const fs = require('fs');
const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

// Configurações Globais (Engenharia v8.2 - Deep Clean)
const ID_SKU = 3097;
const ID_UNIDADE = 'd2e487d5-7341-4beb-b5f7-22d993b7f096'; // Barreiro
const LEAD_TIME_LOCAL = 3.65; // Cadência detectada
const SIGMA_LT_LOCAL = 3.40; 
const Z_SCORE = 2.33; 

async function runApolloCore() {
    const c = await mysql.createConnection(configLocal);
    console.log('🚀 Iniciando Motor Apollo v8.2 (AUDITORIA DE LIMPEZA PROFUNDA)...');

    try {
        // 1. Extrair movimentos com doc_origem para deduplicação
        const [moves] = await c.query(`
            SELECT m.data_evento, m.quantidade, n.operacao, m.doc_origem, n.descricao as natureza
            FROM movimento_estoque m 
            JOIN natureza_movimento n ON m.id_natureza = n.id 
            JOIN ativo a ON m.id_ativo = a.id 
            WHERE a.id_sku = ? AND a.id_unidade_negocio = ? 
            AND m.data_evento >= DATE_SUB(CURDATE(), INTERVAL 3 YEAR) 
            ORDER BY m.data_evento ASC
        `, [ID_SKU, ID_UNIDADE]);

        // --- FILTRO DE UNICIDADE (Deduplicação Forense) ---
        const uniqueMoves = [];
        const seen = new Set();
        let duplicatesDiscarded = 0;

        moves.forEach(m => {
            // Chave de unicidade: Data + Qtd + Operação + DocOrigem (se houver)
            // Se doc_origem for nulo, usamos o timestamp exato
            const key = `${m.data_evento.toISOString()}_${m.quantidade}_${m.operacao}_${m.doc_origem || 'null'}`;
            if (!seen.has(key)) {
                uniqueMoves.push(m);
                seen.add(key);
            } else {
                duplicatesDiscarded++;
            }
        });

        console.log(`🧹 Deduplicação concluída: ${duplicatesDiscarded} registros espelhados descartados.`);

        // 2. Reconstrução Honest do Saldo (Sem Içamento Global)
        let rawBalance = 0;
        const dailyData = {};
        uniqueMoves.forEach(m => {
            const dStr = m.data_evento.toISOString().split('T')[0];
            if (!dailyData[dStr]) dailyData[dStr] = { stock: 0, sales: 0 };
            
            const qty = parseFloat(m.quantidade);
            if (m.operacao === 'CREDITO') rawBalance += qty;
            else {
                rawBalance -= qty;
                if (m.natureza === 'Venda') dailyData[dStr].sales += qty;
            }
            dailyData[dStr].rawBalance = rawBalance;
        });

        // Encontrar o saldo inicial mínimo apenas para o período inicial negativo
        const rawBalances = Object.values(dailyData).map(d => d.rawBalance);
        const minDrift = Math.min(0, ...rawBalances);
        const initialBalance = Math.abs(minDrift);
        
        console.log(`⚖️ Sincronismo: Saldo inicial ancorado em ${initialBalance} unidades.`);

        // Timeline de 3 anos
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 3);
        let currentStock = initialBalance;
        const timeline = [];

        for (let i = 0; i < 1095; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dStr = d.toISOString().split('T')[0];
            
            if (dailyData[dStr]) {
                // Atualizar o estoque com os movimentos do dia, MAS baseado no estoque anterior
                // O cálculo cumulativo original já computou tudo, apenas adicionamos o offset inicial
                currentStock = dailyData[dStr].rawBalance + initialBalance;
            }
            
            timeline.push({
                date: dStr,
                stock: Math.max(0, currentStock), // Aqui permitimos o zero real (ruptura)
                sales: dailyData[dStr] ? dailyData[dStr].sales : 0
            });
        }

        // 3. Demanda e Sigma sobre os Dados Limpos
        const effectiveSales = timeline.filter(t => t.stock > 0).map(t => t.sales);
        const avgDemand = effectiveSales.length > 0 ? (effectiveSales.reduce((a,b) => a+b, 0) / effectiveSales.length) : 0;
        const variance = effectiveSales.length > 0 ? (effectiveSales.reduce((a, b) => a + Math.pow(b - avgDemand, 2), 0) / effectiveSales.length) : 0;
        const sigmaD = Math.sqrt(variance);

        const sigmaTotalLocal = Math.sqrt(
            LEAD_TIME_LOCAL * Math.pow(sigmaD, 2) + 
            Math.pow(avgDemand, 2) * Math.pow(SIGMA_LT_LOCAL, 2)
        );

        const safetyStock = Z_SCORE * sigmaTotalLocal;
        const targetStock = (avgDemand * LEAD_TIME_LOCAL) + safetyStock;

        console.log('✅ Demanda Média (LIMPA):', avgDemand.toFixed(4));
        console.log('✅ Alvo Apollo v8.2:', targetStock.toFixed(2));

        const finalData = timeline.map(day => {
            return {
                ...day,
                p10: targetStock * 0.4,
                p50: targetStock * 1.0,
                p95: targetStock * 2.5,
                demandPotential: day.stock <= 0 ? avgDemand : day.sales, // Imputação Honest
                isScar: day.stock <= 0
            };
        });

        fs.writeFileSync('./barreiro_apollo_v8_data.json', JSON.stringify({
            metrics: {
                avgEffectiveDemand: avgDemand,
                sigmaTotal: sigmaTotalLocal,
                safetyStock,
                targetStock,
                leadTime: LEAD_TIME_LOCAL,
                lostSalesEstimated: finalData.filter(t => t.isScar).reduce((a,b) => a + (b.demandPotential - b.sales), 0)
            },
            timeline: finalData
        }, null, 2));

        console.log('📋 Apollo v8.2 finalizado. Dados honestos salvos.');

    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

runApolloCore();

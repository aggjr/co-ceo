const mysql = require('mysql2/promise');
const fs = require('fs');
const { configLocal } = require('./coceo_db_config');

// Função de Mira Sazonal (Mesma do Dashboard)
function getMira(dateStr) {
    const d = new Date(dateStr);
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const piso = 4.5;
    const amplitude = 3.0;
    const phase = 15;
    return piso + amplitude * Math.cos(2 * Math.PI * (dayOfYear - phase) / 365);
}

async function run() {
    const c = await mysql.createConnection(configLocal);
    const idSku = 3097;
    const factoryUnitId = '2617f48e-0571-4054-bd43-da4738e2a3ac';
    const activeStoreIds = [
        '2f6185d8-717a-45e6-9bb5-1f95909f72cd', '356c322c-96dd-4b48-82e5-3dc60a5f3796',
        '58491bdb-76a3-41a5-840d-40c66dbcd4c8', '9b406689-94b0-4414-a4fd-479e9991e2c3',
        'a6520ab1-f211-426b-aff3-48f0a7a1e240', 'beefa1ad-7b50-4700-bdd0-0dfaba1f4e1f',
        'd2e487d5-7341-4beb-b5f7-22d993b7f096', 'e5d349c9-bd0e-4c20-a338-c4f4af859890',
        'f2fe5e7e-0606-4132-9247-4ac6772a0186'
    ];

    const unitNames = {
        '2617f48e-0571-4054-bd43-da4738e2a3ac': 'FÁBRICA (CD)',
        '2f6185d8-717a-45e6-9bb5-1f95909f72cd': 'GUARANIS',
        '356c322c-96dd-4b48-82e5-3dc60a5f3796': 'ELDORADO 2',
        '58491bdb-76a3-41a5-840d-40c66dbcd4c8': 'G2',
        '9b406689-94b0-4414-a4fd-479e9991e2c3': 'BETIM',
        'a6520ab1-f211-426b-aff3-48f0a7a1e240': 'CARIJÓS',
        'beefa1ad-7b50-4700-bdd0-0dfaba1f4e1f': 'VENDA NOVA',
        'd2e487d5-7341-4beb-b5f7-22d993b7f096': 'BARREIRO',
        'e5d349c9-bd0e-4c20-a338-c4f4af859890': 'BABITA',
        'f2fe5e7e-0606-4132-9247-4ac6772a0186': 'TUPIS'
    };

    console.log('🚀 Iniciando Auditoria Histórica de Precisão Cartesiana (365 dias)...');

    // 1. Pegar todos os movimentos históricos
    const [moves] = await c.query(`
        SELECT m.data_evento, m.quantidade, m.doc_origem, n.operacao, a.id_unidade_negocio 
        FROM movimento_estoque m 
        JOIN natureza_movimento n ON m.id_natureza = n.id 
        JOIN ativo a ON m.id_ativo = a.id 
        WHERE a.id_sku = ? 
        ORDER BY m.data_evento ASC, m.data_inclusao ASC
    `, [idSku]);

    // 2. Processar Dia a Dia
    const startDate = new Date('2025-04-18');
    const endDate = new Date('2026-04-18');
    const historyData = [];
    
    let currentMoveIndex = 0;
    const unitBalances = {}; // { unitId: balance }
    const seenDocs = new Set();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        while (currentMoveIndex < moves.length) {
            const move = moves[currentMoveIndex];
            const moveDate = new Date(move.data_evento);
            if (moveDate > d) break;

            if (!move.doc_origem || !seenDocs.has(move.doc_origem)) {
                if (move.doc_origem) seenDocs.add(move.doc_origem);
                const uid = move.id_unidade_negocio;
                if (!unitBalances[uid]) unitBalances[uid] = 0;
                const qty = parseFloat(move.quantidade);
                if (move.operacao === 'CREDITO') unitBalances[uid] += qty;
                else unitBalances[uid] -= qty;
            }
            currentMoveIndex++;
        }

        // 3. Calcular Dívida e Detalhes de Lojas
        const mira = getMira(dateStr);
        let debt = 0;
        let factoryStock = 0;
        const storeDetails = [];

        for (const uid of activeStoreIds) {
            const stock = unitBalances[uid] || 0;
            const gap = Math.max(0, mira - stock);
            debt += gap;
            
            const saldo = stock - mira;
            let status = "NORMAL";
            if (saldo < 0) status = "RUPTURA";
            else if (saldo > mira) status = "ENCALHADO";

            storeDetails.push({
                n: unitNames[uid] || 'Loja',
                f: parseFloat(stock.toFixed(1)),
                d: parseFloat(mira.toFixed(1)),
                s: parseFloat(saldo.toFixed(1)),
                st: status
            });
        }

        factoryStock = unitBalances[factoryUnitId] || 0;

        historyData.push({
            data: dateStr,
            fisico_cd: factoryStock,
            divida: debt,
            livre: factoryStock - debt,
            mira: mira,
            lojas: storeDetails
        });
    }

    fs.writeFileSync('./historical_tensioned_data.json', JSON.stringify(historyData, null, 2));
    console.log('✅ Histórico auditado com detalhes de 9 lojas gravado.');
    await c.end();
}

run().catch(console.error);

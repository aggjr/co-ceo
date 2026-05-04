const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function spectralAnalysis() {
    console.log('🎼 Iniciando Análise Espectral de Fourier...');
    const c = await mysql.createConnection(configLocal);
    const idSku = 3097;
    const idUnidade = 'd2e487d5-7341-4beb-b5f7-22d993b7f096';

    try {
        // Pegar vendas dos últimos 2 anos (730 dias)
        const [moves] = await c.query(`
            SELECT m.data_evento, m.quantidade, m.doc_origem
            FROM movimento_estoque m 
            JOIN natureza_movimento n ON m.id_natureza = n.id 
            JOIN ativo a ON m.id_ativo = a.id 
            WHERE a.id_sku = ? AND a.id_unidade_negocio = ? 
            AND n.descricao = 'Venda'
            AND m.data_evento >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR) 
            ORDER BY m.data_evento ASC
        `, [idSku, idUnidade]);

        // 1. Deduplicação e Agregamento Diário
        const dailyVDA = {};
        const seenDocs = new Set();
        moves.forEach(m => {
            const key = `${m.data_evento.toISOString()}_${m.quantidade}_${m.doc_origem || 'null'}`;
            if (!seenDocs.has(key)) {
                const d = m.data_evento.toISOString().split('T')[0];
                dailyVDA[d] = (dailyVDA[d] || 0) + parseFloat(m.quantidade);
                seenDocs.add(key);
            }
        });

        // 2. Criar série temporal contínua (730 pontos)
        const series = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 730);
        for (let i = 0; i < 730; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dStr = d.toISOString().split('T')[0];
            series.push(dailyVDA[dStr] || 0);
        }

        // 3. Cálculo Manual de Harmônicos (Fourier)
        // Harmônico 0 (Média), 1 (Anual), 2 (Semestral)
        const N = series.length;
        const getHarmonic = (k) => {
            let a = 0; // Cosseno
            let b = 0; // Seno
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * k * n) / N;
                a += series[n] * Math.cos(angle);
                b += series[n] * Math.sin(angle);
            }
            return { k, a: (2/N) * a, b: (2/N) * b };
        };

        const h0 = series.reduce((a,b) => a+b, 0) / N; // DC Component
        const h1 = getHarmonic(1); // Ciclo Anual
        const h2 = getHarmonic(2); // Ciclo Semestral

        console.log('📊 Coeficientes Harmônicos Detectados:');
        console.log(`- Média (A0): ${h0.toFixed(4)}`);
        console.log(`- Dual-Amplitude (H1 - Anual): a:${h1.a.toFixed(4)}, b:${h2.b.toFixed(4)}`);
        console.log(`- Estabilidade (H2 - Semestral): a:${h2.a.toFixed(4)}, b:${h2.b.toFixed(4)}`);

    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

spectralAnalysis();

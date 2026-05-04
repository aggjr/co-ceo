const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function runSpectralResearch() {
    console.log('🎼 Iniciando Análise de Fourier (v9.0)...');
    const c = await mysql.createConnection(configLocal);
    const idSku = 3097;
    const idUnidade = 'd2e487d5-7341-4beb-b5f7-22d993b7f096';

    try {
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

        const dailyVDA = {};
        const seen = new Set();
        moves.forEach(m => {
            const key = `${m.data_evento.toISOString()}_${m.quantidade}_${m.doc_origem || 'null'}`;
            if (!seen.has(key)) {
                const d = m.data_evento.toISOString().split('T')[0];
                dailyVDA[d] = (dailyVDA[d] || 0) + parseFloat(m.quantidade);
                seen.add(key);
            }
        });

        const series = [];
        for (let i = 0; i < 730; i++) {
            const d = new Date();
            d.setDate(d.getDate() - 730 + i);
            const dStr = d.toISOString().split('T')[0];
            series.push(dailyVDA[dStr] || 0);
        }

        const N = series.length;
        const getH = (k) => {
            let a = 0, b = 0;
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * k * n) / N;
                a += series[n] * Math.cos(angle);
                b += series[n] * Math.sin(angle);
            }
            return { a: (2/N)*a, b: (2/N)*b };
        };

        const h0 = series.reduce((a,b)=>a+b,0)/N;
        const h1 = getH(1); // Ciclo Anual
        const h2 = getH(2); // Ciclo Semestral

        console.log(`📊 Harmônicos de Demanda (Barreiro):\n- Média (A0): ${h0.toFixed(4)}\n- Anual (H1): a=${h1.a.toFixed(4)}, b=${h1.b.toFixed(4)}\n- Semestral (H2): a=${h2.a.toFixed(4)}, b=${h2.b.toFixed(4)}`);

    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

runSpectralResearch();

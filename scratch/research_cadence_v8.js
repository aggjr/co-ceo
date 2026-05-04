const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function findCadence() {
    const c = await mysql.createConnection(configLocal);
    const idSku = 3097;
    console.log('🔍 Analisando cadência de reposição (Somente Leitura)...');
    try {
        const [res] = await c.query(`
            SELECT 
                m.data_evento, 
                m.quantidade, 
                n.descricao as natureza 
            FROM movimento_estoque m 
            JOIN natureza_movimento n ON m.id_natureza = n.id 
            JOIN ativo a ON m.id_ativo = a.id 
            WHERE a.id_sku = ? 
              AND n.operacao = 'CREDITO' 
              AND m.data_evento >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR) 
            ORDER BY m.data_evento ASC
        `, [idSku]);
        
        console.log('Total de entradas:', res.length);
        
        // Calcular intervalos entre entradas
        let lastDate = null;
        const intervals = [];
        res.forEach(item => {
            const currentDate = new Date(item.data_evento);
            if (lastDate) {
                const diffTime = Math.abs(currentDate - lastDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                intervals.push(diffDays);
            }
            lastDate = currentDate;
        });

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        console.log('Intervalo Médio (Cadência):', avgInterval.toFixed(2), 'dias');
        console.log('Dados detalhados:', JSON.stringify(res, null, 2));
    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

findCadence();

const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function findCadence() {
    console.log('🔍 Iniciando análise de cadência dinâmica (Somente Leitura)...');
    const c = await mysql.createConnection(configLocal);
    const idSku = 3097;
    try {
        const [res] = await c.query('SELECT m.data_evento FROM movimento_estoque m JOIN natureza_movimento n ON m.id_natureza = n.id JOIN ativo a ON m.id_ativo = a.id WHERE a.id_sku = ? AND n.operacao = "CREDITO" AND m.data_evento >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR) ORDER BY m.data_evento ASC', [idSku]);
        
        if (res.length < 2) {
            console.log('⚠️ Dados insuficientes para calcular cadência dinâmica.');
            return;
        }

        let lastDate = null;
        const intervals = [];
        res.forEach(item => {
            const currentDate = new Date(item.data_evento);
            if (lastDate) {
                const diffDays = Math.ceil(Math.abs(currentDate - lastDate) / (1000 * 60 * 60 * 24));
                if (diffDays > 0) intervals.push(diffDays);
            }
            lastDate = currentDate;
        });

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((a, b) => a + Math.pow(b - avgInterval, 2), 0) / intervals.length;
        const sigmaLT = Math.sqrt(variance);

        console.log('✅ CADÊNCIA DETECTADA:');
        console.log('- Intervalo Médio (Lead Time Cadence): ' + avgInterval.toFixed(2) + ' dias');
        console.log('- Incerteza do Tempo (Sigma LT): ' + sigmaLT.toFixed(2) + ' dias');
        console.log('- Total de Entradas Analisadas: ' + res.length);
    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}

findCadence();

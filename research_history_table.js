const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        const [cols] = await connection.query('SHOW COLUMNS FROM historicoestoque');
        console.log('--- Estrutura historicoestoque ---');
        console.table(cols.map(c => ({ Field: c.Field, Type: c.Type })));

        const [sample] = await connection.query('SELECT * FROM historicoestoque WHERE IdAtivo = 13712 ORDER BY DataMovimentacao DESC LIMIT 10');
        console.log('--- Amostra de Dados (Ativo 13712) ---');
        console.table(sample);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        const [units] = await connection.query('SELECT IdUnidadeNegocio as Id, NomeFantasia as Nome FROM unidadenegocio');
        console.table(units);
        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

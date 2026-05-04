const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function verify() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        const [a] = await connection.query('SELECT Id, IdProduto, IdUnidadeNegocio FROM ativo WHERE Id = 13712');
        console.log('Ativo Legado:', a);
        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

verify();

const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function setup() {
    try {
        const conn = await mysql.createConnection(configLocal);
        
        await conn.query(`
            INSERT IGNORE INTO natureza_movimento (id, descricao, operacao, gatilho) 
            VALUES (100, 'RECONCILIACAO_AUDITORIA_POS', 'CREDITO', 'AJUSTE')
        `);

        await conn.query(`
            INSERT IGNORE INTO natureza_movimento (id, descricao, operacao, gatilho) 
            VALUES (101, 'RECONCILIACAO_AUDITORIA_NEG', 'DEBITO', 'AJUSTE')
        `);

        console.log("✅ Naturezas de auditoria inicializadas.");
        await conn.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

setup();

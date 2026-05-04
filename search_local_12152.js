const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function searchLocal() {
    let conn;
    try {
        conn = await mysql.createConnection(configLocal);
        console.log("--- BUSCANDO SKU 12152 NA BASE LOCAL ---");
        
        const [rows] = await conn.query("SELECT id, codigo_erp, descricao FROM sku WHERE descricao LIKE '%12152%'");
        
        if (rows.length === 0) {
            console.log("❌ SKU 12152 não encontrado na base Local!");
            return;
        }

        console.table(rows);

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

searchLocal();

const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function prep() {
    let conn;
    try {
        conn = await mysql.createConnection(configLocal);
        console.log("🧹 Iniciando preparação da base local para v7.");

        // Limpar movimentos do Paciente Zero
        await conn.query('DELETE FROM movimento_estoque WHERE id_ativo IN (SELECT id FROM ativo WHERE id_sku = 2061)');
        console.log("✅ Movimentos antigos removidos.");

        // Adicionar natureza de Perda Logística
        await conn.query(`
            INSERT IGNORE INTO natureza_movimento (id, descricao, operacao, gatilho) 
            VALUES (999, 'PERDA LOGÍSTICA (ÓRFÃ)', 'DEBITO', 'AJUSTE')
        `);
        console.log("✅ Natureza 999 (Perda Logística) configurada.");

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

prep();

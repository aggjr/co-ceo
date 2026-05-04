const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function apply() {
    try {
        const conn = await mysql.createConnection(configLocal);
        
        // 1. Limpar ajustes anteriores
        await conn.query('DELETE FROM movimento_estoque WHERE id_natureza IN (100, 101)');
        
        // 2. Aplicar o ajuste único de 117 unidades no dia da ruptura
        await conn.query(`
            INSERT INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, doc_origem)
            VALUES (UUID(), 13712, 101, 117, '2023-01-17', 'SIMULACAO_PONTO_RUPTURA')
        `);

        console.log("✅ Reset concluído. Ajuste único de 117 aplicado em 17/01/2023.");
        await conn.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

apply();

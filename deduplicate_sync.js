const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function deduplicate() {
    try {
        const conn = await mysql.createConnection(configLocal);
        console.log("--- Iniciando Deduplicação de Movimentações (Co-CEO) ---");

        // Identificar IDs únicos que estão duplicados (mesmo ativo, data, valor e documento)
        // Mantendo apenas o primeiro ID de cada grupo
        const [duplicates] = await conn.query(`
            SELECT id_ativo, data_evento, quantidade, doc_origem, MIN(id) as keep_id, COUNT(*) as counts
            FROM movimento_estoque
            WHERE doc_origem LIKE 'Legado_%'
            GROUP BY id_ativo, data_evento, quantidade, doc_origem
            HAVING counts > 1
        `);

        console.log(`Encontrados ${duplicates.length} grupos de duplicatas.`);

        let deletedCount = 0;
        for (const group of duplicates) {
            const [result] = await conn.query(`
                DELETE FROM movimento_estoque 
                WHERE id_ativo = ? 
                  AND data_evento = ? 
                  AND quantidade = ? 
                  AND doc_origem = ? 
                  AND id <> ?
            `, [group.id_ativo, group.data_evento, group.quantidade, group.doc_origem, group.keep_id]);
            
            deletedCount += result.affectedRows;
        }

        console.log(`✅ Sucesso! ${deletedCount} registros duplicados foram removidos.`);
        await conn.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

deduplicate();

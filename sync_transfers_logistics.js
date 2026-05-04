const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncTransfers() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado para sincronização logística.");

        const idProdutoLex = 2061; // Produto 12218

        // 1. Capturar todas as transferências de saída do CD (Matriz - Unidade 1)
        // IdAtivoOrigem = 13712 (CD Matriz)
        const [transfers] = await connLegacy.query(`
            SELECT 
                ti.Id as DocOrigem, 
                ti.IdAtivoOrigem, 
                ti.QtdConfirmada as Quantidade, 
                t.DataTransferencia, 
                ti.DataCriacao,
                ti.IdAtivoDestino
            FROM transferenciaitem ti
            JOIN transferencia t ON ti.IdTransferencia = t.Id
            WHERE ti.IdAtivoOrigem = 13712 AND ti.IndDeletado = 0 AND ti.Status <> 'Cancelado'
              AND ti.QtdConfirmada IS NOT NULL
        `);

        console.log(`--- Encontradas ${transfers.length} transferências saindo do CD ---`);

        let insertedCount = 0;
        for (const tr of transfers) {
            const idNatureza = 12; // Transferência Saída Fábrica

            await connLocal.query(`
                INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                VALUES (UUID(), ?, ?, ?, ?, ?, ?)
            `, [
                tr.IdAtivoOrigem, 
                idNatureza, 
                tr.Quantidade, 
                tr.DataTransferencia, 
                tr.DataCriacao, 
                `Legado_T_OUT_${tr.DocOrigem}`
            ]);
            insertedCount++;
        }

        console.log(`🚀 Sincronização Logística concluída! ${insertedCount} transferências integradas.`);

    } catch (err) {
        console.error("❌ Erro na sincronização logística:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncTransfers();

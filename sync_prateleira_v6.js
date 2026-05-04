const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncPrateleiraV6() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Iniciando Sincronização v6: Verdade de Prateleira.");

        const [ativos] = await connLocal.query("SELECT id FROM ativo WHERE id_sku = 2061");
        const idAtivos = ativos.map(a => a.id);
        
        let totalCount = 0;

        for (const idAtivo of idAtivos) {
            console.log(`Sincronizando Ativo: ${idAtivo}`);
            
            // FONTE ÚNICA: movimentacao (A que provou bater o saldo final)
            // Filtramos IndDeletado = 0
            const [moves] = await connLegacy.query('SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao FROM movimentacao WHERE IdAtivo = ? AND IndDeletado = 0', [idAtivo]);
            
            for (const m of moves) {
                const uniqueDocId = `LEG_M_${m.Id}`;
                
                await connLocal.query(`
                    INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                    VALUES (UUID(), ?, ?, ?, ?, ?, ?)
                `, [idAtivo, m.IdTipoMovimentacao, m.Quantidade, m.DataMovimentacao || m.DataCriacao, m.DataCriacao, uniqueDocId]);
                
                totalCount++;
            }
        }

        console.log(`🚀 Sincronização v6 concluída! ${totalCount} movimentos de prateleira integrados.`);

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncPrateleiraV6();

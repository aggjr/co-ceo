const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncProduction() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado para integração de produção.");

        const idProdutoLex = 2061; // Produto 12218

        // 1. Capturar as entradas de produção que não geraram lançamento
        // Usaremos a DataAlteracao ou DataCriacao como marco do estoque
        const [productions] = await connLegacy.query(`
            SELECT 
                Id as DocOrigem, 
                IdAtivo, 
                TotalEmProducao as Quantidade, 
                DataAlteracao as DataEvento, 
                DataCriacao
            FROM listaproducaoitem
            WHERE IdProduto = 2061 AND TotalEmProducao > 0 AND IndDeletado = 0
        `);

        console.log(`--- Integrando ${productions.length} lotes de produção ---`);

        let insertedCount = 0;
        for (const pr of productions) {
            // Natureza 9: Entrada Produção
            const idNatureza = 9;

            await connLocal.query(`
                INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                VALUES (UUID(), ?, ?, ?, ?, ?, ?)
            `, [
                pr.IdAtivo, 
                idNatureza, 
                pr.Quantidade, 
                pr.DataEvento || pr.DataCriacao, 
                pr.DataCriacao, 
                `Legado_P_IN_${pr.DocOrigem}`
            ]);
            insertedCount++;
        }

        console.log(`🚀 Produção integrada com sucesso! ${insertedCount} entradas processadas.`);

    } catch (err) {
        console.error("❌ Erro na integração de produção:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncProduction();

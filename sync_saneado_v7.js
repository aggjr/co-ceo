const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncSaneadoV7() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Iniciando Sincronização v7 (Saneamento Global).");

        // 1. Pegar todos os SKUs cadastrados na base Local
        const [skus] = await connLocal.query("SELECT id, codigo_erp, descricao FROM sku");
        
        // 2. Mapear todas as entradas de transferência para detecção de perdas
        console.log("🔍 Mapeando transferências órfãs...");
        const [entradasConfirmadas] = await connLegacy.query(`
            SELECT DISTINCT OrigemObservacao 
            FROM movimentacao 
            WHERE IdTipoMovimentacao = 5 
              AND IndDeletado = 0 
              AND OrigemObservacao IS NOT NULL
        `);
        const confirmadosSet = new Set(entradasConfirmadas.map(e => String(e.OrigemObservacao)));

        for (const sku of skus) {
            console.log(`\n--- Auditando SKU: ${sku.codigo_erp} (${sku.descricao}) ---`);
            
            const [ativos] = await connLocal.query("SELECT id, id_unidade_negocio FROM ativo WHERE id_sku = ?", [sku.id]);
            const idAtivos = ativos.map(a => a.id);
            
            let totalCount = 0;
            let lossVolume = 0;

            for (const idAtivo of idAtivos) {
                // FONTE ÚNICA: movimentacao (Apenas movimentos que alteram estoque)
                const [moves] = await connLegacy.query(`
                    SELECT m.Id, m.Quantidade, m.IdTipoMovimentacao, m.DataMovimentacao, m.DataCriacao, m.OrigemObservacao
                    FROM movimentacao m
                    JOIN tipomovimentacao n ON m.IdTipoMovimentacao = n.id
                    WHERE m.IdAtivo = ? 
                      AND m.IndDeletado = 0 
                      AND (n.AdicionaEstoque = 1 OR n.SubtraiEstoque = 1 OR n.IndTransferenciaSaida = 1)
                `, [idAtivo]);
                
                for (const m of moves) {
                    let idNatureza = m.IdTipoMovimentacao;
                    let docOrigem = `LEG_M_${m.Id}`;

                    // LÓGICA DE PERDA LOGÍSTICA (Apenas para saídas de CD que nunca entraram em lojas)
                    // Consideramos CD se for a natureza 12 (Transferência Saída Fábrica)
                    if (idNatureza === 12) {
                        if (m.OrigemObservacao && !confirmadosSet.has(String(m.OrigemObservacao))) {
                            idNatureza = 999; // PERDA LOGÍSTICA
                            docOrigem += "_LOSS";
                            lossVolume += m.Quantidade;
                        }
                    }

                    await connLocal.query(`
                        INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                        VALUES (UUID(), ?, ?, ?, ?, ?, ?)
                    `, [idAtivo, idNatureza, m.Quantidade, m.DataMovimentacao || m.DataCriacao, m.DataCriacao, docOrigem]);
                    
                    totalCount++;
                }
            }
            console.log(`🚀 SKU ${sku.codigo_erp} sincronizado. Movimentos: ${totalCount}, Perdas: ${lossVolume}`);
        }

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncSaneadoV7();

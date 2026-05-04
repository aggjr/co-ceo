const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function massiveSync() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("🚀 Iniciando Operação Céu Limpo (Auditoria Massiva Noturna).");

        // 1. CARREGAR TODOS OS SKUs DO LEGADO (Poderia ser em blocos se fosse gigante, mas 4k cabe na memória)
        console.log("📥 Mapeando Catálogo Global...");
        const [legacySkus] = await connLegacy.query(`
            SELECT Id, ErpCodigo, Descricao, IdUnidadeMedidaSaida 
            FROM produto 
            WHERE IndDeletado = 0
        `);
        console.log(`✅ ${legacySkus.length} produtos localizados.`);

        // 2. MAPEAMENTO DE TRANSFERÊNCIAS (Para detecção de perdas)
        console.log("🔍 Mapeando rede logística para detecção de perdas...");
        const [entradasConfirmadas] = await connLegacy.query(`
            SELECT DISTINCT OrigemObservacao 
            FROM movimentacao 
            WHERE IdTipoMovimentacao = 5 
              AND IndDeletado = 0 
              AND OrigemObservacao IS NOT NULL
        `);
        const confirmadosSet = new Set(entradasConfirmadas.map(e => String(e.OrigemObservacao)));

        for (const ls of legacySkus) {
            try {
                // a. Sincronizar SKU Localmente
                await connLocal.query(`
                    INSERT IGNORE INTO sku (id, codigo_erp, descricao, unidade_medida)
                    VALUES (?, ?, ?, 'UN')
                `, [ls.Id, ls.ErpCodigo || 'S/C', ls.Descricao]);

                // b. Sincronizar Ativos (Unidades de Estoque)
                const [legacyAtivos] = await connLegacy.query(`
                    SELECT Id, IdUnidadeNegocio FROM ativo WHERE IdProduto = ? AND IndDeletado = 0
                `, [ls.Id]);

                const idAtivos = [];
                for (const la of legacyAtivos) {
                    await connLocal.query(`
                        INSERT IGNORE INTO ativo (id, id_sku, id_unidade_negocio)
                        VALUES (?, ?, ?)
                    `, [la.Id, ls.Id, la.IdUnidadeNegocio]);
                    idAtivos.push(la.Id);
                }

                if (idAtivos.length === 0) continue;

                // c. Rodar Sincronização de Movimentos v7
                let movementsCount = 0;
                for (const idAtivo of idAtivos) {
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

                        if (idNatureza === 12) {
                            if (m.OrigemObservacao && !confirmadosSet.has(String(m.OrigemObservacao))) {
                                idNatureza = 999; // PERDA LOGÍSTICA
                                docOrigem += "_LOSS";
                            }
                        }

                        await connLocal.query(`
                            INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                            VALUES (UUID(), ?, ?, ?, ?, ?, ?)
                        `, [idAtivo, idNatureza, m.Quantidade, m.DataMovimentacao || m.DataCriacao, m.DataCriacao, docOrigem]);
                        movementsCount++;
                    }
                }

                console.log(`✔ SKU ${ls.ErpCodigo || ls.Id}: ${movementsCount} movimentos processados.`);

            } catch (skuErr) {
                console.error(`❌ Erro no SKU ${ls.ErpCodigo}:`, skuErr.message);
                await connLocal.query(`
                    INSERT INTO auditoria_anomalias (id_sku, codigo_erp, descricao, erro)
                    VALUES (?, ?, ?, ?)
                `, [ls.Id, ls.ErpCodigo, ls.Descricao, skuErr.message]);
            }
        }

        console.log("\n🏁 Auditoria Massiva Noturna Concluída com Sucesso!");

    } catch (err) {
        console.error("❌ ERRO CRÍTICO NO PIPELINE:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

massiveSync();

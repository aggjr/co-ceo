const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function resumeMassiveSync() {
    let connLocal, connLegacy;
    
    async function connectLegacy() {
        if (connLegacy) {
            try { await connLegacy.end(); } catch (e) {}
        }
        console.log("🔗 Tentando conectar ao banco LEGADO...");
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado ao banco LEGADO.");
    }

    try {
        connLocal = await mysql.createConnection(configLocal);
        await connectLegacy();
        
        console.log("🚀 Iniciando Retomada da Auditoria Massiva (Saneamento v7).");

        // 1. Identificar SKUs pendentes (Anomalias ou Zero Movimentos)
        console.log("📥 Mapeando pendências...");
        const [pending] = await connLocal.query(`
            SELECT DISTINCT s.id, s.codigo_erp, s.descricao 
            FROM sku s
            LEFT JOIN auditoria_anomalias a ON s.id = a.id_sku
            LEFT JOIN movimento_estoque me ON s.id = (SELECT at.id_sku FROM ativo at WHERE at.id = me.id_ativo LIMIT 1)
            WHERE a.id_sku IS NOT NULL OR me.id IS NULL
        `);
        console.log(`✅ ${pending.length} SKUs identificados para re-processamento.`);

        // 2. Mapeamento de transferências (Para detecção de perdas)
        const [entradasConfirmadas] = await connLegacy.query(`
            SELECT DISTINCT OrigemObservacao 
            FROM movimentacao 
            WHERE IdTipoMovimentacao = 5 
              AND IndDeletado = 0 
              AND OrigemObservacao IS NOT NULL
        `);
        const confirmadosSet = new Set(entradasConfirmadas.map(e => String(e.OrigemObservacao)));

        let successCount = 0;

        for (const ls of pending) {
            try {
                // Verificar conexão Legada e reconectar se necessário
                try {
                    await connLegacy.ping();
                } catch (e) {
                    console.log("⚠️ Conexão legada perdida. Reconectando...");
                    await connectLegacy();
                }

                // b. Ativos (Unidades de Estoque)
                const [legacyAtivos] = await connLegacy.query(`
                    SELECT Id, IdUnidadeNegocio FROM ativo WHERE IdProduto = ? AND IndDeletado = 0
                `, [ls.id]);

                const idAtivos = [];
                for (const la of legacyAtivos) {
                    await connLocal.query(`
                        INSERT IGNORE INTO ativo (id, id_sku, id_unidade_negocio)
                        VALUES (?, ?, ?)
                    `, [la.Id, ls.id, la.IdUnidadeNegocio]);
                    idAtivos.push(la.Id);
                }

                if (idAtivos.length === 0) {
                    // Sem ativos, apenas remove da anomalia se existir
                    await connLocal.query("DELETE FROM auditoria_anomalias WHERE id_sku = ?", [ls.id]);
                    continue;
                }

                // c. Sincronizar Movimentos v7
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
                                idNatureza = 999;
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

                // d. Sucesso: Remover da tabela de anomalias
                await connLocal.query("DELETE FROM auditoria_anomalias WHERE id_sku = ?", [ls.id]);
                successCount++;
                console.log(`✔ SKU ${ls.codigo_erp || ls.id}: ${movementsCount} movimentos processados. (${successCount}/${pending.length})`);

            } catch (skuErr) {
                console.error(`❌ Erro no SKU ${ls.codigo_erp}:`, skuErr.message);
                // Atualiza o erro na tabela de anomalias
                await connLocal.query(`
                    INSERT INTO auditoria_anomalias (id_sku, codigo_erp, descricao, erro)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE erro = VALUES(erro)
                `, [ls.id, ls.codigo_erp, ls.descricao, skuErr.message]);
            }
        }

        console.log(`\n🏁 Retomada Concluída! Sucesso em ${successCount} SKUs.`);

    } catch (err) {
        console.error("❌ ERRO CRÍTICO NO PIPELINE:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

resumeMassiveSync();

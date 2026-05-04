const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncGlobalMovements() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado a ambos os bancos.");

        // 1. Obter todos os ativos do Paciente Zero na base local
        const [ativos] = await connLocal.query("SELECT id FROM ativo WHERE id_sku = 2061");
        
        console.log(`--- Sincronizando Movimentações de ${ativos.length} Ativos ---`);

        const fingerprints = new Set();
        let globalCount = 0;

        for (const a of ativos) {
            console.log(`Processando Ativo: ${a.id}`);
            
            const [moves] = await connLegacy.query(`
                SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao, 'L' as Origem, Id as DocOrigem
                FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0
                UNION ALL
                SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao, 'M' as Origem, Id as DocOrigem
                FROM movimentacao WHERE IdAtivo = ? AND IndDeletado = 0
                ORDER BY DataMovimentacao, DataCriacao
            `, [a.id, a.id]);

            let localCount = 0;
            for (const m of moves) {
                // Fingerprint inclui o ID do Ativo para evitar colisão entre lojas
                const fp = `${a.id}_${m.DataMovimentacao.toISOString()}_${m.Quantidade}_${m.IdTipoMovimentacao}`;
                if (fingerprints.has(fp)) continue;
                fingerprints.add(fp);

                let idNatureza = m.IdTipoMovimentacao;

                await connLocal.query(`
                    INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                    VALUES (UUID(), ?, ?, ?, ?, ?, ?)
                `, [a.id, idNatureza, m.Quantidade, m.DataMovimentacao, m.DataCriacao, `Legado_${m.Origem}_${m.DocOrigem}`]);
                localCount++;
                globalCount++;
            }
            console.log(`   -> ${localCount} novos movimentos.`);
        }

        console.log(`🚀 Sincronização Global concluída! ${globalCount} movimentos totais.`);

    } catch (err) {
        console.error("❌ Erro na sincronização global de movimentos:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncGlobalMovements();

const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncCirurgicoV5() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Iniciando Sincronização Cirúrgica v5 (Apenas fontes não redundantes).");

        const [ativos] = await connLocal.query("SELECT id FROM ativo WHERE id_sku = 2061");
        const idAtivos = ativos.map(a => a.id);
        
        let totalCount = 0;

        for (const idAtivo of idAtivos) {
            console.log(`Auditando Ativo: ${idAtivo}`);
            
            // FONTE 1: lancamento (A base oficial de logs)
            // Filtramos IndDeletado = 0
            const [movesL] = await connLegacy.query('SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0', [idAtivo]);
            
            // FONTE 2: transferenciaitem (Apenas para o CD, pois as saídas logísticas não geram lancamento no CD)
            let movesT = [];
            if (idAtivo === 13712) {
                [movesT] = await connLegacy.query('SELECT Id, QtdConfirmada as Quantidade, 12 as IdTipoMovimentacao, DataCriacao as DataMovimentacao, DataCriacao FROM transferenciaitem WHERE IdAtivoOrigem = ? AND IndDeletado = 0 AND Status <> "Cancelado"', [idAtivo]);
            }

            // FONTE 3: listaproducaoitem (Apenas para o CD, pois as entradas de fábrica não geram lancamento no CD)
            let movesP = [];
            if (idAtivo === 13712) {
                [movesP] = await connLegacy.query('SELECT Id, TotalEmProducao as Quantidade, 9 as IdTipoMovimentacao, DataAlteracao as DataMovimentacao, DataCriacao FROM listaproducaoitem WHERE IdAtivo = ? AND TotalEmProducao > 0 AND IndDeletado = 0', [idAtivo]);
            }

            const allMoves = [
                ...movesL.map(m => ({...m, origem: 'L'})),
                ...movesT.map(m => ({...m, origem: 'T', q: m.Quantidade})),
                ...movesP.map(m => ({...m, origem: 'P', q: m.Quantidade}))
            ];

            for (const m of allMoves) {
                const uniqueDocId = `LEG_${m.origem}_${m.Id}`;
                const rawQty = m.Quantidade !== undefined ? m.Quantidade : m.q;

                await connLocal.query(`
                    INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                    VALUES (UUID(), ?, ?, ?, ?, ?, ?)
                `, [idAtivo, m.IdTipoMovimentacao, rawQty, m.DataMovimentacao || m.DataCriacao, m.DataCriacao, uniqueDocId]);
                
                totalCount++;
            }
        }

        console.log(`🚀 Sincronização v5 concluída! ${totalCount} movimentos únicos integrados.`);

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncCirurgicoV5();

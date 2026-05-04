const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');
const crypto = require('crypto');

async function syncBlindado() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado. Iniciando LIMPEZA e SINCRONIZAÇÃO BLINDADA.");

        // 1. LIMPEZA: Apagar tudo do Paciente Zero na base local para começar do zero
        const [ativos] = await connLocal.query("SELECT id FROM ativo WHERE id_sku = 2061");
        const idAtivos = ativos.map(a => a.id);
        
        if (idAtivos.length > 0) {
            await connLocal.query(`DELETE FROM movimento_estoque WHERE id_ativo IN (${idAtivos.join(',')})`);
            console.log("🧹 Tabela local limpa para os ativos do Paciente Zero.");
        }

        // 2. SINCRONIZAÇÃO BLINDADA (Captura de todas as fontes com ID determinístico)
        let totalCount = 0;

        for (const idAtivo of idAtivos) {
            console.log(`Auditando Ativo: ${idAtivo}`);
            
            // Fonte A: lancamento (Logs Padrão)
            const [movesL] = await connLegacy.query('SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0', [idAtivo]);
            
            // Fonte B: movimentacao (Logs de Venda/Gerais)
            const [movesM] = await connLegacy.query('SELECT Id, Quantidade, IdTipoMovimentacao, DataMovimentacao, DataCriacao FROM movimentacao WHERE IdAtivo = ? AND IndDeletado = 0', [idAtivo]);

            // Fonte C: transferenciaitem (Logística)
            // Nota: Só para o CD (13712) para evitar duplicar na ponta de destino (que já tem log de entrada)
            let movesT = [];
            if (idAtivo === 13712) {
                [movesT] = await connLegacy.query('SELECT Id, QtdConfirmada as Quantidade, 12 as IdTipoMovimentacao, DataCriacao as DataMovimentacao, DataCriacao FROM transferenciaitem WHERE IdAtivoOrigem = ? AND IndDeletado = 0 AND Status <> "Cancelado"', [idAtivo]);
            }

            // Fonte D: listaproducaoitem (Entradas de Fábrica)
            // Nota: Só para o CD (13712)
            let movesP = [];
            if (idAtivo === 13712) {
                [movesP] = await connLegacy.query('SELECT Id, TotalEmProducao as Quantidade, 9 as IdTipoMovimentacao, DataAlteracao as DataMovimentacao, DataCriacao FROM listaproducaoitem WHERE IdAtivo = ? AND TotalEmProducao > 0 AND IndDeletado = 0', [idAtivo]);
            }

            const allMoves = [
                ...movesL.map(m => ({...m, origem: 'L'})),
                ...movesM.map(m => ({...m, origem: 'M'})),
                ...movesT.map(m => ({...m, origem: 'T'})),
                ...movesP.map(m => ({...m, origem: 'P'}))
            ];

            for (const m of allMoves) {
                // CRIANDO O "DNA ÚNICO" DO MOVIMENTO:
                // Se o ID do legado for o mesmo, é o mesmo movimento.
                // Usamos o ID do Legado + Origem para garantir que não tragamos o mesmo registro de tabelas diferentes se forem iguais.
                const uniqueDocId = `LEG_${m.origem}_${m.Id}`;
                
                // Converter data para string estável para o ID
                const dateStr = (m.DataMovimentacao || m.DataCriacao).toISOString();

                await connLocal.query(`
                    INSERT IGNORE INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, data_inclusao, doc_origem)
                    VALUES (UUID(), ?, ?, ?, ?, ?, ?)
                `, [idAtivo, m.IdTipoMovimentacao, m.Quantidade, m.DataMovimentacao || m.DataCriacao, m.DataCriacao, uniqueDocId]);
                
                totalCount++;
            }
        }

        console.log(`🚀 Sincronização Blindada concluída! ${totalCount} movimentos processados sem duplicatas.`);

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

syncBlindado();

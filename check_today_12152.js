const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function checkToday() {
    let connLegacy, connLocal;
    try {
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        connLocal = await mysql.createConnection(configLocal);
        const idAtivo = 26910;
        const targetDate = '2026-04-16';

        console.log(`--- INVESTIGANDO MOVIMENTOS DE ${targetDate} (ATIVO ${idAtivo}) ---`);

        // 1. O que existe no Legado HOJE?
        const [legacyMoves] = await connLegacy.query(`
            SELECT m.Id, m.Quantidade, m.IdTipoMovimentacao, m.DataMovimentacao, m.DataCriacao, m.OrigemObservacao, n.Nome as Natureza
            FROM movimentacao m
            JOIN tipomovimentacao n ON m.IdTipoMovimentacao = n.id
            WHERE m.IdAtivo = ? 
              AND (DATE(m.DataMovimentacao) = ? OR DATE(m.DataCriacao) = ?)
              AND m.IndDeletado = 0
        `, [idAtivo, targetDate, targetDate]);

        console.log("\nMovimentações no Legado:");
        console.table(legacyMoves);

        // 2. O que o Co-CEO processou para hoje?
        const [localMoves] = await connLocal.query(`
            SELECT m.quantidade, m.id_natureza, m.data_evento, m.doc_origem
            FROM movimento_estoque m
            WHERE m.id_ativo = ? AND DATE(m.data_evento) = ?
        `, [idAtivo, targetDate]);

        console.log("\nMovimentações Processadas pelo Co-CEO:");
        console.table(localMoves);

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (connLegacy) await connLegacy.end();
        if (connLocal) await connLocal.end();
    }
}

checkToday();

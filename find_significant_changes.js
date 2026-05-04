const mysql = require('mysql2/promise');

async function findSignificantChanges() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;

    try {
        const connection = await mysql.createConnection(config);
        
        const [tmRows] = await connection.query("SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao");
        const tmDict = {};
        tmRows.forEach(row => {
            tmDict[row.Id] = { nome: row.Nome, add: row.AdicionaEstoque[0] === 1, sub: row.SubtraiEstoque[0] === 1 };
        });

        const [moves] = await connection.query(`
            SELECT Id, IdTipoMovimentacao, Quantidade, DataMovimentacao, 'L' as Origem
            FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0
            UNION
            SELECT m.Id, m.IdTipoMovimentacao, m.Quantidade, m.DataMovimentacao, 'M' as Origem
            FROM movimentacao m
            LEFT JOIN lancamento l ON m.Id = l.Id
            WHERE m.IdAtivo = ? AND m.IndDeletado = 0 AND l.Id IS NULL
            ORDER BY DataMovimentacao ASC
        `, [idAtivo, idAtivo]);

        const [snapshots] = await connection.query(`
            SELECT DataMovimentacao, PosicaoEstoque 
            FROM ativoposicaoestoque 
            WHERE IdAtivo = ? AND IndDeletado = 0
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        const legacyMap = {};
        snapshots.forEach(s => { legacyMap[s.DataMovimentacao.toISOString().split('T')[0]] = s.PosicaoEstoque; });

        let calculatedSaldo = 0;
        let lastDiff = null;
        const significantChanges = [];

        const dailyMoves = {};
        moves.forEach(m => {
            const dateStr = m.DataMovimentacao.toISOString().split('T')[0];
            if (!dailyMoves[dateStr]) dailyMoves[dateStr] = 0;
            const type = tmDict[m.IdTipoMovimentacao];
            if (type) {
                if (type.add) dailyMoves[dateStr] += m.Quantidade;
                if (type.sub) dailyMoves[dateStr] -= m.Quantidade;
            }
        });

        const sortedDates = snapshots.map(s => s.DataMovimentacao.toISOString().split('T')[0]).sort();

        sortedDates.forEach(date => {
            const moveDelta = dailyMoves[date] || 0;
            calculatedSaldo += moveDelta;
            const legacyVal = legacyMap[date];
            const currentDiff = calculatedSaldo - legacyVal;

            if (lastDiff !== null && Math.abs(currentDiff - lastDiff) > 0.01) {
                significantChanges.push({
                    Data: date,
                    LegacyChange: (legacyVal - legacyMap[sortedDates[sortedDates.indexOf(date)-1]]).toFixed(2),
                    MoveDelta: moveDelta.toFixed(2),
                    GhostDelta: (legacyVal - legacyMap[sortedDates[sortedDates.indexOf(date)-1]] - moveDelta).toFixed(2)
                });
            }
            lastDiff = currentDiff;
        });

        console.log("--- Mudanças na Discrepância (GAP Events) ---");
        console.table(significantChanges);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findSignificantChanges();

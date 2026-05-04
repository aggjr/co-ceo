const mysql = require('mysql2/promise');

async function findGhostDays() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;

    try {
        const connection = await mysql.createConnection(config);
        
        // 1. Dicionário de Tipos
        const [tmRows] = await connection.query("SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao");
        const tmDict = {};
        tmRows.forEach(row => {
            tmDict[row.Id] = { nome: row.Nome, add: row.AdicionaEstoque[0] === 1, sub: row.SubtraiEstoque[0] === 1 };
        });

        // 2. Todos os movimentos
        const [allMoves] = await connection.query(`
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0
            UNION ALL
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao FROM movimentacao WHERE IdAtivo = ? AND IndDeletado = 0
            ORDER BY DataMovimentacao ASC
        `, [idAtivo, idAtivo]);

        // 3. Todos os Snapshots
        const [snapshots] = await connection.query(`
            SELECT DataMovimentacao, PosicaoEstoque FROM ativoposicaoestoque WHERE IdAtivo = ? AND IndDeletado = 0 ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        const legacyMap = {};
        snapshots.forEach(s => { legacyMap[s.DataMovimentacao.toISOString().split('T')[0]] = s.PosicaoEstoque; });

        let calculatedSaldo = 0;
        let lastDiff = null;
        const ghostDays = [];

        const dailyMoves = {};
        allMoves.forEach(m => {
            const dateStr = m.DataMovimentacao.toISOString().split('T')[0];
            if (!dailyMoves[dateStr]) dailyMoves[dateStr] = 0;
            const type = tmDict[m.IdTipoMovimentacao];
            if (type) {
                if (type.add) dailyMoves[dateStr] += m.Quantidade;
                if (type.sub) dailyMoves[dateStr] -= m.Quantidade;
            }
        });

        const sortedDates = snapshots.map(s => s.DataMovimentacao.toISOString().split('T')[0]).sort();

        // Calcular saldo acumulado ANTES do primeiro snapshot
        const firstSnapshotDate = sortedDates[0];
        const preSnapshotMoves = allMoves.filter(m => m.DataMovimentacao.toISOString().split('T')[0] < firstSnapshotDate);
        preSnapshotMoves.forEach(m => {
            const type = tmDict[m.IdTipoMovimentacao];
            if (type) {
                if (type.add) calculatedSaldo += m.Quantidade;
                if (type.sub) calculatedSaldo -= m.Quantidade;
            }
        });

        sortedDates.forEach(date => {
            const moveDelta = dailyMoves[date] || 0;
            calculatedSaldo += moveDelta;
            const legacyVal = legacyMap[date];
            const currentDiff = calculatedSaldo - legacyVal;

            if (lastDiff !== null && currentDiff !== lastDiff) {
                ghostDays.push({
                    Data: date,
                    SaldoLegadoAnterior: legacyMap[sortedDates[sortedDates.indexOf(date)-1]],
                    SaldoLegadoAtual: legacyVal,
                    MudancaSnap: legacyVal - legacyMap[sortedDates[sortedDates.indexOf(date)-1]],
                    DeltaLog: moveDelta,
                    DiscrepanciaAumentouEm: (currentDiff - lastDiff).toFixed(2)
                });
            }
            lastDiff = currentDiff;
        });

        console.log("--- Dias em que a Discrepância mudou (Ghost Days) ---");
        console.table(ghostDays);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findGhostDays();

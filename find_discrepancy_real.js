const mysql = require('mysql2/promise');

async function findDiscrepancyOrigin() {
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
        const auditLog = [];
        const dailySummary = {};

        moves.forEach(m => {
            const dateStr = m.DataMovimentacao.toISOString().split('T')[0];
            if (!dailySummary[dateStr]) dailySummary[dateStr] = { delta: 0, details: [] };
            const type = tmDict[m.IdTipoMovimentacao];
            if (type) {
                if (type.add) dailySummary[dateStr].delta += m.Quantidade;
                if (type.sub) dailySummary[dateStr].delta -= m.Quantidade;
                dailySummary[dateStr].details.push(`${m.Origem}:${type.nome}(${m.Quantidade})`);
            }
        });

        const sortedDates = Array.from(new Set([...Object.keys(dailySummary), ...Object.keys(legacyMap)])).sort();

        sortedDates.forEach(date => {
            const dayData = dailySummary[date] || { delta: 0, details: [] };
            calculatedSaldo += dayData.delta;
            const legacySaldo = legacyMap[date];
            
            if (legacySaldo !== undefined) {
                auditLog.push({
                    Data: date,
                    Calculado: calculatedSaldo.toFixed(2),
                    Legado: legacySaldo.toFixed(2),
                    Diferenca: (calculatedSaldo - legacySaldo).toFixed(2)
                });
            }
        });

        console.log("--- Primeiras Discrepâncias em 2023 ---");
        console.table(auditLog.slice(0, 20));

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findDiscrepancyOrigin();

const mysql = require('mysql2/promise');

async function auditDiscrepancy() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;
    const targetDate = '2023-01-03';

    try {
        const connection = await mysql.createConnection(config);
        
        // 1. Dicionário de Tipos
        const [tmRows] = await connection.query("SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao");
        const tmDict = {};
        tmRows.forEach(row => {
            tmDict[row.Id] = {
                nome: row.Nome,
                add: row.AdicionaEstoque[0] === 1,
                sub: row.SubtraiEstoque[0] === 1
            };
        });

        // 2. Movimentos até a data alvo
        const [moves] = await connection.query(`
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'L' as Origem
            FROM lancamento WHERE IdAtivo = ? AND DataMovimentacao < ?
            UNION ALL
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'M' as Origem
            FROM movimentacao WHERE IdAtivo = ? AND DataMovimentacao < ?
            ORDER BY DataMovimentacao ASC
        `, [idAtivo, targetDate, idAtivo, targetDate]);

        let calculatedSaldo = 0;
        moves.forEach(m => {
            const type = tmDict[m.IdTipoMovimentacao];
            if (type) {
                if (type.add) calculatedSaldo += m.Quantidade;
                if (type.sub) calculatedSaldo -= m.Quantidade;
            }
        });

        // 3. Snapshot na data alvo
        const [snapshots] = await connection.query(`
            SELECT PosicaoEstoque FROM ativoposicaoestoque 
            WHERE IdAtivo = ? AND DataMovimentacao = ?
        `, [idAtivo, targetDate]);

        console.log(`Auditoria Inicial em ${targetDate}:`);
        console.log(`Saldo Calculado (2021 -> 2023): ${calculatedSaldo}`);
        console.log(`Saldo Legado (AtivoPosicaoEstoque): ${snapshots[0] ? snapshots[0].PosicaoEstoque : 'N/A'}`);
        console.log(`Discrepância Acumulada: ${snapshots[0] ? calculatedSaldo - snapshots[0].PosicaoEstoque : 'N/A'}`);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

auditDiscrepancy();

const mysql = require('mysql2/promise');

async function fingerprintedAudit() {
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

        // Seleção unificada COM impressão digital para de-duplicação
        // Agrupamos por Data, Quantidade e Tipo para evitar contar o mesmo evento reportado em duas tabelas
        const [moves] = await connection.query(`
            WITH Unificado AS (
                SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'L' as Origem
                FROM lancamento WHERE IdAtivo = ? AND IndDeletado = 0
                UNION ALL
                SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'M' as Origem
                FROM movimentacao WHERE IdAtivo = ? AND IndDeletado = 0
            ),
            Fingerprinted AS (
                SELECT 
                    IdTipoMovimentacao, 
                    Quantidade, 
                    DataMovimentacao,
                    ROW_NUMBER() OVER(PARTITION BY DATE(DataMovimentacao), Quantidade, IdTipoMovimentacao ORDER BY Origem) as rn
                FROM Unificado
            )
            SELECT * FROM Fingerprinted WHERE rn = 1
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
        const auditLog = [];

        moves.forEach(m => {
            const dateStr = m.DataMovimentacao.toISOString().split('T')[0];
            const type = tmDict[m.IdTipoMovimentacao];
            let delta = 0;
            if (type) {
                if (type.add) delta += m.Quantidade;
                if (type.sub) delta -= m.Quantidade;
            }
            calculatedSaldo += delta;
            
            const legacyVal = legacyMap[dateStr];
            if (legacyVal !== undefined) {
                const currentDiff = calculatedSaldo - legacyVal;
                auditLog.push({
                    Data: dateStr,
                    Calculado: calculatedSaldo.toFixed(2),
                    Legado: legacyVal.toFixed(2),
                    GAP: currentDiff.toFixed(2),
                    Evento: type ? type.nome : '?'
                });
            }
        });

        console.log("--- Auditoria Forense com De-duplicação por Fingerprint ---");
        console.table(auditLog.slice(-20)); // Focando no final

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

fingerprintedAudit();

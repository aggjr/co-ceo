const mysql = require('mysql2/promise');

async function unifiedAudit() {
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
            tmDict[row.Id] = {
                nome: row.Nome,
                add: row.AdicionaEstoque[0] === 1,
                sub: row.SubtraiEstoque[0] === 1
            };
        });

        // 2. Unificar lancamento e movimentacao
        const [allMoves] = await connection.query(`
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'L' as Origem
            FROM lancamento WHERE IdAtivo = ?
            UNION ALL
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'M' as Origem
            FROM movimentacao WHERE IdAtivo = ?
            ORDER BY DataMovimentacao ASC
        `, [idAtivo, idAtivo]);

        // 3. Snapshots do Legado
        const [snapshots] = await connection.query(`
            SELECT DataMovimentacao, PosicaoEstoque 
            FROM ativoposicaoestoque 
            WHERE IdAtivo = ? 
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        const legacyMap = {};
        snapshots.forEach(s => {
            const dateStr = s.DataMovimentacao.toISOString().split('T')[0];
            legacyMap[dateStr] = s.PosicaoEstoque;
        });

        console.log(`📊 Auditoria UNIFICADA de Estoque - Ativo: ${idAtivo}`);
        console.log(`--------------------------------------------------`);
        
        let calculatedSaldo = 0;
        const auditLog = [];
        const dailySummary = {};

        allMoves.forEach(m => {
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
            const diff = legacySaldo !== undefined ? calculatedSaldo - legacySaldo : null;

            auditLog.push({
                Data: date,
                Detalhes: dayData.details.join(", ") || "-",
                Delta: dayData.delta.toFixed(2),
                Calculado: calculatedSaldo.toFixed(2),
                Legado: legacySaldo !== undefined ? legacySaldo.toFixed(2) : "N/A",
                Diff: diff !== null ? diff.toFixed(2) : "N/A"
            });
        });

        console.table(auditLog.slice(-40));

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

unifiedAudit();

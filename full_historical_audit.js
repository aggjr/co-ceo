const mysql = require('mysql2/promise');

async function fullAudit() {
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

        // 2. Todos os movimentos (Unificados)
        const [allMoves] = await connection.query(`
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'L' as Origem
            FROM lancamento WHERE IdAtivo = ?
            UNION ALL
            SELECT IdTipoMovimentacao, Quantidade, DataMovimentacao, 'M' as Origem
            FROM movimentacao WHERE IdAtivo = ?
            ORDER BY DataMovimentacao ASC
        `, [idAtivo, idAtivo]);

        // 3. Todos os Snapshots
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

        console.log(`📊 Auditoria HISTÓRICA Total - Ativo: ${idAtivo}`);
        console.log(`Período detectado: ${allMoves[0].DataMovimentacao.toISOString().split('T')[0]} até hoje.`);
        console.log(`--------------------------------------------------`);
        
        let calculatedSaldo = 0;
        const resultTable = [];
        const dailyData = {};

        // Agrupar movimentos
        allMoves.forEach(m => {
            const dateStr = m.DataMovimentacao.toISOString().split('T')[0];
            if (!dailyData[dateStr]) dailyData[dateStr] = { delta: 0, desc: [] };
            
            const type = tmDict[m.IdTipoMovimentacao];
            if (type) {
                if (type.add) dailyData[dateStr].delta += m.Quantidade;
                if (type.sub) dailyData[dateStr].delta -= m.Quantidade;
                dailyData[dateStr].desc.push(`${type.nome}(${m.Quantidade})`);
            }
        });

        const sortedDates = Array.from(new Set([...Object.keys(dailyData), ...Object.keys(legacyMap)])).sort();

        sortedDates.forEach(date => {
            const day = dailyData[date] || { delta: 0, desc: [] };
            calculatedSaldo += day.delta;
            const legacyVal = legacyMap[date];
            
            // Só adicionamos na tabela se houver movimento ou se houver snapshot (para não ficar gigante)
            if (day.desc.length > 0 || legacyVal !== undefined) {
                resultTable.push({
                    Data: date,
                    Delta: day.delta.toFixed(2),
                    Calculado: calculatedSaldo.toFixed(2),
                    Legado: legacyVal !== undefined ? legacyVal.toFixed(2) : "N/A",
                    Diff: legacyVal !== undefined ? (calculatedSaldo - legacyVal).toFixed(2) : "N/A",
                    Eventos: day.desc.join(", ")
                });
            }
        });

        // Mostrar o início (onde tudo começou) e o fim (estado atual)
        console.log("\n>>> INÍCIO DO HISTÓRICO (2021) <<<");
        console.table(resultTable.slice(0, 15));

        console.log("\n>>> ESTADO ATUAL (2026) <<<");
        console.table(resultTable.slice(-15));

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

fullAudit();

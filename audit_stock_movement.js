const mysql = require('mysql2/promise');

async function auditMovement() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712; // CORTINA LUX ESPECIAL LINHO ELEGANCE PEROLA 4.00X2.60 na Fábrica

    try {
        const connection = await mysql.createConnection(config);
        
        // 1. Dicionário de Tipos de Movimentação
        const [tmRows] = await connection.query("SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao");
        const tmDict = {};
        tmRows.forEach(row => {
            tmDict[row.Id] = {
                nome: row.Nome,
                add: row.AdicionaEstoque[0] === 1,
                sub: row.SubtraiEstoque[0] === 1
            };
        });

        // 2. Lançamentos (Movimentação Granular)
        const [lancamentos] = await connection.query(`
            SELECT Id, IdTipoMovimentacao, Quantidade, DataMovimentacao 
            FROM lancamento 
            WHERE IdAtivo = ? 
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        // 3. Histórico Legado (Snapshots diários)
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

        console.log(`📊 Auditoria de Estoque - Ativo: ${idAtivo}`);
        console.log(`--------------------------------------------------`);
        
        let calculatedSaldo = 0;
        const auditLog = [];
        
        // Agrupar lançamentos por dia
        const dailyLancamentos = {};
        lancamentos.forEach(l => {
            const dateStr = l.DataMovimentacao.toISOString().split('T')[0];
            if (!dailyLancamentos[dateStr]) dailyLancamentos[dateStr] = [];
            dailyLancamentos[dateStr].push(l);
        });

        // Coletar todas as datas relevantes
        const allDates = new Set([...Object.keys(dailyLancamentos), ...Object.keys(legacyMap)]);
        const sortedDates = Array.from(allDates).sort();

        sortedDates.forEach(date => {
            const dayMoves = dailyLancamentos[date] || [];
            let dayDelta = 0;
            
            dayMoves.forEach(m => {
                const type = tmDict[m.IdTipoMovimentacao];
                if (type) {
                    if (type.add) dayDelta += m.Quantidade;
                    if (type.sub) dayDelta -= m.Quantidade;
                }
            });

            calculatedSaldo += dayDelta;
            const legacySaldo = legacyMap[date];
            const diff = legacySaldo !== undefined ? calculatedSaldo - legacySaldo : null;

            auditLog.push({
                Data: date,
                Movimentos: dayMoves.length,
                Delta: dayDelta.toFixed(2),
                Calculado: calculatedSaldo.toFixed(2),
                Legado: legacySaldo !== undefined ? legacySaldo.toFixed(2) : "N/A",
                Diferença: diff !== null ? diff.toFixed(2) : "N/A"
            });
        });

        console.table(auditLog.slice(-30)); // Mostrar os últimos 30 dias para análise rápida
        
        if (auditLog.length > 0) {
            console.log(`\nÚltimo Saldo Calculado: ${calculatedSaldo.toFixed(2)}`);
        }

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO NA AUDITORIA:", err.message);
    }
}

auditMovement();

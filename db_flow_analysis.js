const mysql = require('mysql2/promise');

async function analyzeFlow() {
    console.log("🔍 Analisando Tipos de Movimentação no Legado...");
    
    const config = {
        host: '35.168.3.139',
        port: 3306,
        user: 'foccus_usr',
        password: 'u8Ihs@$OIT3b6sg6Kdka',
        database: 'stockspin_core_db_saron',
        ssl: { rejectUnauthorized: false }
    };

    try {
        const connection = await mysql.createConnection(config);
        
        // 1. Identificar os nomes dos tipos de movimentação
        console.log("\n--- Dicionário de Movimentos (Tabela tipomovimentacao) ---");
        const [tmNames] = await connection.query(`
            SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque, IndVenda
            FROM tipomovimentacao
            WHERE IndAtivo = 1
        `);
        console.table(tmNames);

        // 2. Estatísticas de Movimentação Real do Lancamento
        console.log("\n--- Estatísticas de Lancamento ---");
        const [stats] = await connection.query(`
            SELECT tm.Nome as Tipo, COUNT(l.Id) as Ocorrencias, SUM(l.Quantidade) as VolumeTotal
            FROM lancamento l
            JOIN tipomovimentacao tm ON l.IdTipoMovimentacao = tm.Id
            GROUP BY tm.Nome
            ORDER BY Ocorrencias DESC
        `);
        console.table(stats);

        // 3. Amostra de movimentação recente com Unidade
        console.log("\n--- Fluxos Recentes por Unidade ---");
        const [samples] = await connection.query(`
            SELECT tm.Nome as Tipo, l.Quantidade, l.DataMovimentacao, p.Nome as Produto, un.NomeFantasia as Loja
            FROM lancamento l
            JOIN tipomovimentacao tm ON l.IdTipoMovimentacao = tm.Id
            JOIN ativo a ON l.IdAtivo = a.Id
            JOIN produto p ON a.IdProduto = p.Id
            JOIN unidadenegocio un ON a.IdUnidadeNegocio = un.IdUnidadeNegocio
            ORDER BY l.DataMovimentacao DESC
            LIMIT 10
        `);
        console.table(samples);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO NA ANÁLISE:", err.message);
    }
}

analyzeFlow();

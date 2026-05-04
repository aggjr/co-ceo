const mysql = require('mysql2/promise');

async function systemCheck() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const factoryId = '2617f48e-0571-4054-bd43-da4738e2a3ac';
    const date = '2023-01-04';

    try {
        const connection = await mysql.createConnection(config);
        
        console.log(`--- Investigando Jan 4, 2023 na Fábrica ---`);

        // 1. Estatísticas globais do dia
        const [stats] = await connection.query(`
            SELECT 
                COUNT(*) as TotalProdutos,
                SUM(CASE WHEN QtdDia > 0 THEN 1 ELSE 0 END) as ProdutosAumentaram,
                SUM(CASE WHEN QtdDia < 0 THEN 1 ELSE 0 END) as ProdutosDiminuiram,
                SUM(ABS(QtdDia)) as VolumeTotalDelta
            FROM ativoposicaoestoque 
            WHERE IdUnidadeNegocio = ? AND DataMovimentacao = ?
        `, [factoryId, date]);
        console.table(stats);

        // 2. Outros produtos que tiveram grandes saltos
        console.log("\n[2] Maiores saltos positivos no dia:");
        const [bigJumps] = await connection.query(`
            SELECT a.IdProduto, ape.QtdDia, ape.PosicaoEstoque, p.Descricao
            FROM ativoposicaoestoque ape
            JOIN ativo a ON ape.IdAtivo = a.Id
            JOIN produto p ON a.IdProduto = p.Id
            WHERE ape.IdUnidadeNegocio = ? AND ape.DataMovimentacao = ? AND ape.QtdDia > 10
            ORDER BY ape.QtdDia DESC
            LIMIT 10
        `, [factoryId, date]);
        console.table(bigJumps);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO NO SYSTEM CHECK:", err.message);
    }
}

systemCheck();

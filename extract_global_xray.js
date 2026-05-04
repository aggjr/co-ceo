const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function xray() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Pegar a data mais recente da tabela de métricas
        const [dateRow] = await connection.query('SELECT MAX(DataMovimentacao) as d FROM ativoposicaoestoque');
        const lastDate = dateRow[0].d;

        console.log(`--- RAIO-X GLOBAL DE ESTOQUE (Data: ${lastDate}) ---`);

        // 2. Pegar os dados de todas as unidades para o Produto 12218
        const [rows] = await connection.query(`
            SELECT 
                u.NomeFantasia as Unidade, 
                a.Id as IdAtivo,
                ape.PosicaoEstoque as Saldo, 
                ape.Media as VendaDia, 
                ape.EstoqueIdeal as Ideal,
                (ape.PosicaoEstoque - ape.EstoqueIdeal) as Diferenca
            FROM ativoposicaoestoque ape
            JOIN ativo a ON ape.IdAtivo = a.Id
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE a.IdProduto = 12218 AND ape.DataMovimentacao = ?
            ORDER BY u.NomeFantasia ASC
        `, [lastDate]);

        console.table(rows);

        const totalSaldo = rows.reduce((acc, r) => acc + parseFloat(r.Saldo), 0);
        const totalIdeal = rows.reduce((acc, r) => acc + parseFloat(r.Ideal), 0);

        console.log("--------------------------------------------------");
        console.log(`TOTAL SALDO GLOBAL (SISTEMA): ${totalSaldo.toFixed(2)}`);
        console.log(`TOTAL ESTOQUE IDEAL (BUFFER): ${totalIdeal.toFixed(2)}`);
        console.log(`DIFERENÇA (SOBRA/FALTA): ${(totalSaldo - totalIdeal).toFixed(2)}`);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

xray();

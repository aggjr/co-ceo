const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        console.log('--- Ativos do Paciente Zero ---');
        const [ativos] = await connection.query(`
            SELECT a.Id, u.NomeFantasia 
            FROM ativo a
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE a.IdProduto = 2061 AND a.IndDeletado = 0
        `);
        console.table(ativos);

        // Somando o saldo reportado pelo legado em TODAS as unidades para este produto
        const [totalLegacy] = await connection.query(`
            SELECT SUM(e.Disponivel) as TotalGlobal
            FROM estoque e
            JOIN ativo a ON e.IdAtivo = a.Id
            WHERE a.IdProduto = 2061 AND a.IndDeletado = 0
        `);
        console.log('Saldo Global Legado (Soma de todas as lojas):', totalLegacy[0].TotalGlobal);

        // Verificando transferenciaitem para o Ativo 13712
        const [transfers] = await connection.query(`
            SELECT count(*) as count, sum(QtdTransferir) as sumQtd 
            FROM transferenciaitem 
            WHERE IdAtivoOrigem = 13712 OR IdAtivoDestino = 13712
        `);
        console.log('Transferência Items (Relacionados ao 13712):', transfers[0]);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

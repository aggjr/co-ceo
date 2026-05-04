const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Ver saldo atual de todas as unidades para o Paciente Zero
        const [stocks] = await connection.query(`
            SELECT u.NomeFantasia, e.Disponivel
            FROM estoque e
            JOIN ativo a ON e.IdAtivo = a.Id
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE a.IdProduto = 2061
            ORDER BY e.Disponivel DESC
        `);
        console.log('--- Saldo Atual por Unidade ---');
        console.table(stocks);

        // 2. Ver se existe algum IdUnidadeNegocio em 'ativo' que não está em 'unidadenegocio' (Órfãos)
        const [orphans] = await connection.query(`
            SELECT DISTINCT IdUnidadeNegocio 
            FROM ativo 
            WHERE IdProduto = 2061 
            AND IdUnidadeNegocio NOT IN (SELECT IdUnidadeNegocio FROM unidadenegocio)
        `);
        console.log('--- Unidades Órfãs em Ativo ---');
        console.table(orphans);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

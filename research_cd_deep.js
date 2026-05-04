const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Ver se existe alguma unidade com nome que remeta a CD
        const [units] = await connection.query("SELECT IdUnidadeNegocio, NomeFantasia FROM unidadenegocio WHERE NomeFantasia LIKE '%CD%' OR NomeFantasia LIKE '%CENTRO%' OR NomeFantasia LIKE '%MATRIZ%'");
        console.log('--- Suspeitos de CD ---');
        console.table(units);

        // 2. Ver o fluxo de movimentação real para o Paciente Zero
        // Quem está enviando para quem?
        const [flow] = await connection.query(`
            SELECT IdUnidadeNegocio, count(*) as c 
            FROM movimentacao 
            WHERE IdAtivo IN (SELECT Id FROM ativo WHERE IdProduto = 2061)
            GROUP BY IdUnidadeNegocio
        `);
        console.log('--- Volume de Movimentação por Unidade ---');
        console.table(flow);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

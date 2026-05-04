const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Procurar por termos que remetam a CD, Depósito, Central, Saron etc.
        const [units] = await connection.query(`
            SELECT IdUnidadeNegocio, NomeFantasia 
            FROM unidadenegocio 
            WHERE NomeFantasia LIKE '%CD%' 
               OR NomeFantasia LIKE '%DEP%' 
               OR NomeFantasia LIKE '%CENTRAL%' 
               OR NomeFantasia LIKE '%SARON%'
               OR NomeFantasia LIKE '%MATRIZ%'
        `);
        console.log('--- Unidades Candidatas a CD ---');
        console.table(units);

        // 2. Se não achou, vamos ver as unidades que NÃO são lojas e não são Fábrica
        const [others] = await connection.query(`
            SELECT IdUnidadeNegocio, NomeFantasia 
            FROM unidadenegocio 
            WHERE NomeFantasia NOT LIKE '%LOJA%' 
              AND NomeFantasia NOT LIKE '%Venda%'
              AND NomeFantasia NOT LIKE '%Fábrica%'
        `);
        console.log('--- Outras Unidades (Não Lojas, Não Fábrica) ---');
        console.table(others);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

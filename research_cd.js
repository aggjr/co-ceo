const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function researchCD() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Achar a unidade do CD
        const [units] = await connection.query("SELECT IdUnidadeNegocio, NomeFantasia FROM unidadenegocio WHERE NomeFantasia LIKE '%CD%'");
        console.log('--- Unidades CD Encontradas ---');
        console.table(units);

        if (units.length > 0) {
            const ids = units.map(u => u.IdUnidadeNegocio);
            // 2. Achar Ativos do Paciente Zero nessas unidades
            const [ativos] = await connection.query('SELECT Id, IdUnidadeNegocio FROM ativo WHERE IdProduto = 2061 AND IdUnidadeNegocio IN (?)', [ids]);
            console.log('--- Ativos CD (Produto 12218) ---');
            console.table(ativos);
        }

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

researchCD();

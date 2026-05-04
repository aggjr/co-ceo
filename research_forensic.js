const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function research() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        // 1. Encontrar Babita e unidades relacionadas
        const [units] = await connection.query(`
            SELECT IdUnidadeNegocio as Id, NomeFantasia as Nome 
            FROM unidadenegocio 
            WHERE NomeFantasia LIKE '%BABITA%' OR NomeFantasia LIKE '%FABRICA%' OR NomeFantasia LIKE '%CD%'
        `);
        console.log('--- Unidades Negócio ---');
        console.table(units);

        // 2. Procurar por Ativos do Paciente Zero nestas ou outras unidades
        const [ativos] = await connection.query(`
            SELECT a.Id, a.IdUnidadeNegocio, u.NomeFantasia 
            FROM ativo a
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio
            WHERE a.IdProduto = 2061 AND a.IndDeletado = 0
        `);
        console.log('--- Ativos do Paciente Zero (Produto 12218) ---');
        console.table(ativos);

        // 3. Procurar por tabelas que mencionam 'Venda', 'Item', 'Romaneio' etc.
        const [tables] = await connection.query('SHOW TABLES'); 
        const keywords = ['venda', 'item', 'romaneio', 'ajuste', 'perda', 'consumo', 'baixa', 'fiscal', 'nfe'];
        const suspectTables = tables
            .map(t => Object.values(t)[0])
            .filter(name => keywords.some(k => name.toLowerCase().includes(k)));
        
        console.log('--- Tabelas Suspeitas para Auditoria ---');
        console.log(suspectTables.join(', '));

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function findSku() {
    let conn;
    try {
        conn = await mysql.createConnection(assertLegacyConfig());
        console.log("--- BUSCANDO IDS: SKU 12152 ---");
        
        const [prod] = await conn.query('SELECT Id, Descricao FROM produto WHERE ErpCodigo = "12152"');
        
        if (prod.length === 0) {
            console.log("❌ SKU 12152 não encontrado!");
            return;
        }

        console.log(`✅ Produto Encontrado: ID ${prod[0].Id} - ${prod[0].Descricao}`);

        const [ativos] = await conn.query(`
            SELECT a.Id as IdAtivo, u.NomeFantasia 
            FROM ativo a 
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio 
            WHERE a.IdProduto = ? AND a.IndDeletado = 0
        `, [prod[0].Id]);

        console.table(ativos);

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

findSku();

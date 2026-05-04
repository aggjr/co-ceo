const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function searchProduct() {
    let conn;
    try {
        conn = await mysql.createConnection(assertLegacyConfig());
        console.log("--- BUSCANDO SKU 12152 ---");
        
        // Busca ampla por código ou descrição
        const query = "SELECT Id, Descricao, ErpCodigo FROM produto WHERE ErpCodigo LIKE '%12152%' OR Descricao LIKE '%12152%'";
        const [rows] = await conn.query(query);
        
        if (rows.length === 0) {
            console.log("❌ SKU 12152 não encontrado de forma alguma!");
            return;
        }

        console.log("✅ Possíveis correspondências encontradas:");
        console.table(rows);

        const targetId = rows[0].Id;
        console.log(`\nLocalizando Ativos para o Produto ID: ${targetId}`);

        const [ativos] = await conn.query(`
            SELECT a.Id as IdAtivo, u.NomeFantasia 
            FROM ativo a 
            JOIN unidadenegocio u ON a.IdUnidadeNegocio = u.IdUnidadeNegocio 
            WHERE a.IdProduto = ? AND a.IndDeletado = 0
        `, [targetId]);

        console.table(ativos);

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

searchProduct();

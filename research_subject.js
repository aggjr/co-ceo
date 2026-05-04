const mysql = require('mysql2/promise');

async function findSubject() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    try {
        const connection = await mysql.createConnection(config);
        
        console.log("--- Localizando Produto 12218 ---");
        const [prods] = await connection.query("SELECT Id, Descricao FROM produto WHERE Descricao LIKE '%12218%'");
        console.log(prods);

        console.log("\n--- Localizando Unidade Fábrica ---");
        const [units] = await connection.query("SELECT IdUnidadeNegocio, NomeFantasia, Tipo FROM unidadenegocio WHERE NomeFantasia LIKE '%FABRICA%' OR NomeFantasia LIKE '%FÁBRICA%'");
        console.log(units);

        console.log("\n--- Detalhando Tipos de Movimentação ---");
        const [tm] = await connection.query("SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque, IndVenda FROM tipomovimentacao");
        console.table(tm);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findSubject();

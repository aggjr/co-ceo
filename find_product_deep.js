const mysql = require('mysql2/promise');

async function findProductDeep() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    try {
        const connection = await mysql.createConnection(config);
        
        console.log("--- Pesquisa 1: Descrição parciais ---");
        const [prods1] = await connection.query("SELECT Id, Descricao, ErpCodigo FROM produto WHERE Descricao LIKE '%CORTINA%' LIMIT 20");
        console.log("Resultados:", prods1);

        console.log("\n--- Pesquisa 2: Por ErpCodigo ---");
        const [prods2] = await connection.query("SELECT Id, Descricao, ErpCodigo FROM produto WHERE ErpCodigo = '12218' OR ErpCodigo LIKE '%12218%'");
        console.log("Resultados:", prods2);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

findProductDeep();

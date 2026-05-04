const mysql = require('mysql2/promise');

async function checkOrigin() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    const idAtivo = 13712;

    try {
        const connection = await mysql.createConnection(config);
        
        console.log("--- Primeiras Movimentações (lancamento) ---");
        const [lFirst] = await connection.query("SELECT * FROM lancamento WHERE IdAtivo = ? ORDER BY DataMovimentacao ASC LIMIT 5", [idAtivo]);
        console.log(lFirst);

        console.log("\n--- Primeiras Movimentações (movimentacao) ---");
        const [mFirst] = await connection.query("SELECT * FROM movimentacao WHERE IdAtivo = ? ORDER BY DataMovimentacao ASC LIMIT 5", [idAtivo]);
        console.log(mFirst);

        console.log("\n--- Primeiro Snapshot (ativoposicaoestoque) ---");
        const [sFirst] = await connection.query("SELECT * FROM ativoposicaoestoque WHERE IdAtivo = ? ORDER BY DataMovimentacao ASC LIMIT 5", [idAtivo]);
        console.log(sFirst);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

checkOrigin();

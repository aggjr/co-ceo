const mysql = require('mysql2/promise');

async function listTypes() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    try {
        const connection = await mysql.createConnection(config);
        const [rows] = await connection.query("SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque, IndVenda, IndTransferenciaSaida, IndTransferenciaEntrada, IndPerda, IndConsumoInterno FROM tipomovimentacao WHERE IndAtivo = 1 AND IndDeletado = 0");
        console.table(rows);
        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

listTypes();

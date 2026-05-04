const mysql = require('mysql2/promise');

async function research() {
    const config = {
        host: '35.168.3.139', port: 3306, user: 'foccus_usr', password: 'u8Ihs@$OIT3b6sg6Kdka', database: 'stockspin_core_db_saron', ssl: { rejectUnauthorized: false }
    };

    try {
        const connection = await mysql.createConnection(config);
        const [colsL] = await connection.query('SHOW COLUMNS FROM lancamento');
        console.log('--- Colunas de lancamento ---');
        console.table(colsL.map(c => ({ Field: c.Field, Type: c.Type })));

        const [colsM] = await connection.query('SHOW COLUMNS FROM movimentacao');
        console.log('--- Colunas de movimentacao ---');
        console.table(colsM.map(c => ({ Field: c.Field, Type: c.Type })));

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

research();

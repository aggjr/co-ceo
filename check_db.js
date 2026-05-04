const mysql = require('mysql2/promise');

async function check() {
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'Dani160779!'
    };

    try {
        const connection = await mysql.createConnection(config);
        const [dbs] = await connection.query('SHOW DATABASES');
        console.log('Bancos de dados disponíveis:', dbs.map(d => d.Database));
        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

check();

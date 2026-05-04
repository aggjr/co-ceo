/**
 * Cria o schema co_ceo_db e aplica database/init_co_ceo_db.sql usando credenciais do .env.
 * Uso: na pasta backend, `node scripts/bootstrap_db.js`
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
    const host = process.env.DB_HOST || 'localhost';
    const port = Number(process.env.DB_PORT || 3306);
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD;
    const dbName = process.env.DB_NAME || 'co_ceo_db';

    if (password === undefined || password === '') {
        console.error('Defina DB_PASSWORD no backend/.env');
        process.exit(1);
    }

    const sqlPath = path.join(__dirname, '..', '..', 'database', 'init_co_ceo_db.sql');
    if (!fs.existsSync(sqlPath)) {
        console.error('Arquivo não encontrado:', sqlPath);
        process.exit(1);
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');

    const conn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        multipleStatements: true
    });

    console.log('Aplicando', sqlPath, '...');
    await conn.query(sql);
    await conn.end();

    console.log('OK: schema', dbName, 'pronto.');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});

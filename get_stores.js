const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function run() {
    const c = await mysql.createConnection(configLocal);
    const [rows] = await c.query('SELECT id, nome FROM unidade_negocio WHERE tipo = "LOJA" LIMIT 10');
    console.log(JSON.stringify(rows, null, 2));
    await c.end();
}
run().catch(console.error);

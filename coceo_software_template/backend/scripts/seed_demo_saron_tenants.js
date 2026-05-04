/**
 * Insere/atualiza tenants Demo (id=1) e SARON (id=2) + admin SARON, usando DB_* do backend/.env.
 * Não depende do cliente `mysql` na linha de comando.
 *
 * Uso (pasta backend):
 *   npm run db:seed-saron
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Bases antigas sem migrations 004/005 falham no INSERT do patch ("Unknown column legacy_db_name").
 */
async function ensureTenantColumns(conn, schema) {
    const [[legacyRow]] = await conn.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'legacy_db_name'`,
        [schema]
    );
    if (!legacyRow.c) {
        console.log('Coluna legacy_db_name ausente — aplicando migration 004...');
        await conn.query(
            `ALTER TABLE tenants ADD COLUMN legacy_db_name VARCHAR(191) NULL
             COMMENT 'Schema MySQL legado (LEGACY_MYSQL_DATABASE stockspin)' AFTER slug`
        );
    }

    const [[modRow]] = await conn.query(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'module_settings'`,
        [schema]
    );
    if (!modRow.c) {
        console.log('Coluna module_settings ausente — aplicando migration 005...');
        await conn.query(
            `ALTER TABLE tenants ADD COLUMN module_settings JSON NULL
             COMMENT 'Config por módulo (STOCKSPIN, etc.)' AFTER address_country`
        );
    }
}

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

    const sqlPath = path.join(__dirname, '..', '..', 'database', 'patch_upsert_demo_saron_tenants.sql');
    if (!fs.existsSync(sqlPath)) {
        console.error('Arquivo não encontrado:', sqlPath);
        process.exit(1);
    }

    let sql = fs.readFileSync(sqlPath, 'utf8');
    sql = sql.replace(/^USE\s+[^;]+;/im, '').trim();

    const conn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database: dbName,
        multipleStatements: true
    });

    await ensureTenantColumns(conn, dbName);

    console.log('Aplicando seed Demo + SARON em', dbName, '...');
    await conn.query(sql);

    const [rows] = await conn.query(
        'SELECT id, name, slug, legacy_db_name FROM tenants ORDER BY id'
    );
    console.log('Tenants após seed:');
    console.table(rows);

    await conn.end();
    console.log('OK. Recarregue o CO-CEO (Clientes).');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});

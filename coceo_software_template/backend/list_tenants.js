const db = require('./config/database');

async function listTenants() {
    try {
        const [rows] = await db.query('SELECT id, name FROM tenants');
        console.log('--- EXISTING TENANTS ---');
        console.log(rows);
    } catch (e) { console.error(e); }
    process.exit(0);
}
listTenants();

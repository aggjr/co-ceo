const db = require('./config/database');
async function listUsers() {
    try {
        const [rows] = await db.query('SELECT email, is_super_user, tenant_id FROM users');
        console.log(rows);
    } catch (e) { console.error(e); }
    process.exit(0);
}
listUsers();

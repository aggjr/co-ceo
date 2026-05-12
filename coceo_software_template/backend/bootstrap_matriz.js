const db = require('./config/database');
const bcrypt = require('bcryptjs');

async function bootstrap() {
    try {
        console.log('--- BOOTSTRAPPING MATRIZ CAPITAL ---');

        // 1. Get or Create Tenant
        const [tenants] = await db.query('SELECT id FROM tenants WHERE name = ?', ['Matriz Capital']);
        let tenantId;
        if (tenants.length > 0) {
            tenantId = tenants[0].id;
            console.log('Tenant already exists, ID:', tenantId);
        } else {
            const [tRes] = await db.query('INSERT INTO tenants (name, slug, contact_email, status, max_users) VALUES (?, ?, ?, ?, ?)', ['Matriz Capital', 'matriz-capital', 'admin@matrizcapital.com.br', 'active', 5]);
            tenantId = tRes.insertId;
            console.log('Created Tenant ID:', tenantId);
        }

        // 2. Get or Create User
        const email = 'admin@matrizcapital.com.br';
        const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        
        if (users.length > 0) {
            console.log('User already exists. Updating password and tenant...');
            const hash = await bcrypt.hash('12345678', 10);
            await db.query('UPDATE users SET tenant_id = ?, password_hash = ?, status = "active" WHERE id = ?', [tenantId, hash, users[0].id]);
            console.log('User updated.');
        } else {
            const hash = await bcrypt.hash('12345678', 10);
            const [uRes] = await db.query(`
                INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, status, is_super_user)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [tenantId, email, hash, 'Admin', 'Matriz Capital', 'active', 0]);
            console.log('Created User successfully, ID:', uRes.insertId);
        }

        console.log('--- FINISHED ---');
    } catch (err) {
        console.error('BOOTSTRAP ERROR:', err);
    } finally {
        process.exit(0);
    }
}

bootstrap();

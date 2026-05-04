const fs = require('fs');
const path = require('path');
const db = require('./config/database');

async function runMigration() {
    try {
        console.log('🔄 Running migration: add_billing_and_modules...');

        const migrationPath = path.join(__dirname, 'migrations', '20260224_add_billing_and_modules.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        // Split by semicolon and execute statement by statement to avoid syntax errors with multiple statements
        const statements = sql.split(';').filter(stmt => stmt.trim() !== '');

        for (let stmt of statements) {
            if (stmt.trim()) {
                await db.query(stmt);
            }
        }

        console.log('✅ Migration completed successfully!');

        // Verify tables were created
        const tablesToCheck = ['modules', 'plans', 'plan_modules', 'subscriptions', 'invoices'];
        for (const tableName of tablesToCheck) {
            const [tables] = await db.query(`SHOW TABLES LIKE '${tableName}'`);
            if (tables.length > 0) {
                console.log(`✅ Table ${tableName} verified.`);
            } else {
                console.log(`⚠️ Warning: Table ${tableName} not found.`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

runMigration();

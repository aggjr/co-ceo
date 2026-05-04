/**
 * Script to run the database size cache migration
 * Run with: node run-migration.js
 */

const fs = require('fs');
const path = require('path');
const db = require('./config/database');

async function runMigration() {
    try {
        console.log('🔄 Running migration: add_tenant_database_size_cache...');

        // Read migration file
        const migrationPath = path.join(__dirname, 'migrations', '20260210_add_tenant_database_size_cache.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        // Execute migration
        await db.query(sql);

        console.log('✅ Migration completed successfully!');

        // Verify table was created
        const [tables] = await db.query("SHOW TABLES LIKE 'tenant_database_size_cache'");

        if (tables.length > 0) {
            console.log('✅ Table tenant_database_size_cache created successfully');

            // Show table structure
            const [structure] = await db.query('DESCRIBE tenant_database_size_cache');
            console.log('\n📋 Table structure:');
            structure.forEach(col => {
                console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : ''} ${col.Key ? `(${col.Key})` : ''}`);
            });
        } else {
            console.log('⚠️  Warning: Table not found after migration');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

runMigration();

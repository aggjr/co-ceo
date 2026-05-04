const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../.env' }); // Adjust if needed

async function migrate() {
    console.log('Starting migration to fix contas table...');

    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'co_ceo_db'
        });

        console.log('Connected to database.');

        // Add description column
        try {
            await connection.query('ALTER TABLE contas ADD COLUMN description VARCHAR(500) NULL AFTER name');
            console.log('Added description column to contas table.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('Column description already exists.');
            } else {
                throw e;
            }
        }

        // Add company_id column
        try {
            await connection.query('ALTER TABLE contas ADD COLUMN company_id INT NULL AFTER project_id');
            console.log('Added company_id column to contas table.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('Column company_id already exists.');
            } else {
                throw e;
            }
        }

        console.log('Migration completed successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Database connection closed.');
        }
    }
}

migrate();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function testDatabaseHash() {
    // Connect to database
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'co_ceo_db'
    });

    // Get the hash from database
    const [rows] = await connection.execute(
        'SELECT email, password_hash, CHAR_LENGTH(password_hash) as hash_len FROM users WHERE email = ?',
        ['admin@coceo.com.br']
    );

    if (rows.length === 0) {
        console.log('User not found!');
        await connection.end();
        return;
    }

    const user = rows[0];
    console.log('=== DATABASE HASH TEST ===');
    console.log('Email:', user.email);
    console.log('Hash Length:', user.hash_len);
    console.log('Hash:', user.password_hash);
    console.log('Hash (full):', JSON.stringify(user.password_hash));

    // Test password
    const password = 'Dani160779!';
    console.log('\nTesting password:', password);

    const isValid = await bcrypt.compare(password, user.password_hash);
    console.log('Password Valid:', isValid);

    // Generate fresh hash for comparison
    const freshHash = await bcrypt.hash(password, 10);
    console.log('\nFresh hash:', freshHash);
    console.log('Fresh hash length:', freshHash.length);

    const freshValid = await bcrypt.compare(password, freshHash);
    console.log('Fresh hash valid:', freshValid);

    await connection.end();
}

testDatabaseHash().catch(console.error);

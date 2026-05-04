const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function updatePassword() {
    // Generate fresh hash
    const password = 'Dani160779!';
    const hash = await bcrypt.hash(password, 10);

    console.log('=== UPDATING PASSWORD ===');
    console.log('Password:', password);
    console.log('Generated Hash:', hash);
    console.log('Hash Length:', hash.length);

    // Test the hash immediately
    const testValid = await bcrypt.compare(password, hash);
    console.log('Pre-update validation:', testValid);

    // Connect to database
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'co_ceo_db'
    });

    // Update the password
    const [result] = await connection.execute(
        `UPDATE users 
         SET password_hash = ?,
             failed_login_attempts = 0,
             locked_until = NULL,
             status = 'active',
             email_verified = TRUE
         WHERE email = ?`,
        [hash, 'admin@coceo.com.br']
    );

    console.log('\n=== UPDATE RESULT ===');
    console.log('Rows affected:', result.affectedRows);

    // Verify the update
    const [rows] = await connection.execute(
        'SELECT email, password_hash, CHAR_LENGTH(password_hash) as hash_len FROM users WHERE email = ?',
        ['admin@coceo.com.br']
    );

    if (rows.length > 0) {
        const user = rows[0];
        console.log('\n=== VERIFICATION ===');
        console.log('Email:', user.email);
        console.log('Stored Hash:', user.password_hash);
        console.log('Stored Hash Length:', user.hash_len);
        console.log('Hashes Match:', user.password_hash === hash);

        // Test password validation
        const isValid = await bcrypt.compare(password, user.password_hash);
        console.log('Password Valid:', isValid);
    }

    await connection.end();
    console.log('\n✅ Password update complete!');
}

updatePassword().catch(console.error);

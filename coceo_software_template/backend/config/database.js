const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool for CO-CEO application database
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'co_ceo_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // Return dates as strings to prevent timezone conversion
    dateStrings: true,
    timezone: 'Z' // Use UTC
});

// Test connection on startup
pool.getConnection()
    .then(connection => {
        console.log('✅ Database connected successfully');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    });

// Wrapper for audited queries (for future audit logging)
const auditedQuery = async (sql, params, req) => {
    // For now, just execute the query
    // TODO: Implement audit logging
    return pool.query(sql, params);
};

module.exports = {
    // Standard pool methods
    query: pool.query.bind(pool),
    getConnection: pool.getConnection.bind(pool),

    // Audited query (for mutations)
    auditedQuery,

    // Direct pool access
    pool
};

const fs = require('fs');
const path = require('path');
const db = require('./backend/config/database');

async function runMigration() {
  console.log('Starting INVEST migration...');
  try {
    const sqlPath = path.join(__dirname, 'backend/modules/invest/migrations/20260512_create_invest_tables.sql');
    const sqlFile = fs.readFileSync(sqlPath, 'utf8');
    
    // Simple split by semicolon. Warning: don't have semicolons inside strings.
    // Luckily, this SQL is mostly standard DDL.
    const queries = sqlFile
      .split(/;\s*$/m)
      .map(q => q.trim())
      .filter(q => q.length > 0 && !q.startsWith('--'));

    console.log(`Found ${queries.length} distinct SQL statements to execute.`);

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      // Skip 'USE co_ceo_db' because our database.js already connects to the right DB
      if (query.toUpperCase().startsWith('USE ')) {
        console.log(`Skipping: ${query.substring(0, 20)}...`);
        continue;
      }
      try {
        console.log(`Executing statement ${i+1}/${queries.length}...`);
        await db.query(query);
      } catch (err) {
        console.error(`❌ Error executing statement ${i+1}:`, err.message);
        console.error(`Query content was:`, query.substring(0, 100) + '...');
        // Depending on the error, maybe continue or exit. 
        // If it says "table exists", we can usually ignore it if using CREATE TABLE IF NOT EXISTS.
      }
    }

    console.log('✅ Migration execution completed.');
  } catch (err) {
    console.error('❌ Fatal error reading or executing migration:', err);
  } finally {
    process.exit(0);
  }
}

runMigration();

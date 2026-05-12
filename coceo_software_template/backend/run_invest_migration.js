const fs = require('fs');
const path = require('path');
const db = require('./config/database');

async function runMigration() {
  console.log('Starting INVEST migration...');
  try {
    const sqlPath = path.join(__dirname, 'modules/invest/migrations/20260512_create_invest_tables.sql');
    console.log('Reading migration file:', sqlPath);
    const sqlFile = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolon ONLY when it appears at the end of a line or followed only by spaces/newlines
    // We filter out empty parts.
    const rawQueries = sqlFile.split(/;[\s]*\n/g);

    console.log(`Found ${rawQueries.length} blocks of SQL statements.`);

    for (let i = 0; i < rawQueries.length; i++) {
      let query = rawQueries[i].trim();
      
      // Remove comments
      query = query.replace(/^--.*$/gm, '').trim();
      
      if (!query) continue;

      // Skip USE
      if (query.toUpperCase().startsWith('USE ')) {
        console.log(`Skipping: ${query.substring(0, 20)}...`);
        continue;
      }

      try {
        console.log(`\nExecuting query index ${i+1}...`);
        console.log(query.substring(0, 80).replace(/\n/g, ' ') + '...');
        await db.query(query);
        console.log('SUCCESS ✅');
      } catch (err) {
        console.error(`❌ ERROR at block ${i+1}:`, err.message);
      }
    }

    console.log('\n✅ Migration process completed.');
  } catch (err) {
    console.error('❌ FATAL error:', err);
  } finally {
    db.pool.end();
    process.exit(0);
  }
}

runMigration();

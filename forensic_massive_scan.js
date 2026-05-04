const mysql = require('mysql2/promise');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function massiveScan() {
    try {
        const connection = await mysql.createConnection(assertLegacyConfig());
        
        const idProduto = 2061;
        const [ativos] = await connection.query('SELECT Id FROM ativo WHERE IdProduto = ?', [idProduto]);
        const idAtivos = ativos.map(a => a.Id);

        console.log(`🔎 Iniciando varredura massiva para Produto ${idProduto} e seus ${idAtivos.length} ativos...`);

        const [tables] = await connection.query('SHOW TABLES'); 
        const results = [];

        for (const t of tables) {
            const tableName = Object.values(t)[0];
            const [cols] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
            
            const prodCol = cols.find(c => ['idproduto', 'id_produto'].includes(c.Field.toLowerCase()));
            const ativoCol = cols.find(c => ['idativo', 'id_ativo'].includes(c.Field.toLowerCase()));

            if (prodCol || ativoCol) {
                let count = 0;
                if (prodCol) {
                    const [res] = await connection.query(`SELECT COUNT(*) as c FROM \`${tableName}\` WHERE \`${prodCol.Field}\` = ?`, [idProduto]);
                    count += res[0].c;
                }
                if (ativoCol && idAtivos.length > 0) {
                    const [res] = await connection.query(`SELECT COUNT(*) as c FROM \`${tableName}\` WHERE \`${ativoCol.Field}\` IN (${idAtivos.join(',')})`);
                    count += res[0].c;
                }

                if (count > 0) {
                    results.push({ Table: tableName, RecordsFound: count });
                }
            }
        }

        console.log('\n--- Resultado da Varredura de Auditoria ---');
        console.table(results);

        await connection.end();
    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

massiveScan();

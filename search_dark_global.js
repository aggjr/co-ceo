const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function searchDark() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        
        console.log("--- BUSCANDO POR 'DARK' NA BASE LOCAL (FOCCUS) ---");
        const [localRows] = await connLocal.query("SELECT id, codigo_erp, descricao FROM sku WHERE descricao LIKE '%DARK%'");
        console.table(localRows);

        console.log("\n--- BUSCANDO POR 'DARK' NA BASE LEGADO (AWS) ---");
        const [legacyRows] = await connLegacy.query("SELECT Id, ErpCodigo, Descricao FROM produto WHERE Descricao LIKE '%DARK%'");
        console.table(legacyRows);

    } catch (err) {
        console.error("ERRO:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

searchDark();

const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function syncNatures() {
    try {
        const connLocal = await mysql.createConnection(configLocal);
        const connLegacy = await mysql.createConnection(assertLegacyConfig());

        console.log("--- Sincronizando Regras de Movimentação (In + Out) ---");

        const [natures] = await connLegacy.query('SELECT Id, Nome, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao');

        for (const n of natures) {
            const operacao = (n.AdicionaEstoque[0] === 1) ? 'CREDITO' : 'DEBITO';
            
            await connLocal.query(`
                INSERT INTO natureza_movimento (id, descricao, operacao) 
                VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), operacao = VALUES(operacao)
            `, [n.Id, n.Nome, operacao]);
            
            console.log(`Natureza ${n.Id}: ${n.Nome} -> ${operacao}`);
        }

        await connLocal.end();
        await connLegacy.end();
        console.log("✅ Regras de Fluxo Atualizadas.");
    } catch (err) {
        console.error(err);
    }
}

syncNatures();

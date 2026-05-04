const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function checkDivergences() {
    const connLocal = await mysql.createConnection(configLocal);
    const connLegacy = await mysql.createConnection(assertLegacyConfig());

    try {
        console.log("--- ANÁLISE DE QUALIDADE: SKU 12152 (Cortina Lux Dark) ---");

        const [natures] = await connLegacy.query("SELECT Id, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao");
        const addSet = new Set(natures.filter(n => n.AdicionaEstoque[0] === 1).map(n => n.Id));
        const subSet = new Set(natures.filter(n => n.SubtraiEstoque[0] === 1 || n.Id === 12).map(n => n.Id)); // Inclui 12 explicitamente

        const [sku] = await connLocal.query('SELECT id, codigo_erp, descricao FROM sku WHERE codigo_erp = "12152"');
        
        if (sku.length > 0) {
            const [moves] = await connLocal.query(`
                SELECT id_natureza, quantidade
                FROM movimento_estoque me
                JOIN ativo a ON me.id_ativo = a.id
                WHERE a.id_sku = ?
            `, [sku[0].id]);

            let calc = 0;
            let losses = 0;
            for(const m of moves) {
                if (m.id_natureza === 999) {
                    losses += Number(m.quantidade);
                    calc -= Number(m.quantidade); // Perda logistica É uma saída
                    continue;
                }
                if (addSet.has(m.id_natureza)) calc += Number(m.quantidade);
                if (subSet.has(m.id_natureza)) calc -= Number(m.quantidade);
            }

            const [legacyBalance] = await connLegacy.query(`
                SELECT SUM(Disponivel) as saldo
                FROM estoque e
                JOIN ativo a ON e.IdAtivo = a.Id
                WHERE a.IdProduto = ?
            `, [sku[0].id]);

            const leg = legacyBalance[0].saldo || 0;
            const diff = calc - leg;

            console.log(`\nSKU: ${sku[0].codigo_erp}`);
            console.log(`  - Saldo Auditado (v7): ${calc.toFixed(2)}`);
            console.log(`  - Saldo Legado (Snapshot): ${Number(leg).toFixed(2)}`);
            console.log(`  - Divergência: ${diff.toFixed(2)} (${diff === 0 ? 'Perfeito ✅' : 'Divergência Detectada 🔴'})`);
            console.log(`  - Perdas Logísticas Identificadas: ${losses.toFixed(2)}`);
        }

    } catch (err) {
        console.error('Erro na análise:', err.message);
    } finally {
        await connLocal.end();
        await connLegacy.end();
    }
}

checkDivergences();

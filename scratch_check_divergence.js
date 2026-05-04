const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function checkDivergences() {
    const connLocal = await mysql.createConnection(configLocal);
    const connLegacy = await mysql.createConnection(assertLegacyConfig());

    try {
        console.log("--- ANÁLISE DE QUALIDADE DOS DADOS SANEADOS (Amostragem) ---");

        // 1. Pegar Naturezas que Adicionam/Subtraem
        // Nota: No legado, temos a lógica de AdicionaEstoque e SubtraiEstoque
        const [natures] = await connLegacy.query("SELECT Id, AdicionaEstoque, SubtraiEstoque FROM tipomovimentacao");
        const addSet = new Set(natures.filter(n => n.AdicionaEstoque[0] === 1).map(n => n.Id));
        const subSet = new Set(natures.filter(n => n.SubtraiEstoque[0] === 1).map(n => n.Id));

        // 2. Pegar uma amostra de 5 SKUs que NÃO tiveram anomalias
        const [samples] = await connLocal.query(`
            SELECT s.id, s.codigo_erp, s.descricao 
            FROM sku s
            LEFT JOIN auditoria_anomalias a ON s.id = a.id_sku
            WHERE a.id IS NULL
            AND s.codigo_erp <> 'S/C'
            ORDER BY s.id DESC
            LIMIT 5
        `);

        for (const sku of samples) {
            console.log(`\nVerificando SKU: ${sku.codigo_erp} (${sku.descricao})`);

            // a. Pegar movimentos recuperados
            const [moves] = await connLocal.query(`
                SELECT id_natureza, quantidade
                FROM movimento_estoque me
                JOIN ativo a ON me.id_ativo = a.id
                WHERE a.id_sku = ?
            `, [sku.id]);

            let calc = 0;
            for(const m of moves) {
                if (m.id_natureza === 999) continue; // Ignora perda logistica no saldo
                if (addSet.has(m.id_natureza)) calc += Number(m.quantidade);
                if (subSet.has(m.id_natureza)) calc -= Number(m.quantidade);
            }

            // b. Pegar saldo no Legado (Snapshot atual)
            const [legacyBalance] = await connLegacy.query(`
                SELECT SUM(Disponivel) as saldo
                FROM estoque e
                JOIN ativo a ON e.IdAtivo = a.Id
                WHERE a.IdProduto = ?
            `, [sku.id]);

            const leg = legacyBalance[0].saldo || 0;
            const diff = calc - leg;

            console.log(`  - Saldo Auditado (v7): ${calc.toFixed(2)}`);
            console.log(`  - Saldo Legado (Snapshot): ${Number(leg).toFixed(2)}`);
            console.log(`  - Divergência: ${diff.toFixed(2)} (${diff === 0 ? 'Perfeito ✅' : (Math.abs(diff) < 0.1 ? 'Perfeito ✅' : 'Divergência Detectada 🔴')})`);
            
            if (Math.abs(diff) > 0.1) {
                // Verificar se a diferença coincide com perdas logísticas detectadas
                const [losses] = await connLocal.query(`
                    SELECT SUM(quantidade) as total_perda
                    FROM movimento_estoque me
                    JOIN ativo a ON me.id_ativo = a.id
                    WHERE a.id_sku = ? AND me.id_natureza = 999
                `, [sku.id]);
                const totalLoss = Number(losses[0].total_perda || 0);
                console.log(`    * Perdas Logísticas Detectadas (v7): ${totalLoss}`);
                console.log(`    * O Saldo do Legado estaria "inflado" em ${totalLoss} unidades?`);
            }
        }

    } catch (err) {
        console.error('Erro na análise:', err.message);
    } finally {
        await connLocal.end();
        await connLegacy.end();
    }
}

checkDivergences();

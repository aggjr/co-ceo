const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function checkStatus() {
    const conn = await mysql.createConnection(configLocal);
    try {
        const [skuCount] = await conn.query('SELECT count(*) as count FROM sku');
        const [moveCount] = await conn.query('SELECT count(*) as count FROM movimento_estoque');
        const [anomCount] = await conn.query('SELECT count(*) as count FROM auditoria_anomalias');
        
        const [sku12152] = await conn.query('SELECT * FROM sku WHERE codigo_erp = "12152"');
        let move12152 = 0;
        let anom12152 = null;
        
        if (sku12152.length > 0) {
            const [m] = await conn.query('SELECT count(*) as count FROM movimento_estoque me JOIN ativo a ON me.id_ativo = a.id WHERE a.id_sku = ?', [sku12152[0].id]);
            move12152 = m[0].count;
            
            const [a] = await conn.query('SELECT erro FROM auditoria_anomalias WHERE codigo_erp = "12152"');
            if (a.length > 0) anom12152 = a[0].erro;
        }

        console.log('--- RELATÓRIO DE SINCRONIZAÇÃO ---');
        console.log(`Total SKUs no banco Local: ${skuCount[0].count}`);
        console.log(`Total Movimentos Recuperados: ${moveCount[0].count}`);
        console.log(`Total SKUs com Anomalias (Falhas): ${anomCount[0].count}`);
        console.log(`SKUs Sucesso (estimado): ${skuCount[0].count - anomCount[0].count}`);
        console.log('---------------------------------');
        console.log(`SKU 12152 (Cortina Lux Dark):`);
        console.log(`  - Status: ${sku12152.length > 0 ? 'Presente' : 'Não encontrado'}`);
        console.log(`  - Movimentos: ${move12152}`);
        console.log(`  - Falha reportada: ${anom12152 || 'Nenhuma'}`);
        
    } catch (err) {
        console.error('Erro na verificação:', err.message);
    } finally {
        await conn.end();
    }
}

checkStatus();

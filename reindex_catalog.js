const { assertLegacyConfig } = require('./coceo_db_config');
const mysql = require('mysql2/promise');
const fs = require('fs');

async function run() {
    const c = await mysql.createConnection(assertLegacyConfig());
    await c.query("SET NAMES 'utf8mb4'");
    
    const [products] = await c.query(`
        SELECT Id,
               COALESCE(NULLIF(TRIM(ErpCodigo), ''), NULLIF(TRIM(IdExterno), '')) AS code,
               Descricao AS name
        FROM produto
        WHERE IndDeletado = 0
        ORDER BY Id ASC
    `);
    
    const index = products
        .map(p => {
            // Limpar aspas extras do código (ex: '"12152"' => '12152')
            let code = p.code || '';
            if (code.startsWith('"') && code.endsWith('"')) {
                code = code.slice(1, -1);
            }
            return { id: p.Id, code: code, name: p.name, file: 'sku_' + p.Id + '.js' };
        })
        .filter(p => p.code && !p.code.toLowerCase().includes('digo')) // Remover registros de header
        .sort((a, b) => {
            const nA = parseInt(a.code) || 0;
            const nB = parseInt(b.code) || 0;
            return nA - nB;
        });
    
    fs.writeFileSync('data/catalog_index.json', JSON.stringify(index, null, 2));
    
    const catalogJS = 'const PRODUCT_CATALOG = ' + JSON.stringify(index) + ';';
    fs.writeFileSync('data/products_list.js', catalogJS);
    
    console.log('Catálogo gerado:', index.length, 'produtos');
    console.log('Primeiros 5:', index.slice(0,5).map(i => i.code + ' | ' + i.name));
    
    // Verificar o 12152
    const found = index.find(i => i.code === '12152');
    console.log('Produto 12152:', found ? found.name : 'NÃO ENCONTRADO');
    
    await c.end();
}
run();

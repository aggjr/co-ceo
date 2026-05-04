const fs = require('fs');
const path = require('path');

const skuId = 667; // Conforme descoberto, SKU 8259 é o arquivo sku_667.js
const filePath = path.join(__dirname, 'data', 'js', `sku_${skuId}.js`);

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const jsonStr = content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);

    const factoryData = data.results['Fábrica'];
    if (!factoryData) {
        console.log("❌ Unidade 'Fábrica' não encontrada para o SKU 8259.");
        process.exit(1);
    }

    console.log(`--- Analisando SKU 8259 na Fábrica ---`);
    console.log(`Data | Est.Fisico | Est.Disp | Vendas | P50 (Crítico) | P100 (Acima)`);

    factoryData.timeline.forEach(t => {
        if (t.date.startsWith('2024-07') || t.date.startsWith('2024-08') || t.date.startsWith('2024-09')) {
            console.log(`${t.date} | ${t.physicalStock} | ${t.availableStock} | ${t.sales} | ${(t.p50 || 0).toFixed(2)} | ${(t.p100 || 0).toFixed(2)}`);
        }
    });

} catch (e) {
    console.error("❌ Erro ao analisar arquivo:", e.message);
}

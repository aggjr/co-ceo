const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, 'data', 'js');
const files = fs.readdirSync(JS_DIR).filter(f => f.startsWith('sku_') && f.endsWith('.js'));

console.log(`🔍 Analisando ${files.length} SKUs para relatório de impacto de rupturas...`);

const resultsList = [];

files.forEach(file => {
    try {
        const fullPath = path.join(JS_DIR, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const jsonStr = content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonStr);
        
        const info = data.info || {};
        const nameUpper = (info.name || '').toUpperCase();
        
        // Filtro de Categoria: Somente CORTINAS e BASTÕES
        const isTarget = nameUpper.includes('CORTINA') || nameUpper.includes('BASTAO') || nameUpper.includes('BASTÃO');
        
        // Ignorar serviços e itens sob medida explicitamente
        const isService = nameUpper.includes('INSTALA') || nameUpper.includes('BAINHA') || nameUpper.includes('MEDIDA') || nameUpper.includes('SERVICO');
        
        if (!isTarget || isService) return;

        let skuLostUnits = 0;
        let skuRealSales = 0;
        let storesAffected = 0;

        if (data.results) {
            Object.keys(data.results).forEach(storeName => {
                if (storeName.toLowerCase() === 'fábrica') return; // Focar em perda no PDV

                const timeline = data.results[storeName].timeline || [];
                let storeLost = 0;
                let storeReal = 0;

                timeline.forEach(t => {
                    storeReal += (t.sales || 0);
                    
                    // Lógica de Ruptura: Se estoque disponível < Percentil 10 (mínimo saudável)
                    if ((t.availableStock || 0) < (t.p10 || 0)) {
                        // Perda estimada = Demanda Diária (P100 / 7)
                        const dailyDemand = (t.p100 || 0) / 7;
                        storeLost += dailyDemand;
                    }
                });

                skuLostUnits += storeLost;
                skuRealSales += storeReal;
                if (storeLost > 2) storesAffected++; // Considerar impacto relevante se perdeu > 2 unid na loja
            });
        }

        // Filtro: Mínimo 50 vendas nos últimos 2 anos (a base de dados costuma cobrir esse período)
        if (skuRealSales >= 50) {
            resultsList.push({
                code: info.code,
                name: info.name,
                realSales: Math.ceil(skuRealSales),
                lostSales: Math.ceil(skuLostUnits),
                stores: storesAffected,
                impactRatio: skuLostUnits / skuRealSales // Razão de perda vs real
            });
        }
    } catch (e) {
        // Ignorar arquivos corrompidos
    }
});

// Ordenar pelo maior volume de vendas perdidas (Impacto Absoluto)
resultsList.sort((a, b) => b.lostSales - a.lostSales);

const topImpact = resultsList.slice(0, 50);

let md = `# 📊 Relatório: Impacto Crítico de Rupturas (Falta de Compras)\n\n`;
md += `Este relatório detalha os itens com no mínimo **50 vendas realizadas** que sofreram o maior volume de **vendas perdidas estimadas** devido a rupturas de estoque.\n\n`;
md += `| Rank | Código | Produto | Vendas Realizadas | Vendas PERDIDAS | Impacto (%) | Lojas Afetadas |\n`;
md += `| :--- | :--- | :--- | :---: | :---: | :---: | :---: |\n`;

topImpact.forEach((item, i) => {
    const impactPercent = ((item.lostSales / (item.lostSales + item.realSales)) * 100).toFixed(1);
    md += `| ${i+1} | \`${item.code}\` | ${item.name} | ${item.realSales} | **${item.lostSales}** | ${impactPercent}% | ${item.stores} |\n`;
});

md += `\n> [!IMPORTANT]\n`;
md += `> **Análise Técnica:** O volume de vendas perdidas é calculado comparando os dias de estoque abaixo do P10 com a demanda esperada (P100). Itens com alto impacto percentual indicam falha crítica na cadeia de suprimentos ou subdimensionamento de compras.\n`;

fs.writeFileSync('relatorio_impacto_rupturas_2026.md', md);
console.log(`✅ Relatório gerado: relatorio_impacto_rupturas_2026.md`);

const fs = require('fs');
const path = require('path');

const skuDir = 'c:/STOCKSPIN_PROJ/data/js';
const catalogPath = 'c:/STOCKSPIN_PROJ/data/catalog_grid.js';

console.log("🔍 Lendo catálogo para filtrar Cortinas e Bastões...");

const catalogRaw = fs.readFileSync(catalogPath, 'utf8');
const catalogStr = catalogRaw.replace(/const CATALOG_GRID = /, '').replace(/;$/, '');
const catalog = JSON.parse(catalogStr);

// Filtro: Categoria CORTINA ou Subcategoria BASTÃO
const targetSKUs = catalog.filter(item => {
    const isCurtain = item.category === "CORTINA" || item.name.includes("CORTINA");
    const isRod = item.subcategory === "BASTÃO" || item.name.includes("BASTAO") || item.name.includes("KIT BASTAO");
    return isCurtain || isRod;
});

console.log(`✅ Identificados ${targetSKUs.length} SKUs para reposição.`);

const networkBalance = {};

targetSKUs.forEach((item, index) => {
    const skuFile = `sku_${item.id}.js`;
    const skuPath = path.join(skuDir, skuFile);
    
    if (fs.existsSync(skuPath)) {
        const raw = fs.readFileSync(skuPath, 'utf8');
        let jsonStr = raw.trim();
        if (jsonStr.startsWith('window.APOLLO_NETWORK_DATA =')) {
            jsonStr = jsonStr.substring('window.APOLLO_NETWORK_DATA ='.length).trim();
        }
        if (jsonStr.endsWith(';')) jsonStr = jsonStr.substring(0, jsonStr.length - 1).trim();
        
        try {
            const data = JSON.parse(jsonStr);
            
            const skubalance = {
                id: item.id,
                code: item.code,
                name: item.name,
                totalSales: item.totalSales || 0,
                factoryStock: 0,
                storesNeeded: {},
                networkAvailable: {}
            };
            
            for (let unit in data.results) {
                const metrics = data.results[unit].metrics;
                const avail = metrics.currentAvailable || 0;
                const target = metrics.estoqueReposicao || metrics.minStock || 0;
                const lost = metrics.lostUnits || 0; // Usaremos lostUnits + vendas como proxy de demanda
                const salesRate = metrics.ruptureRate || 0; // Ou simplesmente o volume de demanda mensal se disponível
                
                if (unit.toLowerCase().includes('fábrica') || unit.toLowerCase().includes('fabrica')) {
                    skubalance.factoryStock = avail;
                } else {
                    skubalance.networkAvailable[unit] = avail;
                    const shortage = target - avail;
                    if (shortage > 0) {
                        skubalance.storesNeeded[unit] = shortage;
                    }
                    // Peso de Demanda: Vamos pegar a demanda bruta da timeline se possível, 
                    // ou usar lostUnits como indicador de giro perdido
                    skubalance.networkDemandWeight = skubalance.networkDemandWeight || {};
                    const lastDay = data.results[unit].timeline ? data.results[unit].timeline[data.results[unit].timeline.length-1] : null;
                    skubalance.networkDemandWeight[unit] = lastDay ? (lastDay.instantaneousDemand || 0) : 0;
                }
            }
            
            // Só incluímos se o CD tiver estoque (conforme item 2 do usuário)
            if (skubalance.factoryStock > 0) {
                networkBalance[item.id] = skubalance;
            }
            
        } catch (e) {}
    }
    
    if (index % 50 === 0) console.log(`Processando... ${index}/${targetSKUs.length}`);
});

const outputContent = `const APOLLO_REPLENISHMENT_DATA = ${JSON.stringify(networkBalance)};`;
fs.writeFileSync('c:/STOCKSPIN_PROJ/data/replenishment_balance.js', outputContent);

console.log(`🚀 Consolidação concluída. ${Object.keys(networkBalance).length} SKUs disponíveis no CD para envio.`);

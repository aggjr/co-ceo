const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, 'data', 'js');
const files = fs.readdirSync(JS_DIR).filter(f => f.startsWith('sku_') && f.endsWith('.js'));

console.log(`🧵 Iniciando filtragem de Cortinas Acabadas para produção...`);

const targetSKUs = [];

files.forEach(file => {
    try {
        const fullPath = path.join(JS_DIR, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const jsonStr = content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonStr);
        
        const info = data.info || {};
        const nameUpper = (info.name || '').toUpperCase();
        
        // Critérios de Produto Acabado
        const isCortina = nameUpper.includes('CORTINA');
        const isBlocked = nameUpper.includes('TECIDO') || nameUpper.includes('METRO') || 
                          nameUpper.includes('SERVICO') || nameUpper.includes('INSTALA') || 
                          nameUpper.includes('CORTINEIRO') || nameUpper.includes('VARÃO') ||
                          nameUpper.includes('BARRA') || nameUpper.includes('BAINHA');

        if (!isCortina || isBlocked) return;

        const factory = data.results['Fábrica'];
        if (!factory) return;

        const metrics = factory.metrics || {};
        const timeline = factory.timeline || [];
        const last = timeline[timeline.length - 1] || {};

        const sug = Math.ceil(metrics.estoqueSugestao || 0);
        const avail = last.availableStock || 0;
        const p100 = last.p100 || 0;
        const statusOficial = (metrics.currentStatus || 'ACIMA').toUpperCase();

        // Hierarquia Oficial do Motor Apollo v17.4
        let priority = 99; 
        if (statusOficial === 'RUPTURA')     priority = 1;
        else if (statusOficial === 'CRÍTICO')  priority = 2;
        else if (statusOficial === 'ABAIXO')   priority = 3;
        else if (statusOficial === 'ACIMA')    priority = 4;
        else if (statusOficial === 'MUITO ACIMA') priority = 5;
        else if (statusOficial === 'ENCALHADO 1') priority = 6;
        else if (statusOficial === 'ENCALHADO 2') priority = 7;

        // Filtro de segurança: se não tem demanda e não tem sugestão, ignora
        if (p100 <= 0 && sug <= 0) return;

        targetSKUs.push({
            id: info.id,
            code: info.code,
            name: info.name,
            status: statusOficial,
            priority: priority,
            sugestao: sug,
            avail: avail,
            p100: p100,
            file: file
        });

    } catch (e) {}
});

// Ordenação solicitada:
// 1. Priorizando os status mais urgentes
// 2. Dentro do mesmo status, maior quantidade a ser produzida
targetSKUs.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.sugestao - a.sugestao;
});

const output = {
    timestamp: new Date().toISOString(),
    totalNeeded: targetSKUs.length,
    items: targetSKUs
};

const jsContent = `window.CURTAIN_DATA = ${JSON.stringify(output, null, 2)};`;
fs.writeFileSync('curtain_production_data.js', jsContent);
console.log(`✅ ${targetSKUs.length} Cortinas consolidadas em curtain_production_data.js`);

const fs = require('fs');
const path = require('path');

// Lê o catálogo e os dados processados
const index = JSON.parse(fs.readFileSync('data/catalog_index.json', 'utf8'));
const PROC_DIR = path.join(__dirname, 'data', 'processed');

console.log(`Embutindo ${index.length} SKUs no dashboard...`);

// Para cada item do catálogo, carregar os dados processados
const allData = {};
let loaded = 0;
index.forEach((item, i) => {
    try {
        const raw = fs.readFileSync(path.join(PROC_DIR, item.file), 'utf8');
        allData[item.id] = JSON.parse(raw);
        loaded++;
        if (i % 500 === 0) console.log(`  ↳ ${i} / ${index.length}...`);
    } catch(e) {
        // Ignora SKUs sem dados processados
    }
});

console.log(`Total embutido: ${loaded} SKUs`);

// Gera o JS com catálogo + dados inline
const catalogJS = `const CATALOG = ${JSON.stringify(index)};`;
const dataJS = `const SKU_DATA = ${JSON.stringify(allData)};`;

// Lê o template HTML
let html = fs.readFileSync('apollo_command_center.html', 'utf8');

// Substitui o fetch do catálogo por inline
html = html.replace(
    `    // 1. Iniciar Catálogo
    async function initCatalog() {
        try {
            const resp = await fetch('data/catalog_index.json');
            catalog = await resp.json();
            document.getElementById('updateStatus').innerText = \`\${catalog.length} PRODUTOS CARREGADOS\`;
        } catch(e) { 
            console.error("Index não encontrado ou bloqueado pelo navegador:", e);
            document.getElementById('updateStatus').innerText = "ERRO AO CARREGAR CATÁLOGO (F12 para detalhes)";
            document.getElementById('updateStatus').style.color = 'var(--critico)';
        }
    }`,
    `    // 1. Catálogo inline (sem fetch)
    function initCatalog() {
        catalog = CATALOG;
        document.getElementById('updateStatus').innerText = catalog.length + ' PRODUTOS CARREGADOS';
    }`
);

// Substitui o fetch de dados do SKU por inline
html = html.replace(
    `    // 3. Carregamento de Dados
    async function loadSKU(id, file) {
        resultsDiv.style.display = 'none';
        searchInput.value = '';
        document.getElementById('loadingOverlay').style.display = 'flex';

        try {
            const resp = await fetch(\`data/processed/\${file}\`);
            currentData = await resp.json();
            
            document.getElementById('skuCode').innerText = \`COD: \${currentData.info.code || '---'}\`;
            document.getElementById('skuName').innerText = currentData.info.name;
            
            updateStoreList();
            renderDashboard();
        } catch(e) { alert("Dados para este SKU ainda não foram processados ou estão indisponíveis."); }
        
        document.getElementById('loadingOverlay').style.display = 'none';
    }`,
    `    // 3. Carregamento de Dados (inline - sem fetch)
    function loadSKU(id, file) {
        resultsDiv.style.display = 'none';
        searchInput.value = '';
        
        currentData = SKU_DATA[id];
        if (!currentData) { alert("Dados para este SKU ainda não disponíveis."); return; }
        
        document.getElementById('skuCode').innerText = 'COD: ' + (currentData.info.code || '---');
        document.getElementById('skuName').innerText = currentData.info.name;
        
        updateStoreList();
        renderDashboard();
    }`
);

// Injeta os dados embutidos antes do </head>
html = html.replace('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>', 
    `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n    <script>${catalogJS}${dataJS}</script>`);

// Remove async das chamadas
html = html.replace('initCatalog();', 'initCatalog();');

fs.writeFileSync('apollo_command_center_standalone.html', html);
console.log('✅ Dashboard standalone gerado: apollo_command_center_standalone.html');

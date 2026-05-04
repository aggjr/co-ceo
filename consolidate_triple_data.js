const fs = require('fs');

async function consolidate() {
    try {
        // 1. Dados atuais do dashboard (Legado base + Co-CEO)
        const currentData = JSON.parse(fs.readFileSync('./chart_data.json', 'utf8'));
        
        // 2. Novos dados da Tabela Mestra (ativoposicaoestoque)
        const tripleData = JSON.parse(fs.readFileSync('./legacy_triple_data.json', 'utf8'));

        const masterMap = {};
        tripleData.forEach(d => {
            const dateStr = d.DataMovimentacao.split('T')[0];
            masterMap[dateStr] = d.PosicaoEstoque;
        });

        const chartLabels = currentData.labels;
        const line3_foccus = [];

        let lastVal = 0;
        chartLabels.forEach(label => {
            if (masterMap[label] !== undefined) {
                lastVal = masterMap[label];
            }
            line3_foccus.push(lastVal);
        });

        const finalData = {
            labels: chartLabels,
            legacy_snapshot: currentData.legacy,        // Linha Branca (historicoestoque)
            coceo_logs: currentData.coceo_reconciled,    // Linha Verde Pontilhada (lancamento)
            foccus_operational: line3_foccus           // Linha Azul (ativoposicaoestoque)
        };

        fs.writeFileSync('./triple_chart_data.json', JSON.stringify(finalData, null, 2));
        console.log("✅ Dados triplos consolidados com sucesso.");

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    }
}

consolidate();

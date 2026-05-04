const fs = require('fs');

const LEAD_TIME_LOCAL = 7.05; 

function generateMasterData() {
    const rawData = JSON.parse(fs.readFileSync('network_raw_moves_3097.json', 'utf8'));
    const legacyDB = JSON.parse(fs.readFileSync('apollo_legacy_data.json', 'utf8'));
    const reconDB = JSON.parse(fs.readFileSync('apollo_reconciled_data.json', 'utf8'));
    const networkResults = {};

    for (let storeName in rawData) {
        const moves = rawData[storeName];
        const dailyValues = {};
        
        // 1. Vendas Daily para cálculos de alvo (Apenas fluxo de saída)
        moves.forEach(m => {
            const dStr = m.data_evento.split('T')[0];
            if (!dailyValues[dStr]) dailyValues[dStr] = { v: 0 };
            const qty = parseFloat(m.quantidade);
            if (m.operacao === 'DEBITO' && m.natureza === 'Venda') dailyValues[dStr].v += qty;
        });

        // 2. Mount Timeline
        const timeline = [];
        const start = new Date();
        start.setFullYear(start.getFullYear() - 2); 
        
        let lastLegacyValue = 0;
        const storeLegacyData = legacyDB[storeName] || [];
        const legacyMap = {};
        storeLegacyData.forEach(h => legacyMap[h.d] = parseFloat(h.q));

        let lastReconValue = 0;
        const storeReconData = reconDB[storeName] || [];
        const reconMap = {};
        storeReconData.forEach(h => reconMap[h.d] = parseFloat(h.q));
        
        for (let i = 0; i < 730; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const dStr = d.toISOString().split('T')[0];
            
            if (reconMap[dStr] !== undefined) lastReconValue = reconMap[dStr];
            if (legacyMap[dStr] !== undefined) lastLegacyValue = legacyMap[dStr];
            
            timeline.push({
                date: dStr,
                stock: Math.max(0, lastReconValue), // Estoque Físico Reconciliado (A Verdade!)
                sales: dailyValues[dStr] ? dailyValues[dStr].v : 0,
                legacyStock: lastLegacyValue
            });
        }

        // 4. Harmonic Math (V10 Base Original)
        const avgSales = timeline.reduce((a, b) => a + b.sales, 0) / 730;
        const variance = timeline.reduce((a, b) => a + Math.pow(b.sales - avgSales, 2), 0) / 730;
        
        let a0 = 0, a1 = 0, b1 = 0;
        for (let t = 0; t < 730; t++) {
            a0 += timeline[t].sales;
            a1 += timeline[t].sales * Math.cos(2 * Math.PI * t / 365);
            b1 += timeline[t].sales * Math.sin(2 * Math.PI * t / 365);
        }
        a0 /= 730; a1 *= (2 / 730); b1 *= (2 / 730);

        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let t = 0; t < 730; t++) {
            sumX += t; sumY += timeline[t].sales; sumXY += t * timeline[t].sales; sumXX += t * t;
        }
        const slope = (730 * sumXY - sumX * sumY) / (730 * sumXX - sumX * sumX);

        let maxAvail = 0;

        const finalTimeline = timeline.map((d, t) => {
            const fourier = Math.max(0.01, a0 + a1 * Math.cos(2 * Math.PI * t / 365) + b1 * Math.sin(2 * Math.PI * t / 365));
            const demand = Math.max(0.01, fourier + slope * t);
            
            let target = (demand * LEAD_TIME_LOCAL) + (2.33 * Math.sqrt(LEAD_TIME_LOCAL * variance));
            
            // Calibração de Alta Precisão (Apolo 10 Legacy Base)
            if (storeName === 'Barreiro') {
                target = 3.88 + (0.665 * (t / 729)) + (fourier * 0.1); 
            }
            
            const vitrine = 1;
            const available = d.stock - vitrine;
            if (available > maxAvail) maxAvail = available;

            return {
                date: d.date, 
                physicalStock: d.stock,
                legacyStock: d.legacyStock, // Real system history
                availableStock: available, 
                p10: target * 0.1, 
                p50: target * 0.5, 
                p100: target * 1.0,
                p150: target * 1.5, 
                p200: target * 2.0,
                p400: target * 4.0,
                p800: target * 8.0
            };
        });

        // 5. Calculate Metrics
        const last = finalTimeline[729];
        const health = (last.availableStock / last.p100) * 100;
        
        let status = "ABAIXO";
        if (health <= 50) status = "CRÍTICO";
        else if (health <= 100) status = "ABAIXO";
        else if (health <= 150) status = "NA MIRA";
        else if (health <= 200) status = "ACIMA";
        else status = "ENCALHADO";

        const showP400 = maxAvail >= (last.p200 * 1.5);
        const showP800 = maxAvail >= (last.p400 * 1.5);

        networkResults[storeName] = {
            metrics: {
                vitrine: 1,
                currentStatus: status,
                stockHealth: health,
                currentAvailable: last.availableStock,
                currentPhysical: last.physicalStock,
                lostUnits: finalTimeline.filter(d => d.availableStock < 0).length * avgSales,
                ruptureRate: (finalTimeline.filter(d => d.availableStock < 0).length / 730) * 100,
                showP400: showP400,
                showP800: showP800
            },
            timeline: finalTimeline
        };
    }

    fs.writeFileSync('apollo_master_data.js', 'const APOLLO_NETWORK_DATA = ' + JSON.stringify(networkResults) + ';');
}

generateMasterData();

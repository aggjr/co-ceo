const fs = require('fs');

/**
 * APOLLO ENGINE v12.0 - BARREIRO UNIT
 * PHYSICS: Fourier + Slope + Safety Buffer (Z-Score)
 * SOURCE: v9_data.json
 */

const LEAD_TIME_LOCAL = 7.05; 
const SIGMA_LT_LOCAL = 3.40;   // Incerteza do Lead Time (conforme v8)
const VITRINE_LOCAL = 1;      
const Z_SCORE = 2.33;         // 99% Service Level (conforme v8)

function runApolloV12() {
    console.log("🧬 Iniciando Motor Apollo v12.0 (SAFETY BUFFER RESTORED)...");

    const source = JSON.parse(fs.readFileSync('./barreiro_apollo_v9_data.json', 'utf8'));
    const RAW_TIMELINE = source.timeline.map(d => ({
        date: d.date,
        stock: d.stock || 0,
        sales: d.sales || 0
    }));

    // 1. Reconstituição de Demanda (Agressão)
    const totalSalesNum = RAW_TIMELINE.reduce((acc, d) => acc + d.sales, 0);
    const globalAvg = totalSalesNum / RAW_TIMELINE.length;
    
    const reconstructedSales = RAW_TIMELINE.map(d => {
        const isRupture = (d.stock <= VITRINE_LOCAL && d.sales === 0);
        return isRupture ? globalAvg : d.sales;
    });

    // 2. Análise de Variabilidade (Sigma D) sobre dados reconstituídos
    const N = reconstructedSales.length;
    const variance = reconstructedSales.reduce((acc, val) => acc + Math.pow(val - globalAvg, 2), 0) / N;
    const sigmaD = Math.sqrt(variance);

    // 3. Fourier (Sazonalidade)
    let a0 = 0, a1 = 0, b1 = 0;
    for (let t = 0; t < N; t++) {
        const val = reconstructedSales[t];
        a0 += val;
        a1 += val * Math.cos(2 * Math.PI * t / 365);
        b1 += val * Math.sin(2 * Math.PI * t / 365);
    }
    a0 /= N; a1 *= (2 / N); b1 *= (2 / N);

    // 4. Slope (Tendência)
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let t = 0; t < N; t++) {
        sumX += t; sumY += reconstructedSales[t];
        sumXY += t * reconstructedSales[t]; sumXX += t * t;
    }
    const slope = (N * sumXY - sumX * sumY) / (N * sumXX - sumX * sumX);

    // 5. Geração de Timeline com Buffer de Segurança
    const finalData = RAW_TIMELINE.map((d, t) => {
        const physicalStock = d.stock;
        const availableStock = d.stock - VITRINE_LOCAL;
        
        // Demanda Harmônica + Tendência
        const fourierVal = a0 + a1 * Math.cos(2 * Math.PI * t / 365) + b1 * Math.sin(2 * Math.PI * t / 365);
        const trendVal = slope * t;
        const trendedDemand = Math.max(0.01, fourierVal + trendVal);

        // --- FÓRMULA SAGRADA DO BUFFER (v12) ---
        // Sigma Total = sqrt(LT * SigmaD^2 + Demand^2 * SigmaLT^2)
        const sigmaTotal = Math.sqrt(
            LEAD_TIME_LOCAL * Math.pow(sigmaD, 2) + 
            Math.pow(trendedDemand, 2) * Math.pow(SIGMA_LT_LOCAL, 2)
        );
        const safetyStock = Z_SCORE * sigmaTotal;
        const targetP100 = (trendedDemand * LEAD_TIME_LOCAL) + safetyStock;

        return {
            date: d.date, physicalStock, availableStock, sales: d.sales,
            instantaneousDemand: trendedDemand,
            isScar: availableStock <= (targetP100 * 0.1),
            p10: targetP100 * 0.1,
            p50: targetP100 * 0.5,
            p100: targetP100 * 1.0,
            p150: targetP100 * 1.5,
            p200: targetP100 * 2.0,
            p400: targetP100 * 4.0,
            p800: targetP100 * 8.0,
            safetyStock: safetyStock
        };
    });

    // 6. Fechamento de Métricas
    const lastDay = finalData[finalData.length - 1];
    const targetIdeal = lastDay.p100;
    const health = (lastDay.availableStock / targetIdeal) * 100;
    
    let status = "ABAIXO"; 
    if (lastDay.availableStock <= lastDay.p50) status = "CRÍTICO";
    else if (lastDay.availableStock <= targetIdeal) status = "ABAIXO"; 
    else if (lastDay.availableStock <= lastDay.p150) status = "ACIMA"; 
    else if (lastDay.availableStock <= lastDay.p200) status = "NA MIRA";
    else status = "MUITA SOBRA";

    fs.writeFileSync('./barreiro_apollo_v10_data.json', JSON.stringify({
        metrics: {
            baselineDemand: a0,
            dailyAvg: globalAvg,
            slopePerDay: slope,
            safetyStockCurrent: lastDay.safetyStock,
            targetStockAvailable: targetIdeal,
            vitrine: VITRINE_LOCAL,
            currentPhysical: lastDay.physicalStock,
            currentAvailable: lastDay.availableStock,
            currentStatus: status,
            stockHealth: health,
            lostUnits: finalData.filter(d => d.isScar).reduce((acc, d) => acc + d.instantaneousDemand, 0),
            ruptureRate: (finalData.filter(d => d.isScar).length / finalData.length) * 100,
            showP400: finalData.some(d => d.availableStock >= d.p400),
            showP800: finalData.some(d => d.availableStock >= d.p800)
        },
        timeline: finalData
    }, null, 2));

    console.log("⚓ Buffer v12.0 Restaurado. Saúde: " + health.toFixed(1) + "%");
    console.log("💎 Alvo Atualizado para: " + targetIdeal.toFixed(2) + " un");
}

runApolloV12();
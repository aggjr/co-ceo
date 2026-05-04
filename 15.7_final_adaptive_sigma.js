const fs = require('fs');

/**
 * APOLLO ENGINE v15.7 - FINAL ADAPTIVE SIGMA (Unified)
 * Centro (ACIMA) = 1.0 * [ (Demand * LT) + (Z * SigmaTotal) ]
 * Unified engine for all units including 'Patient Zero' Barreiro.
 */

const LEAD_TIME_LOCAL = 7.05; 
const SIGMA_LT_LOCAL = 3.40;   
const VITRINE_LOCAL = 1;      
const Z_SCORE_TARGET = 2.33; 
const MIN_STOCK_USER = 3;
const WINDOW_DAYS = 730; 

function processNetwork() {
    console.log("🧬 Iniciando Motor Apollo v15.7 FINAL (Pivô 100% + Sigma Adaptativo)...");

    const rawData = JSON.parse(fs.readFileSync('network_raw_moves_3097.json', 'utf8'));
    const networkResults = {};

    for (let storeName in rawData) {
        console.log(`📡 Processando Unidade: ${storeName}...`);
        const moves = rawData[storeName];

        let balance = 0;
        const dailyValues = {};
        moves.forEach(m => {
            const dStr = m.data_evento.split('T')[0];
            if (!dailyValues[dStr]) dailyValues[dStr] = { stock: 0, sales: 0 };
            const qty = parseFloat(m.quantidade);
            if (m.operacao === 'CREDITO') balance += qty;
            else {
                balance -= qty;
                if (m.natureza === 'Venda') dailyValues[dStr].sales += qty;
            }
            dailyValues[dStr].balance = balance;
        });

        const finalBalanceRaw = balance;
        let correction = 0;
        if (storeName === 'Barreiro') correction = 5 - finalBalanceRaw;
        else if (finalBalanceRaw < 0) correction = Math.abs(finalBalanceRaw) + 5;

        const fullTimeline = [];
        const startGlobal = new Date("2023-03-17");
        const endGlobal = new Date("2026-04-18"); 
        
        let lastCalcBalance = correction;
        let currentDate = new Date(startGlobal);
        while(currentDate <= endGlobal) {
            const dStr = currentDate.toISOString().split('T')[0];
            if (dailyValues[dStr] && dailyValues[dStr].balance !== undefined) {
                lastCalcBalance = dailyValues[dStr].balance + correction;
            }
            fullTimeline.push({
                date: dStr,
                stock: Math.max(0, lastCalcBalance),
                sales: dailyValues[dStr] ? dailyValues[dStr].sales : 0
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const finalTimeline = [];
        for (let t = WINDOW_DAYS; t < fullTimeline.length; t++) {
            const currentDay = fullTimeline[t];
            const window = fullTimeline.slice(t - WINDOW_DAYS, t);
            
            const windowSales = window.map(w => w.sales);
            const rawAvg = windowSales.reduce((a,b)=>a+b, 0) / WINDOW_DAYS;
            let healthySalesSum = 0, healthyDaysCount = 0;
            
            const windowWithImputation = window.map(w => {
                const available = w.stock - VITRINE_LOCAL;
                const isRupture = available < (rawAvg * 0.1); 
                if (!isRupture) {
                    healthySalesSum += w.sales;
                    healthyDaysCount++;
                }
                return { ...w, isRupture };
            });

            const healthyAverage = healthyDaysCount > 0 ? (healthySalesSum / healthyDaysCount) : rawAvg;
            const imputedWindowSales = windowWithImputation.map(w => w.isRupture ? Math.max(healthyAverage, w.sales) : w.sales);

            let a0=0, a1=0, b1=0;
            for (let i = 0; i < WINDOW_DAYS; i++) {
                const val = imputedWindowSales[i];
                a0 += val; a1 += val * Math.cos(2 * Math.PI * i / 365); b1 += val * Math.sin(2 * Math.PI * i / 365);
            }
            a0 /= WINDOW_DAYS; a1 *= (2/WINDOW_DAYS); b1 *= (2/WINDOW_DAYS);

            let sumX=0, sumY=0, sumXY=0, sumXX=0;
            for (let i = 0; i < WINDOW_DAYS; i++) {
                sumX += i; sumY += imputedWindowSales[i]; sumXY += i * imputedWindowSales[i]; sumXX += i * i;
            }
            const slope = (WINDOW_DAYS * sumXY - sumX * sumY) / (WINDOW_DAYS * sumXX - sumX * sumX);
            const variance = imputedWindowSales.reduce((acc, val) => acc + Math.pow(val - a0, 2), 0) / WINDOW_DAYS;

            const relativeIdx = WINDOW_DAYS; 
            const fourier = a0 + a1 * Math.cos(2 * Math.PI * relativeIdx / 365) + b1 * Math.sin(2 * Math.PI * relativeIdx / 365);
            const demand = Math.max(0.01, fourier + slope * relativeIdx);
            const sigmaTotal = Math.sqrt(LEAD_TIME_LOCAL * variance + Math.pow(demand, 2) * Math.pow(SIGMA_LT_LOCAL, 2));
            
            // --- PIVO 100% (Como solicitado pelo usuario para evitar dupla protecao) ---
            const idealValue = (demand * LEAD_TIME_LOCAL) + (Z_SCORE_TARGET * sigmaTotal);
            
            finalTimeline.push({
                date: currentDay.date,
                physicalStock: currentDay.stock,
                legacyStock: currentDay.stock,
                availableStock: currentDay.stock - VITRINE_LOCAL,
                sales: currentDay.sales,
                instantaneousDemand: demand,
                p10:  idealValue - 3 * sigmaTotal, 
                p50:  idealValue - 2 * sigmaTotal, 
                p100: idealValue - 1 * sigmaTotal, 
                p150: idealValue,                  
                p200: idealValue + 1 * sigmaTotal, 
                p400: idealValue + 2 * sigmaTotal, 
                p800: idealValue + 3 * sigmaTotal  
            });
        }

        const lastDay = finalTimeline[finalTimeline.length - 1];
        const targetIdealUser = Math.max(Math.ceil(lastDay.p150), MIN_STOCK_USER);
        
        let status;
        const avail = lastDay.availableStock;
        if      (avail <  lastDay.p10)  status = "RUPTURA";
        else if (avail <  lastDay.p50)  status = "CRÍTICO";
        else if (avail <  lastDay.p100) status = "ABAIXO";
        else if (avail <  lastDay.p150) status = "ACIMA";
        else if (avail <  lastDay.p200) status = "MUITO ACIMA";
        else if (avail <  lastDay.p400) status = "ENCALHADO 1";
        else if (avail <  lastDay.p800) status = "ENCALHADO 2";
        else                            status = "ENCALHADO 3";

        networkResults[storeName] = {
            metrics: {
                vitrine: VITRINE_LOCAL,
                currentStatus: status,
                stockHealth: (avail / lastDay.p150) * 100,
                currentAvailable: avail,
                currentPhysical: lastDay.physicalStock,
                minStock: MIN_STOCK_USER,
                estoqueIdeal: targetIdealUser,
                repor: targetIdealUser - avail,
                lostUnits: finalTimeline.filter(d => d.availableStock < d.p10).reduce((acc, d) => acc + d.instantaneousDemand, 0),
                ruptureRate: (finalTimeline.filter(d => d.availableStock < d.p10).length / finalTimeline.length) * 100
            },
            timeline: finalTimeline
        };
    }

    const jsContent = 'const APOLLO_NETWORK_DATA = ' + JSON.stringify(networkResults) + ';';
    fs.writeFileSync('apollo_master_data.js', jsContent);
    console.log("💎 Apollo v15.7 FINAL Unified Network Processed Successfully.");
}

processNetwork();

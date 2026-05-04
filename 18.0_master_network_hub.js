const fs = require('fs');

/**
 * APOLLO ENGINE v18.0 - NETWORK HUB CONSOLIDATION
 * Inteligência de Rede: O CD agrega os 'Pulsos' das lojas.
 * FÓRMULA CD: Target_Final = CD_P150_Interno + Σ(Déficits_Lojas)
 */

const VITRINE_LOCAL = 1;      
const MIN_STOCK_USER = 3;
const WINDOW_DEMAND = 730; 
const WINDOW_LT = 90; 
const SMOOTH_WINDOW = 30; 

function processNetwork() {
    console.log("🧬 Iniciando Motor Apollo v18.0 NETWORK HUB (CD Consolidado)...");

    const rawData = JSON.parse(fs.readFileSync('network_raw_moves_3097.json', 'utf8'));
    const networkResults = {};
    const storeNames = Object.keys(rawData).filter(s => s !== 'Fábrica');

    // --- FASE 1: PROCESSAR TODAS AS LOJAS ---
    console.log("📡 Fase 1: Processando Unidades de Ponta...");
    for (let storeName of storeNames) {
        networkResults[storeName] = processUnit(storeName, rawData[storeName]);
    }

    // --- FASE 2: AGREGAR PULSOS PARA O CD ---
    console.log("📡 Fase 2: Agregando Pulsos de Rede para o CD (Fábrica)...");
    const factoryRawMoves = rawData['Fábrica'];
    const cdResult = processUnit('Fábrica', factoryRawMoves, networkResults);
    networkResults['Fábrica'] = cdResult;

    const jsContent = 'const APOLLO_NETWORK_DATA = ' + JSON.stringify(networkResults) + ';';
    fs.writeFileSync('apollo_master_data.js', jsContent);
    console.log("💎 Apollo v18.0 NETWORK HUB Processed Successfully.");
}

function processUnit(storeName, moves, otherStoresData = null) {
    let balance = 0;
    const dailyValues = {};
    const deliveryEvents = [];

    moves.forEach(m => {
        const dStr = m.data_evento.split('T')[0];
        if (!dailyValues[dStr]) dailyValues[dStr] = { stock: 0, sales: 0 };
        const qty = parseFloat(m.quantidade);
        if (m.operacao === 'CREDITO') {
            balance += qty;
            deliveryEvents.push({ date: dStr, qty: qty });
        } else {
            balance -= qty;
            if (m.natureza === 'Venda' || m.natureza.includes('Saída')) dailyValues[dStr].sales += qty; 
        }
        dailyValues[dStr].balance = balance;
    });

    const finalBalanceRaw = balance;
    let correction = 0;
    if (storeName === 'Barreiro') correction = 5 - finalBalanceRaw;
    else if (finalBalanceRaw < 0) correction = Math.abs(finalBalanceRaw) + 5;

    const startGlobal = new Date("2023-03-17");
    const endGlobal = new Date("2026-04-18"); 
    
    const fullTimeline = [];
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

    const deliveryIntervals = [];
    for (let i = 1; i < deliveryEvents.length; i++) {
        const d1 = new Date(deliveryEvents[i-1].date);
        const d2 = new Date(deliveryEvents[i].date);
        const diff = (d2 - d1) / (1000 * 60 * 60 * 24);
        if (diff > 0) deliveryIntervals.push({ date: deliveryEvents[i].date, interval: diff });
    }

    const finalTimelineRaw = [];
    for (let t = WINDOW_DEMAND; t < fullTimeline.length; t++) {
        const windowDem = fullTimeline.slice(t - WINDOW_DEMAND, t);
        const currentDay = fullTimeline[t];

        const windowSales = windowDem.map(w => w.sales);
        const rawAvg = windowSales.reduce((a,b)=>a+b, 0) / WINDOW_DEMAND;
        let healthySalesSum = 0, healthyDaysCount = 0;
        const windowWithImputation = windowDem.map(w => {
            const available = w.stock - VITRINE_LOCAL;
            const isRupture = available < (rawAvg * 0.1); 
            if (!isRupture) { healthySalesSum += w.sales; healthyDaysCount++; }
            return { ...w, isRupture };
        });
        const healthyAverage = healthyDaysCount > 0 ? (healthySalesSum / healthyDaysCount) : rawAvg;
        const imputedWindowSales = windowWithImputation.map(w => w.isRupture ? Math.max(healthyAverage, w.sales) : w.sales);

        let a0=0, a1=0, b1=0;
        for (let i = 0; i < WINDOW_DEMAND; i++) {
            const val = imputedWindowSales[i];
            a0 += val; a1 += val * Math.cos(2 * Math.PI * i / 365); b1 += val * Math.sin(2 * Math.PI * i / 365);
        }
        a0 /= WINDOW_DEMAND; a1 *= (2/WINDOW_DEMAND); b1 *= (2/WINDOW_DEMAND);

        let sumX=0, sumY=0, sumXY=0, sumXX=0;
        for (let i = 0; i < WINDOW_DEMAND; i++) { sumX += i; sumY += imputedWindowSales[i]; sumXY += i * imputedWindowSales[i]; sumXX += i * i; }
        const slope = (WINDOW_DEMAND * sumXY - sumX * sumY) / (WINDOW_DEMAND * sumXX - sumX * sumX);
        const fourier = a0 + a1 * Math.cos(2 * Math.PI * WINDOW_DEMAND / 365) + b1 * Math.sin(2 * Math.PI * WINDOW_DEMAND / 365);
        const demand = Math.max(0.01, fourier + slope * WINDOW_DEMAND);

        const dateRef = new Date(currentDay.date);
        const dateLimit = new Date(currentDay.date);
        dateLimit.setDate(dateLimit.getDate() - WINDOW_LT);
        const recentIntervals = deliveryIntervals.filter(di => {
            const d = new Date(di.date);
            return d <= dateRef && d >= dateLimit;
        });

        let currentLT;
        if (recentIntervals.length > 0) currentLT = recentIntervals.reduce((acc, di) => acc + di.interval, 0) / recentIntervals.length;
        else if (deliveryIntervals.length > 0) currentLT = deliveryIntervals.reduce((acc, di) => acc + di.interval, 0) / deliveryIntervals.length;
        else currentLT = (storeName === 'Fábrica' ? 15 : 7); // LT maior para Fábrica

        finalTimelineRaw.push({
            date: currentDay.date,
            physicalStock: currentDay.stock,
            availableStock: currentDay.stock - VITRINE_LOCAL,
            sales: currentDay.sales,
            rawDemand: demand,
            rawLT: currentLT
        });
    }

    const finalTimelineFluid = [];
    for (let i = 0; i < finalTimelineRaw.length; i++) {
        const startIdx = Math.max(0, i - SMOOTH_WINDOW + 1);
        const slice = finalTimelineRaw.slice(startIdx, i + 1);
        const avgDemand = slice.reduce((a, b) => a + b.rawDemand, 0) / slice.length;
        const avgLT = slice.reduce((a, b) => a + b.rawLT, 0) / slice.length;
        const targetBase = avgDemand * avgLT;
        
        let p10  = targetBase * 0.1;
        let p50  = targetBase * 0.5;
        let p80  = targetBase * 0.8;
        let p100 = targetBase * 1.0;
        let p150 = targetBase * 1.5;
        let p300 = targetBase * 3.0;
        let p600 = targetBase * 6.0;

        // --- CALIBRACÃO CD (V18.0) ---
        // Se for a Fábrica, agregamos os pulsos positivos das lojas
        let netPulse = 0;
        if (storeName === 'Fábrica' && otherStoresData) {
            for (let s in otherStoresData) {
                const storeDay = otherStoresData[s].timeline[i];
                const storePulse = Math.max(0, Math.ceil(storeDay.p150) - storeDay.availableStock);
                netPulse += storePulse;
            }
            // O alvo de reposição do CD é o seu interno (P150) + o somatório dos pulsos
            p150 += netPulse;
            // Para consistência visual, escalamos as bandas superiores também
            p300 += netPulse;
            p600 += netPulse;
        }

        finalTimelineFluid.push({
            date: finalTimelineRaw[i].date,
            physicalStock: finalTimelineRaw[i].physicalStock,
            legacyStock: finalTimelineRaw[i].physicalStock,
            availableStock: finalTimelineRaw[i].availableStock,
            sales: finalTimelineRaw[i].sales,
            instantaneousDemand: avgDemand,
            currentLT: avgLT,
            p10, p50, p80, p100, p150, p300, p600
        });
    }

    const lastDay = finalTimelineFluid[finalTimelineFluid.length - 1];
    const focusP100 = Math.max(Math.ceil(lastDay.p100), MIN_STOCK_USER);
    const replenishTarget = Math.max(Math.ceil(lastDay.p150), MIN_STOCK_USER);
    
    // Status calculado contra o P100 (Eficiência)
    const avail = lastDay.availableStock;
    let status;
    if      (avail <  lastDay.p10)  status = "RUPTURA";
    else if (avail <  lastDay.p50)  status = "CRÍTICO";
    else if (avail <  lastDay.p100) status = "ABAIXO"; 
    else if (avail <  lastDay.p150) status = "ACIMA";
    else if (avail <  lastDay.p300) status = "MUITO ACIMA"; 
    else if (avail <  lastDay.p600) status = "ENCALHADO 1";
    else                            status = "ENCALHADO 2";

    // Sugestão Final = MAX(Reposição, Mínimo) - Disponível
    const sugestaoPulse = Math.max(replenishTarget, MIN_STOCK_USER) - avail;

    return {
        metrics: {
            vitrine: VITRINE_LOCAL,
            currentStatus: status,
            stockHealth: (avail / lastDay.p100) * 100,
            currentAvailable: avail,
            currentPhysical: lastDay.physicalStock,
            minStock: MIN_STOCK_USER,
            estoqueReposicao: replenishTarget,
            estoqueSugestao: sugestaoPulse, 
            lostUnits: finalTimelineFluid.filter(d => d.availableStock < d.p10).reduce((acc, d) => acc + d.instantaneousDemand, 0),
            ruptureRate: (finalTimelineFluid.filter(d => d.availableStock < d.p10).length / finalTimelineFluid.length) * 100
        },
        timeline: finalTimelineFluid
    };
}

processNetwork();

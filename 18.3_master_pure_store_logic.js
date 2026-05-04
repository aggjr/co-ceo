const fs = require('fs');

/**
 * APOLLO ENGINE v18.3 - REVERT TO PURE STORE LOGIC + NETWORK OVERLAY
 * Premissa: O CD é tratado EXATAMENTE como uma loja (Curvas, Status, LT, Demanda).
 * Diferença ÚNICA: O card 'Quantidade Reposição' exibe X + N = T.
 */

const VITRINE_LOCAL = 1;      
const MIN_STOCK_USER = 3;
const WINDOW_DEMAND = 730; 
const WINDOW_LT = 90; 
const SMOOTH_WINDOW = 30; 

function processNetwork() {
    console.log("🧬 Iniciando Motor Apollo v18.3 (Reversão para Lógica de Loja Pura + Overlay)...");

    const rawData = JSON.parse(fs.readFileSync('network_raw_moves_3097.json', 'utf8'));
    const networkResults = {};
    const storeNames = Object.keys(rawData).filter(s => s !== 'Fábrica');

    // --- FASE 1: LOJAS ---
    for (let storeName of storeNames) {
        networkResults[storeName] = processUnit(storeName, rawData[storeName]);
    }

    // --- FASE 2: FÁBRICA (Tratada como uma loja comum para manter as curvas originais) ---
    const factoryRawMoves = rawData['Fábrica'];
    const cdResult = processUnit('Fábrica', factoryRawMoves, networkResults);
    networkResults['Fábrica'] = cdResult;

    const jsContent = 'const APOLLO_NETWORK_DATA = ' + JSON.stringify(networkResults) + ';';
    fs.writeFileSync('apollo_master_data.js', jsContent);
    console.log("💎 Apollo v18.3 REVERTED Processed Successfully.");
}

function processUnit(storeName, moves, otherStoresData = null) {
    let balance = 0;
    const dailyValues = {};
    const deliveryEvents = [];

    // Naturezas de saída para demanda: Venda ou Transferência Saída
    moves.forEach(m => {
        const dStr = m.data_evento.split('T')[0];
        if (!dailyValues[dStr]) dailyValues[dStr] = { stock: 0, sales: 0 };
        const qty = parseFloat(m.quantidade);
        if (m.operacao === 'CREDITO') {
            balance += qty;
            deliveryEvents.push({ date: dStr, qty: qty });
        } else {
            balance -= qty;
            // No CD, o "gasto" de estoque são as transferências para as lojas
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
        if (dailyValues[dStr] && dailyValues[dStr].balance !== undefined) lastCalcBalance = dailyValues[dStr].balance + correction;
        fullTimeline.push({ date: dStr, stock: Math.max(0, lastCalcBalance), sales: dailyValues[dStr] ? dailyValues[dStr].sales : 0 });
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
        const currentAvg = windowDem.reduce((acc, w) => acc + w.sales, 0) / WINDOW_DEMAND;
        let hSum = 0, hCount = 0;
        const pWin = windowDem.map(w => {
            const isRup = (w.stock - VITRINE_LOCAL) < (currentAvg * 0.1); 
            if (!isRup) { hSum += w.sales; hCount++; }
            return { ...w, isRup };
        });
        const dRef = hCount > 0 ? (hSum / hCount) : currentAvg;
        const impSales = pWin.map(w => w.isRup ? Math.max(dRef, w.sales) : w.sales);

        let a0=0, a1=0, b1=0;
        for (let i = 0; i < WINDOW_DEMAND; i++) {
            const val = impSales[i];
            a0 += val; a1 += val * Math.cos(2 * Math.PI * i / 365); b1 += val * Math.sin(2 * Math.PI * i / 365);
        }
        a0 /= WINDOW_DEMAND; a1 *= (2/WINDOW_DEMAND); b1 *= (2/WINDOW_DEMAND);
        let sX=0, sY=0, sXY=0, sXX=0;
        for (let i = 0; i < WINDOW_DEMAND; i++) { sX += i; sY += impSales[i]; sXY += i * impSales[i]; sXX += i * i; }
        const slope = (WINDOW_DEMAND * sXY - sX * sY) / (WINDOW_DEMAND * sXX - sX * sX);
        const demand = Math.max(0.01, (a0 + a1 * Math.cos(2 * Math.PI * WINDOW_DEMAND / 365) + b1 * Math.sin(2 * Math.PI * WINDOW_DEMAND / 365)) + slope * WINDOW_DEMAND);

        const curDate = new Date(fullTimeline[t].date);
        const limDate = new Date(fullTimeline[t].date); limDate.setDate(limDate.getDate() - WINDOW_LT);
        const recInt = deliveryIntervals.filter(di => { const d = new Date(di.date); return d <= curDate && d >= limDate; });
        // REVERSÃO: Lead Time volta a ser o calculado ou 7 (como nas lojas), sem o '15' fixo.
        let currentLT = (recInt.length > 0) ? (recInt.reduce((a, b) => a + b.interval, 0) / recInt.length) : 
                        (deliveryIntervals.length > 0 ? (deliveryIntervals.reduce((a, b) => a + b.interval, 0) / deliveryIntervals.length) : 7);

        finalTimelineRaw.push({ date: fullTimeline[t].date, physicalStock: fullTimeline[t].stock, availableStock: fullTimeline[t].stock - VITRINE_LOCAL, sales: fullTimeline[t].sales, rawDemand: demand, rawLT: currentLT });
    }

    const finalTimelineFluid = [];
    for (let i = 0; i < finalTimelineRaw.length; i++) {
        const slice = finalTimelineRaw.slice(Math.max(0, i - SMOOTH_WINDOW + 1), i + 1);
        const avgDemand = slice.reduce((a, b) => a + b.rawDemand, 0) / slice.length;
        const avgLT = slice.reduce((a, b) => a + b.rawLT, 0) / slice.length;
        const targetBase = avgDemand * avgLT;
        
        finalTimelineFluid.push({
            date: finalTimelineRaw[i].date, physicalStock: finalTimelineRaw[i].physicalStock, legacyStock: finalTimelineRaw[i].physicalStock, availableStock: finalTimelineRaw[i].availableStock, sales: finalTimelineRaw[i].sales, instantaneousDemand: avgDemand, currentLT: avgLT,
            p10:  targetBase * 0.1, p50:  targetBase * 0.5, p80:  targetBase * 0.8, p100: targetBase * 1.0, p150: targetBase * 1.5, p300: targetBase * 3.0, p600: targetBase * 6.0
        });
    }

    const idxF = finalTimelineFluid.length - 1;
    const lastD = finalTimelineFluid[idxF];
    const avail = lastD.availableStock;
    let repoPropria = Math.max(Math.ceil(lastD.p150), MIN_STOCK_USER);
    let pulsoRede = 0;

    // Overlay de rede apenas para o card metrics
    if (storeName === 'Fábrica' && otherStoresData && idxF > 0) {
        for (let s in otherStoresData) {
            const stYesterday = otherStoresData[s].timeline[idxF - 1];
            pulsoRede += Math.max(0, Math.ceil(stYesterday.p150) - stYesterday.availableStock);
        }
    }

    const totalTarget = repoPropria + pulsoRede;
    
    let status;
    if      (avail <  lastD.p10)  status = "RUPTURA";
    else if (avail <  lastD.p50)  status = "CRÍTICO";
    else if (avail <  lastD.p100) status = "ABAIXO"; 
    else if (avail <  lastD.p150) status = "ACIMA";
    else if (avail <  lastD.p300) status = "MUITO ACIMA"; 
    else if (avail <  lastD.p600) status = "ENCALHADO 1";
    else                            status = "ENCALHADO 2";

    return {
        metrics: {
            vitrine: VITRINE_LOCAL, currentStatus: status, stockHealth: (avail / lastD.p100) * 100, currentAvailable: avail, currentPhysical: lastD.physicalStock, minStock: MIN_STOCK_USER,
            estoqueReposicaoProprio: repoPropria, pulsoRede: pulsoRede, estoqueReposicao: totalTarget, estoqueSugestao: totalTarget - avail,
            lostUnits: finalTimelineFluid.filter(d => d.availableStock < d.p10).reduce((acc, d) => acc + d.instantaneousDemand, 0),
            ruptureRate: (finalTimelineFluid.filter(d => d.availableStock < d.p10).length / finalTimelineFluid.length) * 100
        },
        timeline: finalTimelineFluid
    };
}

processNetwork();

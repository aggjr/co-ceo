const fs = require('fs');

/**
 * APOLLO ENGINE v19.0 - NETWORK MIRROR (CD CONSOLIDADO)
 * 1. Curvas do CD = SOMA dos P100 das Lojas (Espelho da Rede).
 * 2. Estoque CD = Contábil Real (Todas as entradas e saídas).
 * 3. Card Reposição = X (Interno CD) + N (Pulsos Lojas Ontem) = Total.
 */

const VITRINE_LOJA = 1;      
const VITRINE_CD = 0;
const MIN_STOCK_USER = 3;
const WINDOW_DEMAND = 730; 
const WINDOW_LT = 90; 
const SMOOTH_WINDOW = 30; 

function processNetwork() {
    console.log("🧬 Iniciando Motor Apollo v19.0 NETWORK MIRROR...");

    const rawData = JSON.parse(fs.readFileSync('network_raw_moves_3097.json', 'utf8'));
    const networkResults = {};
    const storeNames = Object.keys(rawData).filter(s => s !== 'Fábrica');

    // --- FASE 1: PROCESSAR TODAS AS LOJAS ---
    for (let storeName of storeNames) {
        networkResults[storeName] = processUnit(storeName, rawData[storeName]);
    }

    // --- FASE 2: FÁBRICA (CD) COM ESPELHAMENTO DE REDE ---
    const factoryRawMoves = rawData['Fábrica'];
    networkResults['Fábrica'] = processFactory(factoryRawMoves, networkResults);

    const jsContent = 'const APOLLO_NETWORK_DATA = ' + JSON.stringify(networkResults) + ';';
    fs.writeFileSync('apollo_master_data.js', jsContent);
    console.log("💎 Apollo v19.0 NETWORK MIRROR Processed Successfully.");
}

function processUnit(storeName, moves) {
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
            const available = w.stock - VITRINE_LOJA;
            const isRup = available < (currentAvg * 0.1); 
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
        let currentLT = (recInt.length > 0) ? (recInt.reduce((a, b) => a + b.interval, 0) / recInt.length) : 
                        (deliveryIntervals.length > 0 ? (deliveryIntervals.reduce((a, b) => a + b.interval, 0) / deliveryIntervals.length) : 7);

        finalTimelineRaw.push({ date: fullTimeline[t].date, physicalStock: fullTimeline[t].stock, availableStock: fullTimeline[t].stock - VITRINE_LOJA, sales: fullTimeline[t].sales, rawDemand: demand, rawLT: currentLT });
    }

    const finalTimelineFluid = [];
    for (let i = 0; i < finalTimelineRaw.length; i++) {
        const slice = finalTimelineRaw.slice(Math.max(0, i - SMOOTH_WINDOW + 1), i + 1);
        const avgDem = slice.reduce((a, b) => a + b.rawDemand, 0) / slice.length;
        const avgLT = slice.reduce((a, b) => a + b.rawLT, 0) / slice.length;
        const base = avgDem * avgLT;
        finalTimelineFluid.push({
            date: finalTimelineRaw[i].date, physicalStock: finalTimelineRaw[i].physicalStock, legacyStock: finalTimelineRaw[i].physicalStock, availableStock: finalTimelineRaw[i].availableStock, sales: finalTimelineRaw[i].sales, instantaneousDemand: avgDem, currentLT: avgLT,
            p10: base * 0.1, p50: base * 0.5, p80: base * 0.8, p100: base * 1.0, p150: base * 1.5, p300: base * 3.0, p600: base * 6.0
        });
    }

    const lastD = finalTimelineFluid[finalTimelineFluid.length - 1];
    return {
        metrics: {
            vitrine: VITRINE_LOJA, currentStatus: calculateStatus(lastD.availableStock, lastD), stockHealth: (lastD.availableStock / lastD.p100) * 100, currentAvailable: lastD.availableStock, currentPhysical: lastD.physicalStock, minStock: MIN_STOCK_USER,
            estoqueReposicao: Math.max(Math.ceil(lastD.p150), MIN_STOCK_USER), estoqueSugestao: Math.max(Math.ceil(lastD.p150), MIN_STOCK_USER) - lastD.availableStock,
            lostUnits: finalTimelineFluid.filter(d => d.availableStock < d.p10).reduce((a, d) => a + d.instantaneousDemand, 0),
            ruptureRate: (finalTimelineFluid.filter(d => d.availableStock < d.p10).length / finalTimelineFluid.length) * 100
        },
        timeline: finalTimelineFluid
    };
}

function processFactory(moves, storesData) {
    let balance = 0;
    const dailyValues = {};
    const deliveryEvents = [];

    // CD CONTÁBIL PURO: Toda e qualquer movimentação
    moves.forEach(m => {
        const dStr = m.data_evento.split('T')[0];
        if (!dailyValues[dStr]) dailyValues[dStr] = { stock: 0, consumption: 0 };
        const qty = parseFloat(m.quantidade);
        if (m.operacao === 'CREDITO') { 
            balance += qty; 
            if (m.natureza.includes('Produção')) deliveryEvents.push({ date: dStr, qty: qty });
        } else { 
            balance -= qty; 
            // Para o 'X' (Interno), usamos o histórico de saídas do CD
            dailyValues[dStr].consumption += qty; 
        }
        dailyValues[dStr].balance = balance;
    });

    const correction = balance < 0 ? Math.abs(balance) + 5 : 0;
    const startGlobal = new Date("2023-03-17");
    const endGlobal = new Date("2026-04-18"); 
    const fullTimeline = [];
    let lastB = correction;
    let currentD = new Date(startGlobal);
    while(currentD <= endGlobal) {
        const dStr = currentD.toISOString().split('T')[0];
        if (dailyValues[dStr] && dailyValues[dStr].balance !== undefined) lastB = dailyValues[dStr].balance + correction;
        fullTimeline.push({ date: dStr, stock: Math.max(0, lastB), consumption: dailyValues[dStr] ? dailyValues[dStr].consumption : 0 });
        currentD.setDate(currentD.getDate() + 1);
    }

    // --- CÁLCULO DAS BANDAS DE REDE (ESPELHO) ---
    const finalTimelineFluid = [];
    const timelineLen = fullTimeline.length;
    const stores = Object.keys(storesData);

    for (let i = 0; i < timelineLen; i++) {
        const currentDay = fullTimeline[i];
        if (i < WINDOW_DEMAND) continue; // Alinhar com as lojas

        // SOMA P100 DAS LOJAS PARA O DIA i
        let networkP100 = 0;
        stores.forEach(s => {
            const storeDay = storesData[s].timeline[i - WINDOW_DEMAND]; // Alignment offset
            if (storeDay) networkP100 += storeDay.p100;
        });

        const base = networkP100; // O P100 do CD é a soma dos P100 das lojas
        finalTimelineFluid.push({
            date: currentDay.date, physicalStock: currentDay.stock, legacyStock: currentDay.stock, availableStock: currentDay.stock - VITRINE_CD, consumption: currentDay.consumption,
            p10: base * 0.1, p50: base * 0.5, p80: base * 0.8, p100: base * 1.0, p150: base * 1.5, p300: base * 3.0, p600: base * 6.0
        });
    }

    // --- CÁLCULO DO 'X' (INTERNO CD) ---
    // Fazemos um cálculo rápido de P150 baseado nas saídas do CD para o card
    const lastDay = finalTimelineFluid[finalTimelineFluid.length - 1];
    const recentConsumption = fullTimeline.slice(-30).reduce((a, b) => a + b.consumption, 0) / 30;
    const repoPropria = Math.max(Math.ceil(recentConsumption * 15 * 1.5), MIN_STOCK_USER); // X (Baseado em 15 dias de LT CD)

    // --- CÁLCULO DO 'N' (REDE) ---
    let pulsoRede = 0;
    if (finalTimelineFluid.length > 1) {
        stores.forEach(s => {
            const stYesterday = storesData[s].timeline[storesData[s].timeline.length - 1]; // Usando o último dia disponível
            pulsoRede += Math.max(0, Math.ceil(stYesterday.p150) - stYesterday.availableStock);
        });
    }

    const netTarget = repoPropria + pulsoRede;
    const avail = lastDay.availableStock;

    const ruptureDays = finalTimelineFluid.filter(d => d.availableStock < d.p10);

    return {
        metrics: {
            vitrine: VITRINE_CD, currentStatus: calculateStatus(avail, lastDay), stockHealth: (avail / lastDay.p100) * 100, currentAvailable: avail, currentPhysical: lastDay.physicalStock, minStock: MIN_STOCK_USER,
            estoqueReposicaoProprio: repoPropria, pulsoRede: pulsoRede, estoqueReposicao: netTarget, estoqueSugestao: netTarget - avail,
            lostUnits: ruptureDays.reduce((acc, d) => acc + d.consumption, 0),
            ruptureRate: (ruptureDays.length / finalTimelineFluid.length) * 100
        },
        timeline: finalTimelineFluid
    };
}

function calculateStatus(avail, targets) {
    if      (avail <  targets.p10)  return "RUPTURA";
    else if (avail <  targets.p50)  return "CRÍTICO";
    else if (avail <  targets.p100) return "ABAIXO"; 
    else if (avail <  targets.p150) return "ACIMA";
    else if (avail <  targets.p300) return "MUITO ACIMA"; 
    else if (avail <  targets.p600) return "ENCALHADO 1";
    else                            return "ENCALHADO 2";
}

processNetwork();

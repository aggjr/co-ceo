const fs = require('fs');

/**
 * APOLLO ENGINE v15.0 - ADAPTIVE FLOW (Sliding Window)
 * Re-calculates intelligence for every single day to ensure convergence.
 */

const LEAD_TIME_LOCAL = 7.05; 
const SIGMA_LT_LOCAL = 3.40;   
const VITRINE_LOCAL = 1;      
const Z_SCORE = 2.33;         
const MIN_STOCK_USER = 3;
const WINDOW_DAYS = 730; // 2 Anos de memória

function processNetwork() {
    console.log("🧬 Iniciando Motor Apollo v15.0 ADAPTATIVO (Janela Móvel 730d)...");

    const rawData = JSON.parse(fs.readFileSync('network_raw_moves_3097.json', 'utf8'));
    const networkResults = {};

    for (let storeName in rawData) {
        console.log(`📡 Processando Unidade: ${storeName}...`);
        const moves = rawData[storeName];

        // 1. Construção da Timeline Histórica Total (Sem lacunas)
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

        // Timeline baseada no range real do arquivo (visto anteriormente: 2023-03-17 a 2026-04-13)
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

        // 2. Loop de Simulação Adaptativa (Janela Móvel)
        const finalTimeline = [];
        
        // Começamos a plotar a partir do dia em que temos a janela cheia (WINDOW_DAYS)
        for (let t = WINDOW_DAYS; t < fullTimeline.length; t++) {
            const currentDay = fullTimeline[t];
            const window = fullTimeline.slice(t - WINDOW_DAYS, t); // Pega os últimos 2 anos até ontem
            
            // --- PASSO A: Imputação de Lost Sales (Cura de Cicatrizes) ---
            // Precisamos de um threshold de ruptura para a janela. 
            // Como é um loop dentro de loop, vamos simplificar o PASS 1 usando a média simples da janela para detectar rupturas iniciais
            const windowSales = window.map(w => w.sales);
            const rawAvg = windowSales.reduce((a,b)=>a+b, 0) / WINDOW_DAYS;
            
            // Identificar dias saudáveis na janela para criar o baseline de cura
            let healthySalesSum = 0;
            let healthyDaysCount = 0;
            const windowWithImputation = window.map(w => {
                const available = w.stock - VITRINE_LOCAL;
                // Critério de Ruptura v14: Se estoque disponível < 10% da média (aproximação do P10)
                const isRupture = available < (rawAvg * 0.5); // Aproximação conservadora para o gatilho de cura
                if (!isRupture) {
                    healthySalesSum += w.sales;
                    healthyDaysCount++;
                }
                return { ...w, isRupture };
            });

            const healthyAverage = healthyDaysCount > 0 ? (healthySalesSum / healthyDaysCount) : rawAvg;
            const imputedWindowSales = windowWithImputation.map(w => w.isRupture ? Math.max(healthyAverage, w.sales) : w.sales);

            // --- PASSO B: Cálculo de Coeficientes Adaptativos (Fourier + Slope) ---
            // Fourier (A0, A1, B1)
            let a0=0, a1=0, b1=0;
            for (let i = 0; i < WINDOW_DAYS; i++) {
                const val = imputedWindowSales[i];
                a0 += val; 
                a1 += val * Math.cos(2 * Math.PI * i / 365); 
                b1 += val * Math.sin(2 * Math.PI * i / 365);
            }
            a0 /= WINDOW_DAYS; a1 *= (2/WINDOW_DAYS); b1 *= (2/WINDOW_DAYS);

            // Regressão Linear (Slope)
            let sumX=0, sumY=0, sumXY=0, sumXX=0;
            for (let i = 0; i < WINDOW_DAYS; i++) {
                sumX += i;
                sumY += imputedWindowSales[i];
                sumXY += i * imputedWindowSales[i];
                sumXX += i * i;
            }
            const slope = (WINDOW_DAYS * sumXY - sumX * sumY) / (WINDOW_DAYS * sumXX - sumX * sumX);

            // Variance (Incerteza do giro)
            const variance = imputedWindowSales.reduce((acc, val) => acc + Math.pow(val - a0, 2), 0) / WINDOW_DAYS;

            // --- PASSO C: Aplicação do Modelo no Dia Atual ---
            // O dia atual t é o dia "WINDOW_DAYS + 1" em relação ao início da janela
            const relativeIdx = WINDOW_DAYS; 
            const fourier = a0 + a1 * Math.cos(2 * Math.PI * relativeIdx / 365) + b1 * Math.sin(2 * Math.PI * relativeIdx / 365);
            const demand = Math.max(0.01, fourier + slope * relativeIdx);
            const sigmaTotal = Math.sqrt(LEAD_TIME_LOCAL * variance + Math.pow(demand, 2) * Math.pow(SIGMA_LT_LOCAL, 2));
            const target = (demand * LEAD_TIME_LOCAL) + (Z_SCORE * sigmaTotal);
            
            const available = currentDay.stock - VITRINE_LOCAL;
            const p10 = target * 0.1;

            finalTimeline.push({
                date: currentDay.date,
                physicalStock: currentDay.stock,
                legacyStock: currentDay.stock, // Alinhado conforme ordem anterior
                availableStock: available,
                sales: currentDay.sales,
                instantaneousDemand: demand,
                isScar: available <= p10,
                p10: p10,
                p50: target * 0.5,
                p100: target * 1.0,
                p150: target * 1.5,
                p200: target * 2.0,
                p400: target * 4.0,
                p800: target * 8.0
            });
        }

        // 3. Resultados Finais e Métricas Atuais (Último dia calculado)
        const lastDay = finalTimeline[finalTimeline.length - 1];
        const targetIdealMath = lastDay.p100;
        const targetIdealUser = Math.max(Math.ceil(lastDay.p150), MIN_STOCK_USER);
        
        const health = (lastDay.availableStock / targetIdealMath) * 100;

        let status;
        const avail = lastDay.availableStock;
        if      (avail <  lastDay.p10)  status = "RUPTURA";
        else if (avail <  lastDay.p50)  status = "CRÍTICO";
        else if (avail <  targetIdealMath) status = "ABAIXO";
        else if (avail <  lastDay.p150) status = "ACIMA";
        else if (avail <  lastDay.p200) status = "MUITO ACIMA";
        else if (avail <  lastDay.p400) status = "ENCALHADO 1";
        else if (avail <  lastDay.p800) status = "ENCALHADO 2";
        else                            status = "ENCALHADO 3";

        networkResults[storeName] = {
            metrics: {
                vitrine: VITRINE_LOCAL,
                currentStatus: status,
                stockHealth: health,
                currentAvailable: lastDay.availableStock,
                currentPhysical: lastDay.physicalStock,
                minStock: MIN_STOCK_USER,
                estoqueIdeal: targetIdealUser,
                repor: targetIdealUser - lastDay.availableStock,
                lostUnits: finalTimeline.filter(d => d.isScar).reduce((acc, d) => acc + d.instantaneousDemand, 0),
                ruptureRate: (finalTimeline.filter(d => d.isScar).length / finalTimeline.length) * 100
            },
            timeline: finalTimeline
        };
    }

    // OVERRIDE BARREIRO: Mantendo a injeção forense v10 mas adaptando para o formato da rede
    const v10Code = fs.readFileSync('barreiro_apollo_v10_data.js', 'utf8');
    let APOLLO_DATA_V10;
    eval(v10Code.replace('const APOLLO_DATA =', 'APOLLO_DATA_V10 ='));
    
    // No Barreiro adaptativo, vamos garantir que métricas ideais usem a regra MAX(p150, 3)
    const tB = APOLLO_DATA_V10.timeline.map(d => ({ ...d, legacyStock: d.physicalStock }));
    const lastB = tB[tB.length - 1];
    const idealB = Math.max(Math.ceil(lastB.p150), MIN_STOCK_USER);

    networkResults['Barreiro'] = {
        metrics: {
            ...APOLLO_DATA_V10.metrics,
            minStock: MIN_STOCK_USER,
            estoqueIdeal: idealB,
            repor: idealB - lastB.availableStock
        },
        timeline: tB
    };

    const jsContent = 'const APOLLO_NETWORK_DATA = ' + JSON.stringify(networkResults) + ';';
    fs.writeFileSync('apollo_master_data.js', jsContent);
    console.log("💎 Apollo v15.0 ADAPTIVE Network Processed Successfully.");
}

processNetwork();

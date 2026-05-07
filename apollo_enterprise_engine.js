const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { assertLegacyConfig } = require(path.join(__dirname, 'coceo_db_config'));
const {
    isClosedRetailExcludedFromStockNetwork,
    isClosedRetailStore,
} = require(path.join(__dirname, 'lib', 'closed_retail_stores'));
const { remapSkuDataStoreKeys, legacyStoreNamesToTry } = require(path.join(__dirname, 'lib', 'store_key_aliases'));

/**
 * APOLLO ENTERPRISE ENGINE v20.1
 * Processador em lote: cada data/raw/sku_*.json → data/js/sku_*.js (+ catalog_index.json).
 */

const RAW_DIR = path.join(__dirname, 'data', 'raw');
const JS_DIR = path.join(__dirname, 'data', 'js'); // Dashboard busca aqui

const VITRINE_LOJA = 1;      
const VITRINE_CD = 0;

function asBool(v) {
    if (v == null) return false;
    if (Buffer.isBuffer(v)) return v[0] === 1;
    const n = Number(v);
    if (!Number.isNaN(n)) return n !== 0;
    return Boolean(v);
}

async function loadForaMixByProductIds(conn, productIds) {
    const map = new Map();
    if (!conn || !productIds.length) return map;
    const ids = [...new Set(productIds.map((x) => Number(x)).filter((id) => Number.isFinite(id) && id > 0))];
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const [rows] = await conn.query(
            `SELECT Id AS id, IndForaMix AS ind_fora_mix FROM produto WHERE Id IN (${placeholders})`,
            chunk
        );
        for (const r of rows) {
            const id = Number(r.id);
            if (!Number.isFinite(id) || id <= 0) continue;
            map.set(id, asBool(r.ind_fora_mix));
        }
    }
    return map;
}
const MIN_STOCK_USER = 3;
const WINDOW_DEMAND = 365; 
const WINDOW_LT = 90; 
const SMOOTH_WINDOW = 60; 
const RUPTURE_LIMIT = 15; // Dias antes de considerar obsolescência

let START_GLOBAL = new Date('2023-03-17');
let END_GLOBAL = (() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    return d;
})();

// Quando true, ignora snapshots de físico do legado (ativoposicaoestoque) e calcula tudo apenas por movimentações.
// Útil quando o legado está inconsistente e queremos o CO-CEO como fonte mais confiável.
const DISABLE_LEGACY_PHYSICAL =
    /^1|true|yes$/i.test(String(process.env.APOLLO_ENGINE_DISABLE_LEGACY_PHYSICAL || "")) ||
    /^1|true|yes$/i.test(String(process.env.LEGACY_PHYSICAL_DISABLE || ""));

function toIsoDay(d) {
    return new Date(d).toISOString().slice(0, 10);
}

function parseIsoDay(yyyyMmDd) {
    const s = String(yyyyMmDd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

function resolveEngineWindow() {
    const envStart = process.env.APOLLO_ENGINE_START_DATE;
    const envEnd = process.env.APOLLO_ENGINE_END_DATE;

    const end = parseIsoDay(envEnd) || (() => {
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        d.setDate(d.getDate() - 1);
        return d;
    })();

    const start = parseIsoDay(envStart) || new Date('2023-03-17T12:00:00.000Z');
    if (start.getTime() > end.getTime()) {
        throw new Error(
            `Janela inválida no engine: start (${toIsoDay(start)}) > end (${toIsoDay(end)}).`
        );
    }
    return { start, end };
}

/** Normaliza nome de loja para casar chaves JSON x legado. */
function normalizeStoreName(v) {
    return String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

const LEGACY_STOCK_CHUNK = 40;

/**
 * Pré-carrega posição diária (ativoposicaoestoque) para muitos produtos em poucas queries.
 * Map: productId → Map<storeName → Map<dateStr → physical_stock>>.
 */
async function loadLegacyPhysicalForProducts(conn, productIds) {
    const legacyByProduct = new Map();
    const ids = [...new Set(productIds.map((x) => Number(x)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!ids.length) return legacyByProduct;

    const startStr = START_GLOBAL.toISOString().slice(0, 10);
    const endStr = END_GLOBAL.toISOString().slice(0, 10);

    for (let i = 0; i < ids.length; i += LEGACY_STOCK_CHUNK) {
        const chunk = ids.slice(i, i + LEGACY_STOCK_CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const [rows] = await conn.query(
            `
            SELECT
              p.Id AS product_id,
              u.NomeFantasia AS store_name,
              DATE_FORMAT(ape.DataMovimentacao, '%Y-%m-%d') AS ref_date,
              CAST(MAX(GREATEST(0, COALESCE(ape.PosicaoEstoque, 0))) AS DECIMAL(18,4)) AS physical_stock
            FROM ativoposicaoestoque ape
            JOIN ativo a ON a.Id = ape.IdAtivo
            JOIN produto p ON p.Id = a.IdProduto
            JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
            WHERE p.Id IN (${placeholders})
              AND COALESCE(a.IndDeletado, b'0') = b'0'
              AND COALESCE(ape.IndDeletado, b'0') = b'0'
              AND ape.DataMovimentacao >= ?
              AND ape.DataMovimentacao < DATE_ADD(?, INTERVAL 1 DAY)
            GROUP BY p.Id, u.NomeFantasia, DATE_FORMAT(ape.DataMovimentacao, '%Y-%m-%d')
            `,
            [...chunk, startStr, endStr]
        );
        for (const r of rows) {
            const pid = Number(r.product_id);
            const st = String(r.store_name || '');
            const d = String(r.ref_date || '').slice(0, 10);
            const v = Math.max(0, Number(r.physical_stock) || 0);
            if (!Number.isFinite(pid) || pid <= 0 || !st || !d) continue;
            if (!legacyByProduct.has(pid)) legacyByProduct.set(pid, new Map());
            const byStore = legacyByProduct.get(pid);
            if (!byStore.has(st)) byStore.set(st, new Map());
            byStore.get(st).set(d, v);
        }
    }
    return legacyByProduct;
}

function legacyPeakPhysicalForStore(legacyByStore, storeName) {
    const dayMap = getLegacyDayMapForStore(legacyByStore, storeName);
    if (!dayMap || !dayMap.size) return 0;
    let maxv = 0;
    for (const v of dayMap.values()) {
        maxv = Math.max(maxv, Math.max(0, Number(v) || 0));
    }
    return maxv;
}

function movesPeakPhysicalInWindow(moves) {
    if (!moves || !moves.length) return 0;
    const tl = buildTimelineFromMoves(moves);
    let maxv = 0;
    for (let i = 0; i < tl.length; i++) {
        maxv = Math.max(maxv, Math.max(0, Number(tl[i].stock) || 0));
    }
    return maxv;
}

function peakPhysicalHintForStoreNetwork(storeName, legacyByStore, rawMoves) {
    const movePeak = movesPeakPhysicalInWindow(rawMoves || []);
    if (DISABLE_LEGACY_PHYSICAL) return movePeak;
    return Math.max(legacyPeakPhysicalForStore(legacyByStore, storeName), movePeak);
}

function getLegacyDayMapForStore(legacyByStore, storeName) {
    if (!legacyByStore || !legacyByStore.size) return null;
    const candidates = legacyStoreNamesToTry(storeName);
    const tryNames = candidates.length ? candidates : [storeName];
    for (let ti = 0; ti < tryNames.length; ti++) {
        const nm = tryNames[ti];
        if (legacyByStore.has(nm)) {
            const m = legacyByStore.get(nm);
            if (m && m.size) return m;
        }
        const want = normalizeStoreName(nm);
        for (const [k, m] of legacyByStore) {
            if (normalizeStoreName(k) === want && m && m.size) return m;
        }
    }
    return null;
}

async function runEngine() {
    const win = resolveEngineWindow();
    START_GLOBAL = win.start;
    END_GLOBAL = win.end;
    console.log("🧬 Sincronizando Apollo Enterprise v21.1 -> Dashboard...");
    console.log(`🗓️ Janela de cálculo (engine): ${toIsoDay(START_GLOBAL)} → ${toIsoDay(END_GLOBAL)}`);
    if (DISABLE_LEGACY_PHYSICAL) {
        console.log("🧯 APOLLO_ENGINE_DISABLE_LEGACY_PHYSICAL=1 → ignorando físico do legado (ativoposicaoestoque); usando movimentos.");
    }
    
    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
    if (!fs.existsSync(JS_DIR)) fs.mkdirSync(JS_DIR, { recursive: true });
    
    const onlySkuId = (() => {
        // Permite regenerar só 1 SKU: --sku=232 ou APOLLO_ENGINE_ONLY_SKU=232
        const arg = process.argv.find((a) => String(a || '').toLowerCase().startsWith('--sku='));
        const fromArg = arg ? String(arg).split('=')[1] : null;
        const raw = fromArg != null && fromArg !== '' ? fromArg : (process.env.APOLLO_ENGINE_ONLY_SKU || '');
        const n = Number(String(raw).trim());
        return Number.isFinite(n) && n > 0 ? n : null;
    })();

    const rawFiles = fs
        .readdirSync(RAW_DIR)
        .filter((f) => f.endsWith('.json'))
        .filter((f) => {
            if (!onlySkuId) return true;
            const m = /^sku_(\d+)\.json$/i.exec(String(f));
            return m ? Number(m[1]) === onlySkuId : false;
        });
    const index = [];
    let errCount = 0;
    let legacyConn = null;
    if (!DISABLE_LEGACY_PHYSICAL) {
        try {
            legacyConn = await mysql.createConnection(assertLegacyConfig());
            await legacyConn.query("SET NAMES 'utf8mb4'");
        } catch (e) {
            console.warn('⚠️ Legado MySQL indisponível — físico volta ao cálculo por movimentos:', e.message || e);
        }
    }

    let legacyByProduct = new Map();
    let foraMixByProductId = new Map();
    if (legacyConn) {
        const idSet = new Set();
        for (const file of rawFiles) {
            try {
                const skuContent = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
                const pid = Number(skuContent?.info?.id);
                if (Number.isFinite(pid) && pid > 0) idSet.add(pid);
            } catch (_) {}
        }
        const allIds = [...idSet];
        console.log(`📦 Pré-carregando estoque legado (${allIds.length} produtos, lotes de ${LEGACY_STOCK_CHUNK})...`);
        try {
            legacyByProduct = await loadLegacyPhysicalForProducts(legacyConn, allIds);
        } catch (e) {
            console.warn('⚠️ Falha ao pré-carregar estoque legado — usando movimentos por SKU:', e.message || e);
            legacyByProduct = new Map();
        }
        try {
            foraMixByProductId = await loadForaMixByProductIds(legacyConn, allIds);
            if (foraMixByProductId.size) {
                console.log(`✂️ IndForaMix carregado para ${foraMixByProductId.size} produto(s) (merge em bundle.info).`);
            }
        } catch (e) {
            console.warn('⚠️ Falha ao carregar IndForaMix — bundles sem info.foraMix:', e.message || e);
            foraMixByProductId = new Map();
        }
    }

    for (let idx = 0; idx < rawFiles.length; idx++) {
        const file = rawFiles[idx];
        if (idx % 100 === 0) console.log(`⚙️ Consolidando SKU ${idx + 1} de ${rawFiles.length}...`);
        try {
            const skuContent = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
            const pid = Number(skuContent?.info?.id);
            const baseInfo = { ...(skuContent.info || {}) };
            if (Number.isFinite(pid) && pid > 0 && foraMixByProductId.has(pid)) {
                baseInfo.foraMix = foraMixByProductId.get(pid);
            }
            const enrichedSkuContent = { ...skuContent, info: baseInfo };
            const legacyByStore =
                legacyConn && Number.isFinite(pid) && pid > 0 && legacyByProduct.has(pid)
                    ? legacyByProduct.get(pid)
                    : new Map();
            const skuResults = processSKUNetwork(enrichedSkuContent, legacyByStore);
            
            const jsFile = file.replace('.json', '.js');
            const outPath = path.join(JS_DIR, jsFile);
            const jsContent = `window.APOLLO_NETWORK_DATA = ${JSON.stringify(skuResults)};`;
            
            fs.writeFileSync(outPath, jsContent);
            
            index.push({
                id: enrichedSkuContent.info.id,
                code: enrichedSkuContent.info.code,
                name: enrichedSkuContent.info.name,
                file: jsFile
            });
        } catch (err) {
            errCount++;
            console.error(`❌ Erro no SKU ${file}:`, err.message);
        }
    }

    if (legacyConn) {
        try {
            await legacyConn.end();
        } catch (_) {}
    }

    const catalogPath = path.join(__dirname, 'data', 'catalog_index.json');
    let mergedIndex = index;
    if (onlySkuId && index.length) {
        let prev = [];
        try {
            prev = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        } catch (_) {}
        if (!Array.isArray(prev)) prev = [];
        const touched = new Set(index.map((e) => Number(e.id)).filter((n) => Number.isFinite(n)));
        mergedIndex = prev.filter((e) => !touched.has(Number(e.id))).concat(index);
    }
    mergedIndex.sort((a, b) => (parseInt(a.code) || 0) - (parseInt(b.code) || 0));
    fs.writeFileSync(catalogPath, JSON.stringify(mergedIndex, null, 2));
    console.log(
        `💎 Concluído: ${index.length} SKU(s) em data/js/ a partir de ${rawFiles.length} JSON em data/raw/` +
            (errCount ? ` (${errCount} arquivo(s) com erro).` : ".") +
            ` catalog_index.json → ${mergedIndex.length} entradas.`
    );
}

function processSKUNetwork(skuContent, legacyByStore) {
    const rawData = remapSkuDataStoreKeys(skuContent.data);
    // Loja fechada com físico no legado mas sem movimentos no JSON bruto (janela / miner antigo).
    if (legacyByStore && legacyByStore.size) {
        for (const [legacyStoreName] of legacyByStore) {
            if (!isClosedRetailStore(legacyStoreName)) continue;
            if (legacyPeakPhysicalForStore(legacyByStore, legacyStoreName) <= 0) continue;
            if (!Array.isArray(rawData[legacyStoreName])) {
                rawData[legacyStoreName] = [];
            }
        }
    }
    const networkResults = {};
    const storeNames = Object.keys(rawData).filter((s) => {
        if (s.includes('Fábrica') || s.includes('CD')) return false;
        const hint = peakPhysicalHintForStoreNetwork(s, legacyByStore, rawData[s] || []);
        return !isClosedRetailExcludedFromStockNetwork(s, hint);
    });
    const factoryKey = Object.keys(rawData).find(s => s.includes('Fábrica') || s.includes('CD')) || 'Fábrica';

    // 1) Pré-constrói timeline base (dia a dia) por loja para permitir agregações.
    const baseTimelineByStore = {};
    for (let i = 0; i < storeNames.length; i++) {
        const s = storeNames[i];
        baseTimelineByStore[s] =
            (DISABLE_LEGACY_PHYSICAL ? null : buildTimelineFromLegacyPositions(s, rawData[s] || [], legacyByStore)) ||
            buildTimelineFromMoves(rawData[s] || []);
    }

    const factoryMoves = rawData[factoryKey] || [];
    const baseTimelineFactory =
        (DISABLE_LEGACY_PHYSICAL ? null : buildTimelineFromLegacyPositions(factoryKey, factoryMoves, legacyByStore)) ||
        buildTimelineFromMoves(factoryMoves);

    // 2) Calcula curvas por loja (varejo).
    for (let i = 0; i < storeNames.length; i++) {
        const s = storeNames[i];
        networkResults[s] = processUnitFromBaseTimeline(s, baseTimelineByStore[s], false, null, legacyByStore);
    }

    // 3) Calcula hub/CD (usa p100 das lojas para demanda de rede).
    networkResults[factoryKey] = processUnitFromBaseTimeline(factoryKey, baseTimelineFactory, true, networkResults, legacyByStore);

    // 4) "TOTAL" — agrega físico dia a dia de todas as lojas + CD, e recomputa curvas como unidade separada.
    //    - Estoque: soma físico de todas as lojas abertas + hub/CD.
    //    - Vendas: soma vendas do varejo (CD não é ponto de venda; evita dupla contagem por transferências).
    //    - Vitrine: na visão TOTAL, vitrine conta como estoque (financeiro). Então, não subtrair vitrine:
    //      disponível = físico (override vitrine = 0).
    if (storeNames.length) {
        const vitrineTotal = 0;
        const totalBase = [];
        const n = Math.min(
            baseTimelineFactory ? baseTimelineFactory.length : Infinity,
            ...storeNames.map((s) => (baseTimelineByStore[s] ? baseTimelineByStore[s].length : 0))
        );
        for (let i = 0; i < n; i++) {
            let stockSum = 0;
            let salesSum = 0;
            let date = null;
            for (let si = 0; si < storeNames.length; si++) {
                const s = storeNames[si];
                const row = baseTimelineByStore[s] && baseTimelineByStore[s][i];
                if (!row) continue;
                if (!date) date = row.date;
                stockSum += Math.max(0, Number(row.stock) || 0);
                salesSum += Math.max(0, Number(row.sales) || 0);
            }
            const hubRow = baseTimelineFactory && baseTimelineFactory[i];
            if (hubRow) {
                if (!date) date = hubRow.date;
                stockSum += Math.max(0, Number(hubRow.stock) || 0);
            }
            if (!date) continue;
            totalBase.push({ date: date, stock: stockSum, sales: salesSum });
        }
        if (totalBase.length) {
            networkResults["TOTAL"] = processUnitFromBaseTimeline(
                "TOTAL",
                totalBase,
                false,
                null,
                legacyByStore,
                { vitrineOverride: vitrineTotal }
            );
        }
    }

    return { info: skuContent.info, results: networkResults };
}

/** Vendas por dia a partir das movimentações (inalterado). */
function buildDailySalesFromMoves(moves) {
    const dailyValues = {};
    moves.forEach(m => {
        const dStr = m.data_evento.split('T')[0];
        if (!dailyValues[dStr]) dailyValues[dStr] = { sales: 0 };
        const qty = parseFloat(m.quantidade);
        if (m.operacao !== 'CREDITO') {
            dailyValues[dStr].sales += qty;
        }
    });
    return dailyValues;
}

/** Físico diário a partir do legado ativoposicaoestoque (curva laranja); carry-forward entre dias sem snapshot. */
function buildTimelineFromLegacyPositions(storeName, moves, legacyByStore) {
    const dayMap = getLegacyDayMapForStore(legacyByStore, storeName);
    if (!dayMap) return null;
    const dailySales = buildDailySalesFromMoves(moves);
    const fullTimeline = [];
    let lastStock = 0;
    let currentD = new Date(START_GLOBAL);
    while (currentD <= END_GLOBAL) {
        const dStr = currentD.toISOString().split('T')[0];
        if (dayMap.has(dStr)) {
            lastStock = Math.max(0, Number(dayMap.get(dStr)) || 0);
        }
        const salesDay = dailySales[dStr] ? dailySales[dStr].sales : 0;
        fullTimeline.push({ date: dStr, stock: lastStock, sales: salesDay });
        currentD.setDate(currentD.getDate() + 1);
    }
    return fullTimeline;
}

/** Físico a partir do saldo de movimentos (legado anterior) + rebase se necessário. */
function buildTimelineFromMoves(moves) {
    let balance = 0;
    const dailyValues = {};

    moves.forEach(m => {
        const dStr = m.data_evento.split('T')[0];
        if (!dailyValues[dStr]) dailyValues[dStr] = { stock: 0, sales: 0 };
        const qty = parseFloat(m.quantidade);
        if (m.operacao === 'CREDITO') balance += qty;
        else {
            balance -= qty;
            dailyValues[dStr].sales += qty; 
        }
        dailyValues[dStr].balance = balance;
    });

    const fullTimeline = [];
    const fullTimelineRaw = [];
    let lastB = 0; 
    let currentD = new Date(START_GLOBAL);
    while(currentD <= END_GLOBAL) {
        const dStr = currentD.toISOString().split('T')[0];
        if (dailyValues[dStr] && dailyValues[dStr].balance !== undefined) lastB = dailyValues[dStr].balance; 
        const salesDay = dailyValues[dStr] ? dailyValues[dStr].sales : 0;
        fullTimelineRaw.push({ date: dStr, stockRaw: lastB, sales: salesDay });
        fullTimeline.push({ date: dStr, stock: Math.max(0, lastB), sales: salesDay });
        currentD.setDate(currentD.getDate() + 1);
    }

    const totalSales = fullTimelineRaw.reduce((acc, d) => acc + (Number(d.sales) || 0), 0);
    const nonZeroStockDays = fullTimeline.reduce((acc, d) => acc + (d.stock > 0 ? 1 : 0), 0);
    if (totalSales > 0 && nonZeroStockDays === 0) {
        let minRaw = Infinity;
        for (let i = 0; i < fullTimelineRaw.length; i++) {
            if (fullTimelineRaw[i].stockRaw < minRaw) minRaw = fullTimelineRaw[i].stockRaw;
        }
        if (Number.isFinite(minRaw) && minRaw < 0) {
            const rebaseOffset = -minRaw;
            for (let i = 0; i < fullTimeline.length; i++) {
                fullTimeline[i].stock = Math.max(0, fullTimelineRaw[i].stockRaw + rebaseOffset);
            }
        }
    }
    return fullTimeline;
}

function processUnitFromBaseTimeline(
    storeName,
    fullTimeline,
    isCD,
    otherStoresData = null,
    legacyByStore = null,
    opts = null
) {
    const vitrine =
        opts && Number.isFinite(Number(opts.vitrineOverride))
            ? Math.max(0, Number(opts.vitrineOverride))
            : (isCD ? VITRINE_CD : VITRINE_LOJA);
    const finalTimelineFluid = [];
    
    // VARIÁVEIS DE CONTROLE DE DEMANDA
    let ruptureCounter = 0;
    let avgDem = 0;
    let lostUnitsTotal = 0;
    const historicalDemands = []; // Array para cálculo da média móvel de 60 dias

    for (let i = 0; i < fullTimeline.length; i++) {
        const day = fullTimeline[i];
        
        // 1. Contador de Ruptura
        if (day.stock <= vitrine) ruptureCounter++;
        else ruptureCounter = 0;

        // 2. Cálculo de Demanda Efetiva (Regra dos 15 dias com Reset de Memória)
        let effectiveDemand = day.sales;
        if (ruptureCounter > 15) {
            // APÓS 15 DIAS: Corte Seco e Reset de Memória
            effectiveDemand = 0;
            avgDem = 0; // Zera a média instantaneamente conforme solicitado
            historicalDemands.length = 0; // Limpa o histórico para impedir inércia
        } else if (ruptureCounter > 0) {
            // Durante os primeiros 15 dias: Reconstituímos usando a média acumulada
            effectiveDemand = Math.max(day.sales, avgDem);
        } else {
            // Fora de ruptura: Segue a venda real
            effectiveDemand = day.sales;
        }

        historicalDemands.push(effectiveDemand);
        
        // 3. Média Móvel Suavizada (60 dias)
        if (historicalDemands.length > 0) {
            const slice = historicalDemands.slice(-SMOOTH_WINDOW);
            avgDem = slice.reduce((a, b) => a + b, 0) / slice.length;
        } else {
            avgDem = 0;
        }

        if (i >= WINDOW_DEMAND) {
            let base = avgDem * 7; // Removido o floor de 0.1 para permitir o zero real
            const p10 = base * 0.1;

            // Acumular Vendas Perdidas 
            const available = Math.max(0, day.stock - vitrine);
            if (available < p10 && ruptureCounter <= 15) {
                lostUnitsTotal += effectiveDemand;
            }

            if (isCD && otherStoresData) {
                let networkP100 = 0;
                for (let s in otherStoresData) {
                    const stDay = otherStoresData[s].timeline[i - WINDOW_DEMAND];
                    if (stDay) networkP100 += stDay.p100;
                }
                if (networkP100 > 0) base = networkP100;
            }

            finalTimelineFluid.push({
                date: day.date, physicalStock: day.stock, availableStock: available, sales: day.sales, 
                p10: p10, p50: base * 0.5, p80: base * 0.8, p100: base * 1.0, 
                p150: Math.max(base * 1.5, MIN_STOCK_USER),
                p300: base * 3.0, p600: base * 6.0
            });
        }
    }

    const last = finalTimelineFluid[finalTimelineFluid.length - 1] || { availableStock: 0, p150: MIN_STOCK_USER };
    
    return {
        metrics: {
            vitrine, currentAvailable: last.availableStock, currentPhysical: last.physicalStock,
            estoqueReposicao: Math.ceil(last.p150), 
            estoqueSugestao: Math.ceil(last.p150) - last.availableStock,
            ruptureRate: (finalTimelineFluid.filter(d => d.availableStock < d.p10).length / Math.max(1, finalTimelineFluid.length)) * 100,
            lostUnits: lostUnitsTotal
        },
        timeline: finalTimelineFluid
    };
}

runEngine().catch((err) => {
    console.error(err);
    process.exit(1);
});

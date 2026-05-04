/**
 * Replica o cálculo do pill STATUS nas vistas de `ceo_product_detail_layout.html`
 * (disp último dia vs P150 protegido, mesmas faixas resolveStatusByPct).
 *
 * Disponível / Mira: quando `systemPhysicalStock` existe no ponto da timeline, usa-se como físico ERP
 * e `disponível = max(0, físico − vitrine)`; caso contrário, motor do bundle (igual ao detalhe).
 * Faixa de status (pill / histograma): `disp / max(P150 Mira protegido, timeline[].p150 motor)` para evitar
 * razões artificiais >800% quando só a Mira colapsa abaixo do alvo `p150` já gravado no bundle.
 *
 * Usado pelo build `cd_purchase_plan`, `build_stock_health_histogram` e histogramas de saúde.
 */
"use strict";

const { isClosedRetailStore } = require("./closed_retail_stores");

const WINDOW = 56;
const LT_DEFAULT_MEAN = 14;
const LT_DEFAULT_SIGMA = 2;
const LT_MAX_LOOKAHEAD_DAYS = 45;
const STRUCTURED_MIN_STORES_SAME_DAY = 3;
const STRUCTURED_MIN_INBOUND_QTY = 2;
const MIRA_EMA_HALF_LIFE_DAYS = 30;
const LT_SAFETY_DEFAULT = 1.85;
const VOL_PROTECTION_MIN = 0.92;
const VOL_PROTECTION_CAP = 1.68;

/** Igual ao bloco em ceo_product_detail_layout.html (fallback por SKU). */
const LT_BY_SKU_STORE = {
  "3104": {
    Babita: { mean: 14, sigma: 2 },
    G2: { mean: 14, sigma: 2 },
    Betim: { mean: 14, sigma: 2 },
    "Venda Nova": { mean: 14, sigma: 2 },
    Barreiro: { mean: 14, sigma: 2 },
    Tupis: { mean: 14, sigma: 2 },
    Guaranis: { mean: 14, sigma: 2 },
    "Eldorado 2": { mean: 14, sigma: 2 },
    Fábrica: { mean: 21, sigma: 7 },
    __CD__: { mean: 21, sigma: 7 },
  },
};

const DEFAULT_TUNING = Object.freeze({
  ltSafetyMultiplier: 1.85,
  protectionCap: 1.55,
  reactHalfLife: 28,
  sigmaScale: 1,
  seasonBlend: 0.52,
});

function clampToYesterdayNonSunday(now = new Date()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function weekday(iso) {
  return new Date(iso + "T12:00:00").getDay();
}

function filterTimelineChartWindow(timeline, opts) {
  if (!timeline || !timeline.length) return [];
  const years = opts.years != null ? opts.years : 2;
  const excludeSun = opts.excludeSundays !== false;
  const anchor = opts.anchorDate || clampToYesterdayNonSunday(opts.now || new Date());
  const anchorD = new Date(anchor + "T12:00:00");
  const startD = new Date(anchorD);
  startD.setFullYear(startD.getFullYear() - years);
  return timeline.filter((row) => {
    const d = new Date(row.date + "T12:00:00");
    if (d < startD || d > anchorD) return false;
    if (excludeSun && weekday(row.date) === 0) return false;
    return true;
  });
}

function quantileSorted(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function stdDev(vals, mean) {
  if (!vals.length) return 0;
  const m = Number.isFinite(mean) ? mean : vals.reduce((a, b) => a + b, 0) / vals.length;
  let s = 0;
  for (let i = 0; i < vals.length; i++) s += Math.pow(vals[i] - m, 2);
  return Math.sqrt(s / vals.length);
}

function daysBetweenIso(a, b) {
  const da = new Date(a + "T12:00:00");
  const db = new Date(b + "T12:00:00");
  return Math.max(0, Math.round((db - da) / 86400000));
}

function robustMeanP95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const hi = quantileSorted(sorted, 0.95);
  let sum = 0;
  for (const v of values) sum += Math.min(v, hi);
  return sum / values.length;
}

function resolveCdStoreKey(results) {
  if (!results) return null;
  const preferred = ["Fábrica", "CD SARON", "Fabrica"];
  for (let i = 0; i < preferred.length; i++) {
    const k = preferred[i];
    const b = results[k];
    if (b && Array.isArray(b.timeline) && b.timeline.length) return k;
  }
  const keys = Object.keys(results);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const low = String(key).toLowerCase();
    if (low.indexOf("fábrica") >= 0 || low.indexOf("fabrica") >= 0 || low.indexOf("cd") >= 0) {
      const b = results[key];
      if (b && Array.isArray(b.timeline) && b.timeline.length) return key;
    }
  }
  return null;
}

function listRetailStoreKeys(results, cdKey) {
  const exclude = new Set(["Fábrica", "CD SARON"]);
  if (cdKey) exclude.add(cdKey);
  return Object.keys(results || {}).filter(function (s) {
    if (exclude.has(s)) return false;
    if (isClosedRetailStore(s)) return false;
    const b = results[s];
    return b && Array.isArray(b.timeline) && b.timeline.length;
  });
}

function getTimeline(bundle, storeName) {
  const root = bundle.results || bundle;
  const block = root[storeName];
  if (!block || !block.timeline) throw new Error('Loja "' + storeName + '" sem timeline.');
  return block.timeline;
}

function getMetrics(bundle, storeName) {
  const root = bundle.results || bundle;
  const block = root[storeName] || {};
  return block.metrics || {};
}

/**
 * Quando `systemPhysicalStock` existe no dia, governa físico e disponível (disp = max(0, físico − vitrine)).
 * Caso contrário, motor do bundle. `retailProxyPhysical`: loja com físico motor zerado usa disponível como proxy.
 */
function buildCanonicalStockSeries(timeline, vitrineNum, retailProxyPhysical) {
  const vit = Math.max(0, Number(vitrineNum) || 0);
  const n = timeline.length;
  const disponivel = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = timeline[i];
    const sys = Number(d.systemPhysicalStock);
    if (Number.isFinite(sys)) {
      disponivel[i] = Math.max(0, Math.max(0, sys) - vit);
    } else {
      const a = Number(d.availableStock);
      disponivel[i] = Number.isFinite(a) ? a : 0;
    }
  }
  const fisico = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = timeline[i];
    const sys = Number(d.systemPhysicalStock);
    if (Number.isFinite(sys)) {
      fisico[i] = Math.max(0, sys);
      continue;
    }
    const p = Number(d.physicalStock);
    const a = Number(disponivel[i]);
    if (
      retailProxyPhysical &&
      (!Number.isFinite(p) || Math.abs(p) <= 1e-9) &&
      Number.isFinite(a) &&
      Math.abs(a) > 1e-9
    ) {
      fisico[i] = a;
    } else {
      fisico[i] = Number.isFinite(p) ? p : 0;
    }
  }
  return { disponivel, fisico };
}

function timelineWithCanonicalAvailable(timeline, disponivel) {
  return timeline.map((d, i) => Object.assign({}, d, { availableStock: disponivel[i] }));
}

function inferLtByStore(bundle) {
  const results = (bundle && bundle.results) || {};
  const cdKey = resolveCdStoreKey(results);
  const stores = listRetailStoreKeys(results, cdKey);
  const byDateStores = new Map();
  const inboundByStore = {};

  for (let si = 0; si < stores.length; si++) {
    const store = stores[si];
    const tl = ((results[store] || {}).timeline || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const inb = [];
    for (let i = 0; i < tl.length; i++) {
      if (i === 0) {
        inb.push(0);
        continue;
      }
      const prevPhys = Number(tl[i - 1].physicalStock);
      const curPhys = Number(tl[i].physicalStock);
      const sales = Number(tl[i].sales);
      const prevEff = Number.isFinite(prevPhys) ? prevPhys : 0;
      const curEff = Number.isFinite(curPhys) ? curPhys : 0;
      const salesEff = Number.isFinite(sales) ? Math.max(0, sales) : 0;
      const inbound = Math.max(0, curEff - (prevEff - salesEff));
      inb.push(inbound);
      if (inbound > 0) {
        const d = String(tl[i].date);
        if (!byDateStores.has(d)) byDateStores.set(d, new Set());
        byDateStores.get(d).add(store);
      }
    }
    inboundByStore[store] = { timeline: tl, inbound: inb };
  }

  const routeWeekdays = new Set();
  const weekdayCounts = new Array(7).fill(0);
  const allInboundDates = Array.from(byDateStores.keys());
  for (let i = 0; i < allInboundDates.length; i++) {
    const wd = new Date(allInboundDates[i] + "T12:00:00").getDay();
    weekdayCounts[wd]++;
  }
  const avgWd = allInboundDates.length ? allInboundDates.length / 7 : 0;
  for (let wd = 0; wd < 7; wd++) {
    if (weekdayCounts[wd] >= avgWd * 1.15 && weekdayCounts[wd] >= 2) routeWeekdays.add(wd);
  }

  const out = {};
  for (let si = 0; si < stores.length; si++) {
    const store = stores[si];
    const pack = inboundByStore[store];
    const tl = pack.timeline;
    const inb = pack.inbound;
    const structured = new Array(tl.length).fill(false);
    let structuredCount = 0;
    let adHocCount = 0;

    for (let i = 0; i < tl.length; i++) {
      const q = Number(inb[i]) || 0;
      if (q <= 0) continue;
      const d = String(tl[i].date);
      const wd = new Date(d + "T12:00:00").getDay();
      const storesSameDay = byDateStores.has(d) ? byDateStores.get(d).size : 0;
      const isStructured =
        q >= STRUCTURED_MIN_INBOUND_QTY &&
        (storesSameDay >= STRUCTURED_MIN_STORES_SAME_DAY || routeWeekdays.has(wd));
      structured[i] = isStructured;
      if (isStructured) structuredCount++;
      else adHocCount++;
    }

    const ltSamples = [];
    for (let i = 1; i < tl.length; i++) {
      const prevAvail = Number(tl[i - 1].availableStock);
      const curAvail = Number(tl[i].availableStock);
      if (!(Number.isFinite(prevAvail) && Number.isFinite(curAvail))) continue;
      const ruptureStart = prevAvail > 0 && curAvail <= 0;
      if (!ruptureStart) continue;
      let jFound = -1;
      const maxJ = Math.min(tl.length - 1, i + LT_MAX_LOOKAHEAD_DAYS);
      for (let j = i + 1; j <= maxJ; j++) {
        const a = Number(tl[j].availableStock);
        if (!(Number.isFinite(a) && a > 0)) continue;
        if (structured[j] || (Number(inb[j]) || 0) > 0) {
          jFound = j;
          break;
        }
      }
      if (jFound > i) ltSamples.push(daysBetweenIso(String(tl[i].date), String(tl[jFound].date)));
    }

    const mean = ltSamples.length ? Math.max(1, robustMeanP95(ltSamples)) : LT_DEFAULT_MEAN;
    const sigma = ltSamples.length >= 3 ? Math.max(0.5, stdDev(ltSamples, mean)) : LT_DEFAULT_SIGMA;
    out[store] = {
      mean,
      sigma,
      effective: mean + sigma,
      samples: ltSamples.length,
      structuredCount,
      adHocCount,
    };
  }
  return out;
}

function getLtParams(sku, storeName, inferredMap, ltBySkuStore) {
  const map = ltBySkuStore || LT_BY_SKU_STORE;
  const inf = (inferredMap && inferredMap[storeName]) || null;
  if (inf && Number.isFinite(inf.mean) && Number.isFinite(inf.sigma)) {
    return {
      mean: inf.mean,
      sigma: inf.sigma,
      effective: inf.effective,
      samples: inf.samples || 0,
      structuredCount: inf.structuredCount || 0,
      adHocCount: inf.adHocCount || 0,
      source: "inferred",
    };
  }
  const skuMap = map[String(sku)] || {};
  const p = skuMap[storeName] || {};
  const mean = Number.isFinite(Number(p.mean)) ? Number(p.mean) : LT_DEFAULT_MEAN;
  const sigma = Number.isFinite(Number(p.sigma)) ? Math.max(0, Number(p.sigma)) : LT_DEFAULT_SIGMA;
  return { mean, sigma, effective: mean + sigma, samples: 0, structuredCount: 0, adHocCount: 0, source: "fallback" };
}

function getCdLtParams(sku, metrics, cdStoreKey, ltBySkuStore) {
  const map = ltBySkuStore || LT_BY_SKU_STORE;
  const m = metrics || {};
  const obj =
    m.cdReplenishmentLtFromReleases || m.cdReleaseLt || m.releaseLeadTime || m.liberacaoCompraLt || null;
  if (obj && typeof obj === "object") {
    const mean = Number(obj.mean);
    const sigma = Number.isFinite(Number(obj.sigma)) ? Number(obj.sigma) : 0;
    if (Number.isFinite(mean) && mean > 0) {
      return {
        mean: mean,
        sigma: Math.max(0, sigma),
        effective: mean + Math.max(0, sigma),
        samples: Number(obj.samples) || 0,
        structuredCount: 0,
        adHocCount: 0,
        source: "release_bundle",
      };
    }
  }
  const single = Number(m.cdReleaseLeadTimeDays ?? m.releaseLeadTimeDays ?? m.ltLiberacaoCompra);
  if (Number.isFinite(single) && single > 0) {
    return {
      mean: single,
      sigma: 0,
      effective: single,
      samples: 0,
      structuredCount: 0,
      adHocCount: 0,
      source: "release_bundle",
    };
  }
  const skuMap = map[String(sku)] || {};
  const p = skuMap[cdStoreKey] || skuMap.__CD__ || {};
  const mean = Number.isFinite(Number(p.mean)) ? Number(p.mean) : LT_DEFAULT_MEAN;
  const sigma = Number.isFinite(Number(p.sigma)) ? Math.max(0, Number(p.sigma)) : LT_DEFAULT_SIGMA;
  return {
    mean: mean,
    sigma: sigma,
    effective: mean + sigma,
    samples: 0,
    structuredCount: 0,
    adHocCount: 0,
    source: "cd_fallback",
  };
}

const LT_DAYS_MIN = 1;
const LT_DAYS_MAX = 365;

function clampLeadTimeDays(d) {
  const n = Math.round(Number(d));
  if (!Number.isFinite(n)) {
    return Math.max(LT_DAYS_MIN, Math.min(LT_DAYS_MAX, Math.round(LT_DEFAULT_MEAN + LT_DEFAULT_SIGMA)));
  }
  return Math.max(LT_DAYS_MIN, Math.min(LT_DAYS_MAX, n));
}

function operationalLeadTimeDaysRetail(sku, storeName, inferredMap, ltBySkuStore) {
  const ltSt = getLtParams(sku, storeName, inferredMap, ltBySkuStore);
  return clampLeadTimeDays(ltSt.effective);
}

function operationalLeadTimeDaysCd(sku, cdStoreName, metrics, inferredMap, ltBySkuStore) {
  const ltSt = getCdLtParams(sku, metrics, cdStoreName, ltBySkuStore);
  return clampLeadTimeDays(ltSt.effective);
}

/**
 * Status do último dia alinhado ao gráfico por SKU em ceo_product_detail_layout
 * (ratio disp / P150 protegido, resolveStatusByPct). Não aplica ajuste manual de LT (localStorage).
 *
 * @param {object} bundle — APOLLO_NETWORK_DATA
 * @param {string} storeName
 * @param {{ tuning?: object, ltBySkuStore?: object, anchorDate?: string, now?: Date }} [opts]
 * @returns {{ statusText: string, pctToday: number, dispToday: number, p100Today: number, p150Today: number, fisicoToday: number, cdKey: string|null } | { statusText: null, err: string }}
 */
function computeDetailViewStatus(bundle, storeName, opts) {
  const tuning = { ...DEFAULT_TUNING, ...(opts && opts.tuning) };
  const ltBySkuStore = (opts && opts.ltBySkuStore) || LT_BY_SKU_STORE;
  const anchorDate = opts && opts.anchorDate;
  const now = (opts && opts.now) || new Date();
  try {
    const resultsRoot = (bundle && bundle.results) || {};
    const cdKey = resolveCdStoreKey(resultsRoot);
    const isCdView = Boolean(cdKey && storeName === cdKey);
    const skuId = String((bundle.info && bundle.info.id) || "");
    const chartWindowOpts = { years: 2, excludeSundays: true, anchorDate, now };
    const timelineRaw = getTimeline(bundle, storeName);
    const timeline = filterTimelineChartWindow(timelineRaw, chartWindowOpts);
    if (!timeline.length) return { statusText: null, err: "empty_timeline" };

    const metrics = getMetrics(bundle, storeName);
    const inferredMap = inferLtByStore(bundle);
    const vitrineNum = Math.max(0, Number(metrics.vitrine) || 0);
    const canon = buildCanonicalStockSeries(timeline, vitrineNum, !isCdView);
    const disponivel = canon.disponivel;
    const timelineMira = timelineWithCanonicalAvailable(timeline, disponivel);
    let ltDaysOperational;
    let p100;
    if (isCdView) {
      ltDaysOperational = operationalLeadTimeDaysCd(skuId, storeName, metrics, inferredMap, ltBySkuStore);
      p100 = computeMira100(timelineMira, WINDOW, ltDaysOperational, tuning);
    } else {
      ltDaysOperational = operationalLeadTimeDaysRetail(skuId, storeName, inferredMap, ltBySkuStore);
      p100 = computeMira100(timelineMira, WINDOW, ltDaysOperational, tuning);
    }
    const sales = timeline.map((d) => {
      const s = Number(d.sales);
      return Number.isFinite(s) && s >= 0 ? s : 0;
    });
    const riskPack = computeVolatilityProtectionMultiplier(sales, disponivel, p100, tuning);
    const ltSafetyFactor = Number.isFinite(tuning.ltSafetyMultiplier) ? tuning.ltSafetyMultiplier : LT_SAFETY_DEFAULT;
    const p100WithLtSafety = scaleMira(p100, ltSafetyFactor);
    const cap = Math.max(1.0, Math.min(1.8, Number(tuning.protectionCap) || 1.25));
    const finalProtectionFactor = Math.max(
      VOL_PROTECTION_MIN,
      Math.min(Math.min(cap, VOL_PROTECTION_CAP), riskPack.factor)
    );
    const p100Protected = scaleMira(p100WithLtSafety, finalProtectionFactor);
    const p150Protected = scaleMira(p100Protected, 1.5);

    const idxToday = Math.max(0, timeline.length - 1);
    const dispToday = Number(disponivel[idxToday]) || 0;
    const fisicoToday = Number(canon.fisico[idxToday]) || 0;
    const p100Today = Number(p100Protected[idxToday]) || 0;
    const p150Today = Number(p150Protected[idxToday]) || 0;
    /* Ratio disp / P150: o motor Apollo já publica `p150` no ponto (demanda×LT com piso).
       A Mira pode ficar muito abaixo desse alvo após períodos de ruptura → razão explode e tudo cai em ENCALHADO 3.
       Usamos max(Mira, motor) como denominador para o *status* (histograma e pill alinhados ao estoque real vs alvo mínimo do motor). */
    const engineP150 = Number(timeline[idxToday].p150);
    const p150Denom = Math.max(
      p150Today,
      Number.isFinite(engineP150) && engineP150 > 0 ? engineP150 : 0,
      1e-9
    );
    const pctToday = p150Denom > 0 ? (dispToday / p150Denom) * 100 : dispToday > 0 ? Infinity : 0;
    const todayStatus = resolveStatusByPct(pctToday);
    return {
      statusText: todayStatus.text,
      pctToday,
      dispToday,
      p100Today,
      p150Today,
      fisicoToday,
      cdKey,
    };
  } catch (e) {
    return { statusText: null, err: String((e && e.message) || e || e) };
  }
}

function scaleMira(arr, k) {
  return arr.map((v) => (v == null ? null : v * k));
}

function smoothEma(series, halfLifeDays) {
  const out = new Array(series.length).fill(null);
  const hl = Math.max(1, Number(halfLifeDays) || 1);
  const alpha = 1 - Math.exp(Math.log(0.5) / hl);
  let prev = null;
  for (let i = 0; i < series.length; i++) {
    const v = Number(series[i]);
    if (!Number.isFinite(v)) {
      out[i] = prev;
      continue;
    }
    if (prev == null || !Number.isFinite(prev)) {
      prev = v;
    } else {
      prev = alpha * v + (1 - alpha) * prev;
    }
    out[i] = prev;
  }
  return out;
}

function computeMira100(timeline, windowDays, leadTimeDays, tuning) {
  const T = tuning || DEFAULT_TUNING;
  const W = windowDays;
  const LTd = leadTimeDays;
  const SHORT_RUPTURE_HOLD_DAYS = 15;
  const ALPHA_OBS = 0.22;
  const HOLD_DECAY = 0.003;
  const LONG_RUPTURE_DECAY = 0.03;
  const PRIOR_BLEND = 0.35;
  const PRIOR_FLOOR_RATIO = 0.55;
  const SEASON_BLEND = Math.max(0, Math.min(0.8, Number(T.seasonBlend) || 0));
  const SEASON_RADIUS_DAYS = 42;
  const SEASON_RECENCY_HALF_LIFE_DAYS = 260;
  const PREV_YEAR_BOOST = 1.35;
  const RUPTURE_FLOOR_LOOKBACK = 90;
  const RUPTURE_FLOOR_RATIO = 0.24;
  const n = timeline.length;
  const demandDaily = new Array(n).fill(null);
  const dayMs = 86400000;
  const dateMs = timeline.map((r) => new Date(String(r.date) + "T12:00:00").getTime());
  const doy = timeline.map((r) => {
    const d = new Date(String(r.date) + "T12:00:00");
    const y0 = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - y0) / dayMs);
  });
  const circularDist = (a, b) => {
    const d = Math.abs(a - b);
    return Math.min(d, 366 - d);
  };

  const baselineSales = [];
  const priorDailyArr = [];
  for (let i = 0; i < n; i++) {
    const avail = Number(timeline[i].availableStock);
    const s = Number(timeline[i].sales);
    if (Number.isFinite(avail) && avail > 0 && Number.isFinite(s) && s >= 0) baselineSales.push(s);
    const p100Legacy = Number(timeline[i].p100);
    if (Number.isFinite(p100Legacy) && p100Legacy > 0 && Number.isFinite(LTd) && LTd > 0) {
      priorDailyArr.push(p100Legacy / LTd);
    }
  }
  const baselineMuRaw = robustMeanP95(baselineSales);
  const priorDaily = priorDailyArr.length ? robustMeanP95(priorDailyArr) : null;
  const baselineMu =
    priorDaily != null
      ? Math.max(0.05, (1 - PRIOR_BLEND) * baselineMuRaw + PRIOR_BLEND * priorDaily)
      : Math.max(0.05, baselineMuRaw);

  let prev = baselineMu;
  let ruptureStreak = 0;
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - W + 1);
    const slice = timeline.slice(i0, i + 1);
    const cleanSales = [];
    for (let j = 0; j < slice.length; j++) {
      const a = Number(slice[j].availableStock);
      const s = Number(slice[j].sales);
      if (Number.isFinite(a) && a > 0 && Number.isFinite(s) && s >= 0) cleanSales.push(s);
    }
    let obs = cleanSales.length ? robustMeanP95(cleanSales) : baselineMu;

    let seasonNum = 0;
    let seasonDen = 0;
    for (let j = 0; j < i; j++) {
      const a = Number(timeline[j].availableStock);
      const s = Number(timeline[j].sales);
      if (!(Number.isFinite(a) && a > 0 && Number.isFinite(s) && s >= 0)) continue;
      const dd = circularDist(doy[i], doy[j]);
      if (dd > SEASON_RADIUS_DAYS) continue;
      const ageDays = Math.max(1, Math.round((dateMs[i] - dateMs[j]) / dayMs));
      let w = Math.max(0.02, 1 - dd / (SEASON_RADIUS_DAYS + 1));
      const recW = Math.exp((Math.log(0.5) / SEASON_RECENCY_HALF_LIFE_DAYS) * ageDays);
      w *= recW;
      if (ageDays >= 320 && ageDays <= 410) w *= PREV_YEAR_BOOST;
      seasonNum += w * s;
      seasonDen += w;
    }
    if (seasonDen > 0) {
      const seasonObs = seasonNum / seasonDen;
      obs = (1 - SEASON_BLEND) * obs + SEASON_BLEND * seasonObs;
    }

    const p100LegacyToday = Number(timeline[i].p100);
    const priorToday =
      Number.isFinite(p100LegacyToday) && p100LegacyToday > 0 && LTd > 0 ? p100LegacyToday / LTd : priorDaily;
    if (priorToday != null && Number.isFinite(priorToday)) {
      const floorByPrior = priorToday * PRIOR_FLOOR_RATIO;
      obs = Math.max(obs, floorByPrior);
      obs = (1 - PRIOR_BLEND) * obs + PRIOR_BLEND * priorToday;
    }

    const avail = Number(timeline[i].availableStock);
    if (Number.isFinite(avail) && avail > 0) {
      ruptureStreak = 0;
      prev = (1 - ALPHA_OBS) * prev + ALPHA_OBS * obs;
    } else {
      const f0 = Math.max(0, i - RUPTURE_FLOOR_LOOKBACK + 1);
      const recent = [];
      for (let k = f0; k <= i; k++) {
        const a2 = Number(timeline[k].availableStock);
        const s2 = Number(timeline[k].sales);
        if (Number.isFinite(a2) && a2 > 0 && Number.isFinite(s2) && s2 >= 0) recent.push(s2);
      }
      const recentFloor = recent.length ? Math.max(0.02, robustMeanP95(recent) * RUPTURE_FLOOR_RATIO) : 0.02;
      ruptureStreak++;
      if (ruptureStreak <= SHORT_RUPTURE_HOLD_DAYS) {
        prev = Math.max(recentFloor, prev * (1 - HOLD_DECAY));
      } else {
        prev = Math.max(recentFloor * 0.7, prev * (1 - LONG_RUPTURE_DECAY));
      }
    }
    demandDaily[i] = prev;
  }
  const miraRaw = demandDaily.map((d) => d * LTd);
  const hl = Math.max(8, Math.min(90, Number(T.reactHalfLife) || MIRA_EMA_HALF_LIFE_DAYS));
  return smoothEma(miraRaw, hl);
}

function computeVolatilityProtectionMultiplier(sales, available, baseP100, tuning) {
  const T = tuning || DEFAULT_TUNING;
  const n = Math.min(sales.length, available.length, baseP100.length);
  if (!n) return { factor: 1, cv: 0, roiGuard: 1 };
  const valid = [];
  for (let i = 0; i < n; i++) {
    const a = Number(available[i]);
    const s = Number(sales[i]);
    if (Number.isFinite(a) && a > 0 && Number.isFinite(s) && s >= 0) valid.push(s);
  }
  const mu = robustMeanP95(valid);
  const sd = valid.length >= 3 ? stdDev(valid, mu) : 0;
  const sigmaAdj = Math.max(0.6, Math.min(2.0, Number(T.sigmaScale) || 1));
  const cv = mu > 1e-6 ? (sd / mu) * sigmaAdj : 0;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const volSignal = clamp01((cv - 0.45) / 1.1);

  const tail = Math.min(75, n);
  let over = 0;
  let rup = 0;
  let counted = 0;
  for (let i = n - tail; i < n; i++) {
    const a = Number(available[i]);
    const p = Number(baseP100[i]);
    if (!(Number.isFinite(a) && Number.isFinite(p) && p > 0)) continue;
    counted++;
    if (a <= 0) rup++;
    if (a > p * 1.8) over++;
  }
  const rupRate = counted ? rup / counted : 0;
  const overRate = counted ? over / counted : 0;
  const roiGuard = Math.max(0.2, Math.min(1, 1 - overRate * 0.8 + rupRate * 0.35));
  const factor = 1 + 0.32 * volSignal * roiGuard;
  return { factor, cv, roiGuard };
}

function computeAggregatedP100SumStores(bundle, retailKeys, windowOpts, windowDays, inferredMap, expectedLength, skuId, tuning, ltBySkuStore) {
  const sums = new Array(expectedLength).fill(0);
  if (!retailKeys.length || !expectedLength) return { p100: sums, storeCount: 0 };
  let used = 0;
  for (let i = 0; i < retailKeys.length; i++) {
    const key = retailKeys[i];
    let tl;
    try {
      tl = filterTimelineChartWindow(getTimeline(bundle, key), windowOpts);
    } catch (_) {
      continue;
    }
    if (tl.length !== expectedLength) continue;
    const ltSt = getLtParams(skuId, key, inferredMap, ltBySkuStore);
    const LTd = Number(ltSt.effective);
    if (!Number.isFinite(LTd) || LTd <= 0) continue;
    const mKey = getMetrics(bundle, key);
    const vitK = Math.max(0, Number(mKey.vitrine) || 0);
    const dispK = buildCanonicalStockSeries(tl, vitK, true).disponivel;
    const tlMira = timelineWithCanonicalAvailable(tl, dispK);
    const p = computeMira100(tlMira, windowDays, LTd, tuning);
    if (p.length !== expectedLength) continue;
    used++;
    for (let j = 0; j < expectedLength; j++) sums[j] += Number(p[j]) || 0;
  }
  return { p100: sums, storeCount: used };
}

/** pct = (disponível / P150) × 100 — ABAIXO ou melhor implica disp ≤ P150. */
function resolveStatusByPct(pct) {
  if (pct < 10) return { text: "RUPTURA", cls: "zone-ruptura" };
  if (pct < 50) return { text: "CRÍTICO", cls: "zone-critico" };
  if (pct < 100) return { text: "ABAIXO", cls: "zone-abaixo" };
  if (pct < 150) return { text: "ACIMA", cls: "zone-acima" };
  if (pct < 200) return { text: "MUITO ACIMA", cls: "zone-muito-acima" };
  if (pct < 400) return { text: "ENCALHADO 1", cls: "zone-enc1" };
  if (pct < 800) return { text: "ENCALHADO 2", cls: "zone-enc2" };
  return { text: "ENCALHADO 3", cls: "zone-enc3" };
}

/**
 * @param {object} bundle window.APOLLO_NETWORK_DATA
 * @param {object} [opts]
 * @param {object} [opts.tuning] mesmos defaults da página (sliders iniciais)
 * @param {string} [opts.anchorDate] âncora do recorte (default: ontem útil)
 * @param {Date} [opts.now] relógio para âncora (testes)
 * @param {object} [opts.ltBySkuStore] mapa opcional LT (igual ao HTML)
 * @returns {{ statusText: string, pctToday: number, dispToday: number, p100Today: number, p150Today: number, cdKey: string } | { statusText: null, err: string }}
 */
function computeCdFactoryStatus(bundle, opts) {
  const tuning = { ...DEFAULT_TUNING, ...(opts && opts.tuning) };
  const ltBySkuStore = (opts && opts.ltBySkuStore) || LT_BY_SKU_STORE;
  const anchorDate = opts && opts.anchorDate;
  const now = (opts && opts.now) || new Date();
  try {
    const resultsRoot = (bundle && bundle.results) || {};
    const cdKey = resolveCdStoreKey(resultsRoot);
    if (!cdKey) return { statusText: null, err: "no_cd_key" };

    const skuId = String((bundle.info && bundle.info.id) || "");
    const chartWindowOpts = { years: 2, excludeSundays: true, anchorDate, now };
    const timelineRaw = getTimeline(bundle, cdKey);
    const timeline = filterTimelineChartWindow(timelineRaw, chartWindowOpts);
    if (!timeline.length) return { statusText: null, err: "empty_cd_timeline" };

    const metrics = getMetrics(bundle, cdKey);
    const ltParams = getCdLtParams(skuId, metrics, cdKey, ltBySkuStore);
    const inferredLtMap = inferLtByStore(bundle);
    const retailKeys = listRetailStoreKeys(resultsRoot, cdKey);
    const agg = computeAggregatedP100SumStores(
      bundle,
      retailKeys,
      chartWindowOpts,
      WINDOW,
      inferredLtMap,
      timeline.length,
      skuId,
      tuning,
      ltBySkuStore
    );
    let p100 = agg.p100;
    if (!agg.storeCount) {
      const vitCd = Math.max(0, Number(metrics.vitrine) || 0);
      const dispCd = buildCanonicalStockSeries(timeline, vitCd, false).disponivel;
      const tlCdMira = timelineWithCanonicalAvailable(timeline, dispCd);
      p100 = computeMira100(tlCdMira, WINDOW, ltParams.effective, tuning);
    }

    const vitCdAll = Math.max(0, Number(metrics.vitrine) || 0);
    const disponivel = buildCanonicalStockSeries(timeline, vitCdAll, false).disponivel;
    const sales = timeline.map((d) => {
      const s = Number(d.sales);
      return Number.isFinite(s) && s >= 0 ? s : 0;
    });

    const riskPack = computeVolatilityProtectionMultiplier(sales, disponivel, p100, tuning);
    const ltSafetyFactor = Number.isFinite(tuning.ltSafetyMultiplier) ? tuning.ltSafetyMultiplier : LT_SAFETY_DEFAULT;
    const p100WithLtSafety = scaleMira(p100, ltSafetyFactor);
    const cap = Math.max(1.0, Math.min(1.8, Number(tuning.protectionCap) || 1.25));
    const finalProtectionFactor = Math.max(
      VOL_PROTECTION_MIN,
      Math.min(Math.min(cap, VOL_PROTECTION_CAP), riskPack.factor)
    );
    const p100Protected = scaleMira(p100WithLtSafety, finalProtectionFactor);
    const p150Protected = scaleMira(p100Protected, 1.5);

    const idxToday = Math.max(0, timeline.length - 1);
    const dispToday = Number(disponivel[idxToday]) || 0;
    const p100Today = Number(p100Protected[idxToday]) || 0;
    const p150Today = Number(p150Protected[idxToday]) || 0;
    const engineP150Cd = Number(timeline[idxToday].p150);
    const p150DenomCd = Math.max(
      p150Today,
      Number.isFinite(engineP150Cd) && engineP150Cd > 0 ? engineP150Cd : 0,
      1e-9
    );
    const pctToday = p150DenomCd > 0 ? (dispToday / p150DenomCd) * 100 : dispToday > 0 ? Infinity : 0;
    const todayStatus = resolveStatusByPct(pctToday);
    return {
      statusText: todayStatus.text,
      pctToday,
      dispToday,
      p100Today,
      p150Today,
      cdKey,
    };
  } catch (e) {
    return { statusText: null, err: String(e && e.message ? e.message : e) };
  }
}

module.exports = {
  DEFAULT_TUNING,
  LT_BY_SKU_STORE,
  WINDOW,
  resolveStatusByPct,
  computeCdFactoryStatus,
  computeDetailViewStatus,
  resolveCdStoreKey,
  listRetailStoreKeys,
};

/**
 * @file mira_model.js
 * @description Núcleo matemático **canônico** do modelo Co-CEO / Mira robusta.
 * Usado por scripts Node (simulação, exportação em lote) e documentado em
 * `docs/MODELO_MATEMATICO_MIRA.md`. As páginas HTML podem espelhar a mesma lógica
 * até haver bundle ESM único para o browser.
 *
 * ---------------------------------------------------------------------------
 * Resumo formal (ver documentação para notação completa)
 * ---------------------------------------------------------------------------
 *
 * **1. Recorte temporal** — Seja (d_t) a série diária ordenada. Fixamos horizonte
 * de H anos até a âncora T* (último dia não domingo a partir do último dado).
 * Opcionalmente excluímos domingos do conjunto de índices.
 *
 * **2. Janela móvel** — Para cada índice t, J_t = { t−W+1, …, t } ∩ domínio válido.
 *
 * **3. Filtro de ruptura na média** — Dentro de J_t, consideramos vendas s_i em
 * dias i com disponível a_i = availableStock_i ≥ 0 (dias com a_i < 0 não entram
 * na média “limpa”, pois distorcem demanda observável).
 *
 * **4. Fallback** — Se o número de dias válidos |S| < m (padrão m=5), usamos todas
 * as vendas não negativas da janela (ainda com winsorização), para não zerar a mira.
 *
 * **5. Winsorização superior** — Seja Q_p a quantil empírico (p=0,95). Substituímos
 * s_i ← min(s_i, Q_0,95).
 *
 * **6. Média robusta** — μ_t = (1/|S'|) Σ s_i' sobre o conjunto pós-winsorização.
 *
 * **7. Mira P100** — M_t = μ_t · LT, com LT = lead time em **dias** (parâmetro de calibração).
 *
 * **8. Bandas de política** — Para k ∈ K, P_k(t) = k · M_t. Conjunto K padrão:
 * {0,1; 0,5; 0,8; 1,5; 2; 3; 6} (P100 implícito k=1). P200 = 2M.
 *
 * @module lib/mira_model
 */

"use strict";

/** @type {Readonly<Record<string, number>>} Multiplicadores k das bandas (nomes estáveis). */
const ZONE_K = Object.freeze({
  p10: 0.1,
  p50: 0.5,
  p80: 0.8,
  p100: 1.0,
  p150: 1.5,
  p200: 2.0,
  p300: 3.0,
  p600: 6.0,
});

const DEFAULT_MIN_CLEAN_DAYS = 5;
const DEFAULT_WINSOR_P = 0.95;

/**
 * @param {string} iso YYYY-MM-DD
 * @returns {number} 0=domingo … 6=sábado
 */
function weekday(iso) {
  return new Date(iso + "T12:00:00").getDay();
}

/**
 * Recua até o último dia que não é domingo (último “útil” relativo ao ISO dado).
 * @param {string} iso
 * @returns {string} YYYY-MM-DD
 */
function clampToLastNonSunday(iso) {
  let d = new Date(iso + "T12:00:00");
  while (d.getDay() === 0) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ date: string }[]} timeline ordenada por date
 * @param {object} [opts]
 * @param {string} [opts.anchorDate] YYYY-MM-DD; default = último ponto da série
 * @param {number} [opts.years] default 2
 * @param {boolean} [opts.excludeSundays] default true
 * @returns {object[]}
 */
function filterTimelineChartWindow(timeline, opts = {}) {
  if (!timeline || !timeline.length) return [];
  const years = opts.years != null ? opts.years : 2;
  const excludeSun = opts.excludeSundays !== false;

  const lastRaw = opts.anchorDate || timeline[timeline.length - 1].date;
  const anchor = clampToLastNonSunday(lastRaw);
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

/**
 * Quantil empírico por índice de ordenação (compatível com implementação original).
 * @param {number[]} sorted array ordenado crescente
 * @param {number} p em [0,1]
 */
function quantileSorted(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Série Mira P100 por dia (alinhada ao índice da timeline filtrada).
 * @param {object[]} timeline — pontos com date, sales, availableStock
 * @param {number} windowDays W
 * @param {number} leadTimeDays LT
 * @param {object} [opt]
 * @param {number} [opt.minCleanDays]
 * @param {number} [opt.winsorP]
 * @returns {{ series: (number|null)[], fallbackWindows: number }}
 */
function computeMira100(timeline, windowDays, leadTimeDays, opt = {}) {
  const W = windowDays;
  const LT = leadTimeDays;
  const MIN_DAYS = opt.minCleanDays != null ? opt.minCleanDays : DEFAULT_MIN_CLEAN_DAYS;
  const WIN_P = opt.winsorP != null ? opt.winsorP : DEFAULT_WINSOR_P;
  const n = timeline.length;
  const out = new Array(n);
  let fallbackWindows = 0;

  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - W + 1);
    const slice = timeline.slice(i0, i + 1);
    const salesNoRupture = [];
    for (const day of slice) {
      const avail = Number(day.availableStock);
      if (Number.isNaN(avail)) continue;
      if (avail < 0) continue;
      const s = Number(day.sales);
      if (!Number.isNaN(s) && s >= 0) salesNoRupture.push(s);
    }
    let salesUse = salesNoRupture;
    if (salesNoRupture.length < MIN_DAYS) {
      const allSales = [];
      for (const day of slice) {
        const s = Number(day.sales);
        if (!Number.isNaN(s) && s >= 0) allSales.push(s);
      }
      if (allSales.length > 0) {
        salesUse = allSales;
        fallbackWindows++;
      }
    }
    if (salesUse.length === 0) {
      out[i] = null;
      continue;
    }
    const sorted = [...salesUse].sort((a, b) => a - b);
    const hi = quantileSorted(sorted, WIN_P);
    let sum = 0;
    let cnt = 0;
    for (const s of salesUse) {
      sum += Math.min(s, hi);
      cnt++;
    }
    const mu = cnt ? sum / cnt : 0;
    out[i] = mu * LT;
  }
  return { series: out, fallbackWindows };
}

/**
 * Gera curvas P_k(t) = k * M_t com k em ZONE_K (M_t pode ser null).
 * @param {(number|null)[]} mira100
 * @param {Record<string, number>} [kMap]
 * @returns {Record<string, (number|null)[]>}
 */
function buildZoneCurves(mira100, kMap = ZONE_K) {
  /** @type {Record<string, (number|null)[]>} */
  const out = {};
  for (const [name, k] of Object.entries(kMap)) {
    out[name] = mira100.map((v) => (v == null ? null : v * k));
  }
  return out;
}

/**
 * Executa recorte + mira + bandas num único passo (API estável para scripts).
 * @param {object[]} rawTimeline timeline bruta (uma loja)
 * @param {object} opts
 * @param {number} [opts.years]
 * @param {boolean} [opts.excludeSundays]
 * @param {number} opts.windowDays W
 * @param {number} opts.leadTimeDays LT
 */
function runMiraPipeline(rawTimeline, opts) {
  const years = opts.years != null ? opts.years : 2;
  const excludeSundays = opts.excludeSundays !== false;
  const tl = filterTimelineChartWindow(rawTimeline, { years, excludeSundays });
  const miraOut = computeMira100(tl, opts.windowDays, opts.leadTimeDays, {
    minCleanDays: opts.minCleanDays,
    winsorP: opts.winsorP,
  });
  const zones = buildZoneCurves(miraOut.series);
  return {
    timelineFiltered: tl,
    mira100: miraOut.series,
    zones,
    meta: {
      fallbackWindows: miraOut.fallbackWindows,
      windowDays: opts.windowDays,
      leadTimeDays: opts.leadTimeDays,
      years,
      excludeSundays,
    },
  };
}

module.exports = {
  ZONE_K,
  DEFAULT_MIN_CLEAN_DAYS,
  DEFAULT_WINSOR_P,
  weekday,
  clampToLastNonSunday,
  filterTimelineChartWindow,
  quantileSorted,
  computeMira100,
  buildZoneCurves,
  runMiraPipeline,
};

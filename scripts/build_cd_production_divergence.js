"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require(path.join(__dirname, "..", "coceo_db_config"));
const { computeCdFactoryStatus, computeDetailViewStatus } = require(path.join(__dirname, "..", "lib", "ceo_cd_factory_status"));

const ROOT = path.join(__dirname, "..");
const CD_PLAN_PATH = path.join(ROOT, "data", "client", "cd_purchase_plan.json");
const CATALOG_GRID_PATH = path.join(ROOT, "data", "catalog_grid.js");
const OUT_JSON = path.join(ROOT, "data", "client", "cd_production_divergence.json");
const OUT_JS = path.join(ROOT, "data", "client", "cd_production_divergence.js");
const SKU_JS_DIR = path.join(ROOT, "data", "js");

function normalizeCode(v) {
  return String(v == null ? "" : v).trim();
}

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function dateIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function loadCdPlanRows() {
  if (!fs.existsSync(CD_PLAN_PATH)) {
    throw new Error("Arquivo ausente: data/client/cd_purchase_plan.json (rode npm run build:cd-plan)");
  }
  const j = JSON.parse(fs.readFileSync(CD_PLAN_PATH, "utf8"));
  const rows = Array.isArray(j.rows) ? j.rows : [];
  const byCode = new Map();
  for (const r of rows) {
    const code = normalizeCode(r.erp_code);
    if (!code) continue;
    byCode.set(code, r);
  }
  return { generated_at: j.generated_at || null, byCode };
}

function loadCatalogSkuIdByCode() {
  if (!fs.existsSync(CATALOG_GRID_PATH)) return new Map();
  const raw = fs.readFileSync(CATALOG_GRID_PATH, "utf8").trim();
  const jsonStr = raw.replace(/^\s*const\s+CATALOG_GRID\s*=\s*/, "").replace(/;\s*$/, "");
  const arr = JSON.parse(jsonStr);
  const map = new Map();
  for (const r of arr || []) {
    const code = normalizeCode(r && r.code);
    const id = Number(r && r.id);
    if (!code || !Number.isFinite(id) || id <= 0) continue;
    if (!map.has(code)) {
      map.set(code, {
        id,
        legacyAtivo: r && r.legacyAtivo !== false,
      });
    }
  }
  return map;
}

function loadSkuBundle(skuInternalId) {
  const id = Number(skuInternalId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const p = path.join(SKU_JS_DIR, `sku_${id}.js`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").trim();
  const jsonPart = raw.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  try {
    return JSON.parse(jsonPart);
  } catch (_) {
    return null;
  }
}

function normalizeName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCdKey(results) {
  const keys = Object.keys(results || {});
  for (const k of ["Fábrica", "CD SARON", "Fabrica"]) {
    if (results[k] && Array.isArray(results[k].timeline)) return k;
  }
  for (const k of keys) {
    if (/fabrica|fábrica|\bcd\b/.test(normalizeName(k))) return k;
  }
  return null;
}

function retailKeys(results, cdKey) {
  const out = [];
  for (const k of Object.keys(results || {})) {
    if (k === cdKey) continue;
    if (/fabrica|fábrica|\bcd\b/.test(normalizeName(k))) continue;
    const b = results[k];
    if (b && Array.isArray(b.timeline) && b.timeline.length) out.push(k);
  }
  return out;
}

function coceoSuggestedFromBundle(bundle) {
  const results = (bundle && bundle.results) || {};
  const cdKey = resolveCdKey(results);
  if (!cdKey) return { base_cd: 0, lojas: 0, total: 0 };
  const cdDetail = computeDetailViewStatus(bundle, cdKey, {});
  const cdP100 = cdDetail && Number.isFinite(Number(cdDetail.p100Today)) ? Number(cdDetail.p100Today) : 0;
  const cdDisp = cdDetail && Number.isFinite(Number(cdDetail.dispToday)) ? Number(cdDetail.dispToday) : 0;
  const baseCd = Math.max(0, Math.round(cdP100 * 1.5 - cdDisp));
  let lojas = 0;
  for (const store of retailKeys(results, cdKey)) {
    const st = computeDetailViewStatus(bundle, store, {});
    const p100 = st && Number.isFinite(Number(st.p100Today)) ? Number(st.p100Today) : 0;
    const disp = st && Number.isFinite(Number(st.dispToday)) ? Number(st.dispToday) : 0;
    const sug = Math.max(0, Math.round(p100 * 1.5 - disp));
    lojas += sug;
  }
  return { base_cd: baseCd, lojas, total: baseCd + lojas };
}

async function loadLegacyLatestProductionRows() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    const [latestBatchRows] = await conn.query(
      `
      SELECT l.IdListaProducao AS batch_id,
             COALESCE(l.DataAlteracao, l.DataCriacao) AS batch_date
      FROM listaproducaoitem l
      LEFT JOIN unidadenegocio u ON u.IdUnidadeNegocio = l.IdUnidadeNegocio
      WHERE COALESCE(l.IndDeletado, b'0') = b'0'
        AND (u.NomeFantasia IS NULL OR LOWER(u.NomeFantasia) REGEXP 'fábrica|fabrica|\\bcd\\b|matriz')
      ORDER BY COALESCE(l.DataAlteracao, l.DataCriacao) DESC, l.IdListaProducao DESC
      LIMIT 1
      `
    );
    if (!latestBatchRows.length || !latestBatchRows[0].batch_id) {
      return { batch_id: null, batch_date: null, rows: [] };
    }
    const batchId = Number(latestBatchRows[0].batch_id);
    const batchDate = latestBatchRows[0].batch_date;

    const [rows] = await conn.query(
      `
      SELECT
        l.Id AS production_item_id,
        l.IdListaProducao AS batch_id,
        l.IdProduto AS product_id,
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS erp_code,
        p.Descricao AS product_name,
        l.QtdSugerida AS legacy_suggested_qty,
        l.TotalEmProducao AS legacy_in_production_qty,
        l.StatusAtivo AS legacy_status_ativo
      FROM listaproducaoitem l
      LEFT JOIN produto p ON p.Id = l.IdProduto
      WHERE l.IdListaProducao = ?
        AND COALESCE(l.IndDeletado, b'0') = b'0'
      `,
      [batchId]
    );
    return {
      batch_id: batchId,
      batch_date: batchDate,
      rows: rows || [],
    };
  } finally {
    await conn.end();
  }
}

function yesterdayIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function findStoreKeyByName(results, wantedName) {
  const keys = Object.keys(results || {});
  const wanted = normalizeName(wantedName);
  for (const k of keys) {
    if (normalizeName(k) === wanted) return k;
  }
  for (const k of keys) {
    const nk = normalizeName(k);
    if (nk.includes(wanted) || wanted.includes(nk)) return k;
  }
  return null;
}

function appendOrReplaceTimelinePoint(timeline, row) {
  if (!Array.isArray(timeline)) return;
  const date = String(row.date || "");
  if (!date) return;
  const point = {
    date,
    physicalStock: Number(row.physicalStock) || 0,
    legacyStock: Number(row.physicalStock) || 0,
    availableStock: Number(row.availableStock) || 0,
    sales: Number(row.sales) || 0,
    instantaneousDemand: 0,
    currentLT: 0,
    p10: 0,
    p50: 0,
    p80: 0,
    p100: 0,
    p150: 0,
    p300: 0,
    p600: 0,
  };
  let replaced = false;
  for (let i = 0; i < timeline.length; i++) {
    if (String(timeline[i].date) === date) {
      timeline[i] = { ...timeline[i], ...point };
      replaced = true;
      break;
    }
  }
  if (!replaced) timeline.push(point);
  timeline.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function applyLegacyYesterdaySnapshot(conn, bundle, skuId) {
  const results = (bundle && bundle.results) || {};
  if (!Object.keys(results).length) return;
  const [rows] = await conn.query(
    `
    SELECT
      u.NomeFantasia AS store_name,
      CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) AS available_stock,
      CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4)) AS vitrine_stock
    FROM ativo a
    JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
    LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
    WHERE a.IdProduto = ?
      AND COALESCE(a.IndDeletado, b'0') = b'0'
    `,
    [skuId]
  );
  const refDate = yesterdayIso();
  for (const r of rows || []) {
    const key = findStoreKeyByName(results, r.store_name);
    if (!key) continue;
    const block = results[key];
    if (!block || !Array.isArray(block.timeline)) continue;
    const avail = Number(r.available_stock) || 0;
    const vitrine = Number(r.vitrine_stock) || 0;
    appendOrReplaceTimelinePoint(block.timeline, {
      date: refDate,
      availableStock: avail,
      physicalStock: avail + vitrine,
      sales: 0,
    });
  }
}

async function main() {
  const cdPlan = loadCdPlanRows();
  const catalogSkuIdByCode = loadCatalogSkuIdByCode();
  const legacy = await loadLegacyLatestProductionRows();
  const connLegacy = await mysql.createConnection(assertLegacyConfig());

  const joined = [];
  try {
    for (const l of legacy.rows) {
      const code = normalizeCode(l.erp_code);
      if (!code) continue;
      const co = cdPlan.byCode.get(code) || null;
      const catMeta = catalogSkuIdByCode.get(code) || null;
      if (catMeta && catMeta.legacyAtivo === false) continue;
      const skuInternalId = co && Number.isFinite(Number(co.sku_internal_id))
        ? Number(co.sku_internal_id)
        : (catMeta ? Number(catMeta.id) : null);
      const bundle = skuInternalId ? loadSkuBundle(skuInternalId) : null;
      if (bundle && skuInternalId) {
        await applyLegacyYesterdaySnapshot(connLegacy, bundle, skuInternalId);
      }
      const coceoPack = bundle ? coceoSuggestedFromBundle(bundle) : { base_cd: 0, lojas: 0, total: co ? asInt(co.demanda_total_cd) : 0 };
      const coceoSuggested = asInt(coceoPack.total);
      const legacySuggested = asInt(l.legacy_suggested_qty);
      const diffSigned = coceoSuggested - legacySuggested;
      const diffAbs = Math.abs(diffSigned);
      const cdStatus = bundle ? ((computeCdFactoryStatus(bundle, {}) || {}).statusText || null) : null;
      joined.push({
        erp_code: code,
        product_id: Number(l.product_id) || null,
        product_name: String(l.product_name || (co && co.product_name) || ""),
        sku_internal_id: skuInternalId,
        status_urgencia: cdStatus || (co ? String(co.status_urgencia || "ACIMA") : "SEM_DADO_COCEO"),
        legacy_suggested_qty: legacySuggested,
        legacy_in_production_qty: asInt(l.legacy_in_production_qty),
        coceo_cd_base_qty: asInt(coceoPack.base_cd),
        coceo_store_pull_qty: asInt(coceoPack.lojas),
        coceo_suggested_qty: coceoSuggested,
        diff_signed: diffSigned,
        diff_abs: diffAbs,
      });
    }
  } finally {
    await connLegacy.end();
  }

  joined.sort((a, b) => b.diff_abs - a.diff_abs || b.coceo_suggested_qty - a.coceo_suggested_qty);

  const out = {
    generated_at: new Date().toISOString(),
    source: {
      cd_plan_generated_at: cdPlan.generated_at,
      legacy_batch_id: legacy.batch_id,
      legacy_batch_date: legacy.batch_date,
      legacy_batch_date_iso: dateIso(legacy.batch_date),
    },
    stats: {
      compared_skus: joined.length,
      legacy_suggested_total: joined.reduce((a, r) => a + r.legacy_suggested_qty, 0),
      legacy_in_production_total: joined.reduce((a, r) => a + r.legacy_in_production_qty, 0),
      coceo_suggested_total: joined.reduce((a, r) => a + r.coceo_suggested_qty, 0),
      diff_abs_total: joined.reduce((a, r) => a + r.diff_abs, 0),
    },
    rows: joined,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out), "utf8");
  fs.writeFileSync(OUT_JS, "window.CD_PRODUCTION_DIVERGENCE_DATA = " + JSON.stringify(out) + ";\n", "utf8");
  console.log("Gerado:", OUT_JSON);
  console.log("Gerado:", OUT_JS);
  console.log("Lote legado:", out.source.legacy_batch_id, "| data:", out.source.legacy_batch_date_iso);
  console.log("SKUs comparados:", out.stats.compared_skus, "| Divergência abs total:", out.stats.diff_abs_total);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


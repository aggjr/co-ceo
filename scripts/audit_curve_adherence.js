"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require(path.join(__dirname, "..", "coceo_db_config"));

const ROOT = path.join(__dirname, "..");
const PLAN_PATH = path.join(ROOT, "data", "client", "cd_purchase_plan.json");
const SKU_JS_DIR = path.join(ROOT, "data", "js");

function normalizeStoreName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function loadPlanRows() {
  const raw = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  return Array.isArray(raw.rows) ? raw.rows : [];
}

function loadBundleBySkuId(skuId) {
  const p = path.join(SKU_JS_DIR, `sku_${skuId}.js`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").trim();
  const jsonPart = raw.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  return JSON.parse(jsonPart);
}

async function loadSystemPhysicalHistoryByErpCodes(erpCodes) {
  if (!erpCodes.length) return [];
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    const out = [];
    const chunkSize = 400;
    for (let i = 0; i < erpCodes.length; i += chunkSize) {
      const chunk = erpCodes.slice(i, i + chunkSize);
      const [rows] = await conn.query(
        `
        SELECT
          COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS erp_code,
          u.NomeFantasia AS store_name,
          DATE_FORMAT(ape.DataMovimentacao, '%Y-%m-%d') AS ref_date,
          CAST(MAX(COALESCE(ape.PosicaoEstoque, 0)) AS DECIMAL(18,4)) AS physical_stock
        FROM ativoposicaoestoque ape
        JOIN ativo a ON a.Id = ape.IdAtivo
        JOIN produto p ON p.Id = a.IdProduto
        JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
        WHERE COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) IN (?)
          AND COALESCE(a.IndDeletado, b'0') = b'0'
          AND COALESCE(ape.IndDeletado, b'0') = b'0'
          AND ape.DataMovimentacao >= DATE_SUB(CURDATE(), INTERVAL 800 DAY)
        GROUP BY COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')), u.NomeFantasia, DATE_FORMAT(ape.DataMovimentacao, '%Y-%m-%d')
        `,
        [chunk]
      );
      for (let j = 0; j < rows.length; j++) out.push(rows[j]);
    }
    return out;
  } finally {
    await conn.end();
  }
}

function scoreBundle(bundle, historyRows) {
  const histByStoreDate = new Map();
  for (const r of historyRows) {
    const k = `${normalizeStoreName(r.store_name)}|${String(r.ref_date).slice(0, 10)}`;
    histByStoreDate.set(k, Number(r.physical_stock) || 0);
  }

  const out = {
    sku_id: Number(bundle?.info?.id || 0),
    code: String(bundle?.info?.code || ""),
    name: String(bundle?.info?.name || ""),
    days_sale_positive: 0,
    inconsist_blue: 0,
    inconsist_orange: 0,
    compared_days: 0,
  };

  const results = bundle?.results || {};
  for (const store of Object.keys(results)) {
    const nStore = normalizeStoreName(store);
    if (nStore.includes("fabrica") || nStore.includes("cd")) continue;
    const tl = Array.isArray(results[store]?.timeline) ? results[store].timeline : [];
    for (const d of tl) {
      const sales = Number(d.sales) || 0;
      if (sales <= 0) continue;
      const date = String(d.date || "").slice(0, 10);
      if (!date) continue;
      out.days_sale_positive += 1;
      const physBlue = Number(d.physicalStock) || 0;
      const hk = `${nStore}|${date}`;
      if (!histByStoreDate.has(hk)) continue;
      const physOrange = Number(histByStoreDate.get(hk)) || 0;
      out.compared_days += 1;
      if (physBlue <= 0) out.inconsist_blue += 1;
      if (physOrange <= 0) out.inconsist_orange += 1;
    }
  }

  return out;
}

async function main() {
  const arg = String(process.argv[2] || "300").toLowerCase();
  const offsetArg = Number(process.argv[3] || 0);
  let sampleN = null;
  let skuIds = [];
  if (arg === "all") {
    const files = fs.readdirSync(SKU_JS_DIR).filter((f) => /^sku_\d+\.js$/i.test(f));
    skuIds = files.map((f) => Number(f.replace(/^sku_/i, "").replace(/\.js$/i, ""))).filter((n) => Number.isFinite(n) && n > 0);
  } else {
    sampleN = Number(arg || 300);
    const rows = loadPlanRows()
      .filter((r) => Number.isFinite(Number(r.sku_internal_id)) && Number(r.sku_internal_id) > 0)
      .sort((a, b) => Number(b.quantidade_vendida || 0) - Number(a.quantidade_vendida || 0))
      .slice(Math.max(0, offsetArg), Math.max(0, offsetArg) + sampleN);
    skuIds = Array.from(new Set(rows.map((r) => Number(r.sku_internal_id))));
  }

  const bundleByCode = new Map();
  for (const skuId of skuIds) {
    const bundle = loadBundleBySkuId(skuId);
    if (!bundle) continue;
    const code = String(bundle?.info?.code || "").trim();
    if (!code) continue;
    if (!bundleByCode.has(code)) bundleByCode.set(code, bundle);
  }
  const erpCodes = Array.from(bundleByCode.keys());
  const historyRows = await loadSystemPhysicalHistoryByErpCodes(erpCodes);
  const historyByCode = new Map();
  for (const r of historyRows) {
    const c = String(r.erp_code || "").trim();
    if (!c) continue;
    if (!historyByCode.has(c)) historyByCode.set(c, []);
    historyByCode.get(c).push(r);
  }

  const scored = [];
  for (const [code, bundle] of bundleByCode.entries()) {
    const s = scoreBundle(bundle, historyByCode.get(code) || []);
    if (s.compared_days > 0) scored.push(s);
  }

  const agg = scored.reduce(
    (acc, s) => {
      acc.compared_days += s.compared_days;
      acc.inconsist_blue += s.inconsist_blue;
      acc.inconsist_orange += s.inconsist_orange;
      if (s.inconsist_orange < s.inconsist_blue) acc.orange_wins += 1;
      else if (s.inconsist_orange > s.inconsist_blue) acc.blue_wins += 1;
      else acc.tie += 1;
      return acc;
    },
    { compared_days: 0, inconsist_blue: 0, inconsist_orange: 0, orange_wins: 0, blue_wins: 0, tie: 0 }
  );

  const topOrangeWins = scored
    .map((s) => ({ ...s, gain: s.inconsist_blue - s.inconsist_orange }))
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 15);

  console.log(
    JSON.stringify(
      {
        sample_skus: arg === "all" ? "all" : sampleN,
        mode: arg === "all" ? "all" : "top_n",
        offset: arg === "all" ? 0 : Math.max(0, offsetArg),
        input_skus: skuIds.length,
        scored_skus: scored.length,
        compared_days: agg.compared_days,
        inconsistencies: {
          curve_atual_blue: agg.inconsist_blue,
          curve_orange_system: agg.inconsist_orange,
        },
        inconsistency_rate: {
          curve_atual_blue_pct: agg.compared_days ? Number(((100 * agg.inconsist_blue) / agg.compared_days).toFixed(2)) : 0,
          curve_orange_system_pct: agg.compared_days ? Number(((100 * agg.inconsist_orange) / agg.compared_days).toFixed(2)) : 0,
        },
        sku_result_count: {
          orange_wins: agg.orange_wins,
          blue_wins: agg.blue_wins,
          tie: agg.tie,
        },
        top_orange_wins: topOrangeWins,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


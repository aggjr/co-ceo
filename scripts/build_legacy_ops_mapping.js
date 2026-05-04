"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require(path.join(__dirname, "..", "coceo_db_config"));
const { computeDetailViewStatus, DEFAULT_TUNING } = require(path.join(__dirname, "..", "lib", "ceo_cd_factory_status"));

const ROOT = path.join(__dirname, "..");
const OUT_JSON = path.join(ROOT, "data", "client", "legacy_ops_mapping.json");
const OUT_JS = path.join(ROOT, "data", "client", "legacy_ops_mapping.js");
const SKU_JS_DIR = path.join(ROOT, "data", "js");

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function s(v) {
  return v == null ? "" : String(v);
}

function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isFactoryOrCd(name) {
  const low = s(name).toLowerCase();
  return /fábrica|fabrica|\bcd\b|centro de distrib|matriz/.test(low);
}

function isStore(name) {
  return !isFactoryOrCd(name);
}

function parseApolloJs(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return null;
  const jsonStr = trimmed.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/i, "").replace(/;\s*$/s, "");
  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    return null;
  }
}

function normalizeName(v) {
  return s(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pickStoreKey(results, wantedName) {
  const keys = Object.keys(results || {});
  if (!keys.length) return null;
  const wanted = normalizeName(wantedName);
  for (let i = 0; i < keys.length; i++) {
    if (normalizeName(keys[i]) === wanted) return keys[i];
  }
  for (let i = 0; i < keys.length; i++) {
    const k = normalizeName(keys[i]);
    if (k.includes(wanted) || wanted.includes(k)) return keys[i];
  }
  return null;
}

function curveLinkFromSku(skuId) {
  const nSku = Number(skuId);
  if (!Number.isFinite(nSku) || nSku <= 0) return null;
  return "ceo_product_detail_layout.html?sku=" + encodeURIComponent(String(nSku)) + "&hub=1";
}

function loadBundleByProductId(productId) {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const filePath = path.join(SKU_JS_DIR, "sku_" + String(id) + ".js");
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return parseApolloJs(raw);
}

function transferFailureType(row) {
  const status = s(row.status).toLowerCase();
  const planned = n(row.qtd_transferir);
  const confirmed = n(row.qtd_confirmada);
  const gap = Math.max(planned - confirmed, 0);
  if (status.includes("cancel")) {
    return { type: "CANCELADA", impacted_qty: planned > 0 ? planned : confirmed };
  }
  if (!row.data_recebimento) {
    return { type: "SEM_RECEBIMENTO", impacted_qty: confirmed > 0 ? confirmed : planned };
  }
  if (gap > 0) {
    return { type: "DIVERGENCIA_QTD", impacted_qty: gap };
  }
  return { type: "OK", impacted_qty: 0 };
}

function productionFailureType(row) {
  const suggested = n(row.qtd_sugerida);
  const produced = n(row.total_em_producao);
  const gap = Math.max(suggested - produced, 0);
  if (produced <= 0) return { type: "SEM_PRODUCAO", impacted_qty: suggested > 0 ? suggested : 0 };
  if (gap > 0) return { type: "ABAIXO_SUGERIDO", impacted_qty: gap };
  return { type: "OK", impacted_qty: 0 };
}

async function loadLatestStoreTransfer(conn) {
  const [latestRows] = await conn.query(
    `
    SELECT
      t.Id AS transfer_id,
      COALESCE(ti.DataRecebimento, ti.DataExpedicao, t.DataTransferencia, ti.DataCriacao, t.DataCriacao) AS transfer_date
    FROM transferencia t
    JOIN transferenciaitem ti ON ti.IdTransferencia = t.Id
    JOIN ativo ad ON ad.Id = ti.IdAtivoDestino
    JOIN unidadenegocio ud ON ud.IdUnidadeNegocio = ad.IdUnidadeNegocio
    WHERE COALESCE(t.IndDeletado, b'0') = b'0'
      AND COALESCE(ti.IndDeletado, b'0') = b'0'
      AND COALESCE(ti.QtdConfirmada, 0) > 0
    ORDER BY COALESCE(ti.DataRecebimento, ti.DataExpedicao, t.DataTransferencia, ti.DataCriacao, t.DataCriacao) DESC, t.Id DESC
    LIMIT 1
    `
  );
  if (!latestRows.length || !latestRows[0].transfer_id) return null;
  const transferId = latestRows[0].transfer_id;

  const [items] = await conn.query(
    `
    SELECT
      t.Id AS transfer_id,
      COALESCE(ti.DataRecebimento, ti.DataExpedicao, t.DataTransferencia, ti.DataCriacao, t.DataCriacao) AS transfer_date,
      ti.Id AS transfer_item_id,
      ti.IdProduto AS product_id,
      p.ErpCodigo AS erp_code,
      p.Descricao AS product_name,
      uo.NomeFantasia AS origin_unit,
      ud.NomeFantasia AS dest_unit,
      ti.QtdTransferir AS qtd_transferir,
      ti.QtdConfirmada AS qtd_confirmada,
      ti.Status AS status,
      ti.DataRecebimento AS data_recebimento
    FROM transferenciaitem ti
    JOIN transferencia t ON t.Id = ti.IdTransferencia
    JOIN ativo ao ON ao.Id = ti.IdAtivoOrigem
    JOIN ativo ad ON ad.Id = ti.IdAtivoDestino
    JOIN unidadenegocio uo ON uo.IdUnidadeNegocio = ao.IdUnidadeNegocio
    JOIN unidadenegocio ud ON ud.IdUnidadeNegocio = ad.IdUnidadeNegocio
    LEFT JOIN produto p ON p.Id = ti.IdProduto
    WHERE ti.IdTransferencia = ?
      AND COALESCE(t.IndDeletado, b'0') = b'0'
      AND COALESCE(ti.IndDeletado, b'0') = b'0'
    `,
    [transferId]
  );

  const onlyStores = items.filter((r) => isStore(r.dest_unit));
  const detailed = [];
  const bundles = new Map();
  const byStore = {};

  for (const row of onlyStores) {
    const skuId = Number(row.product_id);
    let bundle = bundles.get(skuId);
    if (bundle === undefined) {
      bundle = loadBundleByProductId(skuId);
      bundles.set(skuId, bundle || null);
    }
    const results = (bundle && bundle.results) || null;
    const storeKey = results ? pickStoreKey(results, row.dest_unit) : null;
    let storeStatus = null;
    let cdStatus = null;
    let cdKey = null;
    if (bundle && storeKey) {
      const st = computeDetailViewStatus(bundle, storeKey, { tuning: DEFAULT_TUNING });
      storeStatus = st && st.statusText ? st.statusText : null;
      cdKey = st && st.cdKey ? st.cdKey : null;
      if (cdKey) {
        const cd = computeDetailViewStatus(bundle, cdKey, { tuning: DEFAULT_TUNING });
        cdStatus = cd && cd.statusText ? cd.statusText : null;
      }
    }

    const item = {
      transfer_item_id: row.transfer_item_id,
      product_id: skuId,
      erp_code: s(row.erp_code),
      product_name: s(row.product_name),
      origin_unit: s(row.origin_unit),
      dest_unit: s(row.dest_unit),
      planned_qty: n(row.qtd_transferir),
      confirmed_qty: n(row.qtd_confirmada),
      transfer_status: s(row.status),
      received_at: toIso(row.data_recebimento),
      current_status_store: storeStatus,
      current_status_cd: cdStatus,
      curve_link: curveLinkFromSku(skuId),
      in_apollo_bundle: Boolean(bundle),
    };
    detailed.push(item);
    if (!byStore[item.dest_unit]) byStore[item.dest_unit] = [];
    byStore[item.dest_unit].push(item);
  }

  Object.keys(byStore).forEach((store) => {
    byStore[store].sort((a, b) => b.confirmed_qty - a.confirmed_qty);
  });

  const onlyAbove = detailed
    .filter((r) => r.current_status_store === "ACIMA")
    .sort((a, b) => b.confirmed_qty - a.confirmed_qty);

  const failures = [];
  for (const row of onlyStores) {
    const f = transferFailureType(row);
    if (f.type === "OK") continue;
    failures.push({
      transfer_item_id: row.transfer_item_id,
      product_id: row.product_id,
      erp_code: s(row.erp_code),
      product_name: s(row.product_name),
      origin_unit: s(row.origin_unit),
      dest_unit: s(row.dest_unit),
      failure_type: f.type,
      impacted_qty: f.impacted_qty,
      planned_qty: n(row.qtd_transferir),
      confirmed_qty: n(row.qtd_confirmada),
      status: s(row.status),
      received_at: toIso(row.data_recebimento),
    });
  }
  failures.sort((a, b) => b.impacted_qty - a.impacted_qty);

  const totalPlanned = onlyStores.reduce((acc, r) => acc + n(r.qtd_transferir), 0);
  const totalConfirmed = onlyStores.reduce((acc, r) => acc + n(r.qtd_confirmada), 0);

  return {
    transfer_id: transferId,
    transfer_date: toIso(latestRows[0].transfer_date),
    item_count_total: items.length,
    item_count_store_destinations: onlyStores.length,
    total_planned_qty_store_destinations: totalPlanned,
    total_confirmed_qty_store_destinations: totalConfirmed,
    failures_count: failures.length,
    top_failures: failures.slice(0, 15),
    transferred_items_by_store: byStore,
    transferred_items_all: detailed,
    transferred_items_store_status_acima: onlyAbove,
  };
}

async function loadLatestProduction(conn) {
  const [latestRows] = await conn.query(
    `
    SELECT
      l.IdListaProducao AS production_batch_id,
      COALESCE(l.DataAlteracao, l.DataCriacao) AS production_date
    FROM listaproducaoitem l
    LEFT JOIN unidadenegocio u ON u.IdUnidadeNegocio = l.IdUnidadeNegocio
    WHERE COALESCE(l.IndDeletado, b'0') = b'0'
      AND COALESCE(l.TotalEmProducao, 0) >= 0
      AND (u.NomeFantasia IS NULL OR LOWER(u.NomeFantasia) REGEXP 'fábrica|fabrica|cd|matriz')
    ORDER BY COALESCE(l.DataAlteracao, l.DataCriacao) DESC, l.IdListaProducao DESC
    LIMIT 1
    `
  );
  if (!latestRows.length || !latestRows[0].production_batch_id) return null;
  const batchId = latestRows[0].production_batch_id;

  const [items] = await conn.query(
    `
    SELECT
      l.Id AS production_item_id,
      l.IdListaProducao AS production_batch_id,
      COALESCE(l.DataAlteracao, l.DataCriacao) AS production_date,
      l.IdProduto AS product_id,
      p.ErpCodigo AS erp_code,
      p.Descricao AS product_name,
      u.NomeFantasia AS unit_name,
      l.StatusAtivo AS status_ativo,
      l.QtdSugerida AS qtd_sugerida,
      l.TotalEmProducao AS total_em_producao
    FROM listaproducaoitem l
    LEFT JOIN produto p ON p.Id = l.IdProduto
    LEFT JOIN unidadenegocio u ON u.IdUnidadeNegocio = l.IdUnidadeNegocio
    WHERE l.IdListaProducao = ?
      AND COALESCE(l.IndDeletado, b'0') = b'0'
    `,
    [batchId]
  );

  const failures = [];
  for (const row of items) {
    const f = productionFailureType(row);
    if (f.type === "OK") continue;
    failures.push({
      production_item_id: row.production_item_id,
      product_id: row.product_id,
      erp_code: s(row.erp_code),
      product_name: s(row.product_name),
      unit_name: s(row.unit_name),
      failure_type: f.type,
      impacted_qty: f.impacted_qty,
      suggested_qty: n(row.qtd_sugerida),
      produced_qty: n(row.total_em_producao),
      status_ativo: s(row.status_ativo),
    });
  }
  failures.sort((a, b) => b.impacted_qty - a.impacted_qty);

  const totalSuggested = items.reduce((acc, r) => acc + n(r.qtd_sugerida), 0);
  const totalProduced = items.reduce((acc, r) => acc + n(r.total_em_producao), 0);

  return {
    production_batch_id: batchId,
    production_date: toIso(latestRows[0].production_date),
    item_count: items.length,
    total_suggested_qty: totalSuggested,
    total_produced_qty: totalProduced,
    failures_count: failures.length,
    top_failures: failures.slice(0, 15),
  };
}

async function main() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    await conn.query("SET NAMES 'utf8mb4'");
    const [dbRows] = await conn.query("SELECT DATABASE() AS db_name");
    const dbName = dbRows[0] && dbRows[0].db_name ? String(dbRows[0].db_name) : "";

    const latestTransferToStores = await loadLatestStoreTransfer(conn);
    const latestProduction = await loadLatestProduction(conn);

    const out = {
      generated_at: new Date().toISOString(),
      source: {
        db_name: dbName,
        description:
          "Consolidado legado para Co-CEO com última transferência para lojas, última produção e maiores falhas.",
      },
      latest_transfer_to_stores: latestTransferToStores,
      latest_factory_production: latestProduction,
    };

    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
    fs.writeFileSync(OUT_JS, "window.LEGACY_OPS_MAPPING_DATA = " + JSON.stringify(out) + ";\n", "utf8");

    const transferInfo = latestTransferToStores
      ? `transferência ${latestTransferToStores.transfer_id} (falhas: ${latestTransferToStores.failures_count})`
      : "sem transferência para lojas";
    const productionInfo = latestProduction
      ? `produção ${latestProduction.production_batch_id} (falhas: ${latestProduction.failures_count})`
      : "sem produção";
    console.log("OK - legado consolidado:", transferInfo, "|", productionInfo);
    console.log("Arquivo:", path.relative(ROOT, OUT_JSON).replace(/\\/g, "/"));
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Falha no consolidado legado:", err && err.message ? err.message : err);
  process.exit(1);
});


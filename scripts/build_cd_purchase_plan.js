/**
 * Gera dataset da tela de sugestão de compra/produção do CD por categoria/subcategoria.
 *
 * Fonte de demanda:
 * - data/client/network_matrix.json (sugestao_unidades por SKU x loja)
 *   -> usa somente demandas positivas de lojas (não CD/Fábrica).
 *
 * Enriquecimento:
 * - data/catalog_grid.js (categoria/subcategoria por código ERP, foraMix = produto.IndForaMix)
 * - ruptura_ponderada_vendas_pct: média do % ruptura (matrix) ponderada por vendas na loja (fallback: demanda CD).
 *
 * Metadados operacionais:
 * - schema ceo: datas disponíveis em daily_stock_snapshot e cd_daily_aggregate
 *
 * Saída:
 * - data/client/cd_purchase_plan.json
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { configCeo } = require(path.join(__dirname, "..", "coceo_db_config"));
const { assertLegacyConfig } = require(path.join(__dirname, "..", "coceo_db_config"));
const { computeCdFactoryStatus } = require(path.join(__dirname, "..", "lib", "ceo_cd_factory_status"));
const { isClosedRetailStore } = require(path.join(__dirname, "..", "lib", "closed_retail_stores"));

const ROOT = path.join(__dirname, "..");
const NETWORK_MATRIX_PATH = path.join(ROOT, "data", "client", "network_matrix.json");
const CATALOG_GRID_PATH = path.join(ROOT, "data", "catalog_grid.js");
const SKU_JS_DIR = path.join(ROOT, "data", "js");
const OUT_PATH = path.join(ROOT, "data", "client", "cd_purchase_plan.json");
const OUT_JS_PATH = path.join(ROOT, "data", "client", "cd_purchase_plan.js");

function loadNetworkMatrix() {
  if (!fs.existsSync(NETWORK_MATRIX_PATH)) {
    throw new Error("Arquivo não encontrado: " + NETWORK_MATRIX_PATH + " (rode npm run build:client-matrix)");
  }
  const j = JSON.parse(fs.readFileSync(NETWORK_MATRIX_PATH, "utf8"));
  return Array.isArray(j.rows) ? j.rows : [];
}

function legacyBitToBool(v) {
  if (v == null) return false;
  if (Buffer.isBuffer(v)) return v[0] === 1;
  const n = Number(v);
  if (!Number.isNaN(n)) return n !== 0;
  return Boolean(v);
}

function loadCatalogByCode() {
  if (!fs.existsSync(CATALOG_GRID_PATH)) return new Map();
  const raw = fs.readFileSync(CATALOG_GRID_PATH, "utf8").trim();
  const jsonStr = raw.replace(/^\s*const\s+CATALOG_GRID\s*=\s*/, "").replace(/;\s*$/, "");
  const arr = JSON.parse(jsonStr);
  const m = new Map();
  for (const r of arr) {
    const code = r && r.code != null ? String(r.code).trim() : "";
    if (!code) continue;
    if (!m.has(code)) {
      m.set(code, {
        category: String(r.category || "SEM CATEGORIA"),
        subcategory: String(r.subcategory || "-"),
        fora_mix: Boolean(r.foraMix),
        source: "catalog_grid",
      });
    }
  }
  return m;
}

async function loadLegacyCategoryByCode() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    const [rows] = await conn.query(`
      SELECT
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS erp_code,
        p.IndAtivo AS ind_ativo,
        p.IndForaMix AS ind_fora_mix,
        c.Nome AS cat_nome,
        c.IdParent AS cat_parent_id,
        pcat.Nome AS cat_parent_nome
      FROM produto p
      LEFT JOIN produtocategoria pc
        ON pc.IdProduto = p.Id
       AND COALESCE(pc.IndDeletado, b'0') = b'0'
      LEFT JOIN categoria c
        ON c.Id = pc.IdCategoria
       AND COALESCE(c.IndDeletado, b'0') = b'0'
      LEFT JOIN categoria pcat
        ON pcat.Id = c.IdParent
       AND COALESCE(pcat.IndDeletado, b'0') = b'0'
      WHERE COALESCE(p.IndDeletado, b'0') = b'0'
    `);

    const out = new Map();
    for (const r of rows) {
      const code = normalizeCode(r.erp_code);
      if (!code || out.has(code)) continue;
      const foraMix = legacyBitToBool(r.ind_fora_mix);
      if (r.cat_nome) {
        if (r.cat_parent_id != null && r.cat_parent_nome) {
          out.set(code, {
            category: String(r.cat_parent_nome),
            subcategory: String(r.cat_nome),
            source: "legacy",
            fora_mix: foraMix,
          });
        } else {
          out.set(code, {
            category: String(r.cat_nome),
            subcategory: "-",
            source: "legacy",
            fora_mix: foraMix,
          });
        }
      } else {
        out.set(code, {
          category: "SEM CATEGORIA",
          subcategory: "-",
          source: "legacy",
          fora_mix: foraMix,
        });
      }
    }
    return out;
  } finally {
    await conn.end();
  }
}

async function loadLegacyCategoryTree() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    const [rows] = await conn.query(`
      SELECT Id, Nome, IdParent
      FROM categoria
      WHERE COALESCE(IndDeletado, b'0') = b'0'
      ORDER BY Nome
    `);
    const parents = rows.filter((r) => r.IdParent == null);
    const childrenByParent = new Map();
    for (const r of rows) {
      if (r.IdParent == null) continue;
      if (!childrenByParent.has(r.IdParent)) childrenByParent.set(r.IdParent, []);
      childrenByParent.get(r.IdParent).push(String(r.Nome));
    }
    const tree = {};
    for (const p of parents) {
      const cat = String(p.Nome);
      tree[cat] = (childrenByParent.get(p.Id) || []).sort((a, b) => a.localeCompare(b));
    }
    return tree;
  } finally {
    await conn.end();
  }
}

async function loadLegacyCdFactorySuggestionsByCode() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    const [rows] = await conn.query(`
      SELECT
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS erp_code,
        CAST(SUM(COALESCE(at.SugestaoCompra, 0)) AS DECIMAL(18,4)) AS sugestao_compra_legacy,
        CAST(SUM(COALESCE(at.TotalEmProducao, 0)) AS DECIMAL(18,4)) AS total_em_producao_legacy
      FROM ativototalizador at
      JOIN ativo a
        ON a.Id = at.IdAtivo
       AND COALESCE(a.IndDeletado, b'0') = b'0'
      JOIN produto p
        ON p.Id = a.IdProduto
       AND COALESCE(p.IndDeletado, b'0') = b'0'
      JOIN unidadenegocio u
        ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
      WHERE LOWER(COALESCE(u.NomeFantasia, '')) REGEXP 'fábrica|fabrica|\\bcd\\b|centro de distrib|matriz'
      GROUP BY COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), ''))
    `);
    const out = new Map();
    for (const r of rows) {
      const code = normalizeCode(r.erp_code);
      if (!code) continue;
      out.set(code, {
        sugestao_compra_legacy: Number(r.sugestao_compra_legacy) || 0,
        total_em_producao_legacy: Number(r.total_em_producao_legacy) || 0,
      });
    }
    return out;
  } finally {
    await conn.end();
  }
}

function normalizeCode(code) {
  return String(code == null ? "" : code).trim();
}

function startOfDayIso(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 19).replace("T", " ");
}

function endOfDayIso(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(23, 59, 59, 999);
  return x.toISOString().slice(0, 19).replace("T", " ");
}

function resolveSalesWindow(ceoDateMeta) {
  const envStart = process.env.LEGACY_SALES_START || "";
  const envEnd = process.env.LEGACY_SALES_END || "";
  const ceoMax = ceoDateMeta?.daily_stock_snapshot?.max_date ? new Date(ceoDateMeta.daily_stock_snapshot.max_date) : new Date();
  const fallbackEnd = new Date(ceoMax);
  const fallbackStart = new Date(fallbackEnd);
  fallbackStart.setDate(fallbackStart.getDate() - 89);

  const startIso = startOfDayIso(envStart || fallbackStart);
  const endIso = endOfDayIso(envEnd || fallbackEnd);
  if (!startIso || !endIso) {
    throw new Error("Janela de vendas inválida. Confira LEGACY_SALES_START/LEGACY_SALES_END.");
  }
  return { startIso, endIso, source: envStart || envEnd ? "env" : "ceo_max_minus_90d" };
}

function statusByRupturePct(v) {
  const r = Number(v);
  if (!Number.isFinite(r)) return "ACIMA";
  if (r >= 30) return "RUPTURA";
  if (r >= 18) return "CRÍTICO";
  if (r >= 8) return "ABAIXO";
  return "ACIMA";
}

function statusRank(s) {
  if (s === "RUPTURA") return 1;
  if (s === "CRÍTICO") return 2;
  if (s === "ABAIXO") return 3;
  if (s === "ACIMA") return 4;
  if (s === "MUITO ACIMA") return 5;
  if (s === "ENCALHADO 1") return 6;
  if (s === "ENCALHADO 2") return 7;
  if (s === "ENCALHADO 3") return 8;
  return 9;
}

function loadSkuBundle(internalId) {
  const id = Number(internalId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const p = path.join(SKU_JS_DIR, `sku_${id}.js`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").trim();
  const jsonPart = raw
    .replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/, "")
    .replace(/;\s*$/, "");
  try {
    return JSON.parse(jsonPart);
  } catch (_) {
    return null;
  }
}

function urgencySummaryBucket(statusText) {
  if (statusText === "RUPTURA") return "RUPTURA";
  if (statusText === "CRÍTICO") return "CRÍTICO";
  if (statusText === "ABAIXO") return "ABAIXO";
  return "ACIMA";
}

/** SKUs com demanda positiva na matriz mas IndForaMix (= não entram no plano agregado). */
function countSkusDemandExcludedForaMix(matrixRows, legacyByCode, catalogByCode) {
  const withDemand = new Set();
  for (const r of matrixRows) {
    if (r.is_factory_or_cd) continue;
    if (isClosedRetailStore(r.store)) continue;
    const demand = Number(r.sugestao_unidades);
    if (!Number.isFinite(demand) || demand <= 0) continue;
    const code = normalizeCode(r.erp_code);
    if (!code) continue;
    withDemand.add(code);
  }
  let n = 0;
  for (const code of withDemand) {
    const cat =
      legacyByCode.get(code) ||
      catalogByCode.get(code) ||
      { fora_mix: false };
    if (Boolean(cat.fora_mix)) n++;
  }
  return n;
}

function buildPlanRows(rows, legacyByCode, catalogByCode) {
  const bySku = new Map();
  for (const r of rows) {
    if (r.is_factory_or_cd) continue;
    if (isClosedRetailStore(r.store)) continue;
    const demand = Number(r.sugestao_unidades);
    if (!Number.isFinite(demand) || demand <= 0) continue;

    const code = normalizeCode(r.erp_code);
    if (!code) continue;
    const skuKey = code;
    const cat =
      legacyByCode.get(code) ||
      catalogByCode.get(code) ||
      { category: "SEM CATEGORIA", subcategory: "-", source: "none", fora_mix: false };
    /** Espelha legado: IndForaMix → não entra em pedidos de compra/produção agregados. */
    if (Boolean(cat.fora_mix)) continue;
    const productName = String(r.product_name || "");

    const cur = bySku.get(skuKey) || {
      sku_internal_id: r.sku_internal_id != null ? Number(r.sku_internal_id) : null,
      erp_code: code,
      product_name: productName,
      category: cat.category,
      subcategory: cat.subcategory,
      category_source: cat.source || "none",
      fora_mix: Boolean(cat.fora_mix),
      demanda_total_cd: 0,
      lojas_com_demanda: 0,
      lojas: [],
      ruptura_media_pct: 0,
      ruptura_max_pct: 0,
      _rupt_count: 0,
    };

    cur.demanda_total_cd += Math.round(demand);
    cur.lojas_com_demanda += 1;
    cur.lojas.push({
      store: r.store,
      demanda: Math.round(demand),
      ruptura_pct: Number(r.ruptura_pct) || 0,
      prioridade: String(r.prioridade || "EQUILIBRADO"),
    });

    const rp = Number(r.ruptura_pct);
    if (Number.isFinite(rp)) {
      cur.ruptura_media_pct += rp;
      cur._rupt_count += 1;
      if (rp > cur.ruptura_max_pct) cur.ruptura_max_pct = rp;
    }

    bySku.set(skuKey, cur);
  }

  const out = Array.from(bySku.values()).map((r) => ({
    sku_internal_id: r.sku_internal_id,
    erp_code: r.erp_code,
    product_name: r.product_name,
    category: r.category,
    subcategory: r.subcategory,
    category_source: r.category_source,
    fora_mix: Boolean(r.fora_mix),
    demanda_total_cd: r.demanda_total_cd,
    lojas_com_demanda: r.lojas_com_demanda,
    demanda_media_loja: r.lojas_com_demanda ? Number((r.demanda_total_cd / r.lojas_com_demanda).toFixed(2)) : 0,
    ruptura_media_pct: r._rupt_count ? Number((r.ruptura_media_pct / r._rupt_count).toFixed(2)) : 0,
    ruptura_max_pct: Number(r.ruptura_max_pct || 0),
    status_urgencia: "ACIMA",
    status_source: "pending",
    prioridade: "ACIMA",
    lojas: r.lojas.sort((a, b) => b.demanda - a.demanda || b.ruptura_pct - a.ruptura_pct),
  }));

  return out;
}

function attachLegacySuggestions(planRows, legacyCdFactoryByCode) {
  for (const row of planRows) {
    const extra = legacyCdFactoryByCode.get(normalizeCode(row.erp_code)) || null;
    row.sugestao_compra_legacy = extra ? Math.round(Number(extra.sugestao_compra_legacy) || 0) : 0;
    row.total_em_producao_legacy = extra ? Math.round(Number(extra.total_em_producao_legacy) || 0) : 0;
  }
  return planRows;
}

function attachLegacySalesMetrics(planRows, legacySalesByCode) {
  for (const row of planRows) {
    const sales = legacySalesByCode.get(normalizeCode(row.erp_code)) || null;
    row.quantidade_vendida = sales ? Number(sales.quantidade_vendida.toFixed(2)) : 0;
    row.valor_bruto_vendas = sales ? Number(sales.valor_bruto_vendas.toFixed(2)) : 0;
    row.margem_contribuicao_total = sales ? Number(sales.margem_contribuicao_total.toFixed(2)) : 0;

    row.lojas = (row.lojas || [])
      .filter((l) => !isClosedRetailStore(String(l.store || "").trim()))
      .map((l) => {
      const byStore = sales && sales.stores ? sales.stores.get(String(l.store || "").trim()) : null;
      return {
        ...l,
        quantidade_vendida: byStore ? Number(byStore.quantidade_vendida.toFixed(2)) : 0,
        valor_bruto_vendas: byStore ? Number(byStore.valor_bruto_vendas.toFixed(2)) : 0,
        margem_contribuicao_total: byStore ? Number(byStore.margem_contribuicao_total.toFixed(2)) : 0,
      };
    });
  }
  return planRows;
}

/** Peso da loja: unidades vendidas (janela legado); se zero, demanda CD da loja (evita ignorar loja só com ruptura). */
function weightLojaForRupturaPonderada(l) {
  const qv = Math.max(0, Number(l.quantidade_vendida) || 0);
  if (qv > 0) return qv;
  return Math.max(0, Number(l.demanda) || 0);
}

/**
 * Média ponderada do % tempo em ruptura (matrix) pelas lojas abertas, peso = vendas (fallback: demanda).
 * Diferente de ruptura_media_pct (média aritmética entre lojas com demanda).
 */
function attachRupturaPonderadaVendas(planRows) {
  for (const row of planRows) {
    const lojas = (row.lojas || []).filter((l) => !isClosedRetailStore(String(l.store || "").trim()));
    let wSum = 0;
    let wrSum = 0;
    for (const l of lojas) {
      const w = weightLojaForRupturaPonderada(l);
      const rp = Number(l.ruptura_pct) || 0;
      if (!Number.isFinite(rp) || w <= 0) continue;
      wSum += w;
      wrSum += w * rp;
    }
    row.ruptura_ponderada_vendas_pct = wSum > 0 ? Number((wrSum / wSum).toFixed(2)) : null;
  }
  return planRows;
}

function applyCdFactoryStatusAndSort(planRows) {
  for (const row of planRows) {
    let status = null;
    let source = "matrix_fallback";
    if (Number.isFinite(Number(row.sku_internal_id))) {
      const bundle = loadSkuBundle(row.sku_internal_id);
      if (bundle) {
        const cd = computeCdFactoryStatus(bundle, {});
        if (cd.statusText) {
          status = cd.statusText;
          source = "ceo_cd";
        }
      }
    }
    if (!status) {
      status = statusByRupturePct(row.ruptura_max_pct);
      source = "matrix_fallback";
    }
    row.status_urgencia = status;
    row.prioridade = status;
    row.status_source = source;
  }
  planRows.sort(
    (a, b) =>
      statusRank(a.status_urgencia) - statusRank(b.status_urgencia) ||
      b.demanda_total_cd - a.demanda_total_cd ||
      b.ruptura_max_pct - a.ruptura_max_pct
  );
  return planRows;
}

function buildCategorySummary(planRows) {
  const m = new Map();
  for (const r of planRows) {
    const key = `${r.category}|||${r.subcategory}`;
    const cur = m.get(key) || {
      category: r.category,
      subcategory: r.subcategory,
      sku_count: 0,
      demanda_total_cd: 0,
    };
    cur.sku_count += 1;
    cur.demanda_total_cd += r.demanda_total_cd;
    m.set(key, cur);
  }
  return Array.from(m.values()).sort((a, b) => b.demanda_total_cd - a.demanda_total_cd || a.category.localeCompare(b.category));
}

async function loadCeoDateMeta() {
  const conn = await mysql.createConnection(configCeo);
  try {
    const [[dailyRange]] = await conn.query("SELECT MIN(ref_date) mn, MAX(ref_date) mx FROM daily_stock_snapshot");
    const [[cdRange]] = await conn.query("SELECT MIN(ref_date) mn, MAX(ref_date) mx FROM cd_daily_aggregate");
    const [[d20Daily]] = await conn.query("SELECT COUNT(*) n FROM daily_stock_snapshot WHERE ref_date='2026-04-20'");
    const [[d20Cd]] = await conn.query("SELECT COUNT(*) n FROM cd_daily_aggregate WHERE ref_date='2026-04-20'");
    return {
      daily_stock_snapshot: {
        min_date: dailyRange.mn,
        max_date: dailyRange.mx,
        rows_2026_04_20: Number(d20Daily.n || 0),
      },
      cd_daily_aggregate: {
        min_date: cdRange.mn,
        max_date: cdRange.mx,
        rows_2026_04_20: Number(d20Cd.n || 0),
      },
    };
  } finally {
    await conn.end();
  }
}

async function loadLegacySalesMetricsByCode(windowRange) {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    const [rows] = await conn.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS erp_code,
        un.NomeFantasia AS store,
        CAST(SUM(COALESCE(mv.Quantidade, 0)) AS DECIMAL(18,4)) AS quantidade_vendida,
        CAST(SUM(COALESCE(mv.preco_venda_aplicado, 0) * COALESCE(mv.Quantidade, 0)) AS DECIMAL(18,4)) AS valor_bruto_vendas,
        CAST(SUM((COALESCE(mv.preco_venda_aplicado, 0) - COALESCE(mv.preco_custo_aplicado, 0)) * COALESCE(mv.Quantidade, 0)) AS DECIMAL(18,4)) AS margem_contribuicao_total
      FROM (
        SELECT
          m.IdAtivo,
          m.IdUnidadeNegocio,
          m.Quantidade,
          m.DataMovimentacao,
          COALESCE(NULLIF(m.PrecoRealVenda, 0), NULLIF(m.PrecoVenda, 0), (
            SELECT hpun.PrecoVenda
            FROM historicoprecoundnegocio hpun
            WHERE hpun.IdAtivo = m.IdAtivo
              AND COALESCE(hpun.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hpun.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hpun.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hpun.DataInicioVigencia, '1900-01-01') DESC, hpun.Id DESC
            LIMIT 1
          ), (
            SELECT hp.PrecoVenda
            FROM ativo ax
            JOIN historicopreco hp
              ON hp.IdProduto = ax.IdProduto
            WHERE ax.Id = m.IdAtivo
              AND COALESCE(hp.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hp.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hp.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hp.DataInicioVigencia, '1900-01-01') DESC, hp.Id DESC
            LIMIT 1
          ), 0) AS preco_venda_aplicado,
          COALESCE((
            SELECT hpun.PrecoCusto
            FROM historicoprecoundnegocio hpun
            WHERE hpun.IdAtivo = m.IdAtivo
              AND COALESCE(hpun.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hpun.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hpun.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hpun.DataInicioVigencia, '1900-01-01') DESC, hpun.Id DESC
            LIMIT 1
          ), (
            SELECT hp.PrecoCusto
            FROM ativo ax
            JOIN historicopreco hp
              ON hp.IdProduto = ax.IdProduto
            WHERE ax.Id = m.IdAtivo
              AND COALESCE(hp.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hp.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hp.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hp.DataInicioVigencia, '1900-01-01') DESC, hp.Id DESC
            LIMIT 1
          ), 0) AS preco_custo_aplicado
        FROM movimentacao m
        JOIN tipomovimentacao tm
          ON tm.Id = m.IdTipoMovimentacao
        WHERE COALESCE(m.IndDeletado, b'0') = b'0'
          AND COALESCE(tm.IndDeletado, b'0') = b'0'
          AND COALESCE(tm.IndVenda, b'0') = b'1'
          AND m.DataMovimentacao BETWEEN ? AND ?
      ) mv
      JOIN ativo a
        ON a.Id = mv.IdAtivo
       AND COALESCE(a.IndDeletado, b'0') = b'0'
      JOIN produto p
        ON p.Id = a.IdProduto
       AND COALESCE(p.IndDeletado, b'0') = b'0'
      JOIN unidadenegocio un
        ON un.IdUnidadeNegocio = mv.IdUnidadeNegocio
      GROUP BY
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')),
        un.NomeFantasia
    `,
      [windowRange.startIso, windowRange.endIso]
    );

    const byCode = new Map();
    for (const r of rows) {
      const code = normalizeCode(r.erp_code);
      if (!code) continue;
      const store = String(r.store || "").trim();
      if (isClosedRetailStore(store)) continue;
      const qty = Number(r.quantidade_vendida) || 0;
      const gross = Number(r.valor_bruto_vendas) || 0;
      const margin = Number(r.margem_contribuicao_total) || 0;
      const cur = byCode.get(code) || {
        quantidade_vendida: 0,
        valor_bruto_vendas: 0,
        margem_contribuicao_total: 0,
        stores: new Map(),
      };
      cur.quantidade_vendida += qty;
      cur.valor_bruto_vendas += gross;
      cur.margem_contribuicao_total += margin;
      if (store) {
        cur.stores.set(store, {
          quantidade_vendida: qty,
          valor_bruto_vendas: gross,
          margem_contribuicao_total: margin,
        });
      }
      byCode.set(code, cur);
    }
    return byCode;
  } finally {
    await conn.end();
  }
}

async function main() {
  const rows = loadNetworkMatrix();
  const legacyByCode = await loadLegacyCategoryByCode();
  const legacyCategoryTree = await loadLegacyCategoryTree();
  const legacyCdFactoryByCode = await loadLegacyCdFactorySuggestionsByCode();
  const catalogByCode = loadCatalogByCode();
  const ceoDateMeta = await loadCeoDateMeta();
  const salesWindow = resolveSalesWindow(ceoDateMeta);
  const legacySalesByCode = await loadLegacySalesMetricsByCode(salesWindow);
  const skusDemandExcludedForaMix = countSkusDemandExcludedForaMix(rows, legacyByCode, catalogByCode);
  let planRows = buildPlanRows(rows, legacyByCode, catalogByCode);
  planRows = attachLegacySuggestions(planRows, legacyCdFactoryByCode);
  planRows = attachLegacySalesMetrics(planRows, legacySalesByCode);
  planRows = attachRupturaPonderadaVendas(planRows);
  planRows = applyCdFactoryStatusAndSort(planRows);
  const categorySummary = buildCategorySummary(planRows);

  const allCodes = Array.from(
    new Set(rows.map((r) => normalizeCode(r.erp_code)).filter(Boolean))
  );
  const allClassification = allCodes
    .map((code) => {
      const c =
        legacyByCode.get(code) ||
        catalogByCode.get(code) ||
        { category: "SEM CATEGORIA", subcategory: "-", source: "none" };
      return {
        erp_code: code,
        category: c.category,
        subcategory: c.subcategory,
        source: c.source || "none",
      };
    })
    .sort((a, b) => a.erp_code.localeCompare(b.erp_code));

  const categoriesFromAll = Array.from(new Set(allClassification.map((x) => x.category))).sort((a, b) => a.localeCompare(b));
  const subByCat = {};
  for (const cat of categoriesFromAll) {
    subByCat[cat] = Array.from(
      new Set(allClassification.filter((x) => x.category === cat).map((x) => x.subcategory))
    ).sort((a, b) => a.localeCompare(b));
  }

  const out = {
    generated_at: new Date().toISOString(),
    source: {
      network_matrix_path: path.relative(ROOT, NETWORK_MATRIX_PATH).replace(/\\/g, "/"),
      catalog_grid_path: path.relative(ROOT, CATALOG_GRID_PATH).replace(/\\/g, "/"),
      legacy_category_map_rows: legacyByCode.size,
      legacy_category_tree_rows: Object.keys(legacyCategoryTree).length,
      ceo_dates: ceoDateMeta,
      legacy_cd_factory_suggestion_rows: legacyCdFactoryByCode.size,
      legacy_sales_window: {
        start: salesWindow.startIso,
        end: salesWindow.endIso,
        source: salesWindow.source,
      },
      legacy_sales_rows_by_sku_store: Array.from(legacySalesByCode.values()).reduce((acc, v) => acc + (v.stores ? v.stores.size : 0), 0),
    },
    stats: {
      skus_with_cd_demand: planRows.length,
      demand_units_total: planRows.reduce((acc, r) => acc + r.demanda_total_cd, 0),
      legacy_sugestao_compra_total: planRows.reduce((acc, r) => acc + Number(r.sugestao_compra_legacy || 0), 0),
      legacy_total_em_producao_total: planRows.reduce((acc, r) => acc + Number(r.total_em_producao_legacy || 0), 0),
      legacy_quantidade_vendida_total: Number(planRows.reduce((acc, r) => acc + Number(r.quantidade_vendida || 0), 0).toFixed(2)),
      legacy_valor_bruto_vendas_total: Number(planRows.reduce((acc, r) => acc + Number(r.valor_bruto_vendas || 0), 0).toFixed(2)),
      legacy_margem_contribuicao_total: Number(planRows.reduce((acc, r) => acc + Number(r.margem_contribuicao_total || 0), 0).toFixed(2)),
      categories_with_demand: new Set(categorySummary.map((r) => r.category)).size,
      subcategories_with_demand: categorySummary.length,
      skus_with_legacy_category: planRows.filter((r) => r.category_source === "legacy").length,
      skus_with_non_legacy_category: planRows.filter((r) => r.category_source !== "legacy").length,
      skus_fora_mix_excluded_from_plan: skusDemandExcludedForaMix,
      urgency_summary: {
        RUPTURA: planRows.filter((r) => urgencySummaryBucket(r.status_urgencia) === "RUPTURA").length,
        "CRÍTICO": planRows.filter((r) => urgencySummaryBucket(r.status_urgencia) === "CRÍTICO").length,
        ABAIXO: planRows.filter((r) => urgencySummaryBucket(r.status_urgencia) === "ABAIXO").length,
        ACIMA: planRows.filter((r) => urgencySummaryBucket(r.status_urgencia) === "ACIMA").length,
      },
      skus_total_classificados: allClassification.length,
    },
    filter_options: {
      categories: categoriesFromAll,
      subcategories_by_category: subByCat,
      legacy_category_tree: legacyCategoryTree,
    },
    all_product_classification: allClassification,
    category_summary: categorySummary,
    rows: planRows,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), "utf8");
  fs.writeFileSync(OUT_JS_PATH, "window.CD_PURCHASE_PLAN_DATA = " + JSON.stringify(out) + ";\n", "utf8");
  console.log("Gerado:", OUT_PATH);
  console.log("Gerado:", OUT_JS_PATH);
  console.log(
    "SKUs com demanda:",
    out.stats.skus_with_cd_demand,
    "| Demanda total:",
    out.stats.demand_units_total,
    "| Categorias:",
    out.stats.categories_with_demand
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


/**
 * Agrega status (faixas do detalhe CEO) por SKU × loja/CD em **todos** os bundles data/js/sku_*.js
 * cujo id está ativo em data/catalog_grid.js (legacyAtivo !== false). Não há amostragem: processa a lista completa.
 * Grava JSON para stock_health_histogram.html.
 *
 * RUPTURA: exclui SKUs "descontinuados" — disponível hoje = 0 e soma de vendas = 0 nos últimos 90 dias
 * do recorte filtrado (alinhado a ~3 meses).
 *
 * Valor por faixa: MySQL legado — preço unitário atual em `produto` (coluna detectada) × estoque físico
 * do último dia da timeline (igual a `fisicoToday` em computeDetailViewStatus), por loja.
 *
 * Uso: node scripts/build_stock_health_histogram.js
 * Requer .env com LEGACY_MYSQL_* (mesmo que build_cd_purchase_plan).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require(path.join(__dirname, "..", "coceo_db_config"));
const { computeDetailViewStatus, DEFAULT_TUNING } = require(path.join(__dirname, "..", "lib", "ceo_cd_factory_status"));
const { isClosedRetailStore } = require(path.join(__dirname, "..", "lib", "closed_retail_stores"));

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "data", "js");
const OUT = path.join(ROOT, "data", "client", "stock_health_histogram.json");
const OUT_JS = path.join(ROOT, "data", "client", "stock_health_histogram.js");
const CATALOG_GRID_PATH = path.join(ROOT, "data", "catalog_grid.js");

const STATUS_ORDER = [
  "RUPTURA",
  "CRÍTICO",
  "ABAIXO",
  "ACIMA",
  "MUITO ACIMA",
  "ENCALHADO 1",
  "ENCALHADO 2",
  "ENCALHADO 3",
];

const DISCONTINUED_SALES_TAIL_DAYS = 90;

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

function parseApolloJs(content) {
  const trimmed = content.trim();
  let jsonStr;
  if (/window\.APOLLO_NETWORK_DATA\s*=/i.test(trimmed)) {
    jsonStr = trimmed.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/i, "").replace(/;\s*$/s, "");
  } else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end < start) throw new Error("JSON inválido");
    jsonStr = trimmed.slice(start, end + 1);
  }
  return JSON.parse(jsonStr);
}

/**
 * SKU “morto” / descontinuado: no último dia do recorte **não há estoque** (físico nem disponível)
 * **e** na cauda de tailDays não há vendas. Se há físico OU disponível no último dia, conta sempre
 * (mesmo sem venda). Só expurga quem está zerado em estoque e parado em vendas.
 */
function isDiscontinuedDeadSKU(bundle, storeName, tailDays) {
  const resultsRoot = bundle.results || {};
  const tlRaw = resultsRoot[storeName] && resultsRoot[storeName].timeline ? resultsRoot[storeName].timeline : [];
  if (!tlRaw.length) return false;
  const timeline = filterTimelineChartWindow(tlRaw, { years: 2, excludeSundays: true });

  if (!timeline.length) return false;
  const last = timeline[timeline.length - 1];
  const block = resultsRoot[storeName] || {};
  const vit = Math.max(0, Number((block.metrics && block.metrics.vitrine) || 0));
  const sys = Number(last.systemPhysicalStock);
  let disp;
  let phys;
  if (Number.isFinite(sys)) {
    phys = Math.max(0, sys);
    disp = Math.max(0, phys - vit);
  } else {
    disp = Number(last.availableStock) || 0;
    phys = Number(last.physicalStock) || 0;
  }
  if (disp > 0 || phys > 0) return false;

  const lastDate = new Date(String(last.date) + "T12:00:00");
  const cutoff = new Date(lastDate);
  cutoff.setDate(cutoff.getDate() - tailDays);
  let sumSales = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const d = new Date(String(timeline[i].date) + "T12:00:00");
    if (d < cutoff) break;
    sumSales += Number(timeline[i].sales) || 0;
  }
  return sumSales <= 0;
}

function emptyCounts() {
  const o = {};
  for (const s of STATUS_ORDER) o[s] = 0;
  return o;
}
function emptySkuIdBuckets() {
  const o = {};
  for (const s of STATUS_ORDER) o[s] = [];
  return o;
}

function collectStoreNamesFromBundle(bundle, globalSet) {
  const r = bundle.results || {};
  for (const k of Object.keys(r)) {
    if (isClosedRetailStore(k)) continue;
    if (r[k] && Array.isArray(r[k].timeline) && r[k].timeline.length) globalSet.add(k);
  }
}

function sortStores(names) {
  const arr = [...names];
  const hub =
    arr.find((n) => n === "Fábrica") ||
    arr.find((n) => n === "CD SARON") ||
    arr.find((n) => /fábrica|fabrica/i.test(String(n)));
  const rest = arr.filter((n) => n !== hub).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return hub ? [hub, ...rest] : rest;
}

/**
 * IDs de produto considerados ativos no grid legado (alinha a build_cd_purchase_plan: array em catalog_grid.js).
 * Exclui só linhas com legacyAtivo === false; ausência do campo conta como ativo.
 */
function loadCatalogActiveSkuIds() {
  if (!fs.existsSync(CATALOG_GRID_PATH)) {
    throw new Error("Falta data/catalog_grid.js. Rode: npm run sync:catalog-grid");
  }
  const raw = fs.readFileSync(CATALOG_GRID_PATH, "utf8").trim();
  const jsonStr = raw.replace(/^\s*const\s+CATALOG_GRID\s*=\s*/, "").replace(/;\s*$/, "");
  const catalog = JSON.parse(jsonStr);
  if (!Array.isArray(catalog)) throw new Error("CATALOG_GRID inválido: esperado array.");
  const activeIds = new Set();
  const catalogRowById = new Map();
  let rowsLegacyInactive = 0;
  for (const r of catalog) {
    if (!r || typeof r !== "object") continue;
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (r.legacyAtivo === false) {
      rowsLegacyInactive++;
      continue;
    }
    activeIds.add(id);
    let cadastroEstado = r.cadastroEstado;
    if (!cadastroEstado) {
      if (r.indDeletado) cadastroEstado = "Excluído (cadastro)";
      else if (r.legacyAtivo) cadastroEstado = "Ativo";
      else cadastroEstado = "Inativo";
    }
    catalogRowById.set(id, { ...r, cadastroEstado });
  }
  return {
    activeIds,
    catalogRowById,
    grid_rows_total: catalog.length,
    rows_legacy_inactive: rowsLegacyInactive,
    active_sku_id_count: activeIds.size,
  };
}

/**
 * Mapa Id → preço unitário (R$). Ordem: nomes fixos em produto; heurística em colunas numéricas;
 * override LEGACY_PRODUTO_PRECO_COLUMN; último preço em historico_preco / historicopreco se existir.
 */
async function loadLegacyUnitPriceByProdutoId() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    await conn.query("SET NAMES 'utf8mb4'");
    const [dbRow] = await conn.query("SELECT DATABASE() AS db");
    const schema = dbRow[0] && dbRow[0].db ? String(dbRow[0].db) : "";
    if (!schema) throw new Error("MySQL legado: nenhuma database selecionada.");

    const [colRows] = await conn.query(
      "SELECT COLUMN_NAME AS nm, DATA_TYPE AS dt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'produto'",
      [schema]
    );
    const lower = new Set(colRows.map((r) => String(r.nm).toLowerCase()));
    const byLower = new Map(colRows.map((r) => [String(r.nm).toLowerCase(), String(r.nm)]));

    const manual = String(process.env.LEGACY_PRODUTO_PRECO_COLUMN || "").trim();
    let picked = null;
    let source = "produto";

    if (manual && /^[A-Za-z0-9_]+$/.test(manual) && lower.has(manual.toLowerCase())) {
      picked = byLower.get(manual.toLowerCase());
      source = "produto(env)";
    }

    const fixedOrder = [
      "PrecoVenda",
      "ValorVenda",
      "VlrVenda",
      "Preco",
      "ValorUnitario",
      "ValorUnitarioVenda",
      "ValorDeVenda",
      "ValorUnitario1",
      "ValorVenda1",
      "PrecoVenda1",
    ];
    if (!picked) {
      for (const c of fixedOrder) {
        if (lower.has(c.toLowerCase())) {
          picked = byLower.get(c.toLowerCase());
          break;
        }
      }
    }

    if (!picked) {
      const numericTypes = new Set(["decimal", "double", "float"]);
      const scored = [];
      for (const r of colRows) {
        const nm = String(r.nm);
        const low = nm.toLowerCase();
        const dt = String(r.dt || "").toLowerCase();
        if (!numericTypes.has(dt)) continue;
        if (/custo|ipi|peso|altura|largura|gramatura|peso_liq|volume|percent|taxa|ind_/i.test(nm)) continue;
        if (!/(preco|venda|valor|vlr|unit)/i.test(nm)) continue;
        let score = 1;
        if (/venda|preco|vlr/i.test(nm)) score += 5;
        if (/venda/i.test(nm)) score += 3;
        if (/custo/i.test(nm)) score -= 50;
        scored.push({ nm, score });
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored.length) picked = scored[0].nm;
    }

    if (picked && /^[A-Za-z0-9_]+$/.test(picked)) {
      const sql =
        "SELECT p.Id AS id, CAST(COALESCE(p.`" +
        picked +
        "`, 0) AS DECIMAL(20,6)) AS unit_price FROM produto p WHERE COALESCE(p.IndDeletado, b'0') = b'0'";
      const [rows] = await conn.query(sql);
      const map = new Map();
      for (const r of rows) {
        const id = Number(r.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const p = Number(r.unit_price);
        map.set(id, Number.isFinite(p) && p > 0 ? p : 0);
      }
      return { map, column: picked, source, table: "produto" };
    }

    const [hpTables] = await conn.query(
      "SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND LOWER(TABLE_NAME) IN ('historico_preco','historicopreco')",
      [schema]
    );
    if (!hpTables.length) {
      throw new Error(
        "Não foi possível obter preço: nenhuma coluna candidata em `produto` nem tabela historico_preco/historicopreco. " +
          "Defina LEGACY_PRODUTO_PRECO_COLUMN no .env com o nome exato da coluna em produto."
      );
    }
    const ht = hpTables[0].t;
    const [hpCols] = await conn.query(
      "SELECT COLUMN_NAME AS nm FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
      [schema, ht]
    );
    const hLower = new Set(hpCols.map((r) => String(r.nm).toLowerCase()));
    const pidCol = hLower.has("idproduto")
      ? "IdProduto"
      : hLower.has("id_produto")
        ? "id_produto"
        : null;
    const priceHp = ["PrecoVenda", "ValorVenda", "Preco", "VlrVenda"].find((c) => hLower.has(c.toLowerCase()));
    const dateHp = hLower.has("datainiciovigencia")
      ? "DataInicioVigencia"
      : hLower.has("data_inicio_vigencia")
        ? "data_inicio_vigencia"
        : null;
    if (!pidCol || !priceHp) {
      throw new Error("Tabela " + ht + " encontrada mas faltam colunas IdProduto / PrecoVenda.");
    }
    const delHp = hLower.has("inddeletado") ? "COALESCE(hp.IndDeletado, b'0') = b'0'" : "1";
    let rowsHp;
    if (dateHp) {
      const sqlJoin =
        "SELECT hp.`" +
        pidCol +
        "` AS id, CAST(COALESCE(hp.`" +
        priceHp +
        "`, 0) AS DECIMAL(20,6)) AS unit_price FROM `" +
        ht +
        "` hp INNER JOIN (" +
        "SELECT `" +
        pidCol +
        "` AS _pid, MAX(`" +
        dateHp +
        "`) AS _mx FROM `" +
        ht +
        "` WHERE " +
        (hLower.has("inddeletado") ? "COALESCE(IndDeletado, b'0') = b'0'" : "1") +
        " GROUP BY `" +
        pidCol +
        "`" +
        ") t ON t._pid = hp.`" +
        pidCol +
        "` AND t._mx = hp.`" +
        dateHp +
        "` WHERE " +
        delHp;
      [rowsHp] = await conn.query(sqlJoin);
    } else {
      const sqlG =
        "SELECT hp.`" +
        pidCol +
        "` AS id, CAST(MAX(hp.`" +
        priceHp +
        "`) AS DECIMAL(20,6)) AS unit_price FROM `" +
        ht +
        "` hp WHERE " +
        delHp +
        " GROUP BY hp.`" +
        pidCol +
        "`";
      [rowsHp] = await conn.query(sqlG);
    }
    const map = new Map();
    for (const r of rowsHp) {
      const id = Number(r.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const p = Number(r.unit_price);
      map.set(id, Number.isFinite(p) && p > 0 ? p : 0);
    }
    return { map, column: priceHp + "@" + ht, source: "historico_preco", table: ht };
  } finally {
    await conn.end();
  }
}

async function main() {
  const {
    map: priceByProdutoId,
    column: legacyPriceColumn,
    source: legacyPriceSource,
    table: legacyPriceTable,
  } = await loadLegacyUnitPriceByProdutoId();

  const files = fs.readdirSync(JS_DIR).filter((f) => /^sku_\d+\.js$/i.test(f));
  files.sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const catalogMeta = loadCatalogActiveSkuIds();
  const catalogRowById = catalogMeta.catalogRowById || new Map();
  const filteredFiles = files.filter((f) => {
    const id = parseInt(f.match(/\d+/)[0], 10);
    return catalogMeta.activeIds.has(id);
  });
  const todo = filteredFiles;

  const allStores = new Set();
  for (const f of todo) {
    try {
      const txt = fs.readFileSync(path.join(JS_DIR, f), "utf8");
      const bundle = parseApolloJs(txt);
      collectStoreNamesFromBundle(bundle, allStores);
    } catch (_) {
      /* skip */
    }
  }
  const storesSorted = sortStores([...allStores]);

  const byStore = {};
  for (const s of storesSorted) {
    byStore[s] = {
      counts: emptyCounts(),
      financial_mass: emptyCounts(),
      counts_cadastro_ativo: emptyCounts(),
      financial_mass_cadastro_ativo: emptyCounts(),
      sku_ids_by_status: emptySkuIdBuckets(),
      excluded_discontinued_ruptura: 0,
      skipped: 0,
    };
  }

  for (const f of todo) {
    let bundle;
    try {
      const txt = fs.readFileSync(path.join(JS_DIR, f), "utf8");
      bundle = parseApolloJs(txt);
    } catch {
      continue;
    }
    const results = bundle.results || {};
    for (const storeName of Object.keys(results)) {
      if (isClosedRetailStore(storeName)) continue;
      if (!byStore[storeName]) continue;
      const block = results[storeName];
      if (!block || !Array.isArray(block.timeline) || !block.timeline.length) {
        byStore[storeName].skipped++;
        continue;
      }
      const st = computeDetailViewStatus(bundle, storeName, { tuning: DEFAULT_TUNING });
      if (st.err || !st.statusText) {
        byStore[storeName].skipped++;
        continue;
      }
      let status = st.statusText;
      if (status === "RUPTURA" && isDiscontinuedDeadSKU(bundle, storeName, DISCONTINUED_SALES_TAIL_DAYS)) {
        byStore[storeName].excluded_discontinued_ruptura++;
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(byStore[storeName].counts, status)) {
        byStore[storeName].skipped++;
        continue;
      }
      byStore[storeName].counts[status]++;
      const produtoId = Number((bundle.info && bundle.info.id) || 0);
      if (Number.isFinite(produtoId) && produtoId > 0) {
        byStore[storeName].sku_ids_by_status[status].push(produtoId);
      }
      const unitPrice = priceByProdutoId.get(produtoId) || 0;
      const physQty = Math.max(0, Number(st.fisicoToday) || 0);
      byStore[storeName].financial_mass[status] += unitPrice * physQty;
      const catRow = catalogRowById.get(produtoId);
      const cadastroOk = catRow && String(catRow.cadastroEstado || "").trim() === "Ativo";
      if (cadastroOk) {
        byStore[storeName].counts_cadastro_ativo[status]++;
        byStore[storeName].financial_mass_cadastro_ativo[status] += unitPrice * physQty;
      }
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    sku_files_total_in_js_dir: files.length,
    sku_files_after_catalog_filter: filteredFiles.length,
    catalog: {
      path: path.relative(ROOT, CATALOG_GRID_PATH).replace(/\\/g, "/"),
      filter_rule: "legacyAtivo !== false (ausência do campo = ativo)",
      cadastro_ativo_mix_rule:
        "Histograma opcional «Só cadastro Ativo»: conta apenas SKU com cadastroEstado === 'Ativo' no catálogo (mesmo critério visual do Mix de Produtos).",
      grid_rows_total: catalogMeta.grid_rows_total,
      rows_legacy_inactive: catalogMeta.rows_legacy_inactive,
      active_sku_id_count: catalogMeta.active_sku_id_count,
    },
    model:
      "computeDetailViewStatus — disp canónico (systemPhysicalStock quando houver); faixa de status: % disp / max(P150 Mira protegido, P150 motor no último dia) para não colapsar tudo em ENCALHADO 3 quando a Mira fica abaixo do alvo Apollo",
    discontinued_rule:
      "RUPTURA excluída só para SKU morto: último dia sem estoque útil (físico/disponível canônicos: " +
      "se existir systemPhysicalStock no ponto, físico=ERP e disp=max(0,físico−vitrine); senão motor do bundle), " +
      "e soma de vendas=0 nos últimos " +
      DISCONTINUED_SALES_TAIL_DAYS +
      " dias do recorte (2 anos, domingos excluídos). Com qualquer estoque no último dia, conta sempre.",
    financial_note:
      "financial_mass (R$) = Σ por faixa de (preço unitário em produto.`" +
      legacyPriceColumn +
      "` no legado × fisicoToday canônico do último dia na loja, mesmo critério do status).",
    legacy_price: {
      source: legacyPriceSource || "produto",
      table: legacyPriceTable || "produto",
      column: legacyPriceColumn,
      quantity:
        "fisicoToday do status: físico canônico último dia (systemPhysicalStock quando válido; senão physicalStock motor)",
    },
    status_order: STATUS_ORDER,
    stores: storesSorted,
    by_store: byStore,
    sku_files_used: todo.length,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(payload);
  fs.writeFileSync(OUT, json, "utf8");
  const safeForScript = json.replace(/</g, "\\u003c");
  fs.writeFileSync(OUT_JS, "window.STOCK_HEALTH_HISTOGRAM_DATA = " + safeForScript + ";\n", "utf8");
  console.log(
    "Wrote",
    OUT,
    "and",
    OUT_JS,
    "stores:",
    storesSorted.length,
    "skus_used:",
    todo.length,
    "after_catalog:",
    filteredFiles.length,
    "sku_js_total:",
    files.length,
    "catalog_active_ids:",
    catalogMeta.active_sku_id_count,
    "legacy_price_column:",
    legacyPriceColumn,
    "legacy_price_source:",
    legacyPriceSource
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

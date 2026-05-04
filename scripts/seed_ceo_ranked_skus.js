/**
 * 1) Lê todos os data/js/sku_*.js, calcula vendas totais (soma de sales em todas as timelines).
 * 2) Ordena do maior para o menor e grava data/client/sku_sales_rank.json
 * 3) Ingere no MySQL `ceo` (daily_stock_snapshot + cd_daily_aggregate) nessa ordem:
 *    por padrão TODOS os SKUs (mais vendidos primeiro até o fim). Use --limit=N só para teste.
 *
 * Não depende do dump legado; usa só os artefatos já gerados pelo motor.
 *
 * Uso (na raiz do projeto):
 *   node scripts/seed_ceo_ranked_skus.js              # ranking + ingestão completa
 *   node scripts/seed_ceo_ranked_skus.js --skip-rank  # só ingestão (usa sku_sales_rank.json)
 *   node scripts/seed_ceo_ranked_skus.js --limit=100  # só os 100 primeiros do ranking
 *   node scripts/seed_ceo_ranked_skus.js --rank-only
 *
 * Env: SEED_TOP_SKUS (cap opcional), SEED_YEARS=2, SEED_CHUNK=400, SEED_SKIP_FACTORY=1
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const root = path.join(__dirname, "..");
const { isNonResaleServiceSku } = require(path.join(root, "lib", "resale_sku_filters"));
const { isClosedRetailStore } = require(path.join(root, "lib", "closed_retail_stores"));
const { configCeo } = require(path.join(root, "coceo_db_config"));
const { filterTimelineChartWindow } = require(path.join(root, "timeline_window"));

const JS_DIR = path.join(root, "data", "js");
const OUT_RANK = path.join(root, "data", "client", "sku_sales_rank.json");

function parseArgs(argv) {
  const out = { rankOnly: false, skipRank: false, limit: undefined };
  for (const a of argv.slice(2)) {
    if (a === "--rank-only") out.rankOnly = true;
    else if (a === "--skip-rank") out.skipRank = true;
    else if (a.startsWith("--limit=")) {
      const raw = String(a.split("=")[1] || "").trim().toLowerCase();
      if (raw === "" || raw === "all") out.limit = undefined;
      else {
        const n = parseInt(raw, 10);
        out.limit = Number.isFinite(n) && n > 0 ? n : undefined;
      }
    }
  }
  const envLim = process.env.SEED_TOP_SKUS;
  if (out.limit === undefined && envLim !== undefined && envLim !== "") {
    const n = parseInt(String(envLim).trim(), 10);
    if (Number.isFinite(n) && n > 0) out.limit = n;
  }
  return out;
}

function loadRankFromDisk() {
  if (!fs.existsSync(OUT_RANK)) {
    throw new Error("Arquivo não encontrado: " + OUT_RANK + " — rode sem --skip-rank primeiro.");
  }
  const j = JSON.parse(fs.readFileSync(OUT_RANK, "utf8"));
  if (!j.rows || !Array.isArray(j.rows)) throw new Error("sku_sales_rank.json inválido (faltam rows).");
  return j.rows;
}

function parseApolloJs(content) {
  const trimmed = content.trim();
  let jsonStr;
  if (/window\.APOLLO_NETWORK_DATA\s*=/i.test(trimmed)) {
    jsonStr = trimmed.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/i, "").replace(/;\s*$/s, "");
  } else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end < start) throw new Error("JSON não encontrado");
    jsonStr = trimmed.slice(start, end + 1);
  }
  return JSON.parse(jsonStr);
}

function isFactoryLike(storeName) {
  if (process.env.SEED_SKIP_FACTORY === "0") return false;
  const n = String(storeName || "").toLowerCase();
  return n.includes("fábrica") || n.includes("fabrica") || n === "cd" || /\bcd\b/.test(n);
}

function totalSalesInBundle(data, skipFactory) {
  const results = data.results || {};
  let sum = 0;
  for (const store of Object.keys(results)) {
    if (isClosedRetailStore(store)) continue;
    if (skipFactory && isFactoryLike(store)) continue;
    const tl = results[store].timeline;
    if (!Array.isArray(tl)) continue;
    for (const day of tl) sum += Number(day.sales) || 0;
  }
  return sum;
}

function canonicalAvailable(physical, showcase) {
  const p = Number(physical) || 0;
  const s = Number(showcase) || 0;
  return Math.max(0, p - s);
}

async function rankAll() {
  const files = fs.readdirSync(JS_DIR).filter((f) => /^sku_\d+\.js$/i.test(f));
  files.sort((a, b) => {
    const na = parseInt(a.match(/\d+/)[0], 10);
    const nb = parseInt(b.match(/\d+/)[0], 10);
    return na - nb;
  });

  const rows = [];
  let errors = 0;
  for (let i = 0; i < files.length; i++) {
    if (i % 400 === 0) console.log(`Ranking ${i + 1} / ${files.length}...`);
    const fp = path.join(JS_DIR, files[i]);
    try {
      const data = parseApolloJs(fs.readFileSync(fp, "utf8"));
      const info = data.info || {};
      if (isNonResaleServiceSku({ code: info.code, name: info.name, subcategory: null })) continue;
      const id = info.id != null ? info.id : parseInt(files[i].match(/\d+/)[0], 10);
      const totalSales = totalSalesInBundle(data, true);
      rows.push({
        id,
        code: info.code != null ? String(info.code) : "",
        name: info.name != null ? String(info.name) : "",
        total_sales: totalSales,
        file: files[i],
      });
    } catch (e) {
      errors++;
      if (errors <= 8) console.warn(files[i], e.message);
    }
  }

  rows.sort((a, b) => b.total_sales - a.total_sales);
  fs.mkdirSync(path.dirname(OUT_RANK), { recursive: true });
  const meta = {
    generated_at: new Date().toISOString(),
    sku_count: rows.length,
    parse_errors: errors,
    note:
      "total_sales = soma de day.sales em todas as timelines, excl. Fábrica/CD (SEED_SKIP_FACTORY≠0). " +
      "Exclui serviços/sob medida (lib/resale_sku_filters.js).",
  };
  fs.writeFileSync(OUT_RANK, JSON.stringify({ meta, rows }, null, 2), "utf8");
  console.log("Ranking salvo:", OUT_RANK);
  console.log("Top 15 por vendas (unidades somadas no histórico do arquivo):");
  rows.slice(0, 15).forEach((r, j) => {
    console.log(`  ${j + 1}. id=${r.id} code=${r.code} sales=${r.total_sales.toFixed(0)}  ${(r.name || "").slice(0, 50)}`);
  });
  return rows;
}

function assertSafeDbName(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(name))) {
    throw new Error("CEO_MYSQL_DATABASE inválido: " + name);
  }
  return String(name);
}

async function ensureCeoSchema() {
  const { host, port, user, password, database } = configCeo;
  const db = assertSafeDbName(database);
  const base = { host, port, user, password, multipleStatements: true };
  const c = await mysql.createConnection(base);
  await c.query(
    "CREATE DATABASE IF NOT EXISTS `" + db + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  );

  let ready = false;
  try {
    await c.query("USE `" + db + "`");
    await c.query("SELECT 1 FROM daily_stock_snapshot LIMIT 1");
    await c.query("SELECT 1 FROM cd_daily_aggregate LIMIT 1");
    ready = true;
  } catch (_) {
    ready = false;
  }

  const sqlDir = path.join(root, "sql", "ceo");
  const migrations = fs
    .readdirSync(sqlDir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "en"));
  if (!ready) {
    console.log("Primeira carga/estrutura incompleta no schema `ceo`; aplicando migrations...");
  } else {
    console.log("Schema `ceo` disponível; aplicando migrations idempotentes para manter estrutura atualizada...");
  }
  for (const m of migrations) {
    const full = path.join(sqlDir, m);
    await c.query(fs.readFileSync(full, "utf8"));
  }

  await c.end();
  return mysql.createConnection({ host, port, user, password, database: db });
}

async function seedTop(rankRows, limit) {
  const years = Number(process.env.SEED_YEARS) || 2;
  const chunk = Number(process.env.SEED_CHUNK) || 400;
  const cap =
    limit === undefined || limit === null ? rankRows.length : Math.min(Number(limit), rankRows.length);
  const ordered = rankRows.slice(0, cap);
  if (!ordered.length) {
    console.log("Lista de SKUs vazia; abortando ingestão.");
    return;
  }

  const runId = crypto.randomUUID();
  let conn;
  try {
    conn = await ensureCeoSchema();
  } catch (e) {
    console.error("Falha ao conectar/preparar MySQL `ceo`:", e.message);
    process.exit(1);
  }

  await conn.query(
    `INSERT INTO engine_run (run_id, run_type, status, row_counts, notes)
     VALUES (?, 'ingest_snapshot', 'running', NULL, ?)`,
    [
      runId,
      `seed_ceo_ranked_skus ${ordered.length} SKU(s) por ranking de vendas (últimos ${years}a, sem domingos; cap=${cap === rankRows.length ? "todos" : cap})`,
    ]
  );

  const sqlSnap = `INSERT INTO daily_stock_snapshot
    (run_id, ref_date, store_key, sku_internal_id, sku_erp_code, product_name,
     qty_physical, qty_showcase, qty_available, qty_sales)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      run_id = VALUES(run_id),
      sku_internal_id = VALUES(sku_internal_id),
      product_name = VALUES(product_name),
      qty_physical = VALUES(qty_physical),
      qty_showcase = VALUES(qty_showcase),
      qty_available = VALUES(qty_available),
      qty_sales = VALUES(qty_sales),
      ingested_at = CURRENT_TIMESTAMP(3)`;

  const sqlCd = `INSERT INTO cd_daily_aggregate
    (run_id, ref_date, sku_erp_code, sku_internal_id, store_count,
     sum_qty_physical_stores, sum_qty_available_stores, sum_sales_day)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      run_id = VALUES(run_id),
      sku_internal_id = VALUES(sku_internal_id),
      store_count = VALUES(store_count),
      sum_qty_physical_stores = VALUES(sum_qty_physical_stores),
      sum_qty_available_stores = VALUES(sum_qty_available_stores),
      sum_sales_day = VALUES(sum_sales_day),
      computed_at = CURRENT_TIMESTAMP(3)`;

  let totalSnap = 0;
  let totalCd = 0;
  let skuIndex = 0;

  for (const entry of ordered) {
    skuIndex++;
    const fp = path.join(JS_DIR, entry.file);
    let data;
    try {
      data = parseApolloJs(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      console.warn("Pular (erro ao reler)", entry.file, e.message);
      continue;
    }
    const info = data.info || {};
    const skuInternalId = info.id != null ? info.id : entry.id;
    const skuErpCode = String(info.code || entry.code || "");
    const productName = String(info.name || entry.name || "");
    const results = data.results || {};

    /** @type {Map<string, { phys: number, avail: number, sales: number, n: number }>} */
    const cdByDate = new Map();

    const snapRows = [];

    for (const storeKey of Object.keys(results)) {
      if (isFactoryLike(storeKey)) continue;
      const block = results[storeKey];
      if (!block || !Array.isArray(block.timeline)) continue;
      const vitrine = Number(block.metrics?.vitrine) || 0;
      const timeline = filterTimelineChartWindow(block.timeline, {
        years,
        excludeSundays: true,
      });

      for (const day of timeline) {
        const phys = Number(day.physicalStock) || 0;
        const sales = Number(day.sales) || 0;
        const avail = canonicalAvailable(phys, vitrine);
        snapRows.push([runId, day.date, storeKey, skuInternalId, skuErpCode, productName, phys, vitrine, avail, sales]);

        const agg = cdByDate.get(day.date) || { phys: 0, avail: 0, sales: 0, n: 0 };
        agg.phys += phys;
        agg.avail += avail;
        agg.sales += sales;
        agg.n += 1;
        cdByDate.set(day.date, agg);
      }
    }

    const cdRows = [];
    for (const [refDate, agg] of cdByDate) {
      cdRows.push([
        runId,
        refDate,
        skuErpCode,
        skuInternalId,
        agg.n,
        agg.phys,
        agg.avail,
        agg.sales,
      ]);
    }

    for (let i = 0; i < snapRows.length; i += chunk) {
      await conn.query(sqlSnap, [snapRows.slice(i, i + chunk)]);
    }
    for (let i = 0; i < cdRows.length; i += chunk) {
      await conn.query(sqlCd, [cdRows.slice(i, i + chunk)]);
    }

    totalSnap += snapRows.length;
    totalCd += cdRows.length;
    const logEvery = Number(process.env.SEED_LOG_EVERY) || 50;
    const loud =
      skuIndex <= 3 ||
      skuIndex % logEvery === 0 ||
      skuIndex === ordered.length;
    if (loud) {
      console.log(
        `[${skuIndex}/${ordered.length}] SKU ${skuErpCode} (id ${skuInternalId}) → snapshot ${snapRows.length} linhas, CD ${cdRows.length} dias`
      );
    }
  }

  await conn.query(
    `UPDATE engine_run SET status = 'success', finished_at = CURRENT_TIMESTAMP(3),
     row_counts = ? WHERE run_id = ?`,
    [
      JSON.stringify({
        snapshot_rows: totalSnap,
        cd_aggregate_rows: totalCd,
        skus_ingested: ordered.length,
      }),
      runId,
    ]
  );
  await conn.end();
  console.log("\nOK run_id=", runId);
  console.log("Total snapshot:", totalSnap, "| CD dias (soma lojas):", totalCd, "| SKUs:", ordered.length);
}

async function main() {
  const args = parseArgs(process.argv);
  let rankRows;
  if (args.skipRank) {
    rankRows = loadRankFromDisk();
    console.log("Ranking em disco:", OUT_RANK, "→", rankRows.length, "SKUs (ordem preservada).");
  } else {
    rankRows = await rankAll();
  }
  if (args.rankOnly) {
    console.log("--rank-only: não gravou no MySQL.");
    return;
  }
  await seedTop(rankRows, args.limit);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

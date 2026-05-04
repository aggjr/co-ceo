/**
 * Dupla conferência: catálogo ativo (data/catalog_grid.js) vs bundles em data/js/sku_*.js
 * (e opcionalmente data/raw). Gera relatório em consola + data/client/sku_bundle_coverage.json
 *
 * Uso: node scripts/verify_sku_bundle_coverage.js
 *       node scripts/verify_sku_bundle_coverage.js --deep   (lê cada .js e conta lojas com timeline)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { parseApolloBundleFileContent } = require(path.join(__dirname, "..", "lib", "parse_apollo_bundle"));

const ROOT = path.join(__dirname, "..");
const CATALOG_GRID = path.join(ROOT, "data", "catalog_grid.js");
const JS_DIR = path.join(ROOT, "data", "js");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_JSON = path.join(ROOT, "data", "client", "sku_bundle_coverage.json");

function loadCatalogActiveIds() {
  if (!fs.existsSync(CATALOG_GRID)) throw new Error("Falta " + CATALOG_GRID);
  const raw = fs.readFileSync(CATALOG_GRID, "utf8").trim();
  const jsonStr = raw.replace(/^\s*const\s+CATALOG_GRID\s*=\s*/, "").replace(/;\s*$/, "");
  const arr = JSON.parse(jsonStr);
  if (!Array.isArray(arr)) throw new Error("CATALOG_GRID inválido");
  const active = new Set();
  let inactive = 0;
  for (const r of arr) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (r.legacyAtivo === false) inactive++;
    else active.add(id);
  }
  return { active, inactive, gridRows: arr.length };
}

function listSkuIdsFromDir(dir, ext) {
  if (!fs.existsSync(dir)) return new Set();
  const re = ext === "js" ? /^sku_(\d+)\.js$/i : /^sku_(\d+)\.json$/i;
  const s = new Set();
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(re);
    if (m) s.add(parseInt(m[1], 10));
  }
  return s;
}

function main() {
  const deep = process.argv.includes("--deep");
  const { active, inactive, gridRows } = loadCatalogActiveIds();
  const jsIds = listSkuIdsFromDir(JS_DIR, "js");
  const rawIds = listSkuIdsFromDir(RAW_DIR, "json");

  const missingJs = [...active].filter((id) => !jsIds.has(id)).sort((a, b) => a - b);
  const missingRaw = [...active].filter((id) => !rawIds.has(id)).sort((a, b) => a - b);
  const jsNotInActive = [...jsIds].filter((id) => !active.has(id)).sort((a, b) => a - b);

  let deepStoresHistogram = null;
  let deepErrors = 0;
  if (deep) {
    const hist = {};
    for (const id of active) {
      if (!jsIds.has(id)) continue;
      const p = path.join(JS_DIR, `sku_${id}.js`);
      try {
        const bundle = parseApolloBundleFileContent(fs.readFileSync(p, "utf8"));
        const results = bundle.results || {};
        let n = 0;
        for (const k of Object.keys(results)) {
          const t = results[k] && results[k].timeline;
          if (Array.isArray(t) && t.length) n++;
        }
        hist[n] = (hist[n] || 0) + 1;
      } catch (_) {
        deepErrors++;
      }
    }
    deepStoresHistogram = hist;
  }

  const report = {
    generated_at: new Date().toISOString(),
    catalog_grid_rows: gridRows,
    catalog_legacy_inactive_rows: inactive,
    catalog_active_sku_ids: active.size,
    sku_js_files_on_disk: jsIds.size,
    sku_raw_json_on_disk: rawIds.size,
    active_missing_js: missingJs.length,
    active_missing_raw: missingRaw.length,
    js_files_not_in_active_catalog: jsNotInActive.length,
    sample_missing_js: missingJs.slice(0, 40),
    sample_missing_raw: missingRaw.slice(0, 40),
    sample_js_not_in_catalog: jsNotInActive.slice(0, 20),
    deep_scan: deep,
    deep_parse_errors: deep ? deepErrors : null,
    deep_stores_with_timeline_count_histogram: deepStoresHistogram,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("=== Cobertura SKU (catálogo ativo × data/js) ===");
  console.log("Linhas catalog_grid:", gridRows, "| inativos legado:", inactive, "| IDs ativos:", active.size);
  console.log("sku_*.js no disco:", jsIds.size, "| sku_*.json em data/raw:", rawIds.size);
  console.log("Ativos SEM .js:", missingJs.length, "| Ativos SEM .json raw:", missingRaw.length);
  console.log(".js cujo id NÃO está no catálogo ativo:", jsNotInActive.length);
  if (missingJs.length) console.log("Amostra sem JS:", missingJs.slice(0, 15).join(", "));
  if (deep && deepStoresHistogram) {
    console.log("--deep: lojas com timeline por SKU (contagem de SKUs):", JSON.stringify(deepStoresHistogram));
    console.log("--deep: erros de parse:", deepErrors);
  }
  console.log("Relatório:", OUT_JSON);
}

main();

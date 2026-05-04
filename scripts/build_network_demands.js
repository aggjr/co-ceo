/**
 * Recalcula demanda por loja e agregado CD (fórmulas alinhadas a ceo_product_detail_layout.html)
 * para todos os bundles em data/js/sku_*.js.
 *
 * Saídas:
 *   data/client/network_demands.json  — metadados + array por SKU
 *   data/client/network_demands_stores.csv
 *   data/client/network_demands_cd.csv
 *
 * Uso:
 *   node scripts/build_network_demands.js
 *   node scripts/build_network_demands.js --limit=100
 *   node scripts/build_network_demands.js --anchor=2026-04-20
 *   node scripts/build_network_demands.js --tuning=C:\\path\\tuning_por_loja.json
 *
 * tuning JSON: { "Barreiro": { "ltSafetyMultiplier": 1.5, "reactHalfLife": 50, ... }, ... }
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { computeSkuNetworkDemands } = require(path.join(__dirname, "..", "lib", "detail_style_demand"));

const JS_DIR = path.join(__dirname, "..", "data", "js");
const OUT_DIR = path.join(__dirname, "..", "data", "client");
const OUT_JSON = path.join(OUT_DIR, "network_demands.json");
const OUT_CSV_STORES = path.join(OUT_DIR, "network_demands_stores.csv");
const OUT_CSV_CD = path.join(OUT_DIR, "network_demands_cd.csv");

function parseArgs(argv) {
  const o = { limit: 0, anchor: null, tuningPath: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--limit=")) o.limit = Math.max(0, parseInt(a.split("=")[1], 10) || 0);
    if (a.startsWith("--anchor=")) {
      const v = a.split("=")[1];
      o.anchor = v && String(v).trim() ? String(v).trim() : null;
    }
    if (a.startsWith("--tuning=")) {
      const v = a.slice("--tuning=".length);
      o.tuningPath = v && String(v).trim() ? String(v).trim() : null;
    }
  }
  return o;
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

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\n\r]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(JS_DIR)) {
    console.error("Pasta não encontrada:", JS_DIR);
    process.exit(1);
  }

  let tuningByStore = null;
  if (args.tuningPath) {
    if (!fs.existsSync(args.tuningPath)) {
      console.error("Ficheiro de tuning não encontrado:", args.tuningPath);
      process.exit(1);
    }
    tuningByStore = JSON.parse(fs.readFileSync(args.tuningPath, "utf8"));
    if (!tuningByStore || typeof tuningByStore !== "object") tuningByStore = {};
  }

  const files = fs.readdirSync(JS_DIR).filter((f) => /^sku_\d+\.js$/i.test(f));
  files.sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const todo = args.limit > 0 ? files.slice(0, args.limit) : files;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const opts = {
    years: 2,
    excludeSundays: true,
    anchorDate: args.anchor || undefined,
    tuningByStore: tuningByStore || undefined,
  };

  const results = [];
  const csvStoreLines = [
    [
      "sku_internal_id",
      "erp_code",
      "product_name",
      "store",
      "demand",
      "baseRep",
      "minFinal",
      "p150Today",
      "dispToday",
      "curveClass",
      "ltDaysOperational",
      "error",
    ].join(","),
  ];
  const csvCdLines = [
    [
      "sku_internal_id",
      "erp_code",
      "product_name",
      "cdKey",
      "cdMiraGapRaw",
      "cdTermDisplay",
      "xLojas",
      "rawSum",
      "productionTotal",
      "minFinalCd",
      "p150TodayCd",
      "dispTodayCd",
      "error",
    ].join(","),
  ];

  let err = 0;
  const t0 = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const file = todo[i];
    const fp = path.join(JS_DIR, file);
    try {
      const bundle = parseApolloJs(fs.readFileSync(fp, "utf8"));
      const info = bundle.info || {};
      const skuId = info.id != null ? info.id : parseInt(file.match(/\d+/)[0], 10);
      const erp = info.code != null ? String(info.code) : "";
      const pname = info.name != null ? String(info.name) : "";
      const net = computeSkuNetworkDemands(bundle, skuId, opts);
      results.push({
        sku_internal_id: skuId,
        erp_code: erp,
        product_name: pname,
        ...net,
      });

      for (const s of net.stores || []) {
        csvStoreLines.push(
          [
            skuId,
            csvEscape(erp),
            csvEscape(pname),
            csvEscape(s.store),
            s.demand != null ? s.demand : "",
            s.baseRep != null ? s.baseRep : "",
            s.minFinal != null ? s.minFinal : "",
            s.p150Today != null ? String(s.p150Today) : "",
            s.dispToday != null ? String(s.dispToday) : "",
            csvEscape(s.curveClass || ""),
            s.ltDaysOperational != null ? s.ltDaysOperational : "",
            csvEscape(s.error || ""),
          ].join(",")
        );
      }

      const c = net.cd;
      if (c) {
        csvCdLines.push(
          [
            skuId,
            csvEscape(erp),
            csvEscape(pname),
            csvEscape(c.cdKey || ""),
            c.cdMiraGapRaw != null ? c.cdMiraGapRaw : "",
            c.cdTermDisplay != null ? c.cdTermDisplay : "",
            c.xLojas != null ? c.xLojas : "",
            c.rawSum != null ? c.rawSum : "",
            c.productionTotal != null ? c.productionTotal : "",
            c.minFinalCd != null ? c.minFinalCd : "",
            c.p150TodayCd != null ? String(c.p150TodayCd) : "",
            c.dispTodayCd != null ? String(c.dispTodayCd) : "",
            csvEscape(c.error || ""),
          ].join(",")
        );
      }
    } catch (e) {
      err++;
      results.push({
        sku_internal_id: parseInt(file.match(/\d+/)[0], 10),
        error: String(e.message || e),
        file,
      });
    }
    if (i % 300 === 0) console.log(`… ${i + 1} / ${todo.length} (erros: ${err})`);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    anchorDate: opts.anchorDate || null,
    formula_ref: "ceo_product_detail_layout.html + lib/detail_style_demand.js",
    tuning_file: args.tuningPath,
    sku_count: results.length,
    errors: err,
    results,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(OUT_CSV_STORES, csvStoreLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(OUT_CSV_CD, csvCdLines.join("\n") + "\n", "utf8");

  console.log("JSON:", OUT_JSON);
  console.log("CSV lojas:", OUT_CSV_STORES);
  console.log("CSV CD:", OUT_CSV_CD);
  console.log("Tempo:", ((Date.now() - t0) / 1000).toFixed(1), "s | SKUs:", todo.length, "| erros:", err);
}

main();

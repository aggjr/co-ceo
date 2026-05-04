/**
 * Percorre data/js/sku_*.js com calma (pausa configurável) e grava um snapshot
 * do modelo Mira (lib/mira_model.js) por SKU × loja — útil para BI e auditoria.
 *
 * Saída padrão: data/client/mira_model_snapshot.ndjson (uma linha JSON por registro)
 *
 * Uso:
 *   node scripts/export_mira_snapshot_all.js
 *   node scripts/export_mira_snapshot_all.js --limit=50
 *   node scripts/export_mira_snapshot_all.js --sleep=15   (ms entre arquivos)
 *
 * Env: MIR_EXPORT_W=56 MIR_EXPORT_LT=14 MIR_EXPORT_YEARS=2
 */
const fs = require("fs");
const path = require("path");
const {
  runMiraPipeline,
} = require(path.join(__dirname, "..", "lib", "mira_model"));

const JS_DIR = path.join(__dirname, "..", "data", "js");
const OUT = path.join(__dirname, "..", "data", "client", "mira_model_snapshot.ndjson");

function parseArgs(argv) {
  const o = { limit: 0, sleepMs: 0 };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--limit=")) o.limit = Math.max(0, parseInt(a.split("=")[1], 10) || 0);
    if (a.startsWith("--sleep=")) o.sleepMs = Math.max(0, parseInt(a.split("=")[1], 10) || 0);
  }
  return o;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFactoryLike(name) {
  const n = String(name || "").toLowerCase();
  return n.includes("fábrica") || n.includes("fabrica") || n === "cd" || /\bcd\b/.test(n);
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

async function main() {
  const args = parseArgs(process.argv);
  const W = Number(process.env.MIR_EXPORT_W) || 56;
  const LT = Number(process.env.MIR_EXPORT_LT) || 14;
  const years = Number(process.env.MIR_EXPORT_YEARS) || 2;

  const files = fs.readdirSync(JS_DIR).filter((f) => /^sku_\d+\.js$/i.test(f));
  files.sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const todo = args.limit > 0 ? files.slice(0, args.limit) : files;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const stream = fs.createWriteStream(OUT, { flags: "w", encoding: "utf8" });
  stream.write(
    JSON.stringify({
      type: "header",
      generated_at: new Date().toISOString(),
      model: "mira_robusta",
      lib: "lib/mira_model.js",
      W,
      LT,
      years,
      sku_files: todo.length,
    }) + "\n"
  );

  let ok = 0;
  let err = 0;
  const t0 = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const file = todo[i];
    const fp = path.join(JS_DIR, file);
    try {
      const bundle = parseApolloJs(fs.readFileSync(fp, "utf8"));
      const info = bundle.info || {};
      const skuId = info.id != null ? info.id : parseInt(file.match(/\d+/)[0], 10);
      const results = bundle.results || {};
      for (const store of Object.keys(results)) {
        if (isFactoryLike(store)) continue;
        const block = results[store];
        if (!block || !Array.isArray(block.timeline) || !block.timeline.length) continue;
        const r = runMiraPipeline(block.timeline, {
          years,
          excludeSundays: true,
          windowDays: W,
          leadTimeDays: LT,
        });
        const tl = r.timelineFiltered;
        const lastI = tl.length - 1;
        if (lastI < 0) continue;
        const rec = {
          type: "row",
          sku_internal_id: skuId,
          erp_code: info.code != null ? String(info.code) : "",
          product_name: info.name != null ? String(info.name) : "",
          store,
          W,
          LT,
          years,
          points: tl.length,
          last_date: tl[lastI].date,
          last_mira100: r.mira100[lastI],
          last_p150: r.zones.p150[lastI],
          last_p10: r.zones.p10[lastI],
          last_available: Number(tl[lastI].availableStock),
          last_physical: Number(tl[lastI].physicalStock),
          fallback_windows: r.meta.fallbackWindows,
        };
        stream.write(JSON.stringify(rec) + "\n");
      }
      ok++;
    } catch (e) {
      err++;
      stream.write(
        JSON.stringify({
          type: "error",
          file,
          message: String(e.message || e),
        }) + "\n"
      );
    }
    if (i % 200 === 0) {
      console.log(`… ${i + 1} / ${todo.length} arquivos (${ok} ok, ${err} erros)`);
    }
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }

  stream.end();
  await new Promise((res, rej) => {
    stream.on("finish", res);
    stream.on("error", rej);
  });

  console.log("Exportado:", OUT);
  console.log("Tempo:", ((Date.now() - t0) / 1000).toFixed(1), "s | arquivos:", todo.length, "| erros:", err);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

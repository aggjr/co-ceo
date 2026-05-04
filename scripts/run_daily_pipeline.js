/**
 * Pipeline diário CO-CEO ligado ao MySQL legado (tenant único SARON no deploy atual).
 *
 * Por padrão NÃO clona o legado — os scripts Node já leem LEGACY_MYSQL_* em tempo real.
 * Opcional: definir DAILY_REPLICATE_LEGACY=1 para rodar mysqldump→mysql antes (réplica local).
 *
 * Depois: sincronização Apollo completa (catálogo → miner → engine → grid → matriz) +
 * demandas de rede + plano CD.
 *
 * Uso: node scripts/run_daily_pipeline.js
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runNpm(scriptName) {
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(cmd, ["run", scriptName], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  const code = r.status != null ? r.status : 1;
  if (code !== 0) {
    throw new Error(`Falha ao executar npm run ${scriptName} (código ${code})`);
  }
}

function runNodeScript(relPath) {
  const absPath = path.join(ROOT, relPath);
  const r = spawnSync(process.execPath, [absPath], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  const code = r.status != null ? r.status : 1;
  if (code !== 0) {
    throw new Error(`Falha ao executar node ${relPath} (código ${code})`);
  }
}

function envBool(name) {
  const v = process.env[name];
  return /^1|true|yes|on$/i.test(String(v || ""));
}

function isoYesterday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function assertIsoDay(name, value) {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`${name} inválido: ${value}. Use YYYY-MM-DD.`);
  }
  return s;
}

function main() {
  console.log("[daily] Início | cwd=" + ROOT);
  const yesterday = isoYesterday();
  const reprocessFromRaw = process.env.REPROCESS_FROM_DATE;
  const reprocessFrom = reprocessFromRaw ? assertIsoDay("REPROCESS_FROM_DATE", reprocessFromRaw) : null;
  const effectiveFrom = reprocessFrom && reprocessFrom <= yesterday ? reprocessFrom : yesterday;

  process.env.APOLLO_MINER_START_DATE = effectiveFrom;
  process.env.APOLLO_MINER_END_DATE = yesterday;
  process.env.APOLLO_ENGINE_END_DATE = yesterday;
  if (reprocessFrom && reprocessFrom <= yesterday) {
    process.env.APOLLO_ENGINE_START_DATE = reprocessFrom;
  } else {
    delete process.env.APOLLO_ENGINE_START_DATE;
  }

  console.log(
    `[daily] Janela efetiva | miner: ${process.env.APOLLO_MINER_START_DATE}..${process.env.APOLLO_MINER_END_DATE} | engine_end=${process.env.APOLLO_ENGINE_END_DATE}`
  );
  if (reprocessFrom) {
    console.log(`[daily] REPROCESS_FROM_DATE=${reprocessFrom} (retroativo habilitado)`);
  }

  if (envBool("DAILY_REPLICATE_LEGACY")) {
    console.log("[daily] DAILY_REPLICATE_LEGACY=1 → replicate:legacy-local");
    runNpm("replicate:legacy-local");
  }
  console.log("[daily] sync:apollo-full (legado → bundles → matriz cliente)");
  runNpm("sync:apollo-full");
  console.log("[daily] build:network-demands");
  runNpm("build:network-demands");
  console.log("[daily] build:cd-plan");
  runNpm("build:cd-plan");
  console.log("[daily] bump versão CO-CEO");
  runNodeScript("scripts/bump_coceo_version.js");
  console.log("[daily] Concluído.");
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}

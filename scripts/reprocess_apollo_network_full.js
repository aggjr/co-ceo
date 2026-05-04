/**
 * Reprocesso completo da malha Apollo (todas as lojas / unidades no legado), com passos separados
 * e verificação no fim. Sem amostragem: apollo_enterprise_miner grava todos os produtos IndDeletado=0.
 *
 * Ordem:
 *   1) apollo_enterprise_miner.js  → data/raw/sku_*.json (MySQL legado)
 *   2) apollo_enterprise_engine.js → data/js/sku_*.js (timelines / gráficos)
 *   3) verify_sku_bundle_coverage.js (catálogo ativo vs .js; use --deep para inspeção pesada)
 *
 * Uso: node scripts/reprocess_apollo_network_full.js
 *       node scripts/reprocess_apollo_network_full.js --skip-miner   (só engine + verify; recomendado no Windows)
 *       SKIP_MINER=1 node ...   (Unix / PowerShell com $env:SKIP_MINER='1')
 *       node scripts/reprocess_apollo_network_full.js --skip-verify
 *
 * Requer .env com LEGACY_MYSQL_* (miner). Pode demorar muito (milhares de SKUs × SQL).
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runNode(relScript, extraArgs = []) {
  const scriptPath = path.join(ROOT, relScript);
  console.log("\n>>>", relScript, extraArgs.join(" "), "\n");
  const r = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(relScript + " terminou com código " + r.status);
  }
}

function main() {
  const argv = new Set(process.argv.slice(2).map((a) => String(a).toLowerCase()));
  const skipMiner =
    argv.has("--skip-miner") || /^1|true|yes$/i.test(String(process.env.SKIP_MINER || ""));
  const skipVerify =
    argv.has("--skip-verify") || /^1|true|yes$/i.test(String(process.env.SKIP_VERIFY || ""));
  const verifyDeep =
    argv.has("--verify-deep") || /^1|true|yes$/i.test(String(process.env.VERIFY_DEEP || ""));

  console.log("Raiz:", ROOT);
  console.log("SKIP_MINER=", skipMiner, "SKIP_VERIFY=", skipVerify, "VERIFY_DEEP=", verifyDeep);

  if (!skipMiner) {
    runNode("apollo_enterprise_miner.js");
  } else {
    console.log("(SKIP_MINER: não executar apollo_enterprise_miner.js)");
  }

  runNode("apollo_enterprise_engine.js");

  if (!skipVerify) {
    runNode("scripts/verify_sku_bundle_coverage.js", verifyDeep ? ["--deep"] : []);
  } else {
    console.log("(SKIP_VERIFY: não executar verify_sku_bundle_coverage.js)");
  }

  console.log("\n✅ Reprocesso Apollo concluído. Próximo passo manual sugerido: npm run sync:catalog-grid && npm run build:client-matrix");
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}

/**
 * Varre combinações de janela W e lead time LT (modelo Mira em lib/mira_model.js)
 * sobre a timeline **filtrada** (2 anos, sem domingos), alinhado às páginas HTML.
 */
const fs = require("fs");
const path = require("path");
const {
  filterTimelineChartWindow,
  computeMira100,
} = require(path.join(__dirname, "..", "lib", "mira_model"));

function loadSkuBundle(skuPath) {
  const raw = fs.readFileSync(skuPath, "utf8");
  const jsonStr = raw.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  return JSON.parse(jsonStr);
}

function analyze(timeline, miraSeries, pTarget) {
  let n = 0;
  let belowP10 = 0;
  let belowP100 = 0;
  let sumSales = 0;
  let sumPhys = 0;
  let sumAvail = 0;
  let sumTarget = 0;
  let sumExcessOverP150 = 0;

  for (let i = 0; i < timeline.length; i++) {
    const m = miraSeries[i];
    if (m == null || m <= 0) continue;
    const avail = Number(timeline[i].availableStock);
    const phys = Number(timeline[i].physicalStock);
    const sales = Number(timeline[i].sales) || 0;
    if (Number.isNaN(avail) || Number.isNaN(phys)) continue;
    const p10 = m * 0.1;
    const p100 = m * 1.0;
    const p150 = m * 1.5;
    const target = m * pTarget;
    n++;
    if (avail < p10) belowP10++;
    if (avail < p100) belowP100++;
    sumSales += sales;
    sumPhys += phys;
    sumAvail += avail;
    sumTarget += target;
    if (avail > p150) sumExcessOverP150 += avail - p150;
  }

  const meanPhys = n ? sumPhys / n : 0;
  const meanAvail = n ? sumAvail / n : 0;
  const meanTarget = n ? sumTarget / n : 0;
  const totalSales = sumSales;
  const invTurnoverProxy = meanPhys > 0 ? totalSales / meanPhys : 0;
  const roiProxy = meanPhys > 0 ? sumSales / meanPhys : 0;

  return {
    days: n,
    ruptureProxyPct: n ? (belowP10 / n) * 100 : 0,
    belowMiraPct: n ? (belowP100 / n) * 100 : 0,
    meanPhysical: meanPhys,
    meanAvailable: meanAvail,
    meanTargetP: meanTarget,
    totalSalesWindow: totalSales,
    inventoryTurnoverProxy: invTurnoverProxy,
    roiProxyDailySalesPerUnitInv: roiProxy,
    excessOverP150Sum: sumExcessOverP150,
  };
}

function main() {
  const sku = process.argv[2] || "3104";
  const store = process.argv[3] || "Barreiro";
  const skuPath = path.join(__dirname, "..", "data", "js", `sku_${sku}.js`);
  if (!fs.existsSync(skuPath)) {
    console.error("Arquivo não encontrado:", skuPath);
    process.exit(1);
  }

  const bundle = loadSkuBundle(skuPath);
  const root = bundle.results || bundle;
  const block = root[store];
  if (!block || !block.timeline) {
    console.error("Loja ou timeline ausente:", store, Object.keys(root || {}));
    process.exit(1);
  }

  const timelineRaw = block.timeline;
  const tl = filterTimelineChartWindow(timelineRaw, { years: 2, excludeSundays: true });
  const engine = block.metrics || {};

  const Ws = [28, 42, 56, 70, 84];
  const LTs = [7, 10, 14, 21, 28];
  const targetKs = [1.0, 1.25, 1.5, 2.0];

  console.log("=== Simulação de parâmetros (lib/mira_model.js) ===");
  console.log("SKU:", sku, "| Loja:", store, "| pontos filtrados (2a, sem dom.):", tl.length);
  if (bundle.info) console.log("Produto:", bundle.info.code, bundle.info.name);
  console.log("Métricas motor pré-calculadas (engine):", JSON.stringify(engine, null, 2));
  console.log("");

  const rows = [];
  for (const W of Ws) {
    for (const LT of LTs) {
      const mira = computeMira100(tl, W, LT).series;
      for (const k of targetKs) {
        const a = analyze(tl, mira, k);
        rows.push({ W, LT, targetK: k, ...a });
      }
    }
  }

  rows.sort((a, b) => {
    if (a.ruptureProxyPct !== b.ruptureProxyPct) return a.ruptureProxyPct - b.ruptureProxyPct;
    return b.roiProxyDailySalesPerUnitInv - a.roiProxyDailySalesPerUnitInv;
  });

  console.log("Top 12 cenários por menor rupturaProxy (disponível < P10 da mira), desempate: maior ROI proxy:");
  rows.slice(0, 12).forEach((r) => {
    console.log(
      `W=${r.W} LT=${r.LT} alvo=${r.targetK}×mira | rupt%=${r.ruptureProxyPct.toFixed(2)} abaixoP100%=${r.belowMiraPct.toFixed(1)} | ` +
        `sales/inv=${r.roiProxyDailySalesPerUnitInv.toFixed(3)} meanPhys=${r.meanPhysical.toFixed(2)} excess>P150=${r.excessOverP150Sum.toFixed(0)}`
    );
  });

  console.log("\n--- Melhor compromisso (menor rupt% com alvo 1.5×mira, W/LT variando) ---");
  const only15 = rows.filter((r) => r.targetK === 1.5);
  only15.sort((a, b) => a.ruptureProxyPct - b.ruptureProxyPct || b.roiProxyDailySalesPerUnitInv - a.roiProxyDailySalesPerUnitInv);
  const best = only15[0];
  if (best) {
    console.log(
      `W=${best.W} LT=${best.LT} | rupt%=${best.ruptureProxyPct.toFixed(2)} | ROI proxy=${best.roiProxyDailySalesPerUnitInv.toFixed(3)} | meanPhys=${best.meanPhysical.toFixed(2)}`
    );
  }

  const baseline = rows.find((r) => r.W === 56 && r.LT === 14 && r.targetK === 1.5);
  if (best && baseline) {
    const dRup = baseline.ruptureProxyPct - best.ruptureProxyPct;
    const dRoi = best.roiProxyDailySalesPerUnitInv - baseline.roiProxyDailySalesPerUnitInv;
    console.log("\nvs. baseline HTML padrão (W=56, LT=14, alvo 1.5):");
    console.log(`  Δ ruptura proxy (pontos %): ${dRup.toFixed(2)}`);
    console.log(`  Δ ROI proxy (vendas médias / unidade em estoque): ${dRoi.toFixed(4)}`);
  }

  console.log("\nNota: 'ROI' aqui é proxy contábil simples (Σ vendas / estoque médio no período); não inclui margem nem capital.");
}

main();

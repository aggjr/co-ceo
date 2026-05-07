/**
 * Compara estoque nível admin (visão TOTAL do CO-CEO) com a soma no legado
 * (ativototalizador: disponível + vitrine por ativo, alinhado ao legacy_live_bridge_server).
 *
 * Uso (na raiz do repo):
 *   node scripts/reconcile_admin_stock_legacy_coceo.js
 *
 * Saídas em reports/:
 *   - admin_stock_reconciliation_<ISO>.csv
 *   - admin_stock_reconciliation_<ISO>.json
 *   - admin_stock_divergences_<ISO>.md
 *
 * Opcional: RECONCILE_TOL=0.5 (tolerância absoluta), RECONCILE_MD_LIMIT=80 (linhas no MD).
 * Detalhe loja a loja + cadastro ADMIN: `node scripts/audit_admin_total_vs_coceo_per_store.js`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require("../coceo_db_config");
const {
  isClosedRetailExcludedFromStockNetwork,
} = require("../lib/closed_retail_stores");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "data", "js");
const CATALOG = path.join(ROOT, "data", "catalog_index.json");
const REPORTS = path.join(ROOT, "reports");

const TOL = Math.max(0, Number(process.env.RECONCILE_TOL) || 0.5);
const MD_LIMIT = Math.max(10, Number(process.env.RECONCILE_MD_LIMIT) || 80);

function classifyUnit(nomeFantasia) {
  const s = String(nomeFantasia || "");
  if (/fábrica|fabrica/i.test(s)) return "FABRICA";
  if (/\bcd\b/i.test(s) || /\bCD\b/.test(s)) return "CD";
  return "LOJA";
}

function lastPhysicalFromBundle(block) {
  if (!block || !Array.isArray(block.timeline) || !block.timeline.length) return NaN;
  const last = block.timeline[block.timeline.length - 1];
  const p = Number(last.physicalStock);
  return Number.isFinite(p) ? p : NaN;
}

function coceoAdminPhysicalFromBundle(data) {
  const results = data && data.results;
  if (!results || typeof results !== "object") return null;

  const totalBlock = results.TOTAL;
  if (totalBlock && totalBlock.metrics && Number.isFinite(Number(totalBlock.metrics.currentPhysical))) {
    const m = totalBlock.metrics;
    return {
      coceo_total_physical: Number(m.currentPhysical),
      coceo_total_available: Number.isFinite(Number(m.currentAvailable)) ? Number(m.currentAvailable) : Number(m.currentPhysical),
      coceo_source: "TOTAL",
    };
  }

  let sumPhys = 0;
  let sumAvail = 0;
  const keys = Object.keys(results);
  for (const k of keys) {
    if (k === "TOTAL") continue;
    const block = results[k];
    const hint = lastPhysicalFromBundle(block);
    if (isClosedRetailExcludedFromStockNetwork(k, hint)) continue;
    const m = block && block.metrics;
    if (!m) continue;
    const p = Number(m.currentPhysical);
    const a = Number(m.currentAvailable);
    if (Number.isFinite(p)) sumPhys += p;
    if (Number.isFinite(a)) sumAvail += a;
  }
  if (!keys.length) return null;
  return {
    coceo_total_physical: sumPhys,
    coceo_total_available: sumAvail,
    coceo_source: "SUM_UNITS",
  };
}

function loadCoceoTotalsByProductId() {
  const byId = new Map();
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  if (!Array.isArray(catalog)) throw new Error("catalog_index.json inválido");

  for (const entry of catalog) {
    const id = Number(entry.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const file = path.join(JS_DIR, entry.file || `sku_${id}.js`);
    if (!fs.existsSync(file)) continue;

    let text = fs.readFileSync(file, "utf8");
    const eq = text.indexOf("=");
    if (eq >= 0) text = text.slice(eq + 1).trim().replace(/;[\s\n]*$/,"");
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn(`Ignorando ${entry.file}: JSON inválido (${e.message})`);
      continue;
    }

    const admin = coceoAdminPhysicalFromBundle(data);
    if (!admin) continue;

    byId.set(id, {
      code: String(entry.code || ""),
      name: String(entry.name || ""),
      coceo_total_physical: admin.coceo_total_physical,
      coceo_total_available: admin.coceo_total_available,
      coceo_source: admin.coceo_source,
    });
  }
  return byId;
}

async function loadLegacyRows(conn) {
  const [rows] = await conn.query(
    `
    SELECT
      p.Id AS product_id,
      p.ErpCodigo AS erp_code,
      p.Descricao AS descricao,
      u.NomeFantasia AS store_name,
      a.Id AS ativo_id,
      CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) AS disponivel,
      CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4)) AS vitrine
    FROM ativo a
    JOIN produto p ON p.Id = a.IdProduto
    JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
    LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
    WHERE COALESCE(a.IndDeletado, b'0') = b'0'
    `
  );
  return rows;
}

function aggregateLegacy(rows) {
  /** @type {Map<number, { lines: object[], sum_disp: number, sum_vit: number, sum_phys: number }>} */
  const byProduct = new Map();

  for (const r of rows) {
    const pid = Number(r.product_id);
    if (!Number.isFinite(pid)) continue;
    const store = String(r.store_name || "");
    const disp = Math.max(0, Number(r.disponivel) || 0);
    const vit = Math.max(0, Number(r.vitrine) || 0);
    const phys = disp + vit;
    if (isClosedRetailExcludedFromStockNetwork(store, phys)) continue;
    const bucket = classifyUnit(store);

    if (!byProduct.has(pid)) {
      byProduct.set(pid, { lines: [], sum_disp: 0, sum_vit: 0, sum_phys: 0 });
    }
    const agg = byProduct.get(pid);
    agg.lines.push({
      store_name: store,
      bucket,
      ativo_id: Number(r.ativo_id),
      disponivel: disp,
      vitrine: vit,
      physical: phys,
    });
    agg.sum_disp += disp;
    agg.sum_vit += vit;
    agg.sum_phys += phys;
  }

  for (const [, agg] of byProduct) {
    agg.lines.sort((a, b) => b.physical - a.physical || String(a.store_name).localeCompare(String(b.store_name)));
  }
  return byProduct;
}

function coherenceNote(diff, tol) {
  const ad = Math.abs(diff);
  if (ad <= tol) return "alinhado (|diff| ≤ tolerância)";
  if (diff > 0) return "CO-CEO acima do somatório legado (ativototalizador)";
  return "CO-CEO abaixo do somatório legado (ativototalizador)";
}

async function main() {
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });

  console.log("Carregando totais CO-CEO (admin: TOTAL ou Σ unidades)…");
  const coceo = loadCoceoTotalsByProductId();
  console.log(`  ${coceo.size} produtos com métricas no data/js.`);

  console.log("Consultando legado (ativos × ativototalizador)…");
  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");
  const rawRows = await loadLegacyRows(conn);
  await conn.end();
  console.log(`  ${rawRows.length} linhas ativo legado.`);

  const legacyAgg = aggregateLegacy(rawRows);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `admin_stock_reconciliation_${stamp}`;

  const rows = [];
  let divergent = 0;
  let aligned = 0;
  const detailDivergences = [];

  for (const [pid, c] of coceo) {
    const leg = legacyAgg.get(pid);
    const legacySum = leg ? leg.sum_phys : 0;
    const diff = c.coceo_total_physical - legacySum;
    const pct = legacySum !== 0 ? (diff / legacySum) * 100 : diff === 0 ? 0 : null;

    const row = {
      product_id: pid,
      erp_code: c.code,
      name: c.name,
      coceo_source: c.coceo_source,
      coceo_total_physical: round4(c.coceo_total_physical),
      legacy_sum_physical: round4(legacySum),
      diff: round4(diff),
      legacy_ativos: leg ? leg.lines.length : 0,
      pct_diff_legacy_base: pct === null ? null : round4(pct),
      note: coherenceNote(diff, TOL),
    };
    rows.push(row);

    if (Math.abs(diff) <= TOL) aligned++;
    else {
      divergent++;
      const byBucket = { LOJA: 0, CD: 0, FABRICA: 0 };
      const lines = leg ? leg.lines : [];
      for (const ln of lines) {
        byBucket[ln.bucket] = (byBucket[ln.bucket] || 0) + ln.physical;
      }
      detailDivergences.push({
        ...row,
        legacy_by_bucket: byBucket,
        legacy_lines: lines,
        internal_sum_check: leg ? round4(lines.reduce((s, x) => s + x.physical, 0)) : 0,
      });
    }
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.product_id - b.product_id);

  const fromTotal = rows.filter((r) => r.coceo_source === "TOTAL").length;
  const fromSum = rows.filter((r) => r.coceo_source === "SUM_UNITS").length;

  const summary = {
    generated_at: new Date().toISOString(),
    tolerance: TOL,
    coceo_products: coceo.size,
    coceo_from_TOTAL_key: fromTotal,
    coceo_from_sum_of_units: fromSum,
    legacy_distinct_products_in_agg: legacyAgg.size,
    aligned_count: aligned,
    divergent_count: divergent,
    note:
      "CO-CEO: quando existe results.TOTAL, usa currentPhysical (soma rede no motor com vitrine=0 na visão admin). " +
      "Sem TOTAL, usa Σ currentPhysical das unidades no bundle (proxy admin). " +
      "Legado: Σ (EstoqueDisponivel + EstoqueVitrine) por ativo (ativototalizador), mesma convenção do bridge. " +
      "Divergências costumam ser ape vs totalizador defasados no ERP.",
  };

  const jsonPath = path.join(REPORTS, `${base}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ summary, rows, divergences: detailDivergences }, null, 2),
    "utf8"
  );

  const csvPath = path.join(REPORTS, `${base}.csv`);
  const csvHeader =
    "product_id,erp_code,name,coceo_source,coceo_total_physical,legacy_sum_physical,diff,pct_diff_legacy_base,legacy_ativos,note\n";
  const csvBody = rows
    .map((r) =>
      [
        r.product_id,
        csvEscape(r.erp_code),
        csvEscape(r.name),
        r.coceo_source,
        r.coceo_total_physical,
        r.legacy_sum_physical,
        r.diff,
        r.pct_diff_legacy_base === null ? "" : r.pct_diff_legacy_base,
        r.legacy_ativos,
        csvEscape(r.note),
      ].join(",")
    )
    .join("\n");
  fs.writeFileSync(csvPath, csvHeader + csvBody, "utf8");

  const mdPath = path.join(REPORTS, `admin_stock_divergences_${stamp}.md`);
  let md = `# Reconciliação estoque admin (TOTAL CO-CEO × legado)\n\n`;
  md += `Gerado: ${summary.generated_at}\n\n`;
  md += `**Tolerância:** ${TOL}\n\n`;
  md += `| Métrica | Valor |\n|---------|-------|\n`;
  md += `| Produtos no CO-CEO (admin) | ${summary.coceo_products} |\n`;
  md += `| … chave TOTAL no bundle | ${summary.coceo_from_TOTAL_key} |\n`;
  md += `| … soma das unidades (sem TOTAL) | ${summary.coceo_from_sum_of_units} |\n`;
  md += `| Alinhados (|diff| ≤ tol) | ${summary.aligned_count} |\n`;
  md += `| Divergentes | ${summary.divergent_count} |\n\n`;
  md += `${summary.note}\n\n`;
  md += `Arquivos: \`${path.basename(jsonPath)}\`, \`${path.basename(csvPath)}\` (pasta \`reports/\`).\n\n`;
  md += `## Amostra de divergências (top ${MD_LIMIT} por |diff|)\n\n`;

  const sample = detailDivergences.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, MD_LIMIT);
  for (const d of sample) {
    md += `### ${d.erp_code} — id ${d.product_id} — ${d.name.slice(0, 70)}\n\n`;
    md += `- **CO-CEO TOTAL físico:** ${d.coceo_total_physical}\n`;
    md += `- **Legado Σ (disp+vitrine):** ${d.legacy_sum_physical} — *soma de ${d.legacy_ativos} ativo(s)*\n`;
    md += `- **Δ (CO-CEO − legado):** ${d.diff}\n`;
    md += `- **Por bucket:** lojas ${round4(d.legacy_by_bucket.LOJA)}, CD ${round4(d.legacy_by_bucket.CD)}, fábrica ${round4(d.legacy_by_bucket.FABRICA)}\n`;
    md += `- **Coerência interna legado:** soma das linhas = ${d.internal_sum_check} (deve coincidir com Σ legado).\n\n`;
    md += `| Loja / unidade | Tipo | Disponível | Vitrine | Físico |\n|----------------|------|------------|---------|--------|\n`;
    for (const ln of d.legacy_lines.slice(0, 35)) {
      md += `| ${mdEscapeCell(ln.store_name)} | ${ln.bucket} | ${ln.disponivel} | ${ln.vitrine} | ${ln.physical} |\n`;
    }
    if (d.legacy_lines.length > 35) md += `| … | … | … | … | *+${d.legacy_lines.length - 35} linhas* |\n`;
    md += `\n**Leitura:** se a soma das linhas bate com o que você espera fisicamente por loja+CD+fábrica, o **totalizador legado** está coerente entre unidades; o **CO-CEO** reflete o motor (snapshots \`ativoposicaoestoque\` no período do engine). Corrigir legado normalmente implica alinhar movimentos/saldos por ativo até \`ativototalizador\` e curvas \`ape\` convergirem.\n\n---\n\n`;
  }

  fs.writeFileSync(mdPath, md, "utf8");

  console.log(`\n✅ Resumo: ${aligned} alinhados, ${divergent} divergentes (tol ${TOL}).`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   CSV:  ${csvPath}`);
  console.log(`   MD:   ${mdPath}`);
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000;
}

function csvEscape(s) {
  const t = String(s ?? "").replace(/"/g, '""');
  if (/[",\n\r]/.test(t)) return `"${t}"`;
  return t;
}

function mdEscapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

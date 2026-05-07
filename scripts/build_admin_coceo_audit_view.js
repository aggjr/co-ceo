/**
 * Constrói o payload da tela "Divergências ADMIN × CO-CEO" a partir do
 * último relatório `reports/admin_coceo_store_audit_*.json` produzido por
 * `scripts/audit_admin_total_vs_coceo_per_store.js`.
 *
 * Saídas (servidas pelo Vite em `/co-ceo-stockspin-static/data/client/...`):
 *   data/client/admin_coceo_audit.json
 *   data/client/admin_coceo_audit.js   (window.ADMIN_COCEO_AUDIT)
 *
 * Cada linha do payload já vem com:
 *   - quantities  (CO-CEO TOTAL, ADMIN comparado, ADMIN cadastro, ADMIN totalizador)
 *   - delta_admin_minus_coceo (ADMIN − CO-CEO)
 *   - motivo (PT-BR, agrupável: "Admin sem reprocessamento", "Diferença de loja", ...)
 *   - motivo_codigo (chave estável para filtros)
 *   - descricao (frase humanizada com pistas para a tratativa)
 *   - max_abs_store_diff, n_stores_with_diff, sum_coceo_minus_legacy_matched, orphan_qty
 *
 * Uso (raiz do repo):
 *   node scripts/build_admin_coceo_audit_view.js
 *   node scripts/build_admin_coceo_audit_view.js --report reports/admin_coceo_store_audit_2026-05-07T00-54-22.json
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const OUT_DIR = path.join(ROOT, "data", "client");
const OUT_JSON = path.join(OUT_DIR, "admin_coceo_audit.json");
const OUT_JS = path.join(OUT_DIR, "admin_coceo_audit.js");

const REPORT_PATTERN = /^admin_coceo_store_audit_.*\.json$/;

function pickReportFromArgv() {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--report=")) return a.slice("--report=".length);
    if (a === "--report") {
      const idx = process.argv.indexOf(a);
      const next = process.argv[idx + 1];
      if (next) return next;
    }
  }
  return null;
}

function findLatestReport() {
  if (!fs.existsSync(REPORTS_DIR)) {
    throw new Error(`Pasta de relatórios não encontrada: ${REPORTS_DIR}`);
  }
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => REPORT_PATTERN.test(f))
    .map((f) => ({ f, st: fs.statSync(path.join(REPORTS_DIR, f)) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  if (!files.length) {
    throw new Error(
      "Nenhum admin_coceo_store_audit_*.json em reports/. " +
        "Rode antes: node scripts/audit_admin_total_vs_coceo_per_store.js"
    );
  }
  return path.join(REPORTS_DIR, files[0].f);
}

function round4(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function fmtBR(n, frac = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: frac });
}

/**
 * Mapeia a classification heurística do auditor para um motivo PT-BR estável,
 * mais um descritor humano com pistas para a tratativa em lote.
 *
 * Motivos:
 *   ADMIN_STALE       → "Admin sem reprocessamento"
 *   STORE_LEVEL       → "Diferença de loja"
 *   ORPHAN_LEGACY     → "Estoque legado órfão"
 *   MIXED:A+B[+C]     → "Misto: <A> + <B>"
 *   ALIGNED           → "Alinhado"
 */
function motivoFromClassification(c) {
  const cls = String(c || "").trim();
  if (!cls) return { codigo: "DESCONHECIDO", motivo: "Desconhecido" };
  if (cls === "ALIGNED") return { codigo: "ALINHADO", motivo: "Alinhado" };
  if (cls === "ADMIN_STALE") {
    return { codigo: "ADMIN_STALE", motivo: "Admin sem reprocessamento" };
  }
  if (cls === "STORE_LEVEL") {
    return { codigo: "STORE_LEVEL", motivo: "Diferença de loja" };
  }
  if (cls === "ORPHAN_LEGACY") {
    return { codigo: "ORPHAN_LEGACY", motivo: "Estoque legado órfão" };
  }
  if (cls.startsWith("MIXED:")) {
    const parts = cls
      .slice("MIXED:".length)
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean);
    const labelMap = {
      ADMIN_STALE: "Admin sem reprocessamento",
      STORE_LEVEL: "Diferença de loja",
      ORPHAN_LEGACY: "Estoque legado órfão",
    };
    const labels = parts.map((p) => labelMap[p] || p);
    return {
      codigo: "MIXED:" + parts.join("+"),
      motivo: "Misto: " + labels.join(" + "),
    };
  }
  return { codigo: cls, motivo: cls };
}

/**
 * Frase curta humanizada com pistas para a tratativa.
 * Mantém PT-BR e usa as quantidades já existentes no payload do auditor.
 */
function buildDescricao(p) {
  const partes = [];
  const dAdmin = Number(p.delta_admin_minus_coceo);
  if (Number.isFinite(dAdmin) && Math.abs(dAdmin) > 0.01) {
    const sinal = dAdmin > 0 ? "+" : "";
    partes.push(`Δ admin−CO-CEO = ${sinal}${fmtBR(dAdmin)}`);
  }
  const sumDiff = Number(p.sum_coceo_stores_minus_legacy_matched);
  const nBad = Number(p.n_stores_with_diff) || 0;
  const maxAbs = Number(p.max_abs_store_diff) || 0;
  if (nBad > 0 || Math.abs(sumDiff) > 0.01) {
    partes.push(
      `lojas off=${nBad}, max |Δ loja|=${fmtBR(maxAbs)}, Σ(CO-CEO−legado)=${fmtBR(sumDiff)}`
    );
  }
  const orphanQ = Array.isArray(p.orphans)
    ? p.orphans.reduce((s, o) => s + (Number(o.q) || 0), 0)
    : 0;
  if (orphanQ > 0.01) {
    const lojas = (p.orphans || [])
      .filter((o) => Number(o.q) > 0)
      .map((o) => `${o.loja} (${fmtBR(o.q, 0)})`)
      .slice(0, 4)
      .join(", ");
    partes.push(`legado órfão = ${fmtBR(orphanQ)}${lojas ? " — " + lojas : ""}`);
  }
  if (p.classification === "ADMIN_STALE") {
    partes.push(
      "lojas casadas batem; o totalizador do admin (produtototalizador) está descalibrado vs o motor — pedir reprocessamento do produto"
    );
  } else if (p.classification === "STORE_LEVEL") {
    partes.push(
      "divergência por unidade — auditar movimentos / ativototalizador na(s) loja(s) listada(s) no detalhe"
    );
  } else if (p.classification === "ORPHAN_LEGACY") {
    partes.push(
      "estoque vivo no legado em unidade não casada com o bundle (ex.: Web ou loja fechada não excluída)"
    );
  }
  return partes.join(" · ");
}

function summarize(report) {
  const products = Array.isArray(report.products) ? report.products : [];
  /** Agrega por motivo (KPIs no topo da tela). */
  const groupAgg = new Map();
  /** Cada linha da planilha. */
  const rows = products.map((p) => {
    const { codigo, motivo } = motivoFromClassification(p.classification);
    const orphanQ = Array.isArray(p.orphans)
      ? p.orphans.reduce((s, o) => s + (Number(o.q) || 0), 0)
      : 0;
    const row = {
      product_id: p.product_id,
      erp_code: String(p.erp_code || ""),
      name: String(p.name || ""),
      classification: p.classification || "",
      motivo_codigo: codigo,
      motivo,
      coceo_total: round4(p.coceo_total_physical),
      coceo_source: String(p.coceo_source || ""),
      admin_compared: round4(p.admin_compared_phys),
      admin_compared_source: String(p.admin_compared_source || ""),
      admin_produtototalizador:
        p.admin_produtototalizador_phys == null
          ? null
          : round4(p.admin_produtototalizador_phys),
      admin_produto_cadastro: round4(p.admin_produto_cadastro_phys),
      data_totalizador: p.data_totalizador || null,
      delta_admin_minus_coceo: round4(p.delta_admin_minus_coceo),
      delta_abs: Math.abs(round4(p.delta_admin_minus_coceo) || 0),
      sum_coceo_stores: round4(p.sum_coceo_stores),
      sum_legacy_matched: round4(p.sum_legacy_matched_stores),
      sum_coceo_stores_minus_legacy_matched: round4(p.sum_coceo_stores_minus_legacy_matched),
      max_abs_store_diff: round4(p.max_abs_store_diff),
      n_stores_with_diff: Number(p.n_stores_with_diff) || 0,
      orphan_qty: round4(orphanQ),
      descricao: buildDescricao(p),
    };

    const agg = groupAgg.get(codigo) || {
      motivo_codigo: codigo,
      motivo,
      n: 0,
      sum_abs_delta: 0,
      sum_orphan: 0,
      sum_max_store_diff: 0,
    };
    agg.n += 1;
    agg.sum_abs_delta += row.delta_abs || 0;
    agg.sum_orphan += row.orphan_qty || 0;
    agg.sum_max_store_diff += row.max_abs_store_diff || 0;
    groupAgg.set(codigo, agg);

    return row;
  });

  rows.sort((a, b) => (b.delta_abs || 0) - (a.delta_abs || 0));

  const groups = [...groupAgg.values()].sort((a, b) => b.sum_abs_delta - a.sum_abs_delta);

  return { rows, groups };
}

function main() {
  const explicit = pickReportFromArgv();
  const reportPath = explicit ? path.resolve(explicit) : findLatestReport();
  if (!fs.existsSync(reportPath)) {
    throw new Error("Relatório não encontrado: " + reportPath);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const { rows, groups } = summarize(report);

  const out = {
    meta: {
      generated_at: new Date().toISOString(),
      source_report: path.relative(ROOT, reportPath),
      source_generated_at: report.generated_at || null,
      tolerance_admin: report.tolerance_admin,
      tolerance_store: report.tolerance_store,
      catalog_entries: report.catalog_entries,
      processed_with_coceo_total: report.processed_with_coceo_total,
      divergent_or_reported_count: report.divergent_or_reported_count,
      note:
        "Linhas geradas a partir do auditor admin × CO-CEO. " +
        "ADMIN comparado = produtototalizador (último Id, EstoqueDisponivel + EstoqueVitrine) " +
        "se houver; senão produto.EstoqueTotal + Vitrine. " +
        "CO-CEO TOTAL = results.TOTAL.metrics.currentPhysical (ou Σ lojas).",
      motivo_codes: [
        { codigo: "ADMIN_STALE", label: "Admin sem reprocessamento" },
        { codigo: "STORE_LEVEL", label: "Diferença de loja" },
        { codigo: "ORPHAN_LEGACY", label: "Estoque legado órfão" },
        { codigo: "MIXED:*", label: "Misto: combinação dos motivos acima" },
        { codigo: "ALINHADO", label: "Alinhado (sem divergência relevante)" },
      ],
    },
    groups,
    rows,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  fs.writeFileSync(
    OUT_JS,
    "window.ADMIN_COCEO_AUDIT = " + JSON.stringify(out) + ";\n",
    "utf8"
  );

  console.log("OK: gerados");
  console.log(" •", path.relative(ROOT, OUT_JSON));
  console.log(" •", path.relative(ROOT, OUT_JS));
  console.log(" • linhas:", rows.length);
  console.log(" • grupos (motivo):");
  for (const g of groups) {
    console.log(
      `    - ${g.motivo_codigo.padEnd(20)} ${String(g.n).padStart(5)} produtos · |Δ| total ${fmtBR(g.sum_abs_delta, 0)}`
    );
  }
  console.log(" • origem:", path.relative(ROOT, reportPath));
}

main();

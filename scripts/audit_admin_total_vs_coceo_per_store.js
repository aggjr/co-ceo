/**
 * Auditoria em massa: estoque ADMIN ao nível produto × TOTAL CO-CEO
 * e, para divergências, tabela loja a loja (CO-CEO × legado ativototalizador), como no dashboard.
 *
 * **ADMIN (comparado ao CO-CEO):** `produtototalizador` (EstoqueDisponivel+EstoqueVitrine, último Id por produto),
 * o mesmo agregado que o painel mostra após “reprocessamento dos totalizadores”. Se não houver linha em
 * `produtototalizador`, cai no fallback `produto.EstoqueTotal+produto.Vitrine` (cadastro cru).
 * Ambos são exportados em JSON/CSV para auditar divergência cadastro vs totalizador.
 *
 * Classificação heurística:
 *   ADMIN_STALE — lojas casadas batem (Σ diff loja ≈ 0) mas ADMIN (totalizador) ≠ TOTAL CO-CEO
 *   STORE_LEVEL — há diferença em pelo menos uma unidade do bundle vs legado
 *   ORPHAN_LEGACY — estoque legado em unidade não mapeada ao bundle (ex. Web) ou fechada fora do bundle
 *   MIXED — mais de um dos acima
 *
 * Uso (raiz do repo, requer .env LEGACY_MYSQL_* e data/js/sku_*.js):
 *   node scripts/audit_admin_total_vs_coceo_per_store.js
 *
 * Variáveis de ambiente:
 *   AUDIT_TOL_ADMIN=0.01     — tolerância |admin (produtototalizador*) − coceo_TOTAL|
 *   AUDIT_TOL_STORE=0.01     — tolerância por loja (diff)
 *   AUDIT_MAX_PRODUCTS=0     — se >0, só processa os N primeiros do catálogo (teste)
 *   AUDIT_MD_DETAIL_LIMIT=120 — máximo de produtos com tabela completa no .md
 *   AUDIT_ONLY_DIVERGENT=1   — só inclui produtos com |delta admin| > tol ou |Σlojas| > tol (default 1)
 *
 * Saídas em reports/:
 *   admin_coceo_store_audit_<stamp>.json
 *   admin_coceo_store_audit_<stamp>.csv
 *   admin_coceo_store_audit_<stamp>.md
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require("../coceo_db_config");
const {
  isClosedRetailStore,
  isClosedRetailExcludedFromStockNetwork,
} = require("../lib/closed_retail_stores");
const { legacyStoreNamesToTry } = require("../lib/store_key_aliases");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "data", "js");
const CATALOG = path.join(ROOT, "data", "catalog_index.json");
const REPORTS = path.join(ROOT, "reports");

const TOL_ADMIN = Math.max(0, Number(process.env.AUDIT_TOL_ADMIN) || 0.01);
const TOL_STORE = Math.max(0, Number(process.env.AUDIT_TOL_STORE) || 0.01);
const MAX_PRODUCTS = Math.max(0, Number(process.env.AUDIT_MAX_PRODUCTS) || 0);
const MD_DETAIL_LIMIT = Math.max(5, Number(process.env.AUDIT_MD_DETAIL_LIMIT) || 120);
const ONLY_DIVERGENT = !/^0|false|no$/i.test(String(process.env.AUDIT_ONLY_DIVERGENT ?? "1"));

const CHUNK = 350;

function normalizeName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseBundleJs(text) {
  const eq = text.indexOf("=");
  let body = eq >= 0 ? text.slice(eq + 1).trim() : text.trim();
  body = body.replace(/;[\s\n]*$/, "");
  return JSON.parse(body);
}

function lastPhysicalFromBundle(block) {
  if (!block || !Array.isArray(block.timeline) || !block.timeline.length) return NaN;
  const last = block.timeline[block.timeline.length - 1];
  const p = Number(last.physicalStock);
  return Number.isFinite(p) ? p : NaN;
}

function coceoTotalPhysical(bundle) {
  const results = bundle && bundle.results;
  if (!results || typeof results !== "object") return { total: NaN, source: "none" };
  const totalBlock = results.TOTAL;
  if (totalBlock && totalBlock.metrics && Number.isFinite(Number(totalBlock.metrics.currentPhysical))) {
    return { total: Number(totalBlock.metrics.currentPhysical), source: "TOTAL" };
  }
  let sum = 0;
  let n = 0;
  for (const k of Object.keys(results)) {
    if (k === "TOTAL") continue;
    const hint = lastPhysicalFromBundle(results[k]);
    if (isClosedRetailExcludedFromStockNetwork(k, hint)) continue;
    const p = lastPhysicalFromBundle(results[k]);
    if (Number.isFinite(p)) {
      sum += p;
      n++;
    }
  }
  return n ? { total: sum, source: "SUM_UNITS" } : { total: NaN, source: "none" };
}

function legacyQtyForBundleKey(bundleKey, legacyByNameNorm) {
  const names = legacyStoreNamesToTry(bundleKey);
  const tryNames = names.length ? names : [bundleKey];
  let sum = 0;
  const matched = [];
  for (const nm of tryNames) {
    const key = normalizeName(nm);
    const row = legacyByNameNorm.get(key);
    if (row) {
      sum += row.sum;
      matched.push(row.originalName);
    }
  }
  return { sum, matched };
}

function buildLegacyByNorm(legacyFlat) {
  const legacyByNorm = new Map();
  for (const r of legacyFlat) {
    const prev = legacyByNorm.get(r.norm) || { sum: 0, originalName: r.originalName };
    prev.sum += r.phys;
    prev.originalName = r.originalName;
    legacyByNorm.set(r.norm, prev);
  }
  return legacyByNorm;
}

function bundleStoreKeys(results) {
  return Object.keys(results || {}).filter(
    (k) =>
      k !== "TOTAL" &&
      !isClosedRetailExcludedFromStockNetwork(k, lastPhysicalFromBundle(results[k]))
  );
}

function legacyRowMatchesAnyBundle(legacyNorm, keys) {
  for (const bk of keys) {
    const tries = legacyStoreNamesToTry(bk);
    const names = tries.length ? tries : [bk];
    for (const t of names) {
      if (normalizeName(t) === legacyNorm) return true;
    }
    if (normalizeName(bk) === legacyNorm) return true;
  }
  return false;
}

function collectOrphans(legacyFlat, keys) {
  const out = [];
  for (const r of legacyFlat) {
    if (isClosedRetailStore(r.originalName)) {
      if (r.phys <= 0) continue;
      if (legacyRowMatchesAnyBundle(r.norm, keys)) continue;
      out.push({
        loja: r.originalName,
        q: r.phys,
        nota: "fechada com estoque — não casada no bundle",
      });
      continue;
    }
    if (!legacyRowMatchesAnyBundle(r.norm, keys)) {
      out.push({ loja: r.originalName, q: r.phys, nota: "sem chave correspondente no bundle" });
    }
  }
  return out;
}

function classifyAnalysis(a) {
  const flags = [];
  const adminOff =
    Number.isFinite(a.delta_admin_minus_coceo) && Math.abs(a.delta_admin_minus_coceo) > TOL_ADMIN;
  const storeOff =
    Math.abs(a.sum_coceo_stores_minus_legacy_matched) > TOL_STORE ||
    a.max_abs_store_diff > TOL_STORE ||
    a.n_stores_with_diff > 0;
  const orphanQ = (a.orphans || []).reduce((s, o) => s + (Number(o.q) || 0), 0);
  const orphanIssue = orphanQ > TOL_STORE;

  if (adminOff && !storeOff && !orphanIssue) flags.push("ADMIN_STALE");
  if (storeOff) flags.push("STORE_LEVEL");
  if (orphanIssue) flags.push("ORPHAN_LEGACY");
  if (!flags.length) return "ALIGNED";
  if (flags.length === 1) return flags[0];
  return `MIXED:${flags.join("+")}`;
}

/**
 * @param {{ produto_cadastro: number, pt_phys: number | null, data_totalizador: * }} adminInfo
 */
function analyzeProduct(productId, erpCode, name, bundle, legacyFlat, adminInfo) {
  const results = bundle.results || {};
  const { total: coceoTotal, source: coceoSource } = coceoTotalPhysical(bundle);
  const keys = bundleStoreKeys(results);
  const legacyByNorm = buildLegacyByNorm(legacyFlat);

  const storeRows = [];
  for (const bundleKey of keys) {
    const coceo = lastPhysicalFromBundle(results[bundleKey]);
    const { sum: legacy, matched } = legacyQtyForBundleKey(bundleKey, legacyByNorm);
    const diff = Number.isFinite(coceo) && Number.isFinite(legacy) ? coceo - legacy : NaN;
    storeRows.push({
      unidade_coceo: bundleKey,
      nome_legado: matched.length ? matched.join(" + ") : "(sem match)",
      coceo: coceo,
      legado: legacy,
      diff,
    });
  }

  const sumCoceoStores = storeRows.reduce(
    (s, r) => s + (Number.isFinite(r.coceo) ? r.coceo : 0),
    0
  );
  const sumLegacyMatched = storeRows.reduce(
    (s, r) => s + (Number.isFinite(r.legado) ? r.legado : 0),
    0
  );

  let maxAbs = 0;
  let nBad = 0;
  for (const r of storeRows) {
    if (!Number.isFinite(r.diff)) continue;
    const ad = Math.abs(r.diff);
    if (ad > TOL_STORE) {
      nBad++;
      if (ad > maxAbs) maxAbs = ad;
    }
  }

  const orphans = collectOrphans(legacyFlat, keys);
  const sumLegNetwork = legacyFlat
    .filter((x) => !isClosedRetailExcludedFromStockNetwork(x.originalName, x.phys))
    .reduce((s, x) => s + x.phys, 0);

  const cad = Number(adminInfo && adminInfo.produto_cadastro);
  const cadN = Number.isFinite(cad) ? cad : NaN;
  const ptRaw = adminInfo && adminInfo.pt_phys;
  const hasPt = ptRaw != null && ptRaw !== "" && Number.isFinite(Number(ptRaw));
  const ptN = hasPt ? Number(ptRaw) : NaN;
  /** Mesmo conceito do painel “reprocessado”: totalizador por produto, senão cadastro. */
  const adminN = hasPt ? ptN : cadN;
  const deltaAdminMinusCoceo =
    Number.isFinite(adminN) && Number.isFinite(coceoTotal) ? adminN - coceoTotal : NaN;
  const sumCoceoMinusLegacyMatched = sumCoceoStores - sumLegacyMatched;

  const classification = classifyAnalysis({
    delta_admin_minus_coceo: deltaAdminMinusCoceo,
    sum_coceo_stores_minus_legacy_matched: sumCoceoMinusLegacyMatched,
    max_abs_store_diff: maxAbs,
    n_stores_with_diff: nBad,
    orphans,
  });

  return {
    product_id: productId,
    erp_code: erpCode,
    name,
    coceo_total_physical: coceoTotal,
    coceo_source: coceoSource,
    admin_compared_phys: adminN,
    admin_produtototalizador_phys: hasPt ? ptN : null,
    admin_produto_cadastro_phys: cadN,
    admin_compared_source: hasPt ? "produtototalizador" : "produto.EstoqueTotal+Vitrine",
    data_totalizador: (adminInfo && adminInfo.data_totalizador) || null,
    delta_admin_minus_coceo: deltaAdminMinusCoceo,
    sum_coceo_stores: sumCoceoStores,
    sum_legacy_matched_stores: sumLegacyMatched,
    sum_coceo_stores_minus_legacy_matched: sumCoceoMinusLegacyMatched,
    sum_legacy_network_all_included: sumLegNetwork,
    max_abs_store_diff: maxAbs,
    n_stores_with_diff: nBad,
    classification,
    store_rows: storeRows,
    orphans,
  };
}

function loadCatalogEntries() {
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  if (!Array.isArray(cat)) throw new Error("catalog_index.json inválido");
  const out = [];
  for (const e of cat) {
    const id = Number(e.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    out.push({
      id,
      code: String(e.code || ""),
      name: String(e.name || ""),
      file: String(e.file || `sku_${id}.js`),
    });
  }
  return out;
}

async function loadAdminRows(conn, productIds) {
  const map = new Map();
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(
      `
      SELECT
        p.Id AS product_id,
        CAST(COALESCE(p.EstoqueTotal, 0) + COALESCE(p.Vitrine, 0) AS DECIMAL(18, 4)) AS adm_produto_cadastro,
        CAST(
          COALESCE(pt.EstoqueDisponivel, 0) + COALESCE(pt.EstoqueVitrine, 0) AS DECIMAL(18, 4)
        ) AS adm_produtototalizador,
        p.DataTotalizador AS data_totalizador
      FROM produto p
      LEFT JOIN (
        SELECT
          pt1.IdProduto AS pid,
          CAST(COALESCE(pt1.EstoqueDisponivel, 0) AS DECIMAL(18, 4)) AS EstoqueDisponivel,
          CAST(COALESCE(pt1.EstoqueVitrine, 0) AS DECIMAL(18, 4)) AS EstoqueVitrine
        FROM produtototalizador pt1
        INNER JOIN (
          SELECT IdProduto, MAX(Id) AS max_id
          FROM produtototalizador
          WHERE COALESCE(IndDeletado, b'0') = b'0'
          GROUP BY IdProduto
        ) x ON x.max_id = pt1.Id
      ) pt ON pt.pid = p.Id
      WHERE p.Id IN (${ph})
      `,
      chunk
    );
    for (const r of rows) {
      const pid = Number(r.product_id);
      const cad = Number(r.adm_produto_cadastro);
      const ptVal = r.adm_produtototalizador;
      map.set(pid, {
        produto_cadastro: Number.isFinite(cad) ? cad : NaN,
        pt_phys: ptVal == null ? null : Number(ptVal),
        data_totalizador: r.data_totalizador,
      });
    }
  }
  return map;
}

async function loadLegacyFlatForProducts(conn, productIds) {
  /** @type {Map<number, Array<{originalName: string, norm: string, phys: number}>>} */
  const byPid = new Map();
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(
      `
      SELECT
        a.IdProduto AS product_id,
        u.NomeFantasia AS store_name,
        CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) AS disponivel,
        CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4)) AS vitrine
      FROM ativo a
      JOIN produto p ON p.Id = a.IdProduto
      JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
      LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
      WHERE COALESCE(a.IndDeletado, b'0') = b'0'
        AND a.IdProduto IN (${ph})
      `,
      chunk
    );
    for (const r of rows) {
      const pid = Number(r.product_id);
      const st = String(r.store_name || "");
      const phys =
        Math.max(0, Number(r.disponivel) || 0) + Math.max(0, Number(r.vitrine) || 0);
      if (!byPid.has(pid)) byPid.set(pid, []);
      byPid.get(pid).push({ originalName: st, norm: normalizeName(st), phys });
    }
  }
  return byPid;
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

async function main() {
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });

  const entries = loadCatalogEntries();
  const slice = MAX_PRODUCTS > 0 ? entries.slice(0, MAX_PRODUCTS) : entries;
  const productIds = slice.map((e) => e.id);

  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");
  const [adminMap, legacyByPid] = await Promise.all([
    loadAdminRows(conn, productIds),
    loadLegacyFlatForProducts(conn, productIds),
  ]);
  await conn.end();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `admin_coceo_store_audit_${stamp}`;

  const summaries = [];
  let processed = 0;
  let skippedNoBundle = 0;

  for (const e of slice) {
    const file = path.join(JS_DIR, e.file);
    if (!fs.existsSync(file)) {
      skippedNoBundle++;
      continue;
    }
    let bundle;
    try {
      bundle = parseBundleJs(fs.readFileSync(file, "utf8"));
    } catch (err) {
      skippedNoBundle++;
      continue;
    }
    const { total: coceoT } = coceoTotalPhysical(bundle);
    if (!Number.isFinite(coceoT)) {
      skippedNoBundle++;
      continue;
    }

    const adm = adminMap.get(e.id) || {
      produto_cadastro: NaN,
      pt_phys: null,
      data_totalizador: null,
    };
    const legacyFlat = legacyByPid.get(e.id) || [];

    const analysis = analyzeProduct(e.id, e.code, e.name, bundle, legacyFlat, adm);
    processed++;

    const adminDiv = Number.isFinite(analysis.delta_admin_minus_coceo)
      ? Math.abs(analysis.delta_admin_minus_coceo) > TOL_ADMIN
      : false;
    const storeDiv =
      Math.abs(analysis.sum_coceo_stores_minus_legacy_matched) > TOL_STORE ||
      analysis.max_abs_store_diff > TOL_STORE;
    const orphanSum = (analysis.orphans || []).reduce((s, o) => s + (Number(o.q) || 0), 0);
    const orphanDiv = orphanSum > TOL_STORE;

    if (ONLY_DIVERGENT && !adminDiv && !storeDiv && !orphanDiv) continue;

    summaries.push(analysis);
  }

  summaries.sort(
    (a, b) =>
      Math.abs(b.delta_admin_minus_coceo || 0) - Math.abs(a.delta_admin_minus_coceo || 0) ||
      Math.abs(b.max_abs_store_diff || 0) - Math.abs(a.max_abs_store_diff || 0) ||
      a.product_id - b.product_id
  );

  const outJson = {
    generated_at: new Date().toISOString(),
    tolerance_admin: TOL_ADMIN,
    tolerance_store: TOL_STORE,
    catalog_entries: slice.length,
    processed_with_coceo_total: processed,
    skipped_missing_or_invalid_bundle: skippedNoBundle,
    divergent_or_reported_count: summaries.length,
    note:
      "admin_compared_phys = produtototalizador (disp+vitrine, MAX(Id)) quando existe; senão produto.EstoqueTotal+Vitrine. " +
      "coceo_total_physical = results.TOTAL.metrics.currentPhysical (ou Σ lojas). " +
      "Loja a loja: último physicalStock da timeline CO-CEO vs Σ ativototalizador (disp+vitrine) no legado por NomeFantasia (sinónimos G2↔Goitacazes; Carijós com estoque incluída na rede).",
    products: summaries,
  };

  fs.writeFileSync(path.join(REPORTS, `${base}.json`), JSON.stringify(outJson, null, 2), "utf8");

  const csvHeader =
    "product_id,erp_code,classification,coceo_total,admin_compared,admin_produtototalizador,admin_produto_cadastro,admin_source,delta_admin_minus_coceo," +
    "sum_coceo_stores,sum_legacy_matched,sum_coceo_minus_legacy_matched,max_abs_store_diff,n_stores_with_diff," +
    "orphan_legacy_qty_sum,coceo_source\n";
  const csvBody = summaries
    .map((a) =>
      [
        a.product_id,
        csvEscape(a.erp_code),
        csvEscape(a.classification),
        round4(a.coceo_total_physical),
        round4(a.admin_compared_phys),
        a.admin_produtototalizador_phys == null ? "" : round4(a.admin_produtototalizador_phys),
        round4(a.admin_produto_cadastro_phys),
        csvEscape(a.admin_compared_source),
        round4(a.delta_admin_minus_coceo),
        round4(a.sum_coceo_stores),
        round4(a.sum_legacy_matched_stores),
        round4(a.sum_coceo_stores_minus_legacy_matched),
        round4(a.max_abs_store_diff),
        a.n_stores_with_diff,
        round4(
          (a.orphans || []).reduce((s, o) => s + (Number(o.q) || 0), 0)
        ),
        csvEscape(a.coceo_source),
      ].join(",")
    )
    .join("\n");
  fs.writeFileSync(path.join(REPORTS, `${base}.csv`), csvHeader + csvBody, "utf8");

  let md = `# Auditoria ADMIN × CO-CEO (com detalhe por loja)\n\n`;
  md += `Gerado: ${outJson.generated_at}\n\n`;
  md += `| Parâmetro | Valor |\n|-----------|-------|\n`;
  md += `| Entradas no catálogo | ${slice.length} |\n`;
  md += `| Com TOTAL CO-CEO válido | ${processed} |\n`;
  md += `| Relatados (divergentes / com órfãos) | ${summaries.length} |\n`;
  md += `| Tol. admin | ${TOL_ADMIN} |\n`;
  md += `| Tol. loja | ${TOL_STORE} |\n\n`;
  md += `${outJson.note}\n\n`;
  md += `Arquivos: \`${base}.json\`, \`${base}.csv\`.\n\n`;
  md += `## Resumo (todos os listados)\n\n`;
  md += `| id | código | classificação | CO-CEO TOTAL | ADMIN (comparado) | fonte | cadastro produto | Δ admin−CO-CEO | max |diff| loja | #lojas off | órfão |\n`;
  md += `|----|--------|---------------|-------------:|------------------:|-------|-----------------:|----------------:|---------------:|-----------:|------:|\n`;
  for (const a of summaries) {
    const oq = (a.orphans || []).reduce((s, x) => s + (Number(x.q) || 0), 0);
    md += `| ${a.product_id} | ${mdEscapeCell(a.erp_code)} | ${mdEscapeCell(a.classification)} | ${round4(a.coceo_total_physical)} | ${round4(a.admin_compared_phys)} | ${mdEscapeCell(a.admin_compared_source)} | ${round4(a.admin_produto_cadastro_phys)} | ${round4(a.delta_admin_minus_coceo)} | ${round4(a.max_abs_store_diff)} | ${a.n_stores_with_diff} | ${round4(oq)} |\n`;
  }

  md += `\n## Detalhe por loja (até ${MD_DETAIL_LIMIT} produtos)\n\n`;
  const detail = summaries.slice(0, MD_DETAIL_LIMIT);
  for (const a of detail) {
    md += `### ${mdEscapeCell(a.erp_code)} — id ${a.product_id}\n\n`;
    md += `**${mdEscapeCell(a.name.slice(0, 120))}**\n\n`;
    md += `- Classificação: **${a.classification}**\n`;
    md += `- CO-CEO TOTAL: ${round4(a.coceo_total_physical)} (${a.coceo_source})\n`;
    md += `- ADMIN comparado: **${round4(a.admin_compared_phys)}** (${a.admin_compared_source})`;
    if (a.admin_produtototalizador_phys != null) {
      md += ` — produtototalizador: ${round4(a.admin_produtototalizador_phys)}`;
    }
    md += ` — cadastro \`produto\` (EstoqueTotal+Vitrine): ${round4(a.admin_produto_cadastro_phys)}\n`;
    md += `- DataTotalizador: ${a.data_totalizador || "—"}\n`;
    md += `- Δ (admin comparado − CO-CEO): ${round4(a.delta_admin_minus_coceo)}\n`;
    md += `- Σ lojas CO-CEO / Σ legado casado: ${round4(a.sum_coceo_stores)} / ${round4(a.sum_legacy_matched_stores)} → Δ ${round4(a.sum_coceo_stores_minus_legacy_matched)}\n`;
    md += `- Σ legado rede (incl. fechada c/ estoque): ${round4(a.sum_legacy_network_all_included)}\n\n`;
    md += `| Unidade CO-CEO | Nome no legado | CO-CEO | Legado | Diff |\n`;
    md += `|----------------|----------------|-------:|-------:|-----:|\n`;
    for (const r of a.store_rows) {
      md += `| ${mdEscapeCell(r.unidade_coceo)} | ${mdEscapeCell(r.nome_legado)} | ${Number.isFinite(r.coceo) ? round4(r.coceo) : "—"} | ${Number.isFinite(r.legado) ? round4(r.legado) : "—"} | ${Number.isFinite(r.diff) ? round4(r.diff) : "—"} |\n`;
    }
    if (a.orphans && a.orphans.length) {
      md += `\n**Legado não agregado ao bundle:**\n\n`;
      md += `| Loja | Qtd | Nota |\n|------|----:|------|\n`;
      for (const o of a.orphans) {
        md += `| ${mdEscapeCell(o.loja)} | ${round4(o.q)} | ${mdEscapeCell(o.nota)} |\n`;
      }
    }
    md += `\n**Leitura:** se todas as linhas têm Diff ≈ 0 mas Δ admin−CO-CEO ≠ 0 com fonte **produtototalizador**, investigar totalizador vs motor; se só o **cadastro produto** diverge do totalizador/CO-CEO, o campo \`EstoqueTotal\` pode estar defasado face ao reprocessamento. Diff por loja → movimentos/ativototalizador na unidade.\n\n---\n\n`;
  }

  if (summaries.length > MD_DETAIL_LIMIT) {
    md += `\n*…${summaries.length - MD_DETAIL_LIMIT} produto(s) adicionais só no JSON/CSV.*\n`;
  }

  fs.writeFileSync(path.join(REPORTS, `${base}.md`), md, "utf8");

  console.log(
    `Pronto: ${summaries.length} produto(s) no relatório (processados com bundle: ${processed}, ignorados: ${skippedNoBundle}).`
  );
  console.log(`  ${path.join(REPORTS, `${base}.json`)}`);
  console.log(`  ${path.join(REPORTS, `${base}.csv`)}`);
  console.log(`  ${path.join(REPORTS, `${base}.md`)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

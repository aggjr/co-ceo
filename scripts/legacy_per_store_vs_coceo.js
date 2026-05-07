/**
 * Por produto: compara estoque físico CO-CEO (último dia da timeline) × legado
 * (Σ ativototalizador disp+vitrine por NomeFantasia), para achar em qual loja/CD diverge.
 *
 * Uso na raiz do repo:
 *   node scripts/legacy_per_store_vs_coceo.js --code=10163
 *   node scripts/legacy_per_store_vs_coceo.js --id=49
 *
 * Requer .env LEGACY_MYSQL_* e data/js/sku_<id>.js gerado pelo Apollo.
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

function parseArgs() {
  const out = { id: null, code: null };
  for (const a of process.argv.slice(2)) {
    const m = /^--id=(\d+)$/.exec(a);
    if (m) out.id = Number(m[1]);
    const c = /^--code=(.+)$/.exec(a);
    if (c) out.code = String(c[1]).trim();
  }
  return out;
}

function normalizeName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveProductIdFromCatalog(code) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const row = cat.find((e) => String(e.code || "").trim() === String(code).trim());
  return row ? Number(row.id) : null;
}

function loadBundle(productId) {
  const file = path.join(JS_DIR, `sku_${productId}.js`);
  if (!fs.existsSync(file)) throw new Error(`Bundle não encontrado: ${file}`);
  let text = fs.readFileSync(file, "utf8");
  const eq = text.indexOf("=");
  if (eq >= 0) text = text.slice(eq + 1).trim().replace(/;[\s\n]*$/, "");
  return JSON.parse(text);
}

function lastPhysicalFromBundle(block) {
  if (!block || !Array.isArray(block.timeline) || !block.timeline.length) return NaN;
  const last = block.timeline[block.timeline.length - 1];
  const p = Number(last.physicalStock);
  return Number.isFinite(p) ? p : NaN;
}

async function legacyRowsFlat(conn, productId) {
  const [rows] = await conn.query(
    `
    SELECT
      u.NomeFantasia AS store_name,
      a.Id AS ativo_id,
      CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) AS disponivel,
      CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4)) AS vitrine
    FROM ativo a
    JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
    LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
    WHERE a.IdProduto = ?
      AND COALESCE(a.IndDeletado, b'0') = b'0'
    `,
    [productId]
  );
  const list = [];
  for (const r of rows) {
    const st = String(r.store_name || "");
    const phys = Math.max(0, Number(r.disponivel) || 0) + Math.max(0, Number(r.vitrine) || 0);
    list.push({
      originalName: st,
      norm: normalizeName(st),
      ativo_id: Number(r.ativo_id),
      phys,
    });
  }
  return list;
}

/** Soma no legado todas as linhas cujo NomeFantasia bate com o bundle (incl. sinónimos ex. G2/Goitacazes). */
function legacyQtyForBundleKey(bundleKey, legacyByNameNorm) {
  const names = legacyStoreNamesToTry(bundleKey);
  const tryNames = names.length ? names : [bundleKey];
  let sum = 0;
  let matched = [];
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

async function main() {
  const args = parseArgs();
  let productId = args.id;
  if (!productId && args.code) {
    productId = resolveProductIdFromCatalog(args.code);
    if (!productId) throw new Error(`Código ERP não encontrado no catálogo: ${args.code}`);
  }
  if (!productId) {
    console.error("Uso: node scripts/legacy_per_store_vs_coceo.js --code=10163  ou  --id=49");
    process.exit(1);
  }

  const bundle = loadBundle(productId);
  const results = bundle.results || {};
  const keys = Object.keys(results).filter(
    (k) =>
      k !== "TOTAL" &&
      !isClosedRetailExcludedFromStockNetwork(k, lastPhysicalFromBundle(results[k]))
  );

  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");
  const legacyFlat = await legacyRowsFlat(conn, productId);
  const [prodRow] = await conn.query(
    `
    SELECT
      CAST(COALESCE(p.EstoqueTotal, 0) + COALESCE(p.Vitrine, 0) AS DECIMAL(18, 4)) AS adm_cadastro,
      CAST(
        COALESCE(pt.EstoqueDisponivel, 0) + COALESCE(pt.EstoqueVitrine, 0) AS DECIMAL(18, 4)
      ) AS adm_produtototalizador,
      p.DataTotalizador AS DataTotalizador
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
    WHERE p.Id = ?
    LIMIT 1
    `,
    [productId]
  );
  await conn.end();

  const legacyByNorm = new Map();
  for (const r of legacyFlat) {
    const prev = legacyByNorm.get(r.norm) || { sum: 0, ativos: [], originalName: r.originalName };
    prev.sum += r.phys;
    prev.ativos.push({ id: r.ativo_id, phys: r.phys });
    prev.originalName = r.originalName;
    legacyByNorm.set(r.norm, prev);
  }

  const rows = [];
  for (const bundleKey of keys) {
    const coceo = lastPhysicalFromBundle(results[bundleKey]);
    const { sum: legacy, matched } = legacyQtyForBundleKey(bundleKey, legacyByNorm);
    const diff = Number.isFinite(coceo) && Number.isFinite(legacy) ? coceo - legacy : NaN;
    rows.push({
      unidade_bundle: bundleKey,
      legado_nomes: matched.length ? matched.join(" + ") : "(sem match)",
      coceo_fisico_ultimo_dia: coceo,
      legado_fisico_totalizador: legacy,
      diff_coceo_menos_legado: diff,
    });
  }

  rows.sort((a, b) => Math.abs(b.diff_coceo_menos_legado || 0) - Math.abs(a.diff_coceo_menos_legado || 0));

  const sumCoceo = rows.reduce((s, r) => s + (Number.isFinite(r.coceo_fisico_ultimo_dia) ? r.coceo_fisico_ultimo_dia : 0), 0);
  const sumLegMatched = rows.reduce(
    (s, r) => s + (Number.isFinite(r.legado_fisico_totalizador) ? r.legado_fisico_totalizador : 0),
    0
  );
  const sumLegNetwork = legacyFlat
    .filter((x) => !isClosedRetailExcludedFromStockNetwork(x.originalName, x.phys))
    .reduce((s, x) => s + x.phys, 0);
  const sumLegClosedResidual = legacyFlat
    .filter((x) => isClosedRetailStore(x.originalName) && x.phys > 0)
    .reduce((s, x) => s + x.phys, 0);

  console.log(`Produto ID ${productId} · ${bundle.info?.name || ""}`);
  if (prodRow && prodRow[0]) {
    const pr = prodRow[0];
    const pt = pr.adm_produtototalizador == null ? "—" : pr.adm_produtototalizador;
    console.log(
      `Admin produtototalizador (painel pós-reprocess.): ${pt} · cadastro produto (EstoqueTotal+Vitrine): ${pr.adm_cadastro} · DataTotalizador: ${pr.DataTotalizador || "—"}`
    );
  }
  console.log(`Σ CO-CEO (bundle, lojas+hub): ${sumCoceo}`);
  console.log(`Σ legado só unidades casadas com o bundle: ${sumLegMatched.toFixed(4)}`);
  console.log(`Σ legado rede (abertas + fechadas com estoque): ${sumLegNetwork.toFixed(4)}`);
  if (sumLegClosedResidual > 0) {
    console.log(
      `Σ legado só lojas fechadas **com** estoque residual (ex. Carijós): ${sumLegClosedResidual.toFixed(4)} ← incluídas no CO-CEO quando o bundle as traz`
    );
  }
  console.log("");
  console.table(
    rows.map((r) => ({
      unidade: r.unidade_bundle,
      legado: r.legado_nomes,
      coceo: r.coceo_fisico_ultimo_dia,
      legado$: r.legado_fisico_totalizador,
      diff: r.diff_coceo_menos_legado,
    }))
  );

  function legacyRowMatchesAnyBundle(legacyNorm) {
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

  const orphanLegacy = [];
  for (const r of legacyFlat) {
    if (isClosedRetailStore(r.originalName)) {
      if (r.phys <= 0) continue;
      if (legacyRowMatchesAnyBundle(r.norm)) continue;
      orphanLegacy.push({
        loja: r.originalName,
        q: r.phys,
        nota: "fechada com estoque — não casada no bundle CO-CEO",
      });
      continue;
    }
    if (!legacyRowMatchesAnyBundle(r.norm)) {
      orphanLegacy.push({ loja: r.originalName, q: r.phys, nota: "sem chave correspondente no bundle" });
    }
  }
  if (orphanLegacy.length) {
    console.log("\nLinhas legado não agregadas ao CO-CEO (possível origem do ‘+1’ no admin):");
    console.table(orphanLegacy);
  }

  const bad = rows.filter((r) => Number.isFinite(r.diff_coceo_menos_legado) && Math.abs(r.diff_coceo_menos_legado) > 0.01);
  if (bad.length) {
    console.log("\nUnidades com |diff| > 0.01 entre CO-CEO e legado (sinónimos G2/Goitacazes):");
    bad.forEach((r) =>
      console.log(
        `  - ${r.unidade_bundle}: diff=${r.diff_coceo_menos_legado} (CO-CEO ${r.coceo_fisico_ultimo_dia} vs legado ${r.legado_fisico_totalizador})`
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

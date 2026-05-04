/**
 * Recalcula listas de SKUs “mais importantes” a partir de artefatos já gerados:
 * - data/client/sku_sales_rank.json (volumes no bundle Apollo, excl. Fábrica/CD)
 * - data/client/cd_purchase_plan.json (vendas / valor bruto / margem no período do plano CD)
 *
 * Saída: data/client/sku_top_important.json (+ .js)
 *   top_100_by_volume — primeiros 100 do ranking por unidades (histórico bundle)
 *   top_100_by_contribution_margin — ordenado por lucro bruto (plano CD)
 *   top_100_composite — volume + lucro normalizados; só entram SKUs com lucro bruto ≥ piso (opcional)
 *
 * Lucro bruto (R$) = no plano CD, soma (preço venda aplicado − preço custo aplicado) × qtd (legado).
 *
 * Opcional — piso de lucro bruto só para o ranking *composto*:
 *   --min-lucro=5000   ou   TOP_IMPORTANT_MIN_LUCRO_BRUTO=5000
 *   Só entram SKUs com lucro bruto ≥ este valor (volume alto e lucro baixo, ex. rodízios, caem fora se o piso for alto).
 *
 * Uso (na raiz): node scripts/build_top_important_skus.js
 * Pré-requisito: node scripts/seed_ceo_ranked_skus.js --rank-only
 *               npm run build:cd-plan (para margens alinhadas ao plano)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { isNonResaleServiceSku } = require(path.join(__dirname, "..", "lib", "resale_sku_filters"));

const root = path.join(__dirname, "..");
const RANK_PATH = path.join(root, "data", "client", "sku_sales_rank.json");
const CD_PLAN_PATH = path.join(root, "data", "client", "cd_purchase_plan.json");
const OUT_PATH = path.join(root, "data", "client", "sku_top_important.json");
const OUT_JS_PATH = path.join(root, "data", "client", "sku_top_important.js");

function parseMinLucroFromArgv() {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--min-lucro=")) {
      const n = parseFloat(String(a.split("=")[1] || "").trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Ordem de exibição: maior Score (composto vol+lucro) primeiro, em todas as abas. */
function sortRowsByCompositeScoreDesc(rows) {
  return [...rows].sort(
    (a, b) => (Number(b.composite_score) || 0) - (Number(a.composite_score) || 0)
  );
}

function pickCd(cdRow) {
  if (!cdRow) return null;
  return {
    quantidade_vendida: Number(cdRow.quantidade_vendida) || 0,
    valor_bruto_vendas: Number(cdRow.valor_bruto_vendas) || 0,
    margem_contribuicao_total: Number(cdRow.margem_contribuicao_total) || 0,
    ruptura_media_pct: cdRow.ruptura_media_pct != null ? Number(cdRow.ruptura_media_pct) : null,
    ruptura_ponderada_vendas_pct:
      cdRow.ruptura_ponderada_vendas_pct != null ? Number(cdRow.ruptura_ponderada_vendas_pct) : null,
    demanda_total_cd: cdRow.demanda_total_cd != null ? Number(cdRow.demanda_total_cd) : null,
  };
}

function main() {
  if (!fs.existsSync(RANK_PATH)) {
    throw new Error("Falta " + RANK_PATH + " — rode: node scripts/seed_ceo_ranked_skus.js --rank-only");
  }
  const rankDoc = readJson(RANK_PATH);
  const rankRowsRaw = rankDoc.rows;
  if (!Array.isArray(rankRowsRaw) || !rankRowsRaw.length) throw new Error("sku_sales_rank.json sem rows");

  const cdById = new Map();
  if (fs.existsSync(CD_PLAN_PATH)) {
    const cd = readJson(CD_PLAN_PATH);
    for (const r of cd.rows || []) {
      const id = String(r.sku_internal_id ?? "").trim();
      if (id) cdById.set(id, r);
    }
  }

  const rankRows = rankRowsRaw.filter((row) => {
    const cd = cdById.get(String(row.id));
    return !isNonResaleServiceSku({
      code: row.code,
      name: row.name,
      subcategory: cd ? cd.subcategory : null,
    });
  });
  if (!rankRows.length) throw new Error("Após excluir serviços/sob medida, sku_sales_rank ficou vazio.");

  const enrich = (row) => {
    const id = String(row.id);
    const cd = pickCd(cdById.get(id));
    const vb = cd ? cd.valor_bruto_vendas : 0;
    const mc = cd ? cd.margem_contribuicao_total : 0;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      total_sales_bundle: Number(row.total_sales) || 0,
      ...cd,
      /** Mesmo valor que margem_contribuicao_total no plano CD — nome explícito para a UI */
      lucro_bruto: mc,
      margem_contrib_pct: vb > 0 ? (mc / vb) * 100 : null,
    };
  };

  const allEnriched = rankRows.map(enrich);

  let maxVol = 0;
  let maxMarg = 0;
  for (const r of allEnriched) {
    if (r.total_sales_bundle > maxVol) maxVol = r.total_sales_bundle;
    if (r.margem_contribuicao_total > maxMarg) maxMarg = r.margem_contribuicao_total;
  }
  if (maxVol <= 0) maxVol = 1;
  if (maxMarg <= 0) maxMarg = 1;

  /** Score composto: mais peso no lucro bruto + ruptura (oportunidade perdida). Soma dos pesos = 1. */
  const W_VOL = 0.32;
  const W_LUCRO = 0.5;
  const W_RUPTURA = 0.18;

  const withComposite = allEnriched.map((r) => {
    const lb = r.lucro_bruto || 0;
    const nv = r.total_sales_bundle / maxVol;
    const nm = lb / maxMarg;
    const rpRaw =
      r.ruptura_ponderada_vendas_pct != null && Number.isFinite(Number(r.ruptura_ponderada_vendas_pct))
        ? Number(r.ruptura_ponderada_vendas_pct)
        : r.ruptura_media_pct != null && Number.isFinite(Number(r.ruptura_media_pct))
          ? Number(r.ruptura_media_pct)
          : 0;
    const nr = Math.min(1, Math.max(0, rpRaw) / 100);
    const composite = W_VOL * nv + W_LUCRO * nm + W_RUPTURA * nr;
    return { ...r, _nv: nv, _nm: nm, _nr: nr, composite_score: composite };
  });

  const stripCompositeInternals = (r) => {
    const { _nv, _nm, _nr, ...rest } = r;
    return rest;
  };

  const top100ByVolume = sortRowsByCompositeScoreDesc(
    withComposite.slice(0, 100).map(stripCompositeInternals)
  );

  const byMargin = sortRowsByCompositeScoreDesc(
    [...withComposite]
      .filter((r) => (r.lucro_bruto || 0) > 0)
      .sort((a, b) => (b.lucro_bruto || 0) - (a.lucro_bruto || 0))
      .slice(0, 100)
      .map(stripCompositeInternals)
  );

  const minLucroArg = parseMinLucroFromArgv();
  const minLucroComposite = Math.max(
    0,
    minLucroArg != null ? minLucroArg : Number(process.env.TOP_IMPORTANT_MIN_LUCRO_BRUTO || 0) || 0
  );
  const poolComposite =
    minLucroComposite > 0
      ? withComposite.filter((r) => (r.lucro_bruto || 0) >= minLucroComposite)
      : withComposite;

  const byComposite = sortRowsByCompositeScoreDesc(
    [...poolComposite]
      .sort((a, b) => b.composite_score - a.composite_score)
      .slice(0, 100)
      .map(stripCompositeInternals)
  );

  const out = {
    meta: {
      generated_at: new Date().toISOString(),
      rank_file: path.relative(root, RANK_PATH),
      cd_plan_file: fs.existsSync(CD_PLAN_PATH) ? path.relative(root, CD_PLAN_PATH) : null,
      note:
        "total_sales_bundle = soma sales nas timelines do bundle (lojas, sem Fábrica/CD). " +
        "Valor bruto e lucro bruto vêm do cd_purchase_plan (janela do plano). " +
        "Lucro bruto = Σ (preço venda aplic. − preço custo aplic.) × qtd nas vendas do legado. " +
        "ruptura_ponderada_vendas_pct = média ponderada do % ruptura por loja aberta (peso: qtd vendida na loja; se 0, peso = demanda CD da loja). " +
        "Score = " +
        W_VOL +
        "×vol_norm + " +
        W_LUCRO +
        "×lucro_bruto_norm + " +
        W_RUPTURA +
        "×min(1,ruptura%/100); ruptura reflete oportunidade deixada na rede.",
      lucro_bruto_field: "lucro_bruto",
      min_lucro_bruto_for_composite: minLucroComposite > 0 ? minLucroComposite : null,
      composite_weights: { volume: W_VOL, lucro_bruto: W_LUCRO, ruptura: W_RUPTURA },
      excluded_non_resale_rows: rankRowsRaw.length - rankRows.length,
      resale_filter: "lib/resale_sku_filters.js — alinhado a cd_purchase_plan.html",
      sort_display: "Em todas as abas, as linhas aparecem ordenadas por composite_score (Score), descendente.",
    },
    top_100_by_volume: top100ByVolume,
    top_100_by_contribution_margin: byMargin,
    top_100_composite: byComposite,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  fs.writeFileSync(
    OUT_JS_PATH,
    "window.SKU_TOP_IMPORTANT = " + JSON.stringify(out) + ";\n",
    "utf8"
  );
  console.log("Gerado:", OUT_PATH);
  console.log("Gerado:", OUT_JS_PATH, "(para abrir top_important_skus.html em file://)");
  console.log("  top_100_by_volume:", top100ByVolume.length);
  console.log("  top_100_by_contribution_margin:", byMargin.length);
  console.log("  top_100_composite:", byComposite.length);
}

main();

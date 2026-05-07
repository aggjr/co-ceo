/**
 * Verifica no MySQL legado se o estoque "admin" (nível produto) diverge da soma
 * dos estoques por unidade (ativos × ativototalizador).
 *
 * Fontes admin (ambas reportadas — o ERP pode usar uma delas na tela):
 *   - produto.EstoqueTotal + produto.Vitrine  (físico agregado no cadastro)
 *   - produtototalizador.EstoqueDisponivel + EstoqueVitrine (totalizador por produto)
 *
 * Soma unidades: Σ (EstoqueDisponivel + EstoqueVitrine) em ativototalizador
 * para todos os ativos não deletados do produto.
 *
 * Uso: node scripts/audit_legacy_admin_stock_vs_units_sum.js
 *
 * Env: LEGACY_MYSQL_* (mesmo .env do repo)
 * Opcional: ADMIN_VS_UNITS_TOL=0.01
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require("../coceo_db_config");

const TOL = Math.max(0, Number(process.env.ADMIN_VS_UNITS_TOL) || 0.01);
const REPORTS = path.join(__dirname, "..", "reports");

async function main() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");

  // Uma linha de produtototalizador por produto (pega o maior Id se houver duplicidade rara)
  const [rows] = await conn.query(
    `
    SELECT
      p.Id AS product_id,
      p.ErpCodigo AS erp_code,
      LEFT(p.Descricao, 120) AS descricao,
      CAST(COALESCE(p.EstoqueTotal, 0) AS DECIMAL(18,4)) AS produto_disp_cadastro,
      CAST(COALESCE(p.Vitrine, 0) AS DECIMAL(18,4)) AS produto_vitrine_cadastro,
      CAST(COALESCE(p.EstoqueTotal, 0) + COALESCE(p.Vitrine, 0) AS DECIMAL(18,4)) AS admin_produto_fisico,
      CAST(
        COALESCE(pt.EstoqueDisponivel, 0) + COALESCE(pt.EstoqueVitrine, 0) AS DECIMAL(18,4)
      ) AS admin_produtototalizador_fisico,
      CAST(COALESCE(s.sum_ativo_fisico, 0) AS DECIMAL(18,4)) AS sum_unidades_fisico,
      s.ativos_count AS ativos_nao_deletados
    FROM produto p
    LEFT JOIN (
      SELECT
        pt1.IdProduto AS pid,
        CAST(COALESCE(pt1.EstoqueDisponivel, 0) AS DECIMAL(18,4)) AS EstoqueDisponivel,
        CAST(COALESCE(pt1.EstoqueVitrine, 0) AS DECIMAL(18,4)) AS EstoqueVitrine
      FROM produtototalizador pt1
      INNER JOIN (
        SELECT IdProduto, MAX(Id) AS max_id
        FROM produtototalizador
        WHERE COALESCE(IndDeletado, b'0') = b'0'
        GROUP BY IdProduto
      ) x ON x.max_id = pt1.Id
    ) pt ON pt.pid = p.Id
    LEFT JOIN (
      SELECT
        a.IdProduto AS pid,
        COUNT(DISTINCT a.Id) AS ativos_count,
        SUM(
          CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) +
          CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4))
        ) AS sum_ativo_fisico
      FROM ativo a
      LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
      WHERE COALESCE(a.IndDeletado, b'0') = b'0'
      GROUP BY a.IdProduto
    ) s ON s.pid = p.Id
    WHERE COALESCE(p.IndDeletado, b'0') = b'0'
    ORDER BY p.Id
    `
  );

  await conn.end();

  const divergeProduto = [];
  const divergePT = [];
  const onlyPTnull = [];

  for (const r of rows) {
    const sumU = Number(r.sum_unidades_fisico) || 0;
    const admP = Number(r.admin_produto_fisico) || 0;
    const admPT = r.admin_produtototalizador_fisico == null ? null : Number(r.admin_produtototalizador_fisico);

    if (Math.abs(admP - sumU) > TOL) {
      divergeProduto.push({
        ...r,
        diff_produto_minus_sum: round4(admP - sumU),
      });
    }
    if (admPT != null && Number.isFinite(admPT) && Math.abs(admPT - sumU) > TOL) {
      divergePT.push({
        ...r,
        diff_pt_minus_sum: round4(admPT - sumU),
      });
    }
    if (admPT == null || !Number.isFinite(admPT)) {
      onlyPTnull.push(r.product_id);
    }
  }

  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `legacy_admin_vs_units_${stamp}`;

  const summary = {
    generated_at: new Date().toISOString(),
    tolerance: TOL,
    produtos_ativos_no_legado: rows.length,
    divergencia_produto_cadastro_vs_soma_ativos: divergeProduto.length,
    divergencia_produtototalizador_vs_soma_ativos: divergePT.length,
    produtos_sem_linha_produtototalizador: onlyPTnull.length,
    nota:
      "admin_produto_fisico = produto.EstoqueTotal + produto.Vitrine. " +
      "admin_produtototalizador_fisico = produtototalizador (último Id por produto). " +
      "sum_unidades_fisico = Σ (ativototalizador disponível+vitrine) nos ativos. " +
      "Em sistema consistente, os três alinhamentos deveriam coincidir (salvo arredondamento).",
  };

  const out = { summary, diverge_produto_vs_units: divergeProduto, diverge_produtototalizador_vs_units: divergePT };
  const jsonPath = path.join(REPORTS, `${base}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), "utf8");

  const csvPath = path.join(REPORTS, `${base}_produto_vs_sum.csv`);
  const h =
    "product_id,erp_code,admin_produto_fisico,sum_unidades_fisico,diff,ativos_nao_deletados\n";
  const b = divergeProduto
    .map(
      (x) =>
        `${x.product_id},${csvEsc(x.erp_code)},${x.admin_produto_fisico},${x.sum_unidades_fisico},${x.diff_produto_minus_sum},${x.ativos_nao_deletados}`
    )
    .join("\n");
  fs.writeFileSync(csvPath, h + b, "utf8");

  const csv2 = path.join(REPORTS, `${base}_produtototalizador_vs_sum.csv`);
  const h2 =
    "product_id,erp_code,admin_produtototalizador_fisico,sum_unidades_fisico,diff,ativos_nao_deletados\n";
  const b2 = divergePT
    .map(
      (x) =>
        `${x.product_id},${csvEsc(x.erp_code)},${x.admin_produtototalizador_fisico},${x.sum_unidades_fisico},${x.diff_pt_minus_sum},${x.ativos_nao_deletados}`
    )
    .join("\n");
  fs.writeFileSync(csv2, h2 + b2, "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nJSON: ${jsonPath}`);
  console.log(`CSV (produto vs Σ ativos): ${csvPath}`);
  console.log(`CSV (produtototalizador vs Σ ativos): ${csv2}`);
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000;
}

function csvEsc(s) {
  const t = String(s ?? "").replace(/"/g, '""');
  return /[",\n\r]/.test(t) ? `"${t}"` : t;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

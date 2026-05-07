/**
 * Estatísticas: quantos produtos têm cadastro em lojas / CD / fábrica e
 * quantos têm total admin (cadastro ou produtototalizador) diferente da Σ ativos.
 *
 * node scripts/legacy_stock_scope_stats.js
 */
"use strict";

const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require("../coceo_db_config");

const TOL = Math.max(0, Number(process.env.ADMIN_VS_UNITS_TOL) || 0.01);

function classifyNome(nome) {
  const s = String(nome || "");
  if (/fábrica|fabrica/i.test(s)) return "FABRICA";
  if (/\bcd\b/i.test(s) || /\bCD\b/.test(s)) return "CD";
  return "LOJA";
}

async function main() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");

  const [ativos] = await conn.query(
    `
    SELECT a.IdProduto AS pid, u.NomeFantasia AS nome
    FROM ativo a
    JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
    WHERE COALESCE(a.IndDeletado, b'0') = b'0'
    `
  );

  const [adminRows] = await conn.query(
    `
    SELECT
      p.Id AS product_id,
      CAST(COALESCE(p.EstoqueTotal, 0) + COALESCE(p.Vitrine, 0) AS DECIMAL(18,4)) AS admin_produto_fisico,
      CAST(
        COALESCE(pt.EstoqueDisponivel, 0) + COALESCE(pt.EstoqueVitrine, 0) AS DECIMAL(18,4)
      ) AS admin_pt_fisico,
      CAST(COALESCE(s.sum_ativo_fisico, 0) AS DECIMAL(18,4)) AS sum_unidades_fisico,
      s.ativos_count
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
    `
  );

  await conn.end();

  /** @type {Map<number, Set<string>>} */
  const bucketsByPid = new Map();
  for (const row of ativos) {
    const pid = Number(row.pid);
    const b = classifyNome(row.nome);
    if (!bucketsByPid.has(pid)) bucketsByPid.set(pid, new Set());
    bucketsByPid.get(pid).add(b);
  }

  let produtosLegado = 0;
  let comAtivoEmLoja = 0;
  let comAtivoEmCD = 0;
  let comAtivoEmFabrica = 0;
  let comQualquerAtivo = 0;
  /** Loja + (CD ou fábrica): rede típica */
  let comLojaEHub = 0;
  /** Só lojas (sem CD nem fábrica nos ativos) */
  let somenteLojas = 0;

  let mismatchProdutoVsSum = 0;
  let mismatchPTvsSum = 0;
  /** Com ≥1 ativo em loja E divergência cadastro vs soma */
  let mismatchProduto_comLoja = 0;
  let mismatchPT_comLoja = 0;
  /** Com ≥1 ativo (qualquer) E divergência */
  let mismatchProduto_comQualquerAtivo = 0;
  let mismatchPT_comQualquerAtivo = 0;

  for (const r of adminRows) {
    produtosLegado++;
    const pid = Number(r.product_id);
    const sets = bucketsByPid.get(pid) || new Set();
    const hasLoja = sets.has("LOJA");
    const hasCD = sets.has("CD");
    const hasFab = sets.has("FABRICA");
    const hasAny = sets.size > 0;

    if (hasLoja) comAtivoEmLoja++;
    if (hasCD) comAtivoEmCD++;
    if (hasFab) comAtivoEmFabrica++;
    if (hasAny) comQualquerAtivo++;
    if (hasLoja && (hasCD || hasFab)) comLojaEHub++;
    if (hasLoja && !hasCD && !hasFab) somenteLojas++;

    const sumU = Number(r.sum_unidades_fisico) || 0;
    const admP = Number(r.admin_produto_fisico) || 0;
    const admPT = Number(r.admin_pt_fisico) || 0;

    const badP = Math.abs(admP - sumU) > TOL;
    const badPT = Math.abs(admPT - sumU) > TOL;

    if (badP) mismatchProdutoVsSum++;
    if (badPT) mismatchPTvsSum++;
    if (badP && hasLoja) mismatchProduto_comLoja++;
    if (badPT && hasLoja) mismatchPT_comLoja++;
    if (badP && hasAny) mismatchProduto_comQualquerAtivo++;
    if (badPT && hasAny) mismatchPT_comQualquerAtivo++;
  }

  const out = {
    tolerancia: TOL,
    definicoes: {
      loja_cd_fabrica:
        "Classificação pelo NomeFantasia da unidade: FABRICA (nome contém fábrica/fabrica), CD (palavra CD), senão LOJA.",
      admin_cadastro: "produto.EstoqueTotal + produto.Vitrine",
      admin_produtototalizador: "produtototalizador.EstoqueDisponivel + EstoqueVitrine (1 linha/produto)",
      soma_unidades: "Σ (ativototalizador disponível + vitrine) em todos os ativos não deletados do produto",
    },
    produtos_nao_deletados_no_legado: produtosLegado,
    com_pelo_menos_1_ativo_em_qualquer_unidade: comQualquerAtivo,
    com_pelo_menos_1_ativo_em_loja: comAtivoEmLoja,
    com_pelo_menos_1_ativo_em_cd: comAtivoEmCD,
    com_pelo_menos_1_ativo_em_fabrica: comAtivoEmFabrica,
    com_loja_e_cd_ou_fabrica: comLojaEHub,
    com_loja_sem_cd_nem_fabrica_nos_ativos: somenteLojas,
    divergencias: {
      admin_cadastro_diferente_da_soma_unidades: mismatchProdutoVsSum,
      produtototalizador_diferente_da_soma_unidades: mismatchPTvsSum,
      dentre_produtos_com_ativo_em_loja: {
        admin_cadastro_vs_soma: mismatchProduto_comLoja,
        produtototalizador_vs_soma: mismatchPT_comLoja,
      },
      dentre_produtos_com_qualquer_ativo: {
        admin_cadastro_vs_soma: mismatchProduto_comQualquerAtivo,
        produtototalizador_vs_soma: mismatchPT_comQualquerAtivo,
      },
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Simples:
 * - "Tem estoque" = soma nas unidades > 0 (Σ ativototalizador disp+vitrine).
 * - "Admin" = produto.EstoqueTotal + produto.Vitrine.
 * - "Problema" = |admin − soma| > tolerância.
 *
 * node scripts/legacy_stock_admin_simple.js
 */
"use strict";

const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require("../coceo_db_config");

const TOL = Math.max(0, Number(process.env.ADMIN_VS_UNITS_TOL) || 0.01);

async function main() {
  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");

  const [rows] = await conn.query(
    `
    SELECT
      p.Id AS id,
      CAST(COALESCE(p.EstoqueTotal, 0) + COALESCE(p.Vitrine, 0) AS DECIMAL(18,4)) AS admin_fisico,
      CAST(COALESCE(s.sum_fisico, 0) AS DECIMAL(18,4)) AS soma_unidades
    FROM produto p
    LEFT JOIN (
      SELECT
        a.IdProduto AS pid,
        SUM(
          CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) +
          CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4))
        ) AS sum_fisico
      FROM ativo a
      LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
      WHERE COALESCE(a.IndDeletado, b'0') = b'0'
      GROUP BY a.IdProduto
    ) s ON s.pid = p.Id
    WHERE COALESCE(p.IndDeletado, b'0') = b'0'
    `
  );

  await conn.end();

  let comEstoqueNasUnidades = 0;
  let comEstoqueAdminOuUnidades = 0;
  let divergente_entre_com_unidades = 0;
  let divergente_entre_com_qualquer = 0;

  for (const r of rows) {
    const sumU = Number(r.soma_unidades) || 0;
    const adm = Number(r.admin_fisico) || 0;
    const diff = Math.abs(adm - sumU);

    const temNasUnidades = sumU > TOL;
    const temAlgum = sumU > TOL || adm > TOL;

    if (temNasUnidades) {
      comEstoqueNasUnidades++;
      if (diff > TOL) divergente_entre_com_unidades++;
    }
    if (temAlgum) {
      comEstoqueAdminOuUnidades++;
      if (diff > TOL) divergente_entre_com_qualquer++;
    }
  }

  const out = {
    tolerancia: TOL,
    definicao_tem_estoque_soma_unidades:
      "Σ (EstoqueDisponivel + EstoqueVitrine) nos ativos do produto > tolerância",
    definicao_admin: "produto.EstoqueTotal + produto.Vitrine",
    produtos_ativos_no_cadastro: rows.length,
    com_estoque_nas_unidades: comEstoqueNasUnidades,
    com_estoque_nas_unidades_admin_diferente_da_soma: divergente_entre_com_unidades,
    com_estoque_admin_OU_nas_unidades: comEstoqueAdminOuUnidades,
    com_estoque_admin_OU_nas_unidades_admin_diferente_da_soma: divergente_entre_com_qualquer,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

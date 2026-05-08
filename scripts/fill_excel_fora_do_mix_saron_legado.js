/**
 * Lê uma planilha com colunas CODIGO + DESCRIÇÃO, consulta o MySQL legado
 * (ativo × ativototalizador × unidadenegocio) e grava uma nova .xlsx com
 * uma coluna por unidade de negócio (NomeFantasia) e coluna TOTAL GERAL.
 *
 * CODIGO da planilha = `produto.IdExterno` (varchar). Como fallback, ainda
 * tenta `produto.ErpCodigo` e depois `produto.Id` interno.
 * Estoque/unidade = Σ (disponível + vitrine) no ativototalizador por ativo
 * não deletado (mesmo critério dos scripts de auditoria do legado).
 *
 * Uso:
 *   node scripts/fill_excel_fora_do_mix_saron_legado.js "C:\path\FORA DO MIX SARON.xlsx"
 *   node scripts/fill_excel_fora_do_mix_saron_legado.js "...\pl.xlsx" --out "C:\path\saida.xlsx"
 *
 * Requer .env na raiz com LEGACY_MYSQL_* (ver coceo_db_config.js).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const mysql = require("mysql2/promise");
const { assertLegacyConfig } = require("../coceo_db_config");

/** Mesma ideia de scripts/legacy_stock_scope_stats.js — ordenar colunas CD/Fábrica antes das lojas */
function classifyNome(nome) {
  const s = String(nome || "");
  if (/fábrica|fabrica/i.test(s)) return 0;
  if (/\bcd\b/i.test(s) || /\bCD\b/.test(s)) return 1;
  return 2;
}

function sortUnidades(names) {
  return [...new Set(names)].sort((a, b) => {
    const ca = classifyNome(a);
    const cb = classifyNome(b);
    if (ca !== cb) return ca - cb;
    return String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base" });
  });
}

function normCodigo(v) {
  if (v === "" || v === null || v === undefined) return "";
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return String(Math.trunc(Number(s)));
  return s;
}

function parseArgs(argv) {
  let input = null;
  let outPath = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") {
      outPath = argv[++i];
      continue;
    }
    if (!input && !a.startsWith("-")) input = a;
  }
  return { input, outPath };
}

async function resolveProducts(conn, codigos) {
  const unique = [...new Set(codigos.filter(Boolean))];
  if (!unique.length) {
    return { idByCode: new Map(), matchedBy: new Map(), missingCodes: unique };
  }

  /** @type {Map<string, number>} */
  const idByCode = new Map();
  /** @type {Map<string, "IdExterno"|"ErpCodigo"|"Id">} */
  const matchedBy = new Map();
  const ambiguous = new Set();

  /** 1) IdExterno (chave externa do ERP — caso confirmado pelo cliente Saron). */
  const ph1 = unique.map(() => "?").join(",");
  const [byExt] = await conn.query(
    `
    SELECT Id AS id, IdExterno AS code
    FROM produto
    WHERE COALESCE(IndDeletado, b'0') = b'0'
      AND IdExterno IS NOT NULL
      AND TRIM(CAST(IdExterno AS CHAR)) IN (${ph1})
    `,
    unique
  );
  for (const r of byExt) {
    const code = normCodigo(r.code);
    const id = Number(r.id);
    if (!Number.isFinite(id) || !code) continue;
    if (idByCode.has(code) && idByCode.get(code) !== id) ambiguous.add(code);
    idByCode.set(code, id);
    matchedBy.set(code, "IdExterno");
  }

  /** 2) Fallback: ErpCodigo. */
  let still = unique.filter((k) => !idByCode.has(k));
  if (still.length) {
    const ph2 = still.map(() => "?").join(",");
    const [byErp] = await conn.query(
      `
      SELECT Id AS id, ErpCodigo AS code
      FROM produto
      WHERE COALESCE(IndDeletado, b'0') = b'0'
        AND ErpCodigo IS NOT NULL
        AND TRIM(CAST(ErpCodigo AS CHAR)) IN (${ph2})
      `,
      still
    );
    for (const r of byErp) {
      const code = normCodigo(r.code);
      const id = Number(r.id);
      if (!Number.isFinite(id) || !code) continue;
      if (idByCode.has(code) && idByCode.get(code) !== id) ambiguous.add(code);
      idByCode.set(code, id);
      matchedBy.set(code, "ErpCodigo");
    }
  }

  /** 3) Último fallback: produto.Id interno (apenas se for inteiro). */
  still = unique.filter((k) => !idByCode.has(k));
  const numericKeys = still.filter((k) => /^\d+$/.test(k)).map((k) => parseInt(k, 10));
  if (numericKeys.length) {
    const ph3 = numericKeys.map(() => "?").join(",");
    const [byId] = await conn.query(
      `
      SELECT Id AS id
      FROM produto
      WHERE COALESCE(IndDeletado, b'0') = b'0'
        AND Id IN (${ph3})
      `,
      numericKeys
    );
    for (const r of byId) {
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;
      const code = String(id);
      idByCode.set(code, id);
      matchedBy.set(code, "Id");
    }
  }

  if (ambiguous.size) {
    console.warn(
      "[AVISO] código duplicado no cadastro (manteve último lido):",
      [...ambiguous].slice(0, 15)
    );
  }

  const missingCodes = unique.filter((c) => !idByCode.has(c));
  return { idByCode, matchedBy, missingCodes };
}

async function loadStockByProductAndUnit(conn, productIds) {
  if (!productIds.length) return { byPid: new Map(), unidades: new Set() };

  const ph = productIds.map(() => "?").join(",");
  const [rows] = await conn.query(
    `
    SELECT
      p.Id AS product_id,
      u.NomeFantasia AS unidade,
      SUM(
        CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18, 4)) +
        CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18, 4))
      ) AS qty
    FROM produto p
    INNER JOIN ativo a ON a.IdProduto = p.Id AND COALESCE(a.IndDeletado, b'0') = b'0'
    INNER JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
    LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
    WHERE p.Id IN (${ph})
    GROUP BY p.Id, u.IdUnidadeNegocio, u.NomeFantasia
    `,
    productIds
  );

  /** @type {Map<number, Map<string, number>>} */
  const byPid = new Map();
  const unidades = new Set();
  for (const r of rows) {
    const pid = Number(r.product_id);
    const u = String(r.unidade || "").trim();
    const q = Number(r.qty);
    const qty = Number.isFinite(q) ? q : 0;
    if (!u) continue;
    unidades.add(u);
    if (!byPid.has(pid)) byPid.set(pid, new Map());
    const m = byPid.get(pid);
    m.set(u, (m.get(u) || 0) + qty);
  }

  return { byPid, unidades };
}

async function main() {
  const { input: inputArg, outPath: outArg } = parseArgs(process.argv);
  const inputPath =
    inputArg ||
    path.join("C:", "Users", "Augusto", "Downloads", "FORA DO MIX SARON.xlsx");

  if (!fs.existsSync(inputPath)) {
    console.error("Arquivo não encontrado:", inputPath);
    process.exit(1);
  }

  const base = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);
  const defaultOut = path.join(dir, `${base}_LEGADO_ESTOQUE.xlsx`);
  const outPath = outArg || defaultOut;

  const wb = XLSX.readFile(inputPath);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (!matrix.length) {
    console.error("Planilha vazia.");
    process.exit(1);
  }

  const header = matrix[0].map((c) => String(c).trim().toUpperCase());
  const codeAliases = ["IDEXTERNO", "ID EXTERNO", "CODIGO", "CÓDIGO", "ID"];
  const descAliases = ["DESCRIÇÃO", "DESCRICAO"];
  let idxCod = -1;
  for (const a of codeAliases) {
    idxCod = header.indexOf(a);
    if (idxCod >= 0) break;
  }
  let idxDesc = -1;
  for (const a of descAliases) {
    idxDesc = header.indexOf(a);
    if (idxDesc >= 0) break;
  }

  if (idxCod < 0) {
    console.error(
      'Cabeçalho precisa ter coluna "IDEXTERNO" (ou CODIGO/CÓDIGO). Encontrado:',
      header
    );
    process.exit(1);
  }
  console.log('Coluna de código identificada:', header[idxCod]);

  const dataRows = matrix.slice(1);
  const codigos = [];
  for (const row of dataRows) {
    const c = normCodigo(row[idxCod]);
    codigos.push(c);
  }

  const conn = await mysql.createConnection(assertLegacyConfig());
  await conn.query("SET NAMES 'utf8mb4'");

  const { idByCode, matchedBy, missingCodes } = await resolveProducts(conn, codigos);
  const ids = [...new Set([...idByCode.values()])];
  const { byPid, unidades } = await loadStockByProductAndUnit(conn, ids);
  await conn.end();

  const matchedStats = { IdExterno: 0, ErpCodigo: 0, Id: 0 };
  for (const m of matchedBy.values()) matchedStats[m] = (matchedStats[m] || 0) + 1;

  const colsUnidades = sortUnidades([...unidades]);
  const codeHeaderOut = matrix[0][idxCod] != null && String(matrix[0][idxCod]).trim()
    ? String(matrix[0][idxCod]).trim()
    : "CODIGO";
  const descHeaderOut = idxDesc >= 0 && matrix[0][idxDesc] != null && String(matrix[0][idxDesc]).trim()
    ? String(matrix[0][idxDesc]).trim()
    : "DESCRIÇÃO";
  const headerOut = [codeHeaderOut, descHeaderOut, ...colsUnidades, "TOTAL GERAL"];

  const outMatrix = [headerOut];
  let rowNum = 0;
  for (const row of dataRows) {
    rowNum++;
    const code = normCodigo(row[idxCod]);
    const desc = idxDesc >= 0 ? String(row[idxDesc] ?? "") : "";
    const pid = idByCode.get(code);

    const line = [code || row[idxCod], desc];
    let total = 0;

    if (!pid) {
      for (let i = 0; i < colsUnidades.length; i++) line.push("");
      line.push("");
      outMatrix.push(line);
      continue;
    }

    const unitMap = byPid.get(pid) || new Map();
    for (const u of colsUnidades) {
      const v = unitMap.get(u);
      if (v == null || !Number.isFinite(v)) {
        line.push(0);
      } else {
        line.push(v);
        total += v;
      }
    }
    line.push(total);
    outMatrix.push(line);
  }

  const ws = XLSX.utils.aoa_to_sheet(outMatrix);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, ws, sheetName.slice(0, 31) || "Dados");

  XLSX.writeFile(outWb, outPath);

  console.log("Gerado:", outPath);
  console.log("Produtos na planilha:", dataRows.length);
  console.log("Match por coluna:", matchedStats);
  console.log("Códigos não encontrados no legado:", missingCodes.length);
  if (missingCodes.length) {
    console.log(
      missingCodes.slice(0, 30).join(", "),
      missingCodes.length > 30 ? "..." : ""
    );
  }
  console.log("Colunas de unidade:", colsUnidades.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

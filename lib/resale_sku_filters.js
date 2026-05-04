/**
 * Identifica SKU que são serviço / sob medida / placeholders — não produto de revenda.
 * Alinhado a cd_purchase_plan.html (isServiceItem + isExplicitlyExcludedItem).
 */
"use strict";

const EXCLUDED_ERP_CODES = new Set(["001", "002", "9282"]);

/** Nomes canónicos (sem acento, upper, espaços colapsados) — match exato. */
const EXCLUDED_NAME_CANONICAL = new Set([
  "CORTINA SARON SOB MEDIDA",
  "PERSIANA ENCOMENDA KAZZA",
  "VENDAS PADRAO",
  "INSTALACAO",
]);

function normalizeName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{ code?: string|number, name?: string, subcategory?: string|null }} row
 * @returns {boolean} true = excluir (não é revenda)
 */
function isNonResaleServiceSku(row) {
  const codeNorm = String(row.code ?? "")
    .trim()
    .toUpperCase();
  if (EXCLUDED_ERP_CODES.has(codeNorm)) return true;

  const n = normalizeName(row.name);
  if (!n) return false;
  if (EXCLUDED_NAME_CANONICAL.has(n)) return true;
  if (n.includes("INSTALA")) return true;
  if (n.includes("SOB MEDIDA") || n.includes("SOB-MEDIDA")) return true;
  if (n.includes("ENCOMENDA")) return true;

  const sub = normalizeName(row.subcategory || "");
  if (sub === "CORTINA SOB MEDIDA") return true;

  return false;
}

module.exports = { isNonResaleServiceSku, normalizeName, EXCLUDED_ERP_CODES };

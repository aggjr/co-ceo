/**
 * Lojas de varejo fechadas — por defeito não entram em demandas, médias, matriz, vendas legado agregadas, etc.
 * Unidade com estoque residual (ex.: Carijós) entra na rede de **físico** / totalizadores quando peak > 0.
 * Ajuste CLOSED_RETAIL_STORE_KEYS quando fechar outra unidade (nome canónico sem acento, minúsculas).
 */
"use strict";

function normalizeStoreKey(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chaves normalizadas; ex.: "Carijós" → "carijos" */
const CLOSED_RETAIL_STORE_KEYS = new Set(["carijos"]);

function isClosedRetailStore(storeName) {
  const k = normalizeStoreKey(storeName);
  if (!k) return false;
  return CLOSED_RETAIL_STORE_KEYS.has(k);
}

/**
 * Se true, a loja não entra no conjunto “rede de estoque” do CO-CEO (timeline + TOTAL).
 * Loja fechada com pico de físico > 0 continua na rede para alinhar ao admin.
 *
 * @param {string} storeName
 * @param {number} peakPhysicalHint - máx. físico conhecido (legado e/ou movimentos na janela)
 */
function isClosedRetailExcludedFromStockNetwork(storeName, peakPhysicalHint) {
  if (!isClosedRetailStore(storeName)) return false;
  const v = Math.max(0, Number(peakPhysicalHint) || 0);
  return v <= 0;
}

module.exports = {
  isClosedRetailStore,
  isClosedRetailExcludedFromStockNetwork,
  normalizeStoreKey,
  CLOSED_RETAIL_STORE_KEYS,
};

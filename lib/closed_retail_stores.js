/**
 * Lojas de varejo fechadas — não entram em demandas, médias, matriz, vendas legado agregadas, etc.
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

module.exports = {
  isClosedRetailStore,
  normalizeStoreKey,
  CLOSED_RETAIL_STORE_KEYS,
};

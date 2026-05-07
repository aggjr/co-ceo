/**
 * Chaves de loja como vêm no raw → nome canónico (legado / StockSPIN).
 * Evita tocar milhares de JSON em data/raw; o motor aplica ao ler o SKU.
 */
"use strict";

/** @type {Map<string, string>} */
const STORE_KEY_CANONICAL = new Map([["G2", "Goitacazes"]]);

/**
 * Nome canónico (pós-remap do raw) → nomes a procurar em ativoposicaoestoque / NomeFantasia.
 * Cobre renomeação de unidade no ERP sem perder séries antigas gravadas como "G2".
 */
const LEGACY_STORE_SYNONYMS = new Map([["Goitacazes", ["Goitacazes", "G2"]]]);

function canonicalStoreKey(fromRawKey) {
  const k = String(fromRawKey || "").trim();
  if (!k) return fromRawKey;
  return STORE_KEY_CANONICAL.has(k) ? STORE_KEY_CANONICAL.get(k) : fromRawKey;
}

/**
 * @param {Record<string, unknown>} dataObj - skuContent.data
 * @returns {Record<string, unknown>}
 */
function remapSkuDataStoreKeys(dataObj) {
  if (!dataObj || typeof dataObj !== "object") return dataObj;
  const out = {};
  for (const [key, val] of Object.entries(dataObj)) {
    const canon = canonicalStoreKey(key);
    if (Object.prototype.hasOwnProperty.call(out, canon) && canon !== key) {
      throw new Error(`store key collision ao renomear "${key}" → "${canon}"`);
    }
    out[canon] = val;
  }
  return out;
}

/** @param {string} canonicalStoreName */
function legacyStoreNamesToTry(canonicalStoreName) {
  const c = String(canonicalStoreName || "").trim();
  if (!c) return [];
  if (LEGACY_STORE_SYNONYMS.has(c)) return LEGACY_STORE_SYNONYMS.get(c).slice();
  return [c];
}

module.exports = {
  STORE_KEY_CANONICAL,
  LEGACY_STORE_SYNONYMS,
  canonicalStoreKey,
  remapSkuDataStoreKeys,
  legacyStoreNamesToTry,
};

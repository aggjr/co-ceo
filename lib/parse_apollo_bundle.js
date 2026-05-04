/**
 * Conteúdo de data/js/sku_*.js (window.APOLLO_NETWORK_DATA = …) ou JSON equivalente.
 */
"use strict";

function parseApolloBundleFileContent(content) {
  const trimmed = String(content).trim();
  let jsonStr;
  if (/window\.APOLLO_NETWORK_DATA\s*=/i.test(trimmed)) {
    jsonStr = trimmed.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/i, "").replace(/;\s*$/s, "");
  } else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end < start) throw new Error("JSON inválido no bundle");
    jsonStr = trimmed.slice(start, end + 1);
  }
  return JSON.parse(jsonStr);
}

module.exports = { parseApolloBundleFileContent };

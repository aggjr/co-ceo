/**
 * Consolida TODOS os SKUs em data/js/sku_*.js em uma matriz loja × produto
 * para apresentação ao cliente (substituição / evolução do StockSpin).
 *
 * Saídas:
 *   data/client/network_matrix.json  — app / integração
 *   data/client/network_matrix.csv   — Excel / BI
 *
 * Uso: node build_client_network_matrix.js
 */
const fs = require("fs");
const path = require("path");
const { isClosedRetailStore } = require(path.join(__dirname, "lib", "closed_retail_stores"));

const JS_DIR = path.join(__dirname, "data", "js");
const OUT_DIR = path.join(__dirname, "data", "client");

function parseApolloJs(content) {
  const trimmed = content.trim();
  let jsonStr;
  if (/window\.APOLLO_NETWORK_DATA\s*=/i.test(trimmed)) {
    jsonStr = trimmed.replace(/^\s*window\.APOLLO_NETWORK_DATA\s*=\s*/i, "").replace(/;\s*$/s, "");
  } else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end < start) throw new Error("JSON não encontrado");
    jsonStr = trimmed.slice(start, end + 1);
  }
  return JSON.parse(jsonStr);
}

function isFactoryStore(name) {
  const n = String(name || "").toLowerCase();
  return n.includes("fábrica") || n.includes("fabrica") || n.includes(" cd") || n === "cd" || n.endsWith(" cd");
}

function prioridade(m) {
  const rup = Number(m.ruptureRate) || 0;
  const lost = Number(m.lostUnits) || 0;
  const sug = Number(m.estoqueSugestao) || 0;
  if (rup >= 30 || (lost > 40 && sug > 0)) return "CRÍTICO";
  if (rup >= 18 || sug >= 3) return "ATENÇÃO";
  if (sug <= -3) return "EXCESSO";
  return "EQUILIBRADO";
}

function acaoSugerida(m) {
  const sug = Math.round(Number(m.estoqueSugestao) || 0);
  if (sug > 0) return `Repor +${sug} u (vs. alvo P150)`;
  if (sug < 0) return `Excedente ${sug} u — transferir, ajustar pedido ou campanha`;
  return "Manter — alinhado ao alvo";
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function main() {
  if (!fs.existsSync(JS_DIR)) {
    console.error("Pasta não encontrada:", JS_DIR);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(JS_DIR).filter((f) => /^sku_\d+\.js$/i.test(f));
  files.sort((a, b) => {
    const na = parseInt(a.match(/\d+/)[0], 10);
    const nb = parseInt(b.match(/\d+/)[0], 10);
    return na - nb;
  });

  const rows = [];
  let errors = 0;
  const t0 = Date.now();

  for (let i = 0; i < files.length; i++) {
    if (i % 400 === 0) console.log(`Lendo ${i + 1} / ${files.length}...`);
    const fullPath = path.join(JS_DIR, files[i]);
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const data = parseApolloJs(content);
      const info = data.info || {};
      const skuId = info.id != null ? info.id : parseInt(files[i].match(/\d+/)[0], 10);
      const results = data.results || {};

      for (const storeName of Object.keys(results)) {
        if (isClosedRetailStore(storeName)) continue;
        const block = results[storeName];
        if (!block || !block.metrics) continue;

        const m = block.metrics;
        rows.push({
          sku_internal_id: skuId,
          erp_code: info.code != null ? String(info.code) : "",
          product_name: info.name != null ? String(info.name) : "",
          store: storeName,
          is_factory_or_cd: isFactoryStore(storeName),
          disponivel: m.currentAvailable != null ? m.currentAvailable : m.currentAvailable === 0 ? 0 : null,
          fisico: m.currentPhysical != null ? m.currentPhysical : null,
          vitrine: m.vitrine,
          min_stock: m.minStock != null ? m.minStock : null,
          alvo_p150: m.estoqueReposicao != null ? m.estoqueReposicao : null,
          sugestao_unidades: m.estoqueSugestao != null ? Math.round(m.estoqueSugestao) : null,
          ruptura_pct: m.ruptureRate != null ? Number(Number(m.ruptureRate).toFixed(4)) : null,
          unidades_perdidas_estimadas: m.lostUnits != null ? Number(Number(m.lostUnits).toFixed(4)) : null,
          prioridade: prioridade(m),
          acao_sugerida: acaoSugerida(m),
          data_file: files[i],
        });
      }
    } catch (e) {
      errors++;
      if (errors <= 15) console.error(`Erro ${files[i]}:`, e.message);
    }
  }

  const meta = {
    generated_at: new Date().toISOString(),
    sku_files: files.length,
    matrix_rows: rows.length,
    parse_errors: errors,
    description:
      "Matriz consolidada loja × produto a partir dos artefatos data/js/sku_*.js (motor Apollo / rede). " +
      "Use para apresentação ao cliente e priorização de compra/transferência.",
    columns: {
      sugestao_unidades: "Positivo = falta para atingir alvo P150; negativo = excedente.",
      ruptura_pct: "Percentual de dias (na janela do motor) com disponível abaixo de P10.",
      unidades_perdidas_estimadas: "Estimativa acumulada do motor em ruptura (ver documentação do motor).",
    },
  };

  const jsonPath = path.join(OUT_DIR, "network_matrix.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ meta, rows }, null, 0), "utf8");

  const headers = [
    "sku_internal_id",
    "erp_code",
    "product_name",
    "store",
    "is_factory_or_cd",
    "disponivel",
    "fisico",
    "vitrine",
    "min_stock",
    "alvo_p150",
    "sugestao_unidades",
    "ruptura_pct",
    "unidades_perdidas_estimadas",
    "prioridade",
    "acao_sugerida",
    "data_file",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      headers
        .map((h) => csvEscape(r[h]))
        .join(",")
    );
  }
  const csvPath = path.join(OUT_DIR, "network_matrix.csv");
  fs.writeFileSync(csvPath, "\uFEFF" + lines.join("\n"), "utf8");

  const ms = Date.now() - t0;
  console.log("Pronto.");
  console.log("  JSON:", jsonPath, "(" + (fs.statSync(jsonPath).size / 1e6).toFixed(2), "MB)");
  console.log("  CSV: ", csvPath, "(" + (fs.statSync(csvPath).size / 1e6).toFixed(2), "MB)");
  console.log("  Linhas:", rows.length, "| SKUs:", files.length, "| erros:", errors, "| tempo:", (ms / 1000).toFixed(1), "s");
}

main();

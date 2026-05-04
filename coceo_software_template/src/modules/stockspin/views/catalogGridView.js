import { ExcelTable } from "../../../components/ExcelTable.js";
import { loadClientScript, stockspinDataBase, invalidateClientScript } from "../loadClientScript.js";
import "../stockspin-excel.css";

function isHubStoreName(name) {
    const n = String(name || "");
    return n === "Fábrica" || n === "CD SARON" || /fábrica|fabrica/i.test(n);
}

function extractStockHealthSkuIds(filterPack) {
    if (!window.STOCK_HEALTH_HISTOGRAM_DATA || typeof window.STOCK_HEALTH_HISTOGRAM_DATA !== "object") return null;
    if (!filterPack || filterPack.source !== "stock_health" || !filterPack.status) return null;
    const d = window.STOCK_HEALTH_HISTOGRAM_DATA;
    const byStore = d.by_store || {};
    const status = filterPack.status;
    const out = new Set();
    if (filterPack.store && filterPack.store !== "TOTAL") {
        const block = byStore[filterPack.store];
        const arr =
            block && block.sku_ids_by_status && Array.isArray(block.sku_ids_by_status[status])
                ? block.sku_ids_by_status[status]
                : [];
        for (const id of arr) {
            const n = Number(id);
            if (Number.isFinite(n) && n > 0) out.add(n);
        }
        return out;
    }
    const stores = Array.isArray(d.stores) ? d.stores : Object.keys(byStore);
    for (const st of stores) {
        if (filterPack.scope !== "full" && isHubStoreName(st)) continue;
        const block = byStore[st];
        const arr =
            block && block.sku_ids_by_status && Array.isArray(block.sku_ids_by_status[status])
                ? block.sku_ids_by_status[status]
                : [];
        for (const id of arr) {
            const n = Number(id);
            if (Number.isFinite(n) && n > 0) out.add(n);
        }
    }
    return out;
}

function readStockHealthFilterFromLocation() {
    const urlParams = new URLSearchParams(window.location.search || "");
    return {
        source: String(urlParams.get("source") || "").trim(),
        status: String(urlParams.get("status") || "").trim(),
        store: String(urlParams.get("store") || "").trim(),
        scope: String(urlParams.get("scope") || "").trim()
    };
}

function applyStockHealthFilterIfAny(rows, filterPack, hintEl) {
    if (!filterPack || filterPack.source !== "stock_health" || !filterPack.status) {
        return rows;
    }
    let filtered = rows;
    const ids = extractStockHealthSkuIds(filterPack);
    if (ids && ids.size > 0) {
        filtered = rows.filter((r) => ids.has(Number(r.id)));
    } else {
        const want = filterPack.status.toUpperCase();
        filtered = rows.filter((r) => String(r.curtainStatus || "").toUpperCase() === want);
    }
    if (hintEl) {
        const storeLbl = filterPack.store || "TOTAL";
        const scopeLbl =
            filterPack.store && filterPack.store !== "TOTAL"
                ? "unidade selecionada"
                : filterPack.scope === "full"
                  ? "rede completa"
                  : "só lojas";
        hintEl.style.display = "block";
        hintEl.textContent =
            `Filtro (Saúde do Estoque): ${filterPack.status} · ${storeLbl} · ${scopeLbl} · ${filtered.length} SKU(s).`;
    }
    return filtered;
}

// ── Badge de estado do cadastro (Ativo / Inativo) ──────────────────────────
function cadastroEstadoBadge(item) {
    const label = item.cadastroEstado || "—";
    const span = document.createElement("span");
    span.textContent = label;

    /* Tamanho e formato idênticos ao restante da tabela */
    span.style.fontSize = "12px";
    span.style.fontWeight = "600";
    span.style.padding = "3px 8px";
    span.style.borderRadius = "6px";
    span.style.display = "inline-block";
    span.style.maxWidth = "200px";
    span.style.whiteSpace = "nowrap";
    span.style.lineHeight = "1.35";

    /* Paleta de cor de fundo; fonte sempre escura */
    let bg = "rgba(148,163,184,.25)";
    let fg = "#0f172a";
    if (label === "Ativo") {
        bg = "rgba(16,185,129,.22)";
        fg = "#065f46";
    } else if (label === "Inativo") {
        bg = "rgba(100,116,139,.35)";
        fg = "#334155";
    } else if (label === "Excluído (cadastro)") {
        bg = "rgba(239,68,68,.25)";
        fg = "#991b1b";
    } else if (label === "Sendo inativado") {
        bg = "rgba(245,158,11,.28)";
        fg = "#92400e";
    } else if (label === "Sendo inserido" || label.startsWith("Em processamento") || label === "Sendo processado") {
        bg = "rgba(59,130,246,.25)";
        fg = "#1e3a8a";
    }
    span.style.background = bg;
    span.style.color = fg;
    return span;
}

function readGlobalCatalogGrid() {
    if (typeof window !== "undefined" && typeof window.CATALOG_GRID !== "undefined") return window.CATALOG_GRID;
    if (typeof CATALOG_GRID !== "undefined") return CATALOG_GRID;
    return undefined;
}

function readGlobalCurtainData() {
    if (typeof window !== "undefined" && typeof window.CURTAIN_DATA !== "undefined") return window.CURTAIN_DATA;
    if (typeof CURTAIN_DATA !== "undefined") return CURTAIN_DATA;
    return undefined;
}

/**
 * Tenta carregar catalog_grid (+ curtain) da origem Vite em dev/preview ou da base STOCKSPIN configurada.
 */
async function resolveCatalogDataBase(staticBase) {
    const bases = [];
    if (import.meta.env.DEV || (typeof window !== "undefined" && window.location.port === "4173")) {
        bases.push(`${window.location.origin}/co-ceo-stockspin-static`);
    }
    const norm = String(staticBase || "").replace(/\/+$/, "");
    if (norm) bases.push(norm);

    const errors = [];
    for (const b of bases) {
        const gridUrl = `${b}/data/catalog_grid.js`;
        const curtainUrl = `${b}/curtain_production_data.js`;
        try {
            invalidateClientScript(gridUrl);
            invalidateClientScript(curtainUrl);
            await loadClientScript(gridUrl, { force: true });
            if (typeof readGlobalCatalogGrid() === "undefined") {
                errors.push(`${gridUrl} não definiu CATALOG_GRID`);
                continue;
            }
            try {
                await loadClientScript(curtainUrl, { force: true });
            } catch (w) {
                console.warn("[catalog] curtain opcional:", w);
            }
            return b;
        } catch (e) {
            errors.push(String(e.message || e));
        }
    }
    throw new Error(errors.join(" · ") || "Nenhuma origem disponível para o catálogo.");
}

/**
 * Totais no rodapé das linhas visíveis (filtro/ordenação) + concentração do faturamento (top SKUs).
 */
function buildCatalogFooterAggregate({ currentData, formatCurrency }) {
    const wrap = document.createElement("div");
    wrap.style.display = "inline-flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px 14px";
    wrap.style.alignItems = "baseline";
    wrap.style.justifyContent = "flex-end";

    const rows = Array.isArray(currentData) ? currentData : [];
    if (rows.length === 0) {
        const em = document.createElement("span");
        em.textContent = "Sem linhas para totalizar.";
        em.style.opacity = "0.85";
        wrap.appendChild(em);
        return wrap;
    }

    let sumV = 0;
    let sumL = 0;
    let sumU = 0;
    let sumQ12 = 0;
    let wr = 0;
    let wv = 0;

    for (const r of rows) {
        sumV += Number(r.vendaBruta12m) || 0;
        sumL += Number(r.lucroBruto12m) || 0;
        sumU += Number(r.totalSales) || 0;
        sumQ12 += Number(r.quantidadeVendas12m) || 0;
        const vi = Number(r.vendaBruta12m) || 0;
        const ri = Number(r.rupturaPonderadaVendasPct);
        if (vi > 0 && Number.isFinite(ri)) {
            wr += ri * vi;
            wv += vi;
        }
    }

    const margPct = sumV > 0 ? (sumL / sumV) * 100 : null;
    const ruptPond = wv > 0 ? wr / wv : null;

    const sorted = [...rows].sort((a, b) => (Number(b.vendaBruta12m) || 0) - (Number(a.vendaBruta12m) || 0));
    const topN = Math.min(10, sorted.length);
    let top10v = 0;
    for (let i = 0; i < topN; i++) {
        top10v += Number(sorted[i].vendaBruta12m) || 0;
    }
    const shareTop = sumV > 0 && topN > 0 ? (top10v / sumV) * 100 : null;

    const chip = (label, valueText) => {
        const s = document.createElement("span");
        s.style.whiteSpace = "nowrap";
        const b = document.createElement("strong");
        b.textContent = label;
        b.style.fontWeight = "700";
        s.appendChild(b);
        s.appendChild(document.createTextNode("\u00A0" + valueText));
        return s;
    };

    wrap.appendChild(chip("Tot. venda 12m:", formatCurrency(sumV)));
    wrap.appendChild(
        chip("Tot. qtd. vendas (12m):", `${sumQ12.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}\u00A0un`)
    );
    wrap.appendChild(chip("Tot. lucro:", formatCurrency(sumL)));
    wrap.appendChild(
        chip("Margem s/ faturamento:", margPct != null ? `${margPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—")
    );
    wrap.appendChild(
        chip(
            "Ruptura média (pond. venda):",
            ruptPond != null ? `${ruptPond.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"
        )
    );
    wrap.appendChild(chip("Tot. volume (rede):", `${sumU.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}\u00A0un`));
    if (shareTop != null && topN >= 1) {
        wrap.appendChild(
            chip(`Top ${topN} SKUs (% venda 12m):`, `${shareTop.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`)
        );
    }

    const hint = document.createElement("span");
    hint.style.fontSize = "10px";
    hint.style.opacity = "0.82";
    hint.style.marginLeft = "6px";
    hint.textContent = "· visíveis após filtros";
    wrap.appendChild(hint);

    return wrap;
}

export async function mount(mainEl) {
    const base = stockspinDataBase();
    mainEl.classList.add("stockspin-in-app");
    mainEl.innerHTML = `
<div class="stockspin-panel" style="padding:8px 10px 10px;gap:6px;display:flex;flex-direction:column;flex:1;min-height:0;">
  <p id="cg-hint" class="stockspin-meta" style="display:none;margin:0;font-size:12px;"></p>
  <div id="cg-grid" class="stockspin-table-root" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;"></div>
</div>`;

    const hintEl = mainEl.querySelector("#cg-hint");
    const gridEl = mainEl.querySelector("#cg-grid");

    let catalogDataBase = base;
    try {
        catalogDataBase = await resolveCatalogDataBase(base);
    } catch (e) {
        const errTxt = String(e.message || e)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        gridEl.innerHTML = `
<div style="padding:1rem 1.25rem;color:#fecaca;line-height:1.55;max-width:42rem;">
  <p style="margin:0 0 0.75rem;font-weight:700;">Não foi possível carregar o catálogo</p>
  <p style="margin:0 0 1rem;font-size:0.9rem;word-break:break-word;">${errTxt}</p>
  <ul style="margin:0;padding-left:1.2rem;font-size:0.85rem;color:#cbd5e1;">
    <li>Reinicie o <code>npm run dev</code> (o Vite expõe <code>/co-ceo-stockspin-static/</code> com ficheiros da pasta pai do frontend, ex. <code>data/catalog_grid.js</code>).</li>
    <li>Ou configure o servidor em <code>${base}</code> para servir o mesmo conteúdo que o Stockspin (incluindo <code>data/catalog_grid.js</code>).</li>
    <li>Gere o ficheiro na raiz do legado: <code>node apollo_grid_miner.js</code></li>
  </ul>
</div>`;
        return;
    }

    const filterPack = readStockHealthFilterFromLocation();
    if (filterPack.source === "stock_health" && filterPack.status) {
        try {
            await loadClientScript(`${catalogDataBase}/data/client/stock_health_histogram.js`);
        } catch (_) {
            /* opcional */
        }
    }

    const curtainData = readGlobalCurtainData();
    const productionMap = {};
    if (curtainData && curtainData.items) {
        curtainData.items.forEach((item) => {
            productionMap[item.id] = item;
        });
    }

    const catalogGrid = readGlobalCatalogGrid();
    if (typeof catalogGrid === "undefined") {
        gridEl.innerHTML =
            `<p style="padding:1rem;color:#f87171;">Não foi possível carregar <code>data/catalog_grid.js</code> em ${base}.</p>`;
        return;
    }

    let rows = Array.isArray(catalogGrid) ? [...catalogGrid] : [];
    const finance12mInBundle =
        rows.length === 0 ||
        rows.some((r) => r && Object.prototype.hasOwnProperty.call(r, "vendaBruta12m"));

    rows.forEach((row) => {
        const prod = productionMap[row.id];
        row.curtainStatus = prod ? prod.status : "—";
        row.sugestao = prod ? prod.sugestao : 0;
        row.priority = prod ? prod.priority : 99;
        if (!row.cadastroEstado) {
            if (row.indDeletado) row.cadastroEstado = "Excluído (cadastro)";
            else if (row.legacyAtivo) row.cadastroEstado = "Ativo";
            else row.cadastroEstado = "Inativo";
        }
        if (row.legacyStatus == null) row.legacyStatus = "";
        if (row.idExterno == null) row.idExterno = "";
        row.vendaBruta12m = row.vendaBruta12m != null ? Number(row.vendaBruta12m) : 0;
        row.quantidadeVendas12m =
            row.quantidadeVendas12m != null && Number.isFinite(Number(row.quantidadeVendas12m))
                ? Number(row.quantidadeVendas12m)
                : 0;
        row.lucroBruto12m = row.lucroBruto12m != null ? Number(row.lucroBruto12m) : 0;
        row.pctLucro12m = row.pctLucro12m != null && Number.isFinite(Number(row.pctLucro12m)) ? Number(row.pctLucro12m) : null;
        row.rupturaPonderadaVendasPct =
            row.rupturaPonderadaVendasPct != null && Number.isFinite(Number(row.rupturaPonderadaVendasPct))
                ? Number(row.rupturaPonderadaVendasPct)
                : null;
    });
    rows = applyStockHealthFilterIfAny(rows, filterPack, hintEl);

    if (!finance12mInBundle) {
        const staleMsg =
            "O ficheiro data/catalog_grid.js está desatualizado (sem colunas de venda 12m). " +
            "A ordenação por «Venda Bruta (12m)» não altera a lista e os valores aparecem como R$ 0,00. " +
            "Na raiz do projeto execute node apollo_grid_miner.js — mesma base SQL do Plano CD — e recarregue a página.";
        hintEl.style.display = "block";
        hintEl.textContent = hintEl.textContent ? `${staleMsg} ${hintEl.textContent}` : staleMsg;
    }

    // ── CSS de tema para o Catálogo Grid ─────────────────────────────────────
    // ESTRATÉGIA: O ExcelTable.js já define --row-bg em cada <tr> via JS:
    //   - zebra: rowEvenBg (#ffffff) ou rowOddBg (#dbeafe)
    //   - hover: rowHoverBg (#edd8bb) no mouseenter/mouseleave
    // CSS custom properties são herdadas pelos filhos, então basta um único
    // seletor `td { background-color: var(--row-bg) }` para que TODOS os TDs
    // (sticky e não-sticky) respondam à mesma variável. Isso elimina o conflito
    // entre células sticky (JS-driven) e não-sticky (sem background definido).
    const catalogGridThemeFix = document.createElement("style");
    catalogGridThemeFix.textContent = `
      /* Tabela: não expandir a 1ª coluna para preencher o viewport */
      #cg-grid .table-wrapper table {
        width: max-content !important;
        table-layout: fixed !important;
      }

      /* ── Cabeçalho: cor primária uniforme em todos os TH ─────────────── */
      #cg-grid .table-wrapper table thead tr th {
        background-color: var(--color-primary) !important;
        color: #ffffff !important;
      }

      /* ── Corpo: fonte preta, tamanho uniforme ────────────────────────── */
      #cg-grid .table-wrapper table tbody tr.hoverable-row td {
        background-color: var(--row-bg) !important;
        color: #0f172a !important;
        font-size: 12px !important;
        border-bottom: 1px solid rgba(0,0,0,0.08) !important;
        transition: background-color 0.12s ease;
      }
      #cg-grid .table-wrapper table tbody tr.hoverable-row:hover td {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      #cg-grid .table-wrapper table tbody tr.hoverable-row td[style*="position: sticky"] {
        background-color: var(--row-bg) !important;
      }
      #cg-grid .table-wrapper table tbody tr.hoverable-row:hover td[style*="position: sticky"] {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      #cg-grid .table-wrapper table tbody tr.hoverable-row td a {
        color: #0f172a !important;
      }

      /* ── Rodapé de sumário: texto bem visível (dourado/branco) ──────── */
      #cg-grid .table-footer-summary {
        background: rgba(10, 28, 52, 0.97) !important;
        border-top: 1px solid rgba(218,177,119,0.35) !important;
        padding: 0.6rem 1rem !important;
      }
      #cg-grid .table-footer-summary,
      #cg-grid .table-footer-summary * {
        color: #f5cf96 !important;
        font-size: 0.9rem !important;
      }
      #cg-grid .table-footer-summary strong {
        color: #ffffff !important;
        font-weight: 700 !important;
      }
    `;
    gridEl.appendChild(catalogGridThemeFix);

    // ── Definição das colunas ─────────────────────────────────────────────────
    // ORDEM: CÓDIGO (sticky) → DESCRIÇÃO (sticky) → STATUS cadastro → categorias → financeiro 12m (+ qtd legado) → volume bundle (rede)
    const COL_TEXT_COLOR = "#0f172a"; // preto para todos os renders manuais

    const columns = [
        // 1. CÓDIGO — sticky, fixo à esquerda
        {
            key: "code",
            label: "Código",
            type: "number",
            width: "2cm",
            align: "center",
            sticky: true,
            render: (item) => {
                const id = item.id != null ? String(item.id) : "";
                const a = document.createElement("a");
                a.href = id ? `${base}/ceo_product_detail_layout.html?sku=${encodeURIComponent(id)}&hub=1` : "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = item.code != null && item.code !== "" ? String(item.code) : "—";
                a.style.color = COL_TEXT_COLOR;
                a.style.textDecoration = "none";
                a.style.fontWeight = "600";
                a.style.fontSize = "12px";
                a.style.display = "inline-block";
                a.style.maxWidth = "100%";
                a.style.textAlign = "center";
                a.onmouseenter = () => {
                    a.style.textDecoration = "underline";
                };
                a.onmouseleave = () => {
                    a.style.textDecoration = "none";
                };
                return a;
            }
        },

        // 2. DESCRIÇÃO — sticky, rolagem lateral fixa junto ao código
        {
            key: "name",
            label: "Descrição",
            type: "text",
            width: "200px",
            align: "center",
            sticky: true,
            wrap: true,
            render: (item) => {
                const id = item.id != null ? String(item.id) : "";
                const a = document.createElement("a");
                a.href = id ? `${base}/ceo_product_detail_layout.html?sku=${encodeURIComponent(id)}&hub=1` : "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = item.name || "—";
                a.style.color = COL_TEXT_COLOR;
                a.style.textDecoration = "none";
                a.style.fontWeight = "600";
                a.style.fontSize = "12px";
                a.style.display = "block";
                a.style.textAlign = "center";
                a.style.whiteSpace = "normal";
                a.style.wordBreak = "break-word";
                a.style.lineHeight = "1.2";
                a.onmouseenter = () => {
                    a.style.textDecoration = "underline";
                };
                a.onmouseleave = () => {
                    a.style.textDecoration = "none";
                };
                return a;
            }
        },

        // 3. STATUS — coluna móvel (reordenável)
        {
            key: "cadastroEstado",
            label: "Status",
            type: "text",
            width: "88px",
            align: "center",
            render: (item) => cadastroEstadoBadge(item)
        },

        // 4. Categoria principal
        {
            key: "category",
            label: "Categoria",
            type: "text",
            width: "90px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = item.category || "—";
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "center";
                return s;
            }
        },

        // 5. Sub-categoria
        {
            key: "subcategory",
            label: "Sub-Categoria",
            type: "text",
            width: "105px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = item.subcategory || "—";
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "center";
                return s;
            }
        },

        // 6–9. Mesma base numérica do Plano CD / apollo_grid_miner (PrecoRealVenda → tabela; ruptura ponderada pelo volume na janela)
        {
            key: "vendaBruta12m",
            label: "Venda Bruta<br>(12m)",
            type: "currency",
            width: "118px",
            align: "center",
            render: (item) => {
                const span = document.createElement("span");
                const n = Number(item.vendaBruta12m);
                span.textContent = Number.isFinite(n)
                    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
                    : "—";
                span.style.fontWeight = "600";
                span.style.color = COL_TEXT_COLOR;
                span.style.fontSize = "12px";
                span.style.display = "block";
                span.style.width = "100%";
                span.style.textAlign = "center";
                return span;
            }
        },
        {
            key: "quantidadeVendas12m",
            label: "Qtd. vendas<br>(12m)",
            type: "number",
            width: "108px",
            align: "center",
            render: (item) => {
                const span = document.createElement("span");
                const n = Number(item.quantidadeVendas12m);
                span.textContent = Number.isFinite(n)
                    ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}\u00A0un`
                    : "—";
                span.style.fontWeight = "600";
                span.style.color = COL_TEXT_COLOR;
                span.style.fontSize = "12px";
                span.style.display = "block";
                span.style.width = "100%";
                span.style.textAlign = "center";
                return span;
            }
        },
        {
            key: "lucroBruto12m",
            label: "Lucro<br>Bruto",
            type: "currency",
            width: "118px",
            align: "center",
            render: (item) => {
                const span = document.createElement("span");
                const n = Number(item.lucroBruto12m);
                span.textContent = Number.isFinite(n)
                    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
                    : "—";
                span.style.fontWeight = "600";
                span.style.color = COL_TEXT_COLOR;
                span.style.fontSize = "12px";
                span.style.display = "block";
                span.style.width = "100%";
                span.style.textAlign = "center";
                return span;
            }
        },
        {
            key: "pctLucro12m",
            label: "%<br>Lucro",
            type: "number",
            width: "76px",
            align: "center",
            render: (item) => {
                const span = document.createElement("span");
                const n = item.pctLucro12m;
                span.textContent = n != null && Number.isFinite(Number(n)) ? `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—";
                span.style.fontWeight = "600";
                span.style.color = COL_TEXT_COLOR;
                span.style.fontSize = "12px";
                span.style.display = "block";
                span.style.width = "100%";
                span.style.textAlign = "center";
                return span;
            }
        },
        {
            key: "rupturaPonderadaVendasPct",
            label: "% Ruptura<br>média",
            type: "number",
            width: "96px",
            align: "center",
            render: (item) => {
                const span = document.createElement("span");
                const n = item.rupturaPonderadaVendasPct;
                span.textContent = n != null && Number.isFinite(Number(n)) ? `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—";
                span.style.fontWeight = "600";
                span.style.color = COL_TEXT_COLOR;
                span.style.fontSize = "12px";
                span.style.display = "block";
                span.style.width = "100%";
                span.style.textAlign = "center";
                return span;
            }
        },

        // 10. Volume de vendas na rede (timeline bundle, unidades)
        {
            key: "totalSales",
            label: "Total Venda<br>Hist.",
            type: "number",
            width: "116px",
            align: "center",
            render: (item) => {
                const span = document.createElement("span");
                const n = Number(item.totalSales) || 0;
                span.textContent = `${n.toLocaleString("pt-BR")} un`;
                span.style.fontWeight = "700";
                span.style.color = "#065f46";
                span.style.fontSize = "12px";
                span.style.display = "block";
                span.style.width = "100%";
                span.style.textAlign = "center";
                return span;
            }
        }
    ];

    const tableRows = rows.map((row) => ({
        id: String(row.id != null ? row.id : row.code),
        ...row
    }));

    const excel = new ExcelTable({
        container: gridEl,
        columns,
        gridId: 'catalog-grid-v12',
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        fixedLeadingColumns: 2,
        /** Código ~2cm; impede larguras corrompidas no localStorage */
        /* Padrão continua 2cm na definição da coluna; limites só evitam valores absurdos e permitem ampliar bastante */
        columnWidthLimits: {
            code: { minPx: 36, maxPx: 480 },
            name: { minPx: 120, maxPx: 420 }
        },
        summaryLabels: { total: "Produtos listados", selected: "" },
        footerAggregate: (ctx) => buildCatalogFooterAggregate(ctx),
        tableTheme: {
            rowEvenBg: "#ffffff",
            rowOddBg: "#dbeafe",
            rowHoverBg: "#edd8bb",
            textColor: "#0f172a",
            bodyFontSize: "12px"
        }
    });

    const paintFooterGold = () => {
        const footer = gridEl.querySelector(".table-footer-summary");
        if (!footer) return;
        footer.style.color = "#f5cf96";
        footer.querySelectorAll("*").forEach((el) => {
            if (el.tagName === "STRONG") {
                el.style.color = "#f5cf96";
            } else if (!el.style.color) {
                el.style.color = "#f5cf96";
            }
        });
    };

    const originalRender = excel.render.bind(excel);
    excel.render = (data) => {
        originalRender(data);
        paintFooterGold();
    };

    excel.render(tableRows);
}

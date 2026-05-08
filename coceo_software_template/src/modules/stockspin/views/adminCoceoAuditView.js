import { ExcelTable } from "../../../components/ExcelTable.js";
import { loadClientScript, stockspinDataBase, invalidateClientScript } from "../loadClientScript.js";
import "../stockspin-excel.css";

/**
 * Tela "Divergências ADMIN × CO-CEO".
 *
 * Lê `data/client/admin_coceo_audit.js` (gerado por
 * `scripts/build_admin_coceo_audit_view.js` a partir do último relatório
 * `reports/admin_coceo_store_audit_*.json`).
 *
 * Toda a busca/filtragem/ordenação é feita pela própria ExcelTable (filtro
 * por coluna nativo, sort por header), espelhando o pattern do
 * `catalogGridView` (Mix de Produtos). Sem barra de filtros customizada.
 */

const COL_TEXT_COLOR = "#0f172a";

const fmtNum = (n, frac = 2) =>
    n == null || !Number.isFinite(Number(n))
        ? "—"
        : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: frac });
const fmtInt = (n) =>
    n == null || !Number.isFinite(Number(n))
        ? "—"
        : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/** Cores dos badges (fundo claro, texto escuro). */
const MOTIVO_COLOR = {
    ADMIN_STALE: { bg: "rgba(245,158,11,.28)", fg: "#92400e", border: "rgba(245,158,11,.55)" },
    STORE_LEVEL: { bg: "rgba(59,130,246,.25)", fg: "#1e3a8a", border: "rgba(59,130,246,.55)" },
    ORPHAN_LEGACY: { bg: "rgba(168,85,247,.25)", fg: "#581c87", border: "rgba(168,85,247,.55)" },
    ALINHADO: { bg: "rgba(16,185,129,.22)", fg: "#065f46", border: "rgba(16,185,129,.55)" }
};
function motivoColors(codigo) {
    if (MOTIVO_COLOR[codigo]) return MOTIVO_COLOR[codigo];
    if (String(codigo || "").startsWith("MIXED:")) {
        return { bg: "rgba(244,114,182,.25)", fg: "#9d174d", border: "rgba(244,114,182,.55)" };
    }
    return { bg: "rgba(148,163,184,.28)", fg: "#334155", border: "rgba(148,163,184,.55)" };
}

function motivoBadge(row) {
    const span = document.createElement("span");
    span.textContent = row.motivo || row.motivo_codigo || "—";
    const c = motivoColors(row.motivo_codigo);
    span.style.fontSize = "12px";
    span.style.fontWeight = "600";
    span.style.padding = "3px 8px";
    span.style.borderRadius = "6px";
    span.style.display = "inline-block";
    span.style.maxWidth = "180px";
    span.style.whiteSpace = "nowrap";
    span.style.overflow = "hidden";
    span.style.textOverflow = "ellipsis";
    span.style.lineHeight = "1.35";
    span.style.background = c.bg;
    span.style.color = c.fg;
    span.style.border = `1px solid ${c.border}`;
    span.title = (row.motivo_codigo || "") + (row.motivo ? ` — ${row.motivo}` : "");
    return span;
}

function deltaCell(value) {
    const span = document.createElement("span");
    const n = Number(value);
    span.textContent = Number.isFinite(n) ? fmtNum(n) : "—";
    span.style.fontWeight = "700";
    span.style.fontSize = "12px";
    span.style.display = "block";
    span.style.width = "100%";
    span.style.textAlign = "right";
    if (Number.isFinite(n)) {
        if (n > 0.01) span.style.color = "#9a3412";
        else if (n < -0.01) span.style.color = "#991b1b";
        else span.style.color = "#065f46";
    } else {
        span.style.color = COL_TEXT_COLOR;
    }
    return span;
}

function csvEscape(v) {
    const s = v == null ? "" : String(v);
    if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsv(filename, headers, keys, rows) {
    const lines = [headers.join(";")];
    for (const r of rows) lines.push(keys.map((k) => csvEscape(r[k])).join(";"));
    /** Excel pt-BR abre melhor com BOM UTF-8 + ";" como separador. */
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 200);
}

export async function mount(mainEl) {
    const base = stockspinDataBase();
    mainEl.classList.add("stockspin-in-app");
    mainEl.innerHTML = `
<div class="stockspin-panel" style="padding:8px 10px 10px;gap:8px;display:flex;flex-direction:column;flex:1;min-height:0;">
  <p id="adv-meta" class="stockspin-meta" style="margin:0;font-size:12px;"></p>
  <div id="adv-grid" class="stockspin-table-root" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;"></div>
  <div id="adv-toolbar" style="display:flex;gap:8px;align-items:center;justify-content:flex-end;font-size:12px;">
    <button type="button" id="adv-reload" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(218,177,119,.45);background:rgba(9,28,56,.85);color:var(--color-accent);cursor:pointer;font-weight:600;">Recarregar dados</button>
    <button type="button" id="adv-export" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(218,177,119,.45);background:rgba(9,28,56,.85);color:var(--color-accent);cursor:pointer;font-weight:600;">Baixar planilha (.csv)</button>
  </div>
</div>`;

    const metaEl = mainEl.querySelector("#adv-meta");
    const gridEl = mainEl.querySelector("#adv-grid");
    const exportBtn = mainEl.querySelector("#adv-export");
    const reloadBtn = mainEl.querySelector("#adv-reload");

    /**
     * Tema visual idêntico ao catálogo (Mix de Produtos): zebra branca/azul,
     * cabeçalho azul primário, hover laranja-creme, rodapé navy + dourado.
     */
    const themeFix = document.createElement("style");
    themeFix.textContent = `
      #adv-grid .table-wrapper {
        background: #ffffff !important;
        border: 1px solid rgba(15,23,42,0.12) !important;
        border-radius: 10px !important;
        box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      }
      #adv-grid .table-wrapper table {
        width: max-content !important;
        table-layout: fixed !important;
      }
      #adv-grid .table-wrapper table thead tr th {
        background-color: var(--color-primary) !important;
        color: #ffffff !important;
      }
      #adv-grid .table-wrapper table tbody tr.hoverable-row td {
        background-color: var(--row-bg) !important;
        color: ${COL_TEXT_COLOR} !important;
        font-size: 12px !important;
        border-bottom: 1px solid rgba(0,0,0,0.08) !important;
        transition: background-color 0.12s ease;
      }
      #adv-grid .table-wrapper table tbody tr.hoverable-row:hover td {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      #adv-grid .table-wrapper table tbody tr.hoverable-row td[style*="position: sticky"] {
        background-color: var(--row-bg) !important;
      }
      #adv-grid .table-wrapper table tbody tr.hoverable-row:hover td[style*="position: sticky"] {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      #adv-grid .table-wrapper table tbody tr.hoverable-row td a {
        color: ${COL_TEXT_COLOR} !important;
      }
      #adv-grid .table-footer-summary {
        background: rgba(10,28,52,0.97) !important;
        border-top: 1px solid rgba(218,177,119,0.35) !important;
        padding: 0.6rem 1rem !important;
      }
      #adv-grid .table-footer-summary,
      #adv-grid .table-footer-summary * {
        color: #f5cf96 !important;
        font-size: 0.9rem !important;
      }
      #adv-grid .table-footer-summary strong {
        color: #ffffff !important;
        font-weight: 700 !important;
      }
    `;
    gridEl.appendChild(themeFix);

    let payload = null;
    let allRows = [];

    async function loadPayload(force) {
        const url = `${base}/data/client/admin_coceo_audit.js`;
        if (force) invalidateClientScript(url);
        try {
            await loadClientScript(url, { force: !!force });
        } catch (e) {
            metaEl.style.color = "#991b1b";
            metaEl.textContent =
                `Não foi possível carregar ${url}. Confirme que o ficheiro existe no servidor ` +
                "(rode o sincroniza_nuvem_co_ceo.bat) e que o auditor foi gerado " +
                "(node scripts/build_admin_coceo_audit_view.js).";
            return null;
        }
        const data = window.ADMIN_COCEO_AUDIT;
        if (!data || !Array.isArray(data.rows)) {
            metaEl.style.color = "#991b1b";
            metaEl.textContent = "ADMIN_COCEO_AUDIT inválido ou vazio.";
            return null;
        }
        return data;
    }

    /**
     * Definição das colunas. A ExcelTable já oferece, nativamente:
     *  - filtro por coluna (clicando no cabeçalho)
     *  - ordenação por coluna (clique simples no header)
     *  - busca textual incremental no filtro
     *
     * Por isso esta tela NÃO tem barra de filtros customizada.
     */
    const columns = [
        // 1. Código — sticky
        {
            key: "erp_code",
            label: "Código",
            type: "number",
            numberPlain: true,
            width: "90px",
            align: "center",
            sticky: true,
            render: (item) => {
                const id = item.product_id != null ? String(item.product_id) : "";
                const a = document.createElement("a");
                a.href = id ? `${base}/ceo_product_detail_layout.html?sku=${encodeURIComponent(id)}&hub=1` : "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = item.erp_code || "—";
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

        // 2. Produto — sticky
        {
            key: "name",
            label: "Produto",
            type: "text",
            width: "260px",
            align: "center",
            sticky: true,
            wrap: true,
            render: (item) => {
                const id = item.product_id != null ? String(item.product_id) : "";
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

        // 3. Categoria
        {
            key: "category",
            label: "Categoria",
            type: "text",
            width: "120px",
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

        // 4. Sub-Categoria
        {
            key: "subcategory",
            label: "Sub-Categoria",
            type: "text",
            width: "130px",
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

        // 5. Motivo — badge no render; o filtro nativo da ExcelTable busca pela string original.
        {
            key: "motivo",
            label: "Motivo",
            type: "text",
            width: "180px",
            align: "center",
            render: (item) => motivoBadge(item)
        },

        // 4. CO-CEO TOTAL
        {
            key: "coceo_total",
            label: "CO-CEO<br>TOTAL",
            type: "number",
            width: "120px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.coceo_total);
                s.style.fontWeight = "600";
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "right";
                return s;
            }
        },

        // 5. ADMIN comparado
        {
            key: "admin_compared",
            label: "ADMIN<br>(comparado)",
            type: "number",
            width: "140px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.admin_compared);
                s.style.fontWeight = "600";
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "right";
                s.title =
                    `Fonte: ${item.admin_compared_source || "—"}` +
                    (item.admin_produtototalizador != null
                        ? ` · totalizador: ${fmtNum(item.admin_produtototalizador)}`
                        : "") +
                    ` · cadastro produto: ${fmtNum(item.admin_produto_cadastro)}`;
                return s;
            }
        },

        // 6. Δ
        {
            key: "delta_admin_minus_coceo",
            label: "Δ (admin −<br>CO-CEO)",
            type: "number",
            width: "150px",
            align: "center",
            render: (item) => deltaCell(item.delta_admin_minus_coceo)
        },

        // 7. |Δ|
        {
            key: "delta_abs",
            label: "|Δ|",
            type: "number",
            width: "110px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.delta_abs);
                s.style.fontWeight = "700";
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "right";
                return s;
            }
        },

        // 8. #lojas off
        {
            key: "n_stores_with_diff",
            label: "#lojas<br>off",
            type: "number",
            width: "92px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtInt(Number(item.n_stores_with_diff) || 0);
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "right";
                return s;
            }
        },

        // 9. max |Δ| loja
        {
            key: "max_abs_store_diff",
            label: "max |Δ|<br>loja",
            type: "number",
            width: "110px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.max_abs_store_diff);
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "right";
                return s;
            }
        },

        // 10. legado órfão
        {
            key: "orphan_qty",
            label: "Legado<br>órfão",
            type: "number",
            width: "110px",
            align: "center",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.orphan_qty);
                s.style.color = COL_TEXT_COLOR;
                s.style.fontSize = "12px";
                s.style.display = "block";
                s.style.width = "100%";
                s.style.textAlign = "right";
                return s;
            }
        },

        // 11. Descrição
        {
            key: "descricao",
            label: "Descrição da diferença",
            type: "text",
            width: "420px",
            align: "left",
            wrap: true,
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = item.descricao || "—";
                s.style.whiteSpace = "normal";
                s.style.wordBreak = "break-word";
                s.style.lineHeight = "1.35";
                s.style.fontSize = "11px";
                s.style.color = COL_TEXT_COLOR;
                s.style.display = "block";
                return s;
            }
        }
    ];

    /**
     * Totais agregados no rodapé — refletem as linhas visíveis após filtros
     * nativos da ExcelTable (mesma técnica do catálogo).
     */
    function buildFooterAggregate({ currentData }) {
        const wrap = document.createElement("div");
        wrap.style.display = "inline-flex";
        wrap.style.flexWrap = "wrap";
        wrap.style.gap = "8px 14px";
        wrap.style.alignItems = "baseline";
        wrap.style.justifyContent = "flex-end";
        const rows = Array.isArray(currentData) ? currentData : [];
        if (!rows.length) {
            const em = document.createElement("span");
            em.textContent = "Sem linhas para totalizar.";
            em.style.opacity = "0.85";
            wrap.appendChild(em);
            return wrap;
        }
        let sumAbs = 0;
        let nNeg = 0;
        let nPos = 0;
        let maxStoreDiffSum = 0;
        let orphanSum = 0;
        for (const r of rows) {
            const d = Number(r.delta_admin_minus_coceo);
            const a = Number(r.delta_abs);
            if (Number.isFinite(a)) sumAbs += Math.abs(a);
            if (Number.isFinite(d)) {
                if (d < -0.01) nNeg++;
                else if (d > 0.01) nPos++;
            }
            maxStoreDiffSum += Number(r.max_abs_store_diff) || 0;
            orphanSum += Number(r.orphan_qty) || 0;
        }
        const chip = (label, value) => {
            const s = document.createElement("span");
            s.style.whiteSpace = "nowrap";
            const b = document.createElement("strong");
            b.textContent = label;
            b.style.fontWeight = "700";
            s.appendChild(b);
            s.appendChild(document.createTextNode("\u00A0" + value));
            return s;
        };
        wrap.appendChild(chip("Linhas:", fmtInt(rows.length)));
        wrap.appendChild(chip("Σ |Δ|:", fmtInt(sumAbs)));
        wrap.appendChild(chip("Δ < 0:", fmtInt(nNeg)));
        wrap.appendChild(chip("Δ > 0:", fmtInt(nPos)));
        wrap.appendChild(chip("Σ max |Δ| loja:", fmtInt(maxStoreDiffSum)));
        wrap.appendChild(chip("Σ legado órfão:", fmtInt(orphanSum)));
        return wrap;
    }

    const excel = new ExcelTable({
        container: gridEl,
        columns,
        gridId: "admin-coceo-audit-grid-v4",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        fixedLeadingColumns: 2,
        columnWidthLimits: {
            erp_code: { minPx: 60, maxPx: 200 },
            name: { minPx: 160, maxPx: 480 }
        },
        summaryLabels: { total: "Linhas exibidas", selected: "" },
        footerAggregate: (ctx) => buildFooterAggregate(ctx),
        tableTheme: {
            rowEvenBg: "#ffffff",
            rowOddBg: "#dbeafe",
            rowHoverBg: "#edd8bb",
            textColor: COL_TEXT_COLOR,
            bodyFontSize: "12px"
        }
    });

    /** Mantém o rodapé com texto dourado mesmo após re-render. */
    const paintFooterGold = () => {
        const footer = gridEl.querySelector(".table-footer-summary");
        if (!footer) return;
        footer.style.color = "#f5cf96";
        footer.querySelectorAll("*").forEach((el) => {
            if (el.tagName === "STRONG") {
                el.style.color = "#ffffff";
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

    function renderAll() {
        const tableRows = allRows.map((r) => ({
            id: String(r.product_id != null ? r.product_id : r.erp_code),
            ...r
        }));
        excel.render(tableRows);
    }

    function exportRows() {
        if (!allRows.length) return;
        const headers = [
            "Código",
            "Produto",
            "Categoria",
            "Sub-Categoria",
            "Motivo",
            "Código motivo",
            "CO-CEO TOTAL",
            "ADMIN (comparado)",
            "ADMIN (totalizador)",
            "ADMIN (cadastro)",
            "Δ admin-CO-CEO",
            "|Δ|",
            "#lojas off",
            "max |Δ| loja",
            "Σ(CO-CEO − legado casado)",
            "legado órfão",
            "Fonte ADMIN",
            "Fonte CO-CEO",
            "Data totalizador",
            "Descrição"
        ];
        const keys = [
            "erp_code",
            "name",
            "category",
            "subcategory",
            "motivo",
            "motivo_codigo",
            "coceo_total",
            "admin_compared",
            "admin_produtototalizador",
            "admin_produto_cadastro",
            "delta_admin_minus_coceo",
            "delta_abs",
            "n_stores_with_diff",
            "max_abs_store_diff",
            "sum_coceo_stores_minus_legacy_matched",
            "orphan_qty",
            "admin_compared_source",
            "coceo_source",
            "data_totalizador",
            "descricao"
        ];
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        downloadCsv(`divergencia_admin_coceo_${stamp}.csv`, headers, keys, allRows);
    }

    payload = await loadPayload(false);
    if (!payload) return;
    allRows = payload.rows;

    const meta = payload.meta || {};
    metaEl.style.color = "";
    metaEl.textContent =
        (meta.source_generated_at
            ? `Auditoria gerada em ${meta.source_generated_at}.`
            : "Auditoria carregada.") +
        (meta.divergent_or_reported_count != null
            ? ` ${fmtInt(meta.divergent_or_reported_count)} produto(s) com divergência.`
            : "") +
        " Use o ícone de filtro em cada cabeçalho da tabela para filtrar por motivo, código, valores etc.";

    renderAll();

    exportBtn.addEventListener("click", exportRows);
    reloadBtn.addEventListener("click", async () => {
        reloadBtn.disabled = true;
        reloadBtn.textContent = "Recarregando…";
        const fresh = await loadPayload(true);
        if (fresh) {
            payload = fresh;
            allRows = payload.rows;
            renderAll();
        }
        reloadBtn.disabled = false;
        reloadBtn.textContent = "Recarregar dados";
    });
}

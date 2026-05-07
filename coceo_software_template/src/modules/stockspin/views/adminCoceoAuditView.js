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
 * Cada linha trás as quantidades (CO-CEO TOTAL, ADMIN comparado, ADMIN cadastro,
 * ADMIN totalizador), a diferença `Δ admin − CO-CEO`, o **motivo** classificado
 * (`Admin sem reprocessamento`, `Diferença de loja`, `Estoque legado órfão`, ...)
 * e uma `descrição` humanizada com pistas para a tratativa em lote.
 *
 * Estilo da tabela: idêntico ao `catalogGridView` (Mix de Produtos) — fundo
 * claro com zebra, texto preto, cabeçalho azul primário, hover laranja-creme.
 */

const COL_TEXT_COLOR = "#0f172a"; // preto-slate, igual ao catálogo

const fmtNum = (n, frac = 2) =>
    n == null || !Number.isFinite(Number(n))
        ? "—"
        : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: frac });
const fmtInt = (n) =>
    n == null || !Number.isFinite(Number(n))
        ? "—"
        : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Cores dos badges por motivo, calibradas para fundo claro (mesma intenção
 * dos badges de "cadastroEstado" do catálogo). Fundo translúcido + texto
 * sempre escuro para garantir contraste em zebra branca/azul.
 */
const MOTIVO_COLOR = {
    ADMIN_STALE: { bg: "rgba(245,158,11,.28)", fg: "#92400e", border: "rgba(245,158,11,.55)" },
    STORE_LEVEL: { bg: "rgba(59,130,246,.25)", fg: "#1e3a8a", border: "rgba(59,130,246,.55)" },
    ORPHAN_LEGACY: { bg: "rgba(168,85,247,.25)", fg: "#581c87", border: "rgba(168,85,247,.55)" },
    ALINHADO: { bg: "rgba(16,185,129,.22)", fg: "#065f46", border: "rgba(16,185,129,.55)" }
};
function motivoColors(codigo) {
    if (!codigo) return { bg: "rgba(148,163,184,.28)", fg: "#334155", border: "rgba(148,163,184,.55)" };
    if (MOTIVO_COLOR[codigo]) return MOTIVO_COLOR[codigo];
    if (String(codigo).startsWith("MIXED:")) {
        return { bg: "rgba(244,114,182,.25)", fg: "#9d174d", border: "rgba(244,114,182,.55)" };
    }
    return { bg: "rgba(148,163,184,.28)", fg: "#334155", border: "rgba(148,163,184,.55)" };
}

function motivoBadge(row) {
    const span = document.createElement("span");
    span.textContent = row.motivo || row.motivo_codigo || "—";
    const c = motivoColors(row.motivo_codigo);
    /* Tamanho/forma alinhados ao catálogo (cadastroEstadoBadge). */
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
        if (n > 0.01) span.style.color = "#9a3412"; // vermelho-laranja escuro p/ Δ positivo
        else if (n < -0.01) span.style.color = "#991b1b"; // vermelho escuro p/ Δ negativo
        else span.style.color = "#065f46"; // verde escuro p/ zero
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
  <div class="stockspin-panel__head">
    <h1>Divergências ADMIN × CO-CEO</h1>
    <p>
      Diferença entre o <strong>TOTAL CO-CEO</strong> e o <strong>estoque do admin do legado</strong>
      (produtototalizador quando existe; senão produto.EstoqueTotal+Vitrine).
      Cada linha tem o <em>motivo</em> classificado e uma descrição com a pista para a tratativa.
      Use os chips para isolar grupos (ex.: <em>Admin sem reprocessamento</em>) e tratar em lote.
    </p>
  </div>
  <div class="stockspin-controls">
    <div style="grid-column: span 2;"><label>Busca (código, nome ou descrição)</label><input id="adv-q" type="search" placeholder="ex.: 12220, ILHOS, reprocessamento..." /></div>
    <div><label>Sinal Δ</label><select id="adv-signal">
      <option value="">Todos</option>
      <option value="negative">Δ &lt; 0 (admin abaixo)</option>
      <option value="positive">Δ &gt; 0 (admin acima)</option>
      <option value="nonzero">Δ ≠ 0</option>
    </select></div>
    <div><label>|Δ| mínimo</label><input id="adv-min" type="number" min="0" step="0.01" value="0" /></div>
    <div><label>Top N</label><input id="adv-topn" type="number" min="1" max="5000" value="500" /></div>
    <div><label>&nbsp;</label><button type="button" id="adv-reload">Recarregar dados</button></div>
    <div><label>&nbsp;</label><button type="button" id="adv-export">Baixar planilha (.csv)</button></div>
  </div>
  <div id="adv-chips" class="stockspin-tabs" role="tablist" aria-label="Filtrar por motivo"></div>
  <div class="stockspin-kpis" id="adv-kpis"></div>
  <p class="stockspin-meta" id="adv-meta" style="margin:0;"></p>
  <div id="adv-grid" class="stockspin-table-root" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;"></div>
</div>`;

    const chipsEl = mainEl.querySelector("#adv-chips");
    const kpisEl = mainEl.querySelector("#adv-kpis");
    const metaEl = mainEl.querySelector("#adv-meta");
    const gridEl = mainEl.querySelector("#adv-grid");
    const exportBtn = mainEl.querySelector("#adv-export");
    const reloadBtn = mainEl.querySelector("#adv-reload");

    /**
     * Tema visual idêntico ao catálogo (Mix de Produtos):
     *   - cabeçalho com cor primária + texto branco
     *   - linhas com zebra (#fff / #dbeafe), hover laranja-creme (#edd8bb)
     *   - texto do corpo preto (#0f172a) 12px
     *   - rodapé navy escuro com texto dourado (#f5cf96)
     * Estilo aplicado via <style> escopado em #adv-grid (mesma técnica do
     * catalogGridView), o que sobrepõe o tema escuro padrão do .stockspin-in-app.
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
    let activeMotivo = "ALL";

    async function loadPayload(force) {
        const url = `${base}/data/client/admin_coceo_audit.js`;
        if (force) invalidateClientScript(url);
        try {
            await loadClientScript(url, { force: !!force });
        } catch (e) {
            metaEl.style.color = "#991b1b";
            metaEl.textContent =
                "Não foi possível carregar admin_coceo_audit.js. " +
                "Gere com: node scripts/build_admin_coceo_audit_view.js (após o auditor admin × CO-CEO).";
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
     * Colunas — ordem alinhada ao catálogo (Código + Descrição sticky à esquerda),
     * mas adaptada para a auditoria: ERP (sticky), Produto (sticky), Motivo,
     * quantidades, Δ, sinais por loja, descrição.
     */
    const columns = [
        // 1. ERP — sticky
        {
            key: "erp_code",
            label: "ERP",
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

        // 3. Motivo
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
                const n = Number(item.n_stores_with_diff) || 0;
                s.textContent = fmtInt(n);
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
     * Totais agregados no rodapé (mesma técnica do catálogo via footerAggregate).
     * Reflete linhas visíveis após filtros — alinhado com os KPIs do topo.
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
        gridId: "admin-coceo-audit-grid-v2",
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

    /** Mantém o rodapé com texto dourado mesmo após re-render (igual ao catálogo). */
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

    function renderChips(groups) {
        const total = allRows.length;
        const groupBy = new Map();
        for (const g of groups || []) groupBy.set(g.motivo_codigo, g);
        const chipDefs = [
            { codigo: "ALL", label: `Todos`, n: total }
        ];
        const order = [
            "ADMIN_STALE",
            "STORE_LEVEL",
            "ORPHAN_LEGACY"
        ];
        for (const code of order) {
            const g = groupBy.get(code);
            if (!g) continue;
            chipDefs.push({ codigo: code, label: g.motivo, n: g.n });
        }
        for (const g of groups || []) {
            if (order.includes(g.motivo_codigo)) continue;
            chipDefs.push({ codigo: g.motivo_codigo, label: g.motivo, n: g.n });
        }

        chipsEl.innerHTML = "";
        for (const def of chipDefs) {
            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", def.codigo === activeMotivo ? "true" : "false");
            b.dataset.codigo = def.codigo;
            b.textContent = `${def.label} · ${fmtInt(def.n)}`;
            const c = motivoColors(def.codigo === "ALL" ? null : def.codigo);
            if (def.codigo === activeMotivo) {
                b.style.background = c.bg;
                b.style.borderColor = c.border;
                b.style.color = c.fg;
            }
            b.addEventListener("click", () => {
                activeMotivo = def.codigo;
                refresh();
            });
            chipsEl.appendChild(b);
        }
    }

    function applyFilters() {
        const q = (mainEl.querySelector("#adv-q").value || "").toLowerCase().trim();
        const signal = mainEl.querySelector("#adv-signal").value;
        const minAbs = Math.max(0, Number(mainEl.querySelector("#adv-min").value) || 0);
        const topN = Math.max(1, Math.min(5000, Number(mainEl.querySelector("#adv-topn").value) || 500));

        let rows = allRows;
        if (activeMotivo !== "ALL") {
            rows = rows.filter((r) => r.motivo_codigo === activeMotivo);
        }
        if (q) {
            rows = rows.filter((r) => {
                const hay = `${r.erp_code} ${r.name} ${r.descricao} ${r.motivo}`.toLowerCase();
                return hay.includes(q);
            });
        }
        if (signal === "negative") rows = rows.filter((r) => Number(r.delta_admin_minus_coceo) < -0.01);
        else if (signal === "positive") rows = rows.filter((r) => Number(r.delta_admin_minus_coceo) > 0.01);
        else if (signal === "nonzero") rows = rows.filter((r) => Math.abs(Number(r.delta_admin_minus_coceo)) > 0.01);
        if (minAbs > 0) rows = rows.filter((r) => Math.abs(Number(r.delta_abs) || 0) >= minAbs);
        return rows.slice(0, topN);
    }

    function updateKpis(rows) {
        const n = rows.length;
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
        kpisEl.innerHTML = `
      <div class="stockspin-kpi"><div class="k">Linhas exibidas</div><div class="v">${fmtInt(n)}</div></div>
      <div class="stockspin-kpi"><div class="k">|Δ| total (un)</div><div class="v">${fmtInt(sumAbs)}</div></div>
      <div class="stockspin-kpi"><div class="k">Δ &lt; 0 (admin abaixo)</div><div class="v">${fmtInt(nNeg)}</div></div>
      <div class="stockspin-kpi"><div class="k">Δ &gt; 0 (admin acima)</div><div class="v">${fmtInt(nPos)}</div></div>
      <div class="stockspin-kpi"><div class="k">Σ max |Δ| loja</div><div class="v">${fmtInt(maxStoreDiffSum)}</div></div>
      <div class="stockspin-kpi"><div class="k">Σ legado órfão</div><div class="v">${fmtInt(orphanSum)}</div></div>`;
    }

    function refresh() {
        const rows = applyFilters();
        const tableRows = rows.map((r) => ({ id: String(r.product_id != null ? r.product_id : r.erp_code), ...r }));
        updateKpis(rows);
        excel.render(tableRows);
        renderChips(payload && payload.groups ? payload.groups : []);
    }

    function exportRows() {
        const rows = applyFilters();
        if (!rows.length) {
            metaEl.style.color = "#991b1b";
            metaEl.textContent = "Nada para exportar com os filtros atuais.";
            return;
        }
        const headers = [
            "ERP",
            "Produto",
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
        const suffix = activeMotivo === "ALL" ? "todos" : activeMotivo.replace(/[^A-Za-z0-9_]+/g, "_");
        downloadCsv(`divergencia_admin_coceo_${suffix}_${stamp}.csv`, headers, keys, rows);
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
        (meta.tolerance_admin != null ? ` Tol. admin=${meta.tolerance_admin}.` : "") +
        (meta.tolerance_store != null ? ` Tol. loja=${meta.tolerance_store}.` : "");

    refresh();

    ["#adv-q", "#adv-signal", "#adv-min", "#adv-topn"].forEach((sel) => {
        mainEl.querySelector(sel).addEventListener("input", refresh);
    });
    exportBtn.addEventListener("click", exportRows);
    reloadBtn.addEventListener("click", async () => {
        reloadBtn.disabled = true;
        reloadBtn.textContent = "Recarregando…";
        const fresh = await loadPayload(true);
        if (fresh) {
            payload = fresh;
            allRows = payload.rows;
        }
        reloadBtn.disabled = false;
        reloadBtn.textContent = "Recarregar dados";
        refresh();
    });
}

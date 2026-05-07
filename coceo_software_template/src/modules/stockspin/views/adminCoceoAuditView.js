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
 */

const fmtNum = (n, frac = 2) =>
    n == null || !Number.isFinite(Number(n))
        ? "—"
        : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: frac });
const fmtInt = (n) =>
    n == null || !Number.isFinite(Number(n))
        ? "—"
        : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

const MOTIVO_COLOR = {
    ADMIN_STALE: { bg: "rgba(245,158,11,.22)", fg: "#fbbf24", border: "rgba(245,158,11,.55)" },
    STORE_LEVEL: { bg: "rgba(59,130,246,.22)", fg: "#93c5fd", border: "rgba(59,130,246,.55)" },
    ORPHAN_LEGACY: { bg: "rgba(168,85,247,.22)", fg: "#d8b4fe", border: "rgba(168,85,247,.55)" },
    ALINHADO: { bg: "rgba(34,197,94,.22)", fg: "#86efac", border: "rgba(34,197,94,.55)" }
};
function motivoColors(codigo) {
    if (!codigo) return { bg: "rgba(148,163,184,.22)", fg: "#cbd5e1", border: "rgba(148,163,184,.45)" };
    if (MOTIVO_COLOR[codigo]) return MOTIVO_COLOR[codigo];
    if (String(codigo).startsWith("MIXED:")) {
        return { bg: "rgba(244,114,182,.22)", fg: "#f9a8d4", border: "rgba(244,114,182,.55)" };
    }
    return { bg: "rgba(148,163,184,.22)", fg: "#cbd5e1", border: "rgba(148,163,184,.45)" };
}

function motivoBadge(row) {
    const span = document.createElement("span");
    span.textContent = row.motivo || row.motivo_codigo || "—";
    const c = motivoColors(row.motivo_codigo);
    span.style.display = "inline-block";
    span.style.padding = "2px 8px";
    span.style.borderRadius = "999px";
    span.style.fontSize = "11px";
    span.style.fontWeight = "700";
    span.style.background = c.bg;
    span.style.color = c.fg;
    span.style.border = `1px solid ${c.border}`;
    span.title = row.motivo_codigo || "";
    return span;
}

function deltaCell(value) {
    const span = document.createElement("span");
    const n = Number(value);
    span.textContent = Number.isFinite(n) ? fmtNum(n) : "—";
    span.style.fontWeight = "700";
    if (Number.isFinite(n)) {
        if (n > 0.01) span.style.color = "#fdba74";
        else if (n < -0.01) span.style.color = "#fca5a5";
        else span.style.color = "#86efac";
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
<div class="stockspin-panel">
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
  <p class="stockspin-meta" id="adv-meta"></p>
  <div id="adv-grid" class="stockspin-table-root"></div>
</div>`;

    const chipsEl = mainEl.querySelector("#adv-chips");
    const kpisEl = mainEl.querySelector("#adv-kpis");
    const metaEl = mainEl.querySelector("#adv-meta");
    const gridEl = mainEl.querySelector("#adv-grid");
    const exportBtn = mainEl.querySelector("#adv-export");
    const reloadBtn = mainEl.querySelector("#adv-reload");

    let payload = null;
    let allRows = [];
    let activeMotivo = "ALL";

    async function loadPayload(force) {
        const url = `${base}/data/client/admin_coceo_audit.js`;
        if (force) invalidateClientScript(url);
        try {
            await loadClientScript(url, { force: !!force });
        } catch (e) {
            metaEl.style.color = "#fca5a5";
            metaEl.textContent =
                "Não foi possível carregar admin_coceo_audit.js. " +
                "Gere com: node scripts/build_admin_coceo_audit_view.js (após o auditor admin × CO-CEO).";
            return null;
        }
        const data = window.ADMIN_COCEO_AUDIT;
        if (!data || !Array.isArray(data.rows)) {
            metaEl.style.color = "#fca5a5";
            metaEl.textContent = "ADMIN_COCEO_AUDIT inválido ou vazio.";
            return null;
        }
        return data;
    }

    const columns = [
        {
            key: "motivo",
            label: "Motivo",
            type: "text",
            width: "180px",
            align: "center",
            render: (item) => motivoBadge(item)
        },
        { key: "erp_code", label: "ERP", type: "text", width: "90px", align: "center" },
        {
            key: "name",
            label: "Produto",
            type: "text",
            width: "260px",
            sticky: true,
            render: (item) => {
                const id = item.product_id != null ? String(item.product_id) : "";
                const a = document.createElement("a");
                a.href = id ? `${base}/ceo_product_detail_layout.html?sku=${encodeURIComponent(id)}&hub=1` : "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = item.name || "—";
                a.style.color = "inherit";
                a.style.textDecoration = "none";
                a.style.fontWeight = "600";
                a.onmouseenter = () => {
                    a.style.color = "var(--color-accent)";
                    a.style.textDecoration = "underline";
                };
                a.onmouseleave = () => {
                    a.style.color = "inherit";
                    a.style.textDecoration = "none";
                };
                return a;
            }
        },
        {
            key: "coceo_total",
            label: "CO-CEO TOTAL",
            type: "number",
            width: "120px",
            align: "right",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.coceo_total);
                s.style.fontWeight = "600";
                return s;
            }
        },
        {
            key: "admin_compared",
            label: "ADMIN (comparado)",
            type: "number",
            width: "140px",
            align: "right",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.admin_compared);
                s.style.fontWeight = "600";
                s.title =
                    `Fonte: ${item.admin_compared_source || "—"}` +
                    (item.admin_produtototalizador != null
                        ? ` · totalizador: ${fmtNum(item.admin_produtototalizador)}`
                        : "") +
                    ` · cadastro produto: ${fmtNum(item.admin_produto_cadastro)}`;
                return s;
            }
        },
        {
            key: "delta_admin_minus_coceo",
            label: "Δ (admin − CO-CEO)",
            type: "number",
            width: "150px",
            align: "right",
            render: (item) => deltaCell(item.delta_admin_minus_coceo)
        },
        {
            key: "delta_abs",
            label: "|Δ|",
            type: "number",
            width: "110px",
            align: "right",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.delta_abs);
                s.style.fontWeight = "700";
                return s;
            }
        },
        {
            key: "n_stores_with_diff",
            label: "#lojas off",
            type: "number",
            width: "92px",
            align: "right"
        },
        {
            key: "max_abs_store_diff",
            label: "max |Δ| loja",
            type: "number",
            width: "110px",
            align: "right",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.max_abs_store_diff);
                return s;
            }
        },
        {
            key: "orphan_qty",
            label: "legado órfão",
            type: "number",
            width: "110px",
            align: "right",
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtNum(item.orphan_qty);
                return s;
            }
        },
        {
            key: "descricao",
            label: "Descrição da diferença",
            type: "text",
            width: "420px",
            wrap: true,
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = item.descricao || "—";
                s.style.whiteSpace = "normal";
                s.style.wordBreak = "break-word";
                s.style.lineHeight = "1.35";
                s.style.fontSize = "11px";
                return s;
            }
        }
    ];

    const excel = new ExcelTable({
        container: gridEl,
        columns,
        gridId: "admin-coceo-audit-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        fixedLeadingColumns: 0,
        summaryLabels: { total: "Linhas exibidas:", selected: "" }
    });

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
        updateKpis(rows);
        excel.render(rows);
        renderChips(payload && payload.groups ? payload.groups : []);
    }

    function exportRows() {
        const rows = applyFilters();
        if (!rows.length) {
            metaEl.style.color = "#fca5a5";
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

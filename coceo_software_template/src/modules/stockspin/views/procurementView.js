import { ExcelTable } from "../../../components/ExcelTable.js";
import { loadClientScript, stockspinDataBase } from "../loadClientScript.js";
import "../stockspin-excel.css";
import { decideAction, loadMakeBuyMap, normalizeCode, statusCls } from "../procurementPlanLogic.js";

const fmtInt = (n) => Number(n || 0).toLocaleString("pt-BR");
const fmtBRL = (n) =>
    Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function tagSpan(action) {
    const tag = action === "PRODUZIR" ? "make" : action === "COMPRAR" ? "buy" : "hybrid";
    const span = document.createElement("span");
    span.textContent = action;
    span.style.display = "inline-block";
    span.style.borderRadius = "999px";
    span.style.padding = "2px 8px";
    span.style.fontWeight = "700";
    span.style.fontSize = "11px";
    if (tag === "make") {
        span.style.background = "rgba(34,197,94,.2)";
        span.style.color = "#86efac";
        span.style.border = "1px solid rgba(34,197,94,.4)";
    } else if (tag === "buy") {
        span.style.background = "rgba(56,189,248,.2)";
        span.style.color = "#bae6fd";
        span.style.border = "1px solid rgba(56,189,248,.45)";
    } else {
        span.style.background = "rgba(245,158,11,.2)";
        span.style.color = "#fdba74";
        span.style.border = "1px solid rgba(245,158,11,.45)";
    }
    return span;
}

function statusSpan(status) {
    const s = status || "ACIMA";
    const cls = statusCls(s);
    const span = document.createElement("span");
    span.textContent = s;
    span.style.fontSize = "11px";
    span.style.fontWeight = "700";
    span.style.borderRadius = "6px";
    span.style.padding = "2px 6px";
    span.style.display = "inline-block";
    if (cls === "s-rup") {
        span.style.background = "#111";
        span.style.color = "#fff";
    } else if (cls === "s-cri") {
        span.style.background = "#ef4444";
        span.style.color = "#fff";
    } else if (cls === "s-aba") {
        span.style.background = "#f59e0b";
        span.style.color = "#111";
    } else {
        span.style.background = "#10b981";
        span.style.color = "#052e1b";
    }
    return span;
}

export async function mount(mainEl) {
    const base = stockspinDataBase();
    mainEl.classList.add("stockspin-in-app");
    mainEl.innerHTML = `
<div class="stockspin-panel">
  <div class="stockspin-panel__head">
    <h1>Relatório Compra x Produção</h1>
    <p>Composição via <code>data/client/sku_make_buy_map.json</code> e fallback legado (mesma regra da tela HTML).</p>
  </div>
  <div class="stockspin-controls">
    <div><label>Ação</label><select id="sp-action"><option value="">Todas</option><option>PRODUZIR</option><option>COMPRAR</option><option>MISTO</option></select></div>
    <div><label>Status</label><select id="sp-status"><option value="">Todos</option>
      <option>RUPTURA</option><option>CRÍTICO</option><option>ABAIXO</option><option>ACIMA</option><option>MUITO ACIMA</option>
      <option>ENCALHADO 1</option><option>ENCALHADO 2</option><option>ENCALHADO 3</option></select></div>
    <div style="grid-column: span 2;"><label>Busca</label><input id="sp-q" type="search" placeholder="ERP, nome, categoria..." /></div>
    <div><label>Top N</label><input id="sp-topn" type="number" min="1" max="500" value="200" /></div>
    <div><label>&nbsp;</label><button type="button" id="sp-reload-map">Recarregar mapa composição</button></div>
  </div>
  <div class="stockspin-kpis" id="sp-kpis"></div>
  <p class="stockspin-meta" id="sp-meta"></p>
  <div id="sp-grid" class="stockspin-table-root"></div>
</div>`;

    await loadClientScript(`${base}/data/client/cd_purchase_plan.js`);
    const raw = window.CD_PURCHASE_PLAN_DATA && Array.isArray(window.CD_PURCHASE_PLAN_DATA.rows) ? window.CD_PURCHASE_PLAN_DATA.rows : [];

    let makeBuyMap = await loadMakeBuyMap(base);

    const kpisEl = mainEl.querySelector("#sp-kpis");
    const metaEl = mainEl.querySelector("#sp-meta");
    const gridEl = mainEl.querySelector("#sp-grid");

    const columns = [
        {
            key: "plan_action",
            label: "Ação",
            type: "text",
            width: "110px",
            align: "center",
            render: (item) => tagSpan(item.plan_action)
        },
        {
            key: "status_urgencia",
            label: "Status",
            type: "text",
            width: "120px",
            align: "center",
            render: (item) => statusSpan(item.status_urgencia)
        },
        { key: "erp_code", label: "ERP", type: "text", width: "100px", align: "center" },
        { key: "product_name", label: "Produto", type: "text", width: "260px", sticky: true },
        { key: "category", label: "Categoria", type: "text", width: "120px" },
        { key: "demanda_total_cd", label: "Demanda CD", type: "number", width: "110px", align: "right" },
        { key: "plan_makeQty", label: "Produção rec.", type: "number", width: "110px", align: "right" },
        { key: "plan_buyQty", label: "Compra rec.", type: "number", width: "110px", align: "right" },
        { key: "total_em_producao_legacy", label: "Leg. produção", type: "number", width: "110px", align: "right" },
        { key: "sugestao_compra_legacy", label: "Leg. compra", type: "number", width: "110px", align: "right" },
        { key: "margem_contribuicao_total", label: "Margem", type: "currency", width: "120px", align: "right" },
        { key: "plan_rule", label: "Regra composição", type: "text", width: "200px" }
    ];

    const excel = new ExcelTable({
        container: gridEl,
        columns,
        gridId: "procurement-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        summaryLabels: {
            total: "SKUs na base:",
            selected: ""
        }
    });

    function buildRows() {
        const q = (mainEl.querySelector("#sp-q").value || "").toLowerCase();
        const fAction = mainEl.querySelector("#sp-action").value;
        const fStatus = mainEl.querySelector("#sp-status").value;
        const topN = Math.max(1, Math.min(500, Number(mainEl.querySelector("#sp-topn").value) || 200));

        let rows = raw.map((r, idx) => {
            const plan = decideAction(r, makeBuyMap);
            const erp = normalizeCode(r.erp_code);
            return {
                id: erp || `row-${idx}`,
                ...r,
                plan_action: plan.action,
                plan_makeQty: plan.makeQty,
                plan_buyQty: plan.buyQty,
                plan_rule: plan.rule
            };
        });
        rows.sort(
            (a, b) =>
                Number(b.demanda_total_cd || 0) - Number(a.demanda_total_cd || 0) ||
                Number(b.margem_contribuicao_total || 0) - Number(a.margem_contribuicao_total || 0)
        );
        rows = rows.slice(0, topN).filter((r) => {
            if (fAction && r.plan_action !== fAction) return false;
            if (fStatus && String(r.status_urgencia || "") !== fStatus) return false;
            if (q) {
                const s = `${r.erp_code} ${r.product_name} ${r.category} ${r.subcategory}`.toLowerCase();
                if (!s.includes(q)) return false;
            }
            return true;
        });
        return rows;
    }

    function updateKpis(rows) {
        let dem = 0,
            mk = 0,
            by = 0,
            mg = 0,
            covKnown = 0;
        for (const r of rows) {
            dem += Number(r.demanda_total_cd || 0);
            mk += Number(r.plan_makeQty || 0);
            by += Number(r.plan_buyQty || 0);
            mg += Number(r.margem_contribuicao_total || 0);
            if (r.plan_rule === "Mapa composição") covKnown++;
        }
        const covPct = rows.length ? ((100 * covKnown) / rows.length).toFixed(1).replace(".", ",") + "%" : "0%";
        kpisEl.innerHTML = `
      <div class="stockspin-kpi"><div class="k">SKUs exibidos</div><div class="v">${fmtInt(rows.length)}</div></div>
      <div class="stockspin-kpi"><div class="k">Demanda CD</div><div class="v">${fmtInt(dem)}</div></div>
      <div class="stockspin-kpi"><div class="k">Produzir (un)</div><div class="v">${fmtInt(mk)}</div></div>
      <div class="stockspin-kpi"><div class="k">Comprar (un)</div><div class="v">${fmtInt(by)}</div></div>
      <div class="stockspin-kpi"><div class="k">Margem total</div><div class="v">${fmtBRL(mg)}</div></div>
      <div class="stockspin-kpi"><div class="k">Cobertura composição</div><div class="v">${covPct}</div></div>`;
        const st = window.CD_PURCHASE_PLAN_DATA && window.CD_PURCHASE_PLAN_DATA.stats;
        const exMix = st && st.skus_fora_mix_excluded_from_plan != null ? Number(st.skus_fora_mix_excluded_from_plan) : null;
        metaEl.textContent =
            `Base: cd_purchase_plan (${fmtInt(raw.length)} SKUs` +
            (exMix != null && exMix > 0 ? `; ${fmtInt(exMix)} fora do mix excl. do plano` : "") +
            `). Tabela padrão ExcelTable.`;
    }

    function refresh() {
        const rows = buildRows();
        updateKpis(rows);
        excel.render(rows);
    }

    ["#sp-q", "#sp-action", "#sp-status", "#sp-topn"].forEach((sel) => {
        mainEl.querySelector(sel).addEventListener("input", refresh);
    });
    mainEl.querySelector("#sp-reload-map").addEventListener("click", async () => {
        makeBuyMap = await loadMakeBuyMap(base);
        refresh();
    });

    refresh();
}

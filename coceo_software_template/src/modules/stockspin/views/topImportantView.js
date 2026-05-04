import { ExcelTable } from "../../../components/ExcelTable.js";
import { loadClientScript, stockspinDataBase } from "../loadClientScript.js";
import "../stockspin-excel.css";

const TABS = [
    { key: "top_100_by_volume", label: "Por volume (bundle)" },
    { key: "top_100_by_contribution_margin", label: "Por lucro (plano CD)" },
    { key: "top_100_composite", label: "Composto (vol + lucro + rupt.)" }
];

function fmt(n, d) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: d != null ? d : 2 });
}

export async function mount(mainEl) {
    const base = stockspinDataBase();
    mainEl.classList.add("stockspin-in-app");
    mainEl.innerHTML = `
<div class="stockspin-panel">
  <div class="stockspin-panel__head">
    <h1>Top 100 · produtos mais importantes</h1>
    <p>Dados de <code>data/client/sku_top_important.js</code> — mesmas abas da tela HTML.</p>
  </div>
  <div class="stockspin-tabs" id="ti-tabs" role="tablist"></div>
  <p class="stockspin-meta" id="ti-meta"></p>
  <div id="ti-grid" class="stockspin-table-root"></div>
</div>`;

    await loadClientScript(`${base}/data/client/sku_top_important.js`);
    const payload = window.SKU_TOP_IMPORTANT;
    if (!payload) {
        mainEl.querySelector("#ti-meta").textContent = "Não foi possível ler SKU_TOP_IMPORTANT.";
        return;
    }

    const metaEl = mainEl.querySelector("#ti-meta");
    metaEl.textContent =
        (payload.meta && payload.meta.generated_at ? `Gerado em: ${payload.meta.generated_at}. ` : "") +
        (payload.meta && payload.meta.note ? payload.meta.note : "");

    const gridEl = mainEl.querySelector("#ti-grid");
    let activeKey = TABS[0].key;

    const columns = [
        { key: "_rank", label: "#", type: "number", width: "52px", align: "right", noFilter: true },
        {
            key: "code",
            label: "Código",
            type: "text",
            width: "100px",
            render: (item) => {
                const span = document.createElement("span");
                span.textContent = item.code || "—";
                span.style.fontWeight = "600";
                span.style.color = "#93c5fd";
                return span;
            }
        },
        {
            key: "name",
            label: "Produto",
            type: "text",
            width: "280px",
            sticky: true,
            render: (item) => {
                const id = item.id != null ? String(item.id) : "";
                const a = document.createElement("a");
                a.href = id ? `${base}/ceo_product_detail_layout.html?sku=${encodeURIComponent(id)}&hub=1` : "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = item.name || "—";
                a.style.color = "inherit";
                a.style.textDecoration = "none";
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
        { key: "total_sales_bundle", label: "Vol. bundle", type: "number", width: "110px", align: "right" },
        { key: "quantidade_vendida", label: "Qtd CD plano", type: "number", width: "110px", align: "right" },
        { key: "valor_bruto_vendas", label: "Valor bruto", type: "number", width: "120px", align: "right" },
        { key: "lucro_bruto", label: "Lucro bruto (R$)", type: "number", width: "130px", align: "right" },
        {
            key: "margem_contrib_pct",
            label: "Margem %",
            type: "text",
            width: "90px",
            align: "right",
            render: (item) => {
                const v = item.margem_contrib_pct;
                const t = document.createElement("span");
                t.textContent = v == null ? "—" : `${fmt(v, 1)}%`;
                return t;
            }
        },
        {
            key: "ruptura_ponderada_vendas_pct",
            label: "Rupt. peso vendas %",
            type: "text",
            width: "140px",
            align: "right",
            render: (item) => {
                const v = item.ruptura_ponderada_vendas_pct;
                const t = document.createElement("span");
                t.textContent = v == null ? "—" : `${fmt(v, 1)}%`;
                return t;
            }
        },
        {
            key: "composite_score",
            label: "Score",
            type: "text",
            width: "100px",
            align: "right",
            render: (item) => {
                const v = item.composite_score;
                const t = document.createElement("span");
                t.textContent = v == null ? "—" : fmt(v, 4);
                return t;
            }
        }
    ];

    const excel = new ExcelTable({
        container: gridEl,
        columns,
        gridId: "top-important-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        summaryLabels: { total: "Linhas:", selected: "" }
    });

    function buildRows(key) {
        const list = payload[key] || [];
        return list.map((row, i) => ({
            id: String(row.id != null ? row.id : `top-${key}-${i}`),
            _rank: i + 1,
            ...row
        }));
    }

    function renderTab(key) {
        activeKey = key;
        excel.render(buildRows(key));
        mainEl.querySelectorAll("#ti-tabs button").forEach((b, i) => {
            b.setAttribute("aria-selected", TABS[i].key === key ? "true" : "false");
        });
    }

    const tabHost = mainEl.querySelector("#ti-tabs");
    tabHost.innerHTML = "";
    TABS.forEach((t, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", i === 0 ? "true" : "false");
        b.textContent = t.label;
        b.addEventListener("click", () => renderTab(t.key));
        tabHost.appendChild(b);
    });

    renderTab(TABS[0].key);
}

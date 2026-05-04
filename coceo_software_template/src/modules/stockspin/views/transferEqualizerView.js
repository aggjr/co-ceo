import { ExcelTable } from "../../../components/ExcelTable.js";
import { loadClientScript, stockspinDataBase } from "../loadClientScript.js";
import "../stockspin-excel.css";
import { allocateEqualized, toStoresArray } from "../transferPlanLogic.js";
import { normalizeCode } from "../procurementPlanLogic.js";
import {
    TRANSFER_STATUSES,
    TRANSFER_ITEM_DECISIONS,
    canTransitionTransferStatus,
    createTransferDecisionBadge,
    createTransferStatusBadge,
    deriveTransferStatusFromItems,
    normalizeTransferStatus,
} from "../../../components/TransferStatus.js";
import {
    appendTransferEvent,
    computeReservedBySku,
    loadTransferWorkflow,
    saveTransferWorkflow,
    upsertTransfer,
    upsertTransferItem,
} from "../../../utils/transferWorkflowStore.js";
import { getActiveTenantIdForModules } from "../../../utils/moduleContext.js";

const fmtInt = (n) => Number(n || 0).toLocaleString("pt-BR");
const LEGACY_LIVE_BASE = (window.COCEO_LEGACY_LIVE_BASE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const LEGACY_TRANSFER_CACHE_TTL_MS = 5 * 60 * 1000;
const MIX_TABLE_THEME = {
    rowEvenBg: "#ffffff",
    rowOddBg: "#dbeafe",
    rowHoverBg: "#edd8bb",
    textColor: "#0f172a",
    bodyFontSize: "12px",
};
const TRANSFER_TEXT_COLOR = "#0f172a";
const TRANSFER_TABLE_SCOPES = ["#tr-main-grid", "#tr-sku-grid", "#tr-alloc-grid", "#tr-items-grid"];
let transferTableThemeStyleInstalled = false;
const fmtDate = (d) => {
    const x = new Date(d);
    const dd = String(x.getDate()).padStart(2, "0");
    const mm = String(x.getMonth() + 1).padStart(2, "0");
    const yy = x.getFullYear();
    return `${dd}/${mm}/${yy}`;
};
const deriveProductLifecycleStatus = (row) => {
    if (!row || typeof row !== "object") return "Não informado";
    const normalizeExplicit = (v) => {
        const s = String(v == null ? "" : v).trim();
        if (!s) return "";
        const low = s.toLowerCase();
        if (low === "não informado" || low === "nao informado" || low === "-" || low === "n/a") return "";
        return s;
    };
    const explicit = normalizeExplicit(row.cadastroEstado) || normalizeExplicit(row.productLifecycleStatus);
    if (explicit) return explicit;
    const legacy = String(row.legacyStatus || "").trim().toLowerCase();
    if (legacy.includes("desativ")) return "Sendo desativado";
    if (legacy.includes("inativ")) return "Inativo";
    if (legacy.includes("ativ")) return "Ativo";
    if (row.indDeletado) return "Excluído";
    if (row.legacyAtivo === true) return "Ativo";
    if (row.legacyAtivo === false) return "Inativo";
    return "Inativo";
};
const statusJoinKey = (v) => {
    const s = normalizeCode(v);
    if (!s) return "";
    if (/^\d+$/.test(s)) return String(Number(s));
    return s.toLowerCase();
};
const createLifecycleStatusBadge = (value) => {
    const label = String(value || "Não informado").trim();
    const span = document.createElement("span");
    span.textContent = label;
    span.style.display = "inline-block";
    span.style.padding = "2px 8px";
    span.style.borderRadius = "999px";
    span.style.fontSize = "11px";
    span.style.lineHeight = "1.2";
    span.style.fontWeight = "600";
    span.style.border = "1px solid transparent";
    let bg = "rgba(148,163,184,.2)";
    let fg = "#334155";
    let border = "rgba(148,163,184,.35)";
    if (label === "Ativo") {
        bg = "rgba(16,185,129,.22)";
        fg = "#065f46";
        border = "rgba(16,185,129,.35)";
    } else if (label === "Inativo") {
        bg = "rgba(100,116,139,.35)";
        fg = "#334155";
        border = "rgba(100,116,139,.4)";
    } else if (label === "Excluído (cadastro)" || label === "Excluído") {
        bg = "rgba(239,68,68,.25)";
        fg = "#991b1b";
        border = "rgba(239,68,68,.35)";
    } else if (label === "Sendo inativado" || label === "Sendo desativado") {
        bg = "rgba(245,158,11,.28)";
        fg = "#92400e";
        border = "rgba(245,158,11,.4)";
    } else if (label === "Sendo inserido" || label.startsWith("Em processamento") || label === "Sendo processado") {
        bg = "rgba(59,130,246,.25)";
        fg = "#1e3a8a";
        border = "rgba(59,130,246,.35)";
    }
    span.style.background = bg;
    span.style.color = fg;
    span.style.borderColor = border;
    return span;
};

export async function mount(mainEl) {
    const base = stockspinDataBase();
    const tenantId = getActiveTenantIdForModules();
    mainEl.classList.add("stockspin-in-app");
    mainEl.innerHTML = `
<div class="stockspin-panel">
  <div id="tr-list-screen" style="display:flex;flex-direction:column;flex:1;min-height:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px 0;">
      <div></div>
      <button
        type="button"
        id="tr-new"
        style="min-width:170px;font-weight:700;background:var(--color-accent);color:#0b1220;border:1px solid rgba(0,0,0,.15);border-radius:8px;padding:9px 14px;cursor:pointer;"
      >+ Nova Transferência</button>
    </div>
    <div id="tr-main-grid" class="stockspin-table-root" style="min-height:0;flex:1;"></div>
  </div>

  <div id="tr-detail-screen" style="display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden;">
    <div class="stockspin-controls stockspin-controls--wide" style="grid-template-columns:0.95fr 0.8fr 0.8fr 0.8fr 0.8fr auto auto;align-items:end;column-gap:8px;">
      <div><label>Código da Transferência</label><input id="tr-code" readonly /></div>
      <div><label>Data</label><input id="tr-date" readonly /></div>
      <div><label>Status</label><input id="tr-status" value="PLANEJADA" readonly /></div>
      <div><label>Origem</label><select id="tr-origin"></select></div>
      <div><label>Destino</label><select id="tr-dest"></select></div>
      <div style="align-self:end;"><button type="button" id="tr-back">Voltar</button></div>
      <div style="align-self:end;">
        <button
          type="button"
          id="tr-suggest-top"
          title="Aprovar transferência"
          style="background:var(--color-accent);color:#0b1220;border:1px solid rgba(0,0,0,.15);font-weight:700;"
        >Aprovar transferência</button>
      </div>
    </div>
    <div class="stockspin-split" style="flex:1;min-height:0;overflow:hidden;">
      <div class="stockspin-subpanel">
        <div class="stockspin-controls stockspin-controls--wide" style="display:none;">
          <div><label>ERP</label><input id="tr-erp" placeholder="ex: 9282" /></div>
          <div style="grid-column: span 2;"><label>Busca</label><input id="tr-q" type="search" placeholder="Nome SKU..." /></div>
          <div><label>Top N</label><input id="tr-topn" type="number" min="1" max="500" value="200" /></div>
          <div><label>Status</label><select id="tr-st"><option value="">Todos</option>
            <option>RUPTURA</option><option>CRÍTICO</option><option>ABAIXO</option><option>ACIMA</option><option>MUITO ACIMA</option>
            <option>ENCALHADO 1</option><option>ENCALHADO 2</option><option>ENCALHADO 3</option></select></div>
          <div><label>&nbsp;</label><button type="button" id="tr-refresh">Atualizar lista</button></div>
        </div>
        <div id="tr-sku-grid" class="stockspin-table-root" style="min-height:0;flex:1;"></div>
      </div>
      <div class="stockspin-subpanel" style="display:none;">
        <h3>Plano de distribuição (rateio Fábrica)</h3>
        <div class="stockspin-controls" style="grid-template-columns:1fr 1fr 1fr">
          <div><label>SKU selecionado</label><input id="tr-sel" readonly /></div>
          <div><label>Disponível Fábrica (físico)</label><input id="tr-cd" type="number" min="0" step="1" placeholder="Unidades" /></div>
          <div><label>&nbsp;</label><button type="button" id="tr-calc">Calcular transferência</button></div>
        </div>
        <p class="stockspin-meta" id="tr-note">Selecione um SKU à esquerda, informe o disponível da Fábrica e calcule.</p>
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button type="button" id="tr-reserve">Empenhar SKU na transferência</button>
        </div>
        <div id="tr-alloc-grid" class="stockspin-table-root" style="min-height:220px"></div>
        <div class="stockspin-kpis" id="tr-kpis"></div>
        <hr style="border-color:rgba(255,255,255,.1);margin:14px 0;" />
        <h3>Recebimento por item</h3>
        <div class="stockspin-controls stockspin-controls--wide">
          <div style="grid-column: span 2;"><label>Item transferido</label><select id="tr-recv-item"></select></div>
          <div><label>Decisão</label><select id="tr-recv-decision"></select></div>
          <div><label>Qtd recebida</label><input id="tr-recv-qty" type="number" min="0" step="1" /></div>
          <div style="grid-column: span 2;"><label>Observação</label><input id="tr-recv-note" placeholder="Avaria, divergência, falta parcial..." /></div>
          <div><label>&nbsp;</label><button type="button" id="tr-recv-save">Registrar recebimento</button></div>
        </div>
        <div id="tr-items-grid" class="stockspin-table-root" style="min-height:180px"></div>
        <h3 style="margin-top:14px;">Histórico</h3>
        <div id="tr-history" class="stockspin-meta"></div>
      </div>
    </div>
  </div>
</div>`;

    const listScreen = mainEl.querySelector("#tr-list-screen");
    const detailScreen = mainEl.querySelector("#tr-detail-screen");
    const showList = () => {
        listScreen.style.display = "flex";
        detailScreen.style.display = "none";
    };
    const showDetail = () => {
        listScreen.style.display = "none";
        detailScreen.style.display = "flex";
    };

    await loadClientScript(`${base}/data/client/cd_purchase_plan.js`);
    const rows = window.CD_PURCHASE_PLAN_DATA && Array.isArray(window.CD_PURCHASE_PLAN_DATA.rows) ? window.CD_PURCHASE_PLAN_DATA.rows : [];
    /** Mapa loja×SKU → disponível (network_matrix). Preenchido em background. */
    let matrixAvailByKey = null;
    let matrixLoadPromise = null;
    function loadNetworkMatrixAvail() {
        if (matrixLoadPromise) return matrixLoadPromise;
        matrixLoadPromise = fetch(`${base}/data/client/network_matrix.json`, { cache: "default" })
            .then((res) => {
                if (!res.ok) throw new Error("network_matrix " + res.status);
                return res.json();
            })
            .then((j) => {
                const m = new Map();
                const list = Array.isArray(j?.rows) ? j.rows : [];
                for (let i = 0; i < list.length; i++) {
                    const x = list[i];
                    const st = String(x.store || "").trim().toLowerCase();
                    if (!st) continue;
                    const disp = Math.max(0, Math.round(Number(x.disponivel) || 0));
                    const erp = normalizeCode(x.erp_code).toLowerCase();
                    if (erp) m.set(`erp:${erp}|${st}`, disp);
                    const sid = Number(x.sku_internal_id);
                    if (Number.isFinite(sid) && sid > 0) m.set(`id:${sid}|${st}`, disp);
                }
                matrixAvailByKey = m;
                return m;
            })
            .catch(() => {
                matrixAvailByKey = matrixAvailByKey || new Map();
                return matrixAvailByKey;
            });
        return matrixLoadPromise;
    }
    function matrixDisponivelAtStore(row, storeName) {
        const st = String(storeName || "").trim().toLowerCase();
        if (!st || !matrixAvailByKey) return null;
        const erp = normalizeCode(row.erp_code).toLowerCase();
        const id = row.sku_internal_id != null ? Number(row.sku_internal_id) : NaN;
        if (Number.isFinite(id) && id > 0 && matrixAvailByKey.has(`id:${id}|${st}`)) {
            return matrixAvailByKey.get(`id:${id}|${st}`);
        }
        if (erp && matrixAvailByKey.has(`erp:${erp}|${st}`)) return matrixAvailByKey.get(`erp:${erp}|${st}`);
        return null;
    }
    const catalogStatusByErp = new Map();
    try {
        await loadClientScript(`${base}/data/catalog_grid.js`);
        const rawCatalog = (typeof CATALOG_GRID !== "undefined")
            ? CATALOG_GRID
            : window.CATALOG_GRID;
        const catalogRows = Array.isArray(rawCatalog)
            ? rawCatalog
            : (rawCatalog && Array.isArray(rawCatalog.rows) ? rawCatalog.rows : []);
        catalogRows.forEach((r) => {
            [r.code, r.erp_code, r.codigo, r.id, r.sku_internal_id].forEach((candidate) => {
                const key = statusJoinKey(candidate);
                if (!key) return;
                if (!catalogStatusByErp.has(key)) catalogStatusByErp.set(key, r);
            });
        });
    } catch (_) { }

    let selected = null;
    let latestPlan = null;
    let selectedTransfer = null;
    let skuExcel = null;
    let allocExcel = null;
    let itemsExcel = null;
    let transferListExcel = null;
    let workflow = loadTransferWorkflow(tenantId, "stockspin");
    let legacyTransfers = [];
    let legacyOffset = 0;
    let legacyHasMore = true;
    let legacyLoading = false;
    let suggestTransferMode = false;
    const legacyCacheKey = `coceo.transfer.legacy.cache.${tenantId == null ? "global" : String(tenantId)}`;

    function isLegacySeedTransfer(t) {
        if (!t) return false;
        const id = String(t.id || "");
        const code = String(t.code || "");
        const hasItems = Array.isArray(t.items) && t.items.length > 0;
        if (hasItems) return false;
        if (id.startsWith("seed-")) return true;
        return /^T-45\d{2,}$/.test(code);
    }

    const beforeCleanup = Array.isArray(workflow.transfers) ? workflow.transfers.length : 0;
    workflow = {
        transfers: (workflow.transfers || []).filter((t) => !isLegacySeedTransfer(t)),
    };
    if (workflow.transfers.length !== beforeCleanup) {
        saveTransferWorkflow(tenantId, workflow, "stockspin");
    }

    const mainGridHost = mainEl.querySelector("#tr-main-grid");
    const skuHost = mainEl.querySelector("#tr-sku-grid");
    const allocHost = mainEl.querySelector("#tr-alloc-grid");
    const itemsHost = mainEl.querySelector("#tr-items-grid");

    if (!transferTableThemeStyleInstalled) {
        const transferTableThemeFix = document.createElement("style");
        const scopedCss = TRANSFER_TABLE_SCOPES.map((scope) => `
      ${scope} .table-wrapper table {
        width: max-content !important;
        table-layout: fixed !important;
      }
      ${scope} .table-wrapper table thead tr th {
        background-color: var(--color-primary) !important;
        color: #ffffff !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row td {
        background-color: var(--row-bg) !important;
        color: ${TRANSFER_TEXT_COLOR} !important;
        font-size: 12px !important;
        border-bottom: 1px solid rgba(0,0,0,0.08) !important;
        transition: background-color 0.12s ease;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row:hover td {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row td[style*="position: sticky"] {
        background-color: var(--row-bg) !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row:hover td[style*="position: sticky"] {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row td a {
        color: ${TRANSFER_TEXT_COLOR} !important;
      }`).join("\n");
        transferTableThemeFix.textContent = scopedCss;
        mainEl.appendChild(transferTableThemeFix);
        transferTableThemeStyleInstalled = true;
    }

    const transferCols = [
        {
            key: "code",
            label: "Código",
            type: "text",
            width: "120px",
            align: "center",
            render: (item) => {
                const a = document.createElement("a");
                a.href = "#";
                a.textContent = String(item.code || "-");
                a.style.color = TRANSFER_TEXT_COLOR;
                a.style.fontWeight = "600";
                a.style.fontSize = "12px";
                a.style.textDecoration = "none";
                a.onmouseenter = () => {
                    a.style.textDecoration = "underline";
                };
                a.onmouseleave = () => {
                    a.style.textDecoration = "none";
                };
                a.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openTransfer(item);
                };
                return a;
            },
        },
        { key: "origin", label: "Origem", type: "text", width: "140px", align: "center" },
        { key: "dest", label: "Destino", type: "text", width: "140px", align: "center" },
        { key: "planningDate", label: "Data Planej.", type: "date", width: "120px", align: "center" },
        { key: "executionDate", label: "Data Exec.", type: "date", width: "120px", align: "center" },
        { key: "itemsCount", label: "Itens", type: "number", width: "80px", align: "right" },
        {
            key: "status",
            label: "Status",
            type: "text",
            width: "220px",
            align: "center",
            render: (item) => createTransferStatusBadge(item.status),
        },
    ];

    transferListExcel = new ExcelTable({
        container: mainGridHost,
        columns: transferCols,
        gridId: "transfer-main-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        tableTheme: MIX_TABLE_THEME,
        summaryLabels: { total: "Transferências:", selected: "" }
    });

    function buildTransferRows() {
        let out = [
            ...(Array.isArray(legacyTransfers) ? legacyTransfers : []),
            ...(Array.isArray(workflow.transfers) ? workflow.transfers.filter((t) => String(t.source || "") !== "legacy") : []),
        ];

        out = out.map((r) => ({
            ...r,
            planningDate: String(r.planningDate || r.date || ""),
            executionDate: String(r.executionDate || r.planningDate || r.date || ""),
            itemsCount: Number.isFinite(Number(r.itemsCount))
                ? Number(r.itemsCount)
                : (Array.isArray(r.items) ? r.items.length : 0),
        }));
        out.sort((a, b) => String(b.code).localeCompare(String(a.code), "pt-BR", { numeric: true }));
        return out;
    }

    function refreshTransferList() {
        transferListExcel.render(buildTransferRows());
    }

    function openTransfer(item) {
        selectedTransfer = item || null;
        mainEl.querySelector("#tr-code").value = selectedTransfer ? selectedTransfer.code : "";
        mainEl.querySelector("#tr-origin").value = selectedTransfer ? selectedTransfer.origin : "Fábrica";
        mainEl.querySelector("#tr-dest").value = selectedTransfer ? selectedTransfer.dest : "Selecionar";
        mainEl.querySelector("#tr-date").value = selectedTransfer
            ? (selectedTransfer.executionDate || selectedTransfer.planningDate || selectedTransfer.date || "")
            : fmtDate(new Date());
        mainEl.querySelector("#tr-status").value = "PLANEJADA";
        selected = null;
        latestPlan = null;
        mainEl.querySelector("#tr-sel").value = "";
        mainEl.querySelector("#tr-note").textContent = "Selecione um SKU à esquerda, informe o disponível da Fábrica e calcule.";
        mainEl.querySelector("#tr-kpis").innerHTML = "";
        allocExcel.render([]);
        refreshTransferItemsUi();
        refreshSku();
        const isLegacy = selectedTransfer && String(selectedTransfer.source || "") === "legacy";
        mainEl.querySelector("#tr-origin").disabled = !!isLegacy;
        mainEl.querySelector("#tr-dest").disabled = !!isLegacy;
        mainEl.querySelector("#tr-calc").disabled = !!isLegacy;
        mainEl.querySelector("#tr-reserve").disabled = !!isLegacy;
        mainEl.querySelector("#tr-recv-save").disabled = !!isLegacy;
        if (isLegacy) {
            mainEl.querySelector("#tr-note").textContent =
                "Transferência histórica do legado (até ontem). Edição bloqueada; crie nova transferência para operar no Co-CEO.";
        }
        showDetail();
    }

    function mergeLegacyTransfers(newItems) {
        if (!Array.isArray(newItems) || newItems.length === 0) return false;
        const map = new Map((legacyTransfers || []).map((t) => [String(t.id), t]));
        newItems.forEach((t) => map.set(String(t.id), t));
        const next = Array.from(map.values());
        if (next.length === legacyTransfers.length) return false;
        legacyTransfers = next;
        return true;
    }

    function resolveInitialChunkSize() {
        const host = mainEl.querySelector("#tr-main-grid");
        const hostRect = host ? host.getBoundingClientRect() : null;
        const tableBodyHeight = hostRect && Number.isFinite(hostRect.height) && hostRect.height > 0 ? hostRect.height : 560;
        const estimatedHeaderAndFooter = 110;
        const rowPx = 34;
        const visibleRows = Math.max(1, Math.floor((tableBodyHeight - estimatedHeaderAndFooter) / rowPx));
        return Math.max(15, Math.min(120, visibleRows));
    }

    function loadLegacyCache() {
        try {
            const raw = localStorage.getItem(legacyCacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const items = Array.isArray(parsed?.items) ? parsed.items : [];
            const updatedAt = Number(parsed?.updatedAt) || 0;
            if (!items.length || !updatedAt) return null;
            return { items, updatedAt };
        } catch (_) {
            return null;
        }
    }

    function saveLegacyCache(items) {
        try {
            localStorage.setItem(
                legacyCacheKey,
                JSON.stringify({
                    updatedAt: Date.now(),
                    items: Array.isArray(items) ? items : [],
                })
            );
        } catch (_) { }
    }

    async function fetchLegacyTransfersPage(limit, offset) {
        try {
            const res = await fetch(`${LEGACY_LIVE_BASE}/legacy/transfers?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
            const payload = await res.json();
            if (res.ok && payload && payload.ok && payload.data && Array.isArray(payload.data.transfers)) {
                const page = payload.data.transfers.map((t) => ({
                    ...t,
                    source: "legacy",
                    items: [],
                }));
                return {
                    items: page,
                    hasMore: !!payload.data.hasMore,
                    count: Number(payload.data.count) || page.length,
                };
            }
        } catch (_) { }
        return { items: [], hasMore: false, count: 0 };
    }

    async function loadLegacyTransfersProgressive() {
        if (legacyLoading) return;
        legacyLoading = true;
        try {
            const cached = loadLegacyCache();
            if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
                legacyTransfers = cached.items;
                refreshTransferList();
                const age = Date.now() - Number(cached.updatedAt || 0);
                if (age < LEGACY_TRANSFER_CACHE_TTL_MS) {
                    legacyHasMore = false;
                    return;
                }
            }

            const initialLimit = resolveInitialChunkSize();
            const first = await fetchLegacyTransfersPage(initialLimit, 0);
            legacyOffset = first.count;
            legacyHasMore = !!first.hasMore;
            mergeLegacyTransfers(first.items);
            refreshTransferList();
            saveLegacyCache(legacyTransfers);

            const pump = async () => {
                if (!legacyHasMore) return;
                const page = await fetchLegacyTransfersPage(60, legacyOffset);
                legacyOffset += page.count;
                legacyHasMore = !!page.hasMore;
                const changed = mergeLegacyTransfers(page.items);
                if (changed) refreshTransferList();
                if (legacyHasMore) setTimeout(() => { pump(); }, 120);
                else saveLegacyCache(legacyTransfers);
            };
            if (legacyHasMore) setTimeout(() => { pump(); }, 120);
            else saveLegacyCache(legacyTransfers);
        } finally {
            legacyLoading = false;
        }
    }

    const skuCols = [
        {
            key: "erp_code",
            label: "Código",
            type: "text",
            width: "110px",
            align: "center",
            render: (item) => {
                const a = document.createElement("a");
                a.href = item._detailHref || "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = String(item.erp_code || "-");
                a.style.color = TRANSFER_TEXT_COLOR;
                a.style.fontWeight = "600";
                a.style.fontSize = "12px";
                a.style.textDecoration = "none";
                a.onmouseenter = () => {
                    a.style.textDecoration = "underline";
                };
                a.onmouseleave = () => {
                    a.style.textDecoration = "none";
                };
                a.onclick = (e) => e.stopPropagation();
                return a;
            },
        },
        {
            key: "product_name",
            label: "Descrição",
            type: "text",
            width: "260px",
            sticky: true,
            wrap: true,
            render: (item) => {
                const a = document.createElement("a");
                a.href = item._detailHref || "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = String(item.product_name || "-");
                a.style.color = TRANSFER_TEXT_COLOR;
                a.style.fontWeight = "600";
                a.style.fontSize = "12px";
                a.style.textDecoration = "none";
                a.style.display = "block";
                a.style.whiteSpace = "normal";
                a.style.overflowWrap = "anywhere";
                a.style.wordBreak = "break-word";
                a.style.lineHeight = "1.2";
                a.onmouseenter = () => {
                    a.style.textDecoration = "underline";
                };
                a.onmouseleave = () => {
                    a.style.textDecoration = "none";
                };
                a.onclick = (e) => e.stopPropagation();
                return a;
            },
        },
        { key: "category", label: "Categoria", type: "text", width: "130px", align: "left" },
        { key: "subcategory", label: "Sub-categoria", type: "text", width: "150px", align: "left" },
        {
            key: "product_lifecycle_status",
            label: "Status Cadastro",
            type: "text",
            width: "140px",
            align: "center",
            render: (item) => createLifecycleStatusBadge(item.product_lifecycle_status),
        },
        { key: "status_urgencia", label: "Status", type: "text", width: "110px", align: "center" },
        { key: "demanda_destino", label: "Demanda Destino", type: "number", width: "115px", align: "right" },
        { key: "qtd_cd_disponivel", label: "Disponível Origem", type: "number", width: "120px", align: "right" },
        {
            key: "qtd_repassar_cd",
            label: "Qtd Sugerida",
            type: "number",
            width: "105px",
            align: "right",
            render: (item) => {
                const span = document.createElement("span");
                span.textContent = String(Math.max(0, Number(item.qtd_repassar_cd || 0)));
                if (Number(item.qtd_repassar_cd || 0) <= 0 && Number(item.demanda_destino || 0) > 0) {
                    span.style.color = "#ef4444";
                    span.style.fontWeight = "800";
                    span.title = "Origem sem estoque para este item nesta sugestão. Manter registro para análise futura.";
                    return span;
                }
                if (item._rateioNeeded) {
                    span.style.color = "#fbbf24";
                    span.style.fontWeight = "700";
                    span.title = "Rateio necessário entre as lojas: disponibilidade da Fábrica menor que a demanda total da rede.";
                }
                return span;
            },
        },
        {
            key: "qtd_aprovada",
            label: "Qtd Aprovada",
            type: "number",
            width: "130px",
            align: "right",
            noFilter: true,
            render: (item) => {
                const input = document.createElement("input");
                input.type = "number";
                input.min = "0";
                input.step = "1";
                input.value = String(Math.max(0, Number(item.qtd_aprovada || 0)));
                input.style.width = "84px";
                input.style.textAlign = "right";
                input.style.padding = "3px 6px";
                input.style.borderRadius = "6px";
                input.style.border = "1px solid rgba(148,163,184,.6)";
                input.title = `Origem disponível: ${Math.max(0, Number(item.qtd_cd_disponivel || 0))} | Sugerida: ${Math.max(0, Number(item.qtd_repassar_cd || 0))}`;
                input.onclick = (e) => e.stopPropagation();
                input.onchange = () => {
                    const next = Math.max(0, Math.round(Number(input.value) || 0));
                    if (next !== Number(item.qtd_aprovada || 0)) {
                        applyApprovedQtyChange(item, next);
                    }
                };
                return input;
            },
        },
        
    ];

    skuExcel = new ExcelTable({
        container: skuHost,
        columns: skuCols,
        gridId: "transfer-equalizer-sku-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        tableTheme: MIX_TABLE_THEME,
        summaryLabels: { total: "SKUs (lista):", selected: "" }
    });

    const allocCols = [
        { key: "store", label: "Loja", type: "text", width: "160px" },
        { key: "prioridade", label: "Prioridade", type: "text", width: "110px", align: "center" },
        { key: "demanda", label: "Demanda", type: "number", width: "100px", align: "right" },
        { key: "alloc", label: "Alocado", type: "number", width: "100px", align: "right" },
        {
            key: "cov_pct",
            label: "Atendimento %",
            type: "number",
            width: "110px",
            align: "right",
            noFilter: true,
            render: (item) => {
                const span = document.createElement("span");
                span.textContent = `${item.cov_pct.toFixed(1).replace(".", ",")}%`;
                span.style.fontWeight = "700";
                span.style.color = item._covColor;
                return span;
            }
        },
        { key: "falta", label: "Falta", type: "number", width: "90px", align: "right" }
    ];

    allocExcel = new ExcelTable({
        container: allocHost,
        columns: allocCols,
        gridId: "transfer-equalizer-alloc-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        tableTheme: MIX_TABLE_THEME,
        summaryLabels: { total: "Lojas:", selected: "" }
    });

    const itemCols = [
        { key: "erp_code", label: "ERP", type: "text", width: "90px", align: "center" },
        { key: "product_name", label: "Produto", type: "text", width: "220px", sticky: true },
        { key: "allocatedQty", label: "Empenhado", type: "number", width: "100px", align: "right" },
        { key: "receivedQty", label: "Recebido", type: "number", width: "100px", align: "right" },
        { key: "shortageNow", label: "Pendência", type: "number", width: "100px", align: "right" },
        {
            key: "receiveDecision",
            label: "Decisão",
            type: "text",
            width: "210px",
            render: (it) => createTransferDecisionBadge(it.receiveDecision),
        },
        { key: "receiveNote", label: "Observação", type: "text", width: "240px" },
    ];

    itemsExcel = new ExcelTable({
        container: itemsHost,
        columns: itemCols,
        gridId: "transfer-receipt-items-grid-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        tableTheme: MIX_TABLE_THEME,
        summaryLabels: { total: "Itens:", selected: "" },
    });

    function selectedTransferFromWorkflow() {
        if (!selectedTransfer) return null;
        return (workflow.transfers || []).find((t) => String(t.id) === String(selectedTransfer.id)) || null;
    }

    function getPersistedItemByErp(erpCode) {
        const tr = selectedTransferFromWorkflow();
        if (!tr || !Array.isArray(tr.items)) return null;
        const code = String(erpCode || "").trim();
        return tr.items.find((it) => String(it.erp_code || "").trim() === code) || null;
    }

    function refreshTransferItemsUi() {
        const tr = selectedTransferFromWorkflow() || selectedTransfer || { items: [] };
        const items = Array.isArray(tr.items) ? tr.items : [];
        const sel = mainEl.querySelector("#tr-recv-item");
        sel.innerHTML = items.length
            ? items
                .map((it) => `<option value="${String(it.erp_code)}">${String(it.erp_code)} · ${String(it.product_name || "")}</option>`)
                .join("")
            : `<option value="">Sem itens empenhados</option>`;
        if (items.length) {
            const currentCode = String(sel.value || "");
            const chosen = items.find((it) => String(it.erp_code) === currentCode) || items[0];
            sel.value = String(chosen.erp_code);
            mainEl.querySelector("#tr-recv-qty").value = String(Math.max(0, Number(chosen.receivedQty || 0)));
            mainEl.querySelector("#tr-recv-note").value = String(chosen.receiveNote || "");
            mainEl.querySelector("#tr-recv-decision").value = String(chosen.receiveDecision || "APROVADA TOTALMENTE");
        } else {
            mainEl.querySelector("#tr-recv-qty").value = "";
            mainEl.querySelector("#tr-recv-note").value = "";
            mainEl.querySelector("#tr-recv-decision").value = "APROVADA TOTALMENTE";
        }

        const rowsItems = items.map((it, idx) => ({
            id: `it-${idx}-${it.erp_code}`,
            ...it,
            shortageNow: Math.max(0, Number(it.allocatedQty || 0) - Number(it.receivedQty || 0)),
        }));
        itemsExcel.render(rowsItems);
        const hist = Array.isArray(tr.history) ? tr.history : [];
        const host = mainEl.querySelector("#tr-history");
        if (!hist.length) {
            host.textContent = "Sem eventos registrados.";
        } else {
            host.innerHTML = hist
                .slice()
                .reverse()
                .slice(0, 12)
                .map((h) => {
                    const dt = new Date(h.at);
                    const stamp = Number.isNaN(dt.getTime()) ? String(h.at || "") : dt.toLocaleString("pt-BR");
                    return `<div>• [${stamp}] ${String(h.message || "")}</div>`;
                })
                .join("");
        }
    }

    function buildSkuRows() {
        const erp = (mainEl.querySelector("#tr-erp").value || "").trim();
        const q = (mainEl.querySelector("#tr-q").value || "").toLowerCase();
        const st = mainEl.querySelector("#tr-st").value;
        const topN = Math.max(1, Math.min(500, Number(mainEl.querySelector("#tr-topn").value) || 200));
        const destPick = String(mainEl.querySelector("#tr-dest")?.value || "").trim();
        const originPick = String(mainEl.querySelector("#tr-origin")?.value || "").trim();
        const transferStore =
            destPick || (selectedTransfer && selectedTransfer.dest ? String(selectedTransfer.dest) : "");
        const originName =
            originPick || (selectedTransfer && selectedTransfer.origin ? String(selectedTransfer.origin) : "Fábrica");

        let list = rows.filter((r) => Number(r.demanda_total_cd || 0) > 0);
        if (transferStore) {
            list = list.filter((r) => toStoresArray(r.lojas).some((s) => String(s.store || "") === transferStore && Number(s.demanda || 0) > 0));
        }
        if (suggestTransferMode) {
            list = list.filter((r) => {
                const hasDemandInDest = toStoresArray(r.lojas).some(
                    (s) => String(s.store || "") === transferStore && Number(s.demanda || 0) > 0
                );
                if (!hasDemandInDest) return false;
                return true;
            });
        }
        list.sort((a, b) => Number(b.demanda_total_cd || 0) - Number(a.demanda_total_cd || 0));
        list = list.slice(0, topN).filter((r) => {
            if (erp && String(r.erp_code || "") !== erp) return false;
            if (st && String(r.status_urgencia || "") !== st) return false;
            if (q) {
                const s = `${r.erp_code} ${r.product_name} ${r.category} ${r.subcategory}`.toLowerCase();
                if (!s.includes(q)) return false;
            }
            return true;
        });

        return list.map((r, idx) => ({
            ...(function () {
                const stores = toStoresArray(r.lojas);
                const destDemand = stores
                    .filter((s) => String(s.store || "") === transferStore)
                    .reduce((acc, s) => acc + Math.max(0, Number(s.demanda || 0)), 0);
                const totalDem = Math.max(0, Number(r.demanda_total_cd || 0));
                const originAvail = resolveOriginAvailableQty(r, originName);
                const lowOrig = String(originName || "").toLowerCase();
                const fromFactory =
                    lowOrig.includes("fábrica") ||
                    lowOrig.includes("fabrica") ||
                    lowOrig.includes("cd");
                const rateioNeeded = fromFactory && originAvail < totalDem;
                let cdRepasse = destDemand;
                if (rateioNeeded && totalDem > 0) {
                    cdRepasse = Math.floor((originAvail * destDemand) / totalDem);
                } else {
                    cdRepasse = Math.min(originAvail, destDemand);
                }
                const persisted = getPersistedItemByErp(r.erp_code);
                const approvedQty = persisted && Number.isFinite(Number(persisted.approvedQty))
                    ? Math.max(0, Math.round(Number(persisted.approvedQty)))
                    : Math.max(0, Math.round(cdRepasse));
                return {
                    demanda_destino: Math.max(0, Math.round(destDemand)),
                    qtd_cd_disponivel: Math.max(0, Math.round(originAvail)),
                    qtd_repassar_cd: Math.max(0, Math.round(cdRepasse)),
                    qtd_aprovada: approvedQty,
                    _rateioNeeded: rateioNeeded && destDemand > 0,
                };
            })(),
            id: normalizeCode(r.erp_code) || `sku-${idx}`,
            erp_code: r.erp_code,
            product_name: r.product_name,
            category: r.category || "-",
            subcategory: r.subcategory || "-",
            product_lifecycle_status: deriveProductLifecycleStatus(
                catalogStatusByErp.get(statusJoinKey(r.erp_code))
                || catalogStatusByErp.get(statusJoinKey(r.sku_internal_id))
                || r
            ),
            status_urgencia: r.status_urgencia || "ACIMA",
            demanda_total_cd: r.demanda_total_cd,
            n_lojas: toStoresArray(r.lojas).length,
            _raw: r,
            _detailHref: `${base}/ceo_product_detail_layout.html?sku=${encodeURIComponent(String(r.sku_internal_id || ""))}&hub=1`,
        }));
    }

    function applyApprovedQtyChange(item, approvedQty) {
        if (!selectedTransfer || !item || !item._raw) return;
        const ideal = Math.max(0, Math.round(Number(item.demanda_destino || 0)));
        const availableCd = Math.max(0, Math.round(Number(item.qtd_cd_disponivel || 0)));
        const suggested = Math.max(0, Math.round(Number(item.qtd_repassar_cd || 0)));
        const approved = Math.max(0, Math.round(Number(approvedQty) || 0));
        workflow = upsertTransferItem(workflow, selectedTransfer.id, {
            sku_id: item._raw.sku_internal_id != null ? Number(item._raw.sku_internal_id) : null,
            erp_code: item.erp_code,
            product_name: item.product_name,
            availableCdQty: availableCd,
            approvedQty: approved,
            allocatedQty: approved,
            totalDemand: ideal,
            shortage: Math.max(0, ideal - approved),
        });
        workflow = appendTransferEvent(workflow, selectedTransfer.id, {
            type: "APPROVAL_QTY_CHANGE",
            message: `SKU ${item.erp_code}: origem ${availableCd}, sugerida ${suggested}, aprovada ${approved}.`,
            
        });
        saveTransferWorkflow(tenantId, workflow, "stockspin");
        selectedTransfer = selectedTransferFromWorkflow() || selectedTransfer;
        refreshTransferItemsUi();
    }

    function refreshSku() {
        const skuRows = buildSkuRows();
        skuExcel.render(skuRows);
        const prevErp = selected && selected.erp_code ? String(selected.erp_code) : "";
        const chosen = skuRows.find((x) => String(x.erp_code || "") === prevErp) || skuRows[0] || null;
        if (chosen && chosen._raw) {
            selected = chosen._raw;
            mainEl.querySelector("#tr-sel").value = `${chosen.erp_code} · ${chosen.product_name}`;
            mainEl.querySelector("#tr-note").textContent = "SKU selecionado. Informe o disponível da Fábrica e calcule.";
        } else {
            selected = null;
            mainEl.querySelector("#tr-sel").value = "";
        }
    }

    function resolveOriginAvailableQty(row, originName) {
        const compra = Math.max(0, Number(row.sugestao_compra_legacy || 0));
        const prod = Math.max(0, Number(row.total_em_producao_legacy || 0));
        const low = String(originName || "").toLowerCase();
        if (low.includes("fábrica") || low.includes("fabrica") || low.includes("cd")) {
            return compra + prod;
        }
        const fromMatrix = matrixDisponivelAtStore(row, originName);
        if (fromMatrix != null) return Math.max(0, Math.round(fromMatrix));
        return 0;
    }

    function calcAlloc() {
        if (!selected) {
            alert("Selecione um SKU na lista.");
            return;
        }
        const availPhysical = Math.max(0, Math.round(Number(mainEl.querySelector("#tr-cd").value) || 0));
        const erpCode = String(selected.erp_code || "").trim();
        const reservedByOthers = computeReservedBySku(workflow.transfers || [], erpCode, selectedTransfer?.id || null);
        const avail = Math.max(0, availPhysical - reservedByOthers);
        const stores = toStoresArray(selected.lojas).filter((s) => Number(s.demanda || 0) > 0);
        const plan = allocateEqualized(stores, avail);
        const allocRows = plan.rows.map((s, i) => {
            const falta = Math.max(0, s.demanda - s.alloc);
            const cov = s.demanda > 0 ? (100 * s.alloc) / s.demanda : 0;
            const covColor = cov >= 95 ? "#86efac" : cov >= 60 ? "#fdba74" : "#fca5a5";
            return {
                id: `alloc-${i}-${s.store || i}`,
                store: s.store || "-",
                prioridade: s.prioridade || "-",
                demanda: s.demanda,
                alloc: s.alloc,
                falta,
                cov_pct: cov,
                _covColor: covColor
            };
        });
        allocExcel.render(allocRows);
        const bal = Math.max(0, avail - plan.allocated);
        const cov = plan.totalDem > 0 ? (100 * plan.allocated) / plan.totalDem : 0;
        latestPlan = {
            erp_code: erpCode,
            sku_id: selected.sku_internal_id != null ? Number(selected.sku_internal_id) : null,
            product_name: selected.product_name || "",
            allocatedQty: plan.allocated,
            totalDemand: plan.totalDem,
            shortage: Math.max(0, plan.totalDem - plan.allocated),
        };
        mainEl.querySelector("#tr-kpis").innerHTML = `
      <div class="stockspin-kpi"><div class="k">Demanda total</div><div class="v">${fmtInt(plan.totalDem)}</div></div>
      <div class="stockspin-kpi"><div class="k">Disponível Fábrica (físico)</div><div class="v">${fmtInt(availPhysical)}</div></div>
      <div class="stockspin-kpi"><div class="k">Reservado (outras transferências)</div><div class="v">${fmtInt(reservedByOthers)}</div></div>
      <div class="stockspin-kpi"><div class="k">Disponível p/ rateio</div><div class="v">${fmtInt(avail)}</div></div>
      <div class="stockspin-kpi"><div class="k">Transferido</div><div class="v">${fmtInt(plan.allocated)}</div></div>
      <div class="stockspin-kpi"><div class="k">Cobertura geral</div><div class="v">${cov.toFixed(1).replace(".", ",")}%</div></div>
      <div class="stockspin-kpi"><div class="k">Saldo Fábrica</div><div class="v">${fmtInt(bal)}</div></div>`;
    }

    function persistLatestPlan() {
        if (!selectedTransfer) {
            alert("Selecione uma transferência.");
            return;
        }
        if (!latestPlan || !latestPlan.erp_code) {
            alert("Calcule uma sugestão antes de empenhar.");
            return;
        }
        workflow = upsertTransferItem(workflow, selectedTransfer.id, latestPlan);
        workflow = appendTransferEvent(workflow, selectedTransfer.id, {
            type: "RESERVE_ITEM",
            message: `SKU ${latestPlan.erp_code}: empenho de ${fmtInt(latestPlan.allocatedQty)} unidades.`,
        });
        saveTransferWorkflow(tenantId, workflow, "stockspin");
        selectedTransfer = selectedTransferFromWorkflow() || selectedTransfer;
        mainEl.querySelector("#tr-note").textContent =
            `SKU ${latestPlan.erp_code} empenhado na transferência ${selectedTransfer.code}.`;
        refreshTransferItemsUi();
        refreshTransferList();
    }

    function createTransfer() {
        const stores = [...new Set(rows.flatMap((r) => toStoresArray(r.lojas).map((x) => x.store)).filter(Boolean))];
        const origin = String(mainEl.querySelector("#tr-origin").value || "Fábrica");
        const firstDest = stores.find((s) => String(s) !== origin) || stores[0] || "Barreiro";
        const dest = String(mainEl.querySelector("#tr-dest").value || firstDest);
        const id = `tr-${Date.now()}`;
        const t = {
            id,
            code: `T-${String(Date.now()).slice(-6)}`,
            origin,
            dest,
            planningDate: fmtDate(new Date()),
            executionDate: fmtDate(new Date()),
            status: "PLANEJADA",
            items: [],
        };
        workflow = upsertTransfer(workflow, t);
        workflow = appendTransferEvent(workflow, t.id, {
            type: "CREATE_TRANSFER",
            message: `Transferência criada para ${t.dest}.`,
        });
        saveTransferWorkflow(tenantId, workflow, "stockspin");
        refreshTransferList();
        openTransfer(t);
    }

    function ensureOriginDestDifferent(changedField) {
        const originEl = mainEl.querySelector("#tr-origin");
        const destEl = mainEl.querySelector("#tr-dest");
        let origin = String(originEl.value || "");
        let dest = String(destEl.value || "");
        if (!origin || !dest) {
            refreshSku();
            return;
        }
        if (origin === dest) {
            const opts = Array.from(destEl.options).map((o) => String(o.value || ""));
            const fallback = opts.find((v) => v && v !== origin) || "";
            if (changedField === "origin") {
                dest = fallback;
                destEl.value = dest;
            } else {
                origin = fallback;
                originEl.value = origin;
            }
        }
        if (selectedTransfer) {
            const next = { ...selectedTransfer, origin: originEl.value, dest: destEl.value };
            workflow = upsertTransfer(workflow, next);
            saveTransferWorkflow(tenantId, workflow, "stockspin");
            selectedTransfer = next;
            refreshTransferList();
        }
        refreshSku();
    }

    function registerReceipt() {
        if (!selectedTransfer) return;
        const itemCode = String(mainEl.querySelector("#tr-recv-item").value || "").trim();
        if (!itemCode) return;
        const tr = selectedTransferFromWorkflow();
        if (!tr) return;
        const item = (tr.items || []).find((it) => String(it.erp_code || "").trim() === itemCode);
        if (!item) return;

        const decision = String(mainEl.querySelector("#tr-recv-decision").value || "");
        const qty = Math.max(0, Math.round(Number(mainEl.querySelector("#tr-recv-qty").value) || 0));
        const note = String(mainEl.querySelector("#tr-recv-note").value || "").trim();
        const allocated = Math.max(0, Number(item.allocatedQty || 0));
        if (qty > allocated) {
            alert(`Qtd recebida não pode ser maior que o empenhado (${fmtInt(allocated)}).`);
            return;
        }
        workflow = upsertTransferItem(workflow, tr.id, {
            ...item,
            receivedQty: qty,
            receiveDecision: decision,
            receiveNote: note,
        });
        workflow = appendTransferEvent(workflow, tr.id, {
            type: "RECEIPT_ITEM",
            message: `SKU ${item.erp_code}: ${decision}, recebido ${fmtInt(qty)} de ${fmtInt(allocated)}.`,
        });

        const trAfter = (workflow.transfers || []).find((x) => String(x.id) === String(tr.id)) || tr;
        const derived = deriveTransferStatusFromItems(trAfter.items || []);
        if (canTransitionTransferStatus(trAfter.status, derived)) {
            workflow = upsertTransfer(workflow, { ...trAfter, status: derived });
            workflow = appendTransferEvent(workflow, tr.id, {
                type: "AUTO_STATUS",
                message: `Status ajustado automaticamente para ${derived} pelo recebimento.`,
            });
        }
        saveTransferWorkflow(tenantId, workflow, "stockspin");
        selectedTransfer = selectedTransferFromWorkflow() || selectedTransfer;
        mainEl.querySelector("#tr-status").value = normalizeTransferStatus(selectedTransfer.status);
        refreshTransferItemsUi();
        refreshTransferList();
    }

    function persistSuggestionSnapshot(rowsToPersist) {
        if (!selectedTransfer) return;
        if (!Array.isArray(rowsToPersist) || rowsToPersist.length === 0) return;
        let zeroCount = 0;
        rowsToPersist.forEach((row) => {
            if (!row || !row._raw) return;
            const alloc = Math.max(0, Math.round(Number(row.qtd_repassar_cd || 0)));
            const approved = Math.max(0, Math.round(Number(row.qtd_aprovada || alloc)));
            const availableCd = Math.max(0, Math.round(Number(row.qtd_cd_disponivel || 0)));
            const demDest = Math.max(0, Math.round(Number(row.demanda_destino || 0)));
            if (demDest <= 0) return;
            if (alloc <= 0) zeroCount++;
            workflow = upsertTransferItem(workflow, selectedTransfer.id, {
                sku_id: row._raw.sku_internal_id != null ? Number(row._raw.sku_internal_id) : null,
                erp_code: row.erp_code,
                product_name: row.product_name,
                availableCdQty: availableCd,
                approvedQty: approved,
                allocatedQty: approved,
                totalDemand: demDest,
                shortage: Math.max(0, demDest - approved),
            });
        });
        workflow = appendTransferEvent(workflow, selectedTransfer.id, {
            type: "SUGGESTION_SNAPSHOT",
            message: `Sugestão registrada: ${rowsToPersist.length} SKUs, ${zeroCount} sem estoque na origem (repasse zero).`,
        });
        saveTransferWorkflow(tenantId, workflow, "stockspin");
        selectedTransfer = selectedTransferFromWorkflow() || selectedTransfer;
        refreshTransferItemsUi();
    }

    ["#tr-erp", "#tr-q", "#tr-st", "#tr-topn"].forEach((sel) => {
        mainEl.querySelector(sel).addEventListener("input", () => {
            suggestTransferMode = false;
            refreshSku();
        });
    });
    mainEl.querySelector("#tr-origin").addEventListener("change", () => {
        ensureOriginDestDifferent("origin");
    });
    mainEl.querySelector("#tr-dest").addEventListener("change", () => {
        ensureOriginDestDifferent("dest");
    });
    mainEl.querySelector("#tr-recv-item").addEventListener("change", () => {
        const tr = selectedTransferFromWorkflow();
        const itemCode = String(mainEl.querySelector("#tr-recv-item").value || "").trim();
        const item = tr && Array.isArray(tr.items) ? tr.items.find((it) => String(it.erp_code || "").trim() === itemCode) : null;
        mainEl.querySelector("#tr-recv-qty").value = item ? String(Math.max(0, Number(item.receivedQty || 0))) : "";
        mainEl.querySelector("#tr-recv-note").value = item ? String(item.receiveNote || "") : "";
        mainEl.querySelector("#tr-recv-decision").value = item ? String(item.receiveDecision || "APROVADA TOTALMENTE") : "APROVADA TOTALMENTE";
    });
    mainEl.querySelector("#tr-refresh").addEventListener("click", refreshSku);
    mainEl.querySelector("#tr-suggest-top").addEventListener("click", () => {
        suggestTransferMode = true;
        const suggestedRows = buildSkuRows();
        skuExcel.render(suggestedRows);
        persistSuggestionSnapshot(suggestedRows);
        mainEl.querySelector("#tr-note").textContent =
            "Sugestão aplicada: todos os SKUs com demanda no destino. Se origem for Fábrica e não cobrir a rede, aplica rateio. Itens em vermelho indicam repasse zero por falta de estoque na origem (gravado no histórico).";
    });
    mainEl.querySelector("#tr-calc").addEventListener("click", calcAlloc);
    mainEl.querySelector("#tr-reserve").addEventListener("click", persistLatestPlan);
    mainEl.querySelector("#tr-recv-save").addEventListener("click", registerReceipt);
    mainEl.querySelector("#tr-back").addEventListener("click", showList);
    mainEl.querySelector("#tr-new").addEventListener("click", createTransfer);

    const units = ["Fábrica", ...new Set(rows.flatMap((r) => toStoresArray(r.lojas).map((x) => String(x.store || "")).filter(Boolean)))] ;
    const originEl = mainEl.querySelector("#tr-origin");
    const destEl = mainEl.querySelector("#tr-dest");
    originEl.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
    destEl.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
    originEl.value = "Fábrica";
    const firstDest = units.find((u) => u !== "Fábrica") || units[0] || "";
    destEl.value = firstDest;
    const decisionEl = mainEl.querySelector("#tr-recv-decision");
    decisionEl.innerHTML = TRANSFER_ITEM_DECISIONS
        .filter((d) => d !== "PENDENTE")
        .map((d) => `<option value="${d}">${d}</option>`)
        .join("");

    if (!workflow.transfers || workflow.transfers.length === 0) {
        workflow = { transfers: [] };
        saveTransferWorkflow(tenantId, workflow, "stockspin");
    }

    refreshTransferList();
    loadLegacyTransfersProgressive();
    loadNetworkMatrixAvail().then(() => {
        refreshSku();
    });
    refreshSku();
    allocExcel.render([]);
    itemsExcel.render([]);
    showList();
}

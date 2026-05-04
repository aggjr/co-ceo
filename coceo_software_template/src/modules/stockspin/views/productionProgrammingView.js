import { ExcelTable } from "../../../components/ExcelTable.js";
import { loadClientScript, stockspinDataBase } from "../loadClientScript.js";
import "../stockspin-excel.css";
import { decideAction, loadMakeBuyMap, normalizeCode, statusCls } from "../procurementPlanLogic.js";
import {
    appendProgramEvent,
    loadProductionPrograms,
    replaceProgramItems,
    saveProductionPrograms,
    upsertProgram,
    upsertProgramItem,
} from "../../../utils/productionProgramStore.js";
import { getActiveTenantIdForModules } from "../../../utils/moduleContext.js";

const MIX_TABLE_THEME = {
    rowEvenBg: "#ffffff",
    rowOddBg: "#dbeafe",
    rowHoverBg: "#edd8bb",
    textColor: "#0f172a",
    bodyFontSize: "12px",
};
const COL = "#0f172a";
const TABLE_SCOPES = ["#pp-main-grid", "#pp-lines-grid"];
let productionTableThemeInstalled = false;

function fmtBRL(n) {
    const x = Number(n) || 0;
    return x.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

function fmtPct(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function isoDate(d) {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Mix + origem da classificação (legado vs catálogo). */
function formatStatusCadastro(r) {
    const mix = r.fora_mix ? "FORA MIX" : "NO MIX";
    const src = String(r.category_source || "none").toLowerCase();
    const srcShort =
        src === "legacy" ? "Cat. legado" : src === "none" ? "Sem cat." : src.includes("catalog") ? "Catálogo" : r.category_source;
    return `${mix} · ${srcShort}`;
}

/** Unidades sugeridas pelo ERP legado (produção / compra no CD-fábrica). */
function formatLegacyProductionSuggestion(r) {
    const p = Math.max(0, Math.round(Number(r.total_em_producao_legacy) || 0));
    const c = Math.max(0, Math.round(Number(r.sugestao_compra_legacy) || 0));
    if (p > 0 && c > 0) return `Produzir ${p} u · Comprar ${c} u`;
    if (p > 0) return `Produzir ${p} u`;
    if (c > 0) return `Comprar ${c} u`;
    return "—";
}

function pickPlanMetaFromPlanRow(r) {
    return {
        status_cadastro_label: formatStatusCadastro(r),
        status_urgencia: r.status_urgencia,
        status_source: r.status_source,
        ruptura_max_pct: r.ruptura_max_pct != null ? Number(r.ruptura_max_pct) : null,
        legacy_sugestao_label: formatLegacyProductionSuggestion(r),
    };
}

function statusFabricaBadgeEl(item) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "3px";
    wrap.style.alignItems = "center";
    const s = String(item.status_urgencia || "ACIMA").trim() || "ACIMA";
    const span = document.createElement("span");
    span.textContent = s;
    span.style.fontSize = "11px";
    span.style.fontWeight = "700";
    span.style.borderRadius = "6px";
    span.style.padding = "2px 6px";
    span.style.display = "inline-block";
    const cls = statusCls(s);
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
    wrap.appendChild(span);
    const sub = document.createElement("span");
    sub.style.fontSize = "10px";
    sub.style.color = "#64748b";
    sub.style.lineHeight = "1.15";
    sub.style.textAlign = "center";
    if (item.status_source === "ceo_cd") {
        sub.textContent = "Fonte: CEO / CD";
    } else if (item.status_source === "matrix_fallback") {
        const mx = Number(item.ruptura_max_pct);
        sub.textContent = Number.isFinite(mx)
            ? `Est.: máx. ruptura lojas ${mx.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
            : "Est.: matriz lojas";
    } else {
        sub.textContent = String(item.status_source || "");
    }
    wrap.appendChild(sub);
    return wrap;
}

/**
 * Regra mais ampla que `decideAction` sozinha: o mapa `sku_make_buy_map.json` costuma estar vazio ou
 * marcar «compra» mesmo com legado a produzir; para OP de fábrica incluímos ruptura/crítico com demanda.
 */
function decideProductionAction(r, makeBuyMap) {
    const dec = decideAction(r, makeBuyMap);
    const dem = Math.max(0, Math.round(Number(r.demanda_total_cd || 0)));
    if (dem <= 0) return dec;

    if (dec.action === "COMPRAR") {
        const legProd = Math.max(0, Math.round(Number(r.total_em_producao_legacy || 0)));
        if (legProd > 0) {
            return {
                action: "PRODUZIR",
                makeQty: dem,
                buyQty: 0,
                rule: "Legado em produção (mapa indicava compra)",
            };
        }
        const st = String(r.status_urgencia || "").trim().toUpperCase();
        if (st === "RUPTURA" || st === "CRÍTICO") {
            return {
                action: "PRODUZIR",
                makeQty: dem,
                buyQty: 0,
                rule: "Urgência CD — candidato a OP (composição não mapeada; rever Compra x Produção)",
            };
        }
    }
    return dec;
}

function planRowToSuggestionItem(r, makeBuyMap, qtyOverride) {
    const code = normalizeCode(r.erp_code);
    const dec = decideProductionAction(r, makeBuyMap);
    if (dec.action === "COMPRAR") return null;
    if (dec.action === "MISTO" && (!Number(dec.makeQty) || Number(dec.makeQty) <= 0)) return null;
    const dem = Math.max(0, Math.round(Number(r.demanda_total_cd || 0)));
    if (dem <= 0) return null;

    const lucroBruto = Number(r.margem_contribuicao_total) || 0;
    const vb = Number(r.valor_bruto_vendas) || 0;
    const qv = Number(r.quantidade_vendida) || 0;
    const marginPct = vb > 0 ? (100 * lucroBruto) / vb : null;
    const denom = Math.max(qv, dem, 1);
    const unitContrib = lucroBruto / denom;
    const dq = Number(dec.makeQty);
    const defaultQty = Math.max(0, Math.round(Number.isFinite(dq) && dq > 0 ? dq : dem));
    const qty = qtyOverride != null ? Math.max(0, Math.round(Number(qtyOverride))) : defaultQty;

    return {
        sku_id: r.sku_internal_id != null ? Number(r.sku_internal_id) : null,
        erp_code: code,
        product_name: String(r.product_name || ""),
        demand_cd: dem,
        lucro_bruto_ref: lucroBruto,
        valor_bruto_ref: vb,
        qtd_vendida_ref: qv,
        margin_pct_ref: marginPct,
        unit_contrib: unitContrib,
        qty_produce: qty,
        _margin_display: marginPct,
        _lucro_display: lucroBruto,
        ...pickPlanMetaFromPlanRow(r),
    };
}

function buildSuggestionItems(planRows, makeBuyMap, existingByCode) {
    const out = [];
    const seen = new Set();
    for (const r of planRows || []) {
        const code = normalizeCode(r.erp_code);
        if (!code || seen.has(code)) continue;
        const prev = existingByCode.get(code);
        const row = planRowToSuggestionItem(r, makeBuyMap, prev != null ? prev.qty_produce : undefined);
        if (!row) continue;
        seen.add(code);
        out.push(row);
    }
    out.sort((a, b) => b.demand_cd - a.demand_cd || a.erp_code.localeCompare(b.erp_code));
    return out.slice(0, 800);
}

function persistItemsForProgram(items) {
    return items.map((x) => ({
        sku_id: x.sku_id,
        erp_code: x.erp_code,
        product_name: x.product_name,
        demand_cd: x.demand_cd,
        lucro_bruto_ref: x.lucro_bruto_ref,
        valor_bruto_ref: x.valor_bruto_ref,
        qtd_vendida_ref: x.qtd_vendida_ref,
        margin_pct_ref: x.margin_pct_ref,
        unit_contrib: x.unit_contrib,
        qty_produce: x.qty_produce,
        status_cadastro_label: x.status_cadastro_label,
        status_urgencia: x.status_urgencia,
        status_source: x.status_source,
        ruptura_max_pct: x.ruptura_max_pct,
        legacy_sugestao_label: x.legacy_sugestao_label,
    }));
}

function decorateLineForRender(row, baseUrl, programId, planByCode) {
    const code = normalizeCode(row.erp_code);
    const pr = planByCode && planByCode.get(code);
    const merged = pr ? { ...row, ...pickPlanMetaFromPlanRow(pr) } : row;
    const sku = merged.sku_id != null ? String(merged.sku_id) : "";
    const impact = (Number(merged.unit_contrib) || 0) * Math.max(0, Math.round(Number(merged.qty_produce) || 0));
    return {
        ...merged,
        _programId: programId,
        _detailHref: sku ? `${baseUrl}/ceo_product_detail_layout.html?sku=${encodeURIComponent(sku)}&hub=1` : "#",
        _impact_display: impact,
        _margin_display: merged.margin_pct_ref,
        _lucro_display: merged.lucro_bruto_ref,
    };
}

export async function mount(mainEl) {
    const base = stockspinDataBase();
    const tenantId = getActiveTenantIdForModules();
    mainEl.classList.add("stockspin-in-app");
    mainEl.innerHTML = `
<div class="stockspin-panel" style="padding:8px 10px 10px;gap:6px;display:flex;flex-direction:column;flex:1;min-height:0;">
  <div id="pp-list-screen" style="display:flex;flex-direction:column;flex:1;min-height:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px 0;">
      <div></div>
      <button type="button" id="pp-new" style="min-width:200px;font-weight:700;background:var(--color-accent);color:#0b1220;border:1px solid rgba(0,0,0,.15);border-radius:8px;padding:9px 14px;cursor:pointer;">
        + Nova programação
      </button>
    </div>
    <div id="pp-main-grid" class="stockspin-table-root" style="min-height:0;flex:1;"></div>
  </div>

  <div id="pp-detail-screen" style="display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden;gap:8px;">
    <div class="stockspin-controls stockspin-controls--wide" style="grid-template-columns:1fr 1fr 1fr 1fr auto auto;align-items:end;">
      <div><label>Código OP</label><input id="pp-code" readonly /></div>
      <div><label>Data</label><input id="pp-date" type="date" /></div>
      <div><label>Status</label><select id="pp-status">
        <option value="PLANEJADA">PLANEJADA</option>
        <option value="EM_PRODUCAO">EM_PRODUCAO</option>
        <option value="ENCERRADA">ENCERRADA</option>
      </select></div>
      <div><label>Destino (reabastecimento)</label><input id="pp-dest" value="Fábrica" readonly /></div>
      <div style="align-self:end;"><button type="button" id="pp-back">Voltar</button></div>
      <div style="align-self:end;"><button type="button" id="pp-rebuild" style="font-weight:600;">Recarregar sugestão</button></div>
    </div>
    <p class="stockspin-meta" id="pp-note" style="margin:0;">
      Sugestão: linhas do Plano CD com demanda &gt; 0 e rota de fabrico (PRODUZIR/MISTO), ou legado «em produção», ou urgência
      <strong>RUPTURA</strong>/<strong>CRÍTICO</strong> (para rever OP mesmo sem composição no mapa). Ordenação: maior demanda CD.
      Colunas «Status cadastro» (mix / origem categoria) e «Status na Fábrica / CD» (pill CEO/CD ou estimativa matriz);
      «Sugestão legado» = unidades em produção / compra sugeridas no ERP legado (mesma base do Plano CD).
      Lucro/margem vêm da janela do plano; «Lucro bruto × qtd» = contribuição unitária média × qtd a produzir.
    </p>
    <p class="stockspin-meta" id="pp-alert" style="margin:4px 0 0;display:none;color:#fbbf24;" role="status"></p>
    <div id="pp-lines-grid" class="stockspin-table-root" style="flex:1;min-height:0;"></div>
    <h3 style="margin:4px 0 0;font-size:0.85rem;color:rgba(226,232,240,.85);">Histórico</h3>
    <div id="pp-history" class="stockspin-meta" style="max-height:120px;overflow:auto;"></div>
  </div>
</div>`;

    const listScreen = mainEl.querySelector("#pp-list-screen");
    const detailScreen = mainEl.querySelector("#pp-detail-screen");
    const showList = () => {
        listScreen.style.display = "flex";
        detailScreen.style.display = "none";
    };
    const showDetail = () => {
        listScreen.style.display = "none";
        detailScreen.style.display = "flex";
    };

    await loadClientScript(`${base}/data/client/cd_purchase_plan.js`);
    const planRows =
        window.CD_PURCHASE_PLAN_DATA && Array.isArray(window.CD_PURCHASE_PLAN_DATA.rows)
            ? window.CD_PURCHASE_PLAN_DATA.rows
            : [];
    const planByCode = new Map();
    for (const r of planRows) {
        const c = normalizeCode(r.erp_code);
        if (c) planByCode.set(c, r);
    }
    const makeBuyMap = await loadMakeBuyMap(base);

    let workflow = loadProductionPrograms(tenantId, "stockspin");
    let selected = null;
    let listExcel = null;
    let linesExcel = null;
    let saveDebounce = null;

    if (!productionTableThemeInstalled) {
        const style = document.createElement("style");
        style.textContent = TABLE_SCOPES.map(
            (scope) => `
      ${scope} .table-wrapper table { width: max-content !important; table-layout: fixed !important; }
      ${scope} .table-wrapper table thead tr th {
        background-color: var(--color-primary) !important; color: #ffffff !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row td {
        background-color: var(--row-bg) !important; color: ${COL} !important; font-size: 12px !important;
        border-bottom: 1px solid rgba(0,0,0,0.08) !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row:hover td {
        background-color: var(--row-hover-bg, #edd8bb) !important;
      }
      ${scope} .table-wrapper table tbody tr.hoverable-row td a { color: ${COL} !important; }
    `
        ).join("\n");
        mainEl.appendChild(style);
        productionTableThemeInstalled = true;
    }

    function scheduleSave() {
        if (saveDebounce) clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => {
            saveProductionPrograms(tenantId, workflow, "stockspin");
            saveDebounce = null;
        }, 220);
    }

    function refreshHistory() {
        const el = mainEl.querySelector("#pp-history");
        if (!el || !selected) {
            if (el) el.textContent = "";
            return;
        }
        const h = selected.history || [];
        if (!h.length) {
            el.textContent = "Sem eventos.";
            return;
        }
        el.innerHTML = h
            .slice(-40)
            .reverse()
            .map((e) => `<div>${String(e.at || "").slice(0, 19)} — <strong>${escapeHtml(e.type)}</strong>: ${escapeHtml(e.message)}</div>`)
            .join("");
    }

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    const listCols = [
        {
            key: "code",
            label: "Código OP",
            type: "text",
            width: "130px",
            align: "center",
            render: (item) => {
                const a = document.createElement("a");
                a.href = "#";
                a.textContent = String(item.code || "—");
                a.style.color = COL;
                a.style.fontWeight = "700";
                a.style.textDecoration = "none";
                a.onclick = (e) => {
                    e.preventDefault();
                    openProgram(item);
                };
                return a;
            },
        },
        { key: "date", label: "Data", type: "text", width: "120px", align: "center" },
        { key: "destination", label: "Destino", type: "text", width: "120px", align: "center" },
        { key: "itemsCount", label: "Itens", type: "number", width: "72px", align: "right" },
        { key: "status", label: "Status", type: "text", width: "140px", align: "center" },
    ];

    listExcel = new ExcelTable({
        container: mainEl.querySelector("#pp-main-grid"),
        columns: listCols,
        gridId: "production-program-list-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        tableTheme: MIX_TABLE_THEME,
        summaryLabels: { total: "Programações:", selected: "" },
    });

    function buildListRows() {
        return (workflow.programs || []).map((p) => ({
            ...p,
            itemsCount: Array.isArray(p.items) ? p.items.length : 0,
        }));
    }

    function refreshList() {
        listExcel.render(buildListRows());
    }

    function updatePlanHint(itemCount) {
        const alertEl = mainEl.querySelector("#pp-alert");
        if (!alertEl) return;
        if (itemCount > 0) {
            alertEl.style.display = "none";
            alertEl.textContent = "";
            return;
        }
        if (planRows.length === 0) {
            alertEl.style.display = "block";
            alertEl.textContent =
                "Plano CD não carregou ou não há linhas (cd_purchase_plan.js). Verifique a base e o tenant.";
            return;
        }
        alertEl.style.display = "block";
        alertEl.textContent = `O plano tem ${planRows.length} SKU(s), mas nenhuma linha entrou na sugestão (demanda CD zero em todos, ou rota só «compra» sem legado em produção nem urgência RUPTURA/CRÍTICO). Confira Compra x Produção e o mapa de composição.`;
    }

    function openProgram(prog) {
        selected = prog;
        mainEl.querySelector("#pp-code").value = selected.code || "";
        mainEl.querySelector("#pp-date").value = String(selected.date || isoDate(new Date()));
        mainEl.querySelector("#pp-status").value = selected.status || "PLANEJADA";
        mainEl.querySelector("#pp-dest").value = selected.destination || "Fábrica";
        if (!selected.items || selected.items.length === 0) {
            rebuildItemsFromPlan(true);
        } else {
            updatePlanHint(selected.items.length);
            renderLines();
        }
        refreshHistory();
        showDetail();
    }

    function rebuildItemsFromPlan(silent) {
        if (!selected) return;
        const existing = new Map();
        (selected.items || []).forEach((it) => {
            const c = normalizeCode(it.erp_code);
            if (c) existing.set(c, it);
        });
        const built = buildSuggestionItems(planRows, makeBuyMap, existing);
        const persisted = persistItemsForProgram(built);
        workflow = replaceProgramItems(workflow, selected.id, persisted);
        selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
        scheduleSave();
        if (!silent) {
            workflow = appendProgramEvent(workflow, selected.id, {
                type: "REBUILD",
                message: `Sugestão recalculada: ${persisted.length} SKU(s) com produção.`,
            });
            selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
            scheduleSave();
        }
        updatePlanHint(persisted.length);
        renderLines();
        refreshHistory();
    }

    function renderLines() {
        if (!selected || !linesExcel) return;
        const rows = (selected.items || []).map((r) => decorateLineForRender(r, base, selected.id, planByCode));
        linesExcel.render(rows);
        refreshHistory();
    }

    function applyQtyChange(erpCode, nextQty) {
        if (!selected) return;
        const code = normalizeCode(erpCode);
        const it = (selected.items || []).find((x) => normalizeCode(x.erp_code) === code);
        if (!it) return;
        const merged = { ...it, qty_produce: nextQty };
        workflow = upsertProgramItem(workflow, selected.id, merged);
        selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
        workflow = appendProgramEvent(workflow, selected.id, {
            type: "QTY",
            message: `SKU ${code}: qtd produção ${nextQty}.`,
        });
        selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
        scheduleSave();
        renderLines();
    }

    const lineCols = [
        {
            key: "erp_code",
            label: "Código",
            type: "text",
            width: "100px",
            align: "center",
            render: (item) => {
                const a = document.createElement("a");
                a.href = item._detailHref || "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = String(item.erp_code || "—");
                a.style.color = COL;
                a.style.fontWeight = "600";
                a.onclick = (e) => e.stopPropagation();
                return a;
            },
        },
        {
            key: "product_name",
            label: "Produto",
            type: "text",
            width: "260px",
            sticky: true,
            wrap: true,
            render: (item) => {
                const a = document.createElement("a");
                a.href = item._detailHref || "#";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = String(item.product_name || "—");
                a.style.color = COL;
                a.style.fontWeight = "600";
                a.style.display = "block";
                a.style.whiteSpace = "normal";
                a.style.lineHeight = "1.2";
                a.onclick = (e) => e.stopPropagation();
                return a;
            },
        },
        {
            key: "status_cadastro_label",
            label: "Status<br>cadastro",
            type: "text",
            width: "130px",
            align: "center",
            wrap: true,
            noFilter: true,
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = String(item.status_cadastro_label || "—");
                s.style.fontSize = "11px";
                s.style.lineHeight = "1.25";
                s.style.display = "block";
                s.style.whiteSpace = "normal";
                return s;
            },
        },
        {
            key: "status_urgencia",
            label: "Status na<br>Fábrica / CD",
            type: "text",
            width: "132px",
            align: "center",
            noFilter: true,
            render: (item) => statusFabricaBadgeEl(item),
        },
        {
            key: "legacy_sugestao_label",
            label: "Sugestão<br>legado (ERP)",
            type: "text",
            width: "168px",
            align: "center",
            wrap: true,
            noFilter: true,
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = String(item.legacy_sugestao_label || "—");
                s.style.fontSize = "11px";
                s.style.lineHeight = "1.25";
                s.style.display = "block";
                s.style.whiteSpace = "normal";
                return s;
            },
        },
        { key: "demand_cd", label: "Demanda CD", type: "number", width: "100px", align: "right", noFilter: true },
        {
            key: "_lucro_display",
            label: "Lucro bruto<br>(ref. plano)",
            type: "text",
            width: "128px",
            align: "right",
            noFilter: true,
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtBRL(item.lucro_bruto_ref);
                s.style.fontWeight = "600";
                return s;
            },
        },
        {
            key: "_margin_display",
            label: "Margem %<br>contrib.",
            type: "text",
            width: "100px",
            align: "right",
            noFilter: true,
            render: (item) => {
                const s = document.createElement("span");
                s.textContent = fmtPct(item.margin_pct_ref);
                s.style.fontWeight = "600";
                return s;
            },
        },
        {
            key: "qty_produce",
            label: "Qtd a<br>produzir",
            type: "number",
            width: "110px",
            align: "right",
            noFilter: true,
            render: (item) => {
                const input = document.createElement("input");
                input.type = "number";
                input.min = "0";
                input.step = "1";
                input.value = String(Math.max(0, Math.round(Number(item.qty_produce || 0))));
                input.style.width = "88px";
                input.style.textAlign = "right";
                input.style.padding = "4px 6px";
                input.style.borderRadius = "6px";
                input.style.border = "1px solid rgba(148,163,184,.55)";
                input.onclick = (e) => e.stopPropagation();
                input.onchange = () => {
                    const n = Math.max(0, Math.round(Number(input.value) || 0));
                    applyQtyChange(item.erp_code, n);
                };
                return input;
            },
        },
        {
            key: "_impact_display",
            label: "Lucro bruto<br>× qtd (impacto)",
            type: "text",
            width: "140px",
            align: "right",
            noFilter: true,
            render: (item) => {
                const s = document.createElement("span");
                const impact = (Number(item.unit_contrib) || 0) * Math.max(0, Math.round(Number(item.qty_produce) || 0));
                s.textContent = fmtBRL(impact);
                s.style.fontWeight = "700";
                s.style.color = "#065f46";
                return s;
            },
        },
    ];

    linesExcel = new ExcelTable({
        container: mainEl.querySelector("#pp-lines-grid"),
        columns: lineCols,
        gridId: "production-program-lines-v1",
        projectId: 0,
        endpointPrefix: null,
        enableSelection: false,
        tableTheme: MIX_TABLE_THEME,
        summaryLabels: { total: "Linhas OP:", selected: "" },
    });

    mainEl.querySelector("#pp-new").addEventListener("click", () => {
        const id = `pp-${Date.now()}`;
        const code = `PP-${String(Date.now()).slice(-6)}`;
        const prog = {
            id,
            code,
            date: isoDate(new Date()),
            status: "PLANEJADA",
            destination: "Fábrica",
            items: [],
            history: [{ type: "CREATE", message: "Programação criada.", at: new Date().toISOString() }],
        };
        workflow = upsertProgram(workflow, prog);
        saveProductionPrograms(tenantId, workflow, "stockspin");
        selected = workflow.programs.find((p) => String(p.id) === id);
        refreshList();
        openProgram(selected);
    });

    mainEl.querySelector("#pp-back").addEventListener("click", () => {
        selected = null;
        showList();
    });

    mainEl.querySelector("#pp-rebuild").addEventListener("click", () => {
        rebuildItemsFromPlan(false);
    });

    mainEl.querySelector("#pp-date").addEventListener("change", () => {
        if (!selected) return;
        const v = mainEl.querySelector("#pp-date").value;
        workflow = upsertProgram(workflow, { ...selected, date: v });
        selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
        scheduleSave();
        refreshList();
    });

    mainEl.querySelector("#pp-status").addEventListener("change", () => {
        if (!selected) return;
        const v = mainEl.querySelector("#pp-status").value;
        workflow = upsertProgram(workflow, { ...selected, status: v });
        selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
        workflow = appendProgramEvent(workflow, selected.id, { type: "STATUS", message: `Status: ${v}.` });
        selected = workflow.programs.find((p) => String(p.id) === String(selected.id)) || selected;
        scheduleSave();
        refreshList();
    });

    refreshList();
}

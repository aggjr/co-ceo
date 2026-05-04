import {
    isTransferReservingStock,
    normalizeTransferItemDecision,
    normalizeTransferStatus,
} from "../components/TransferStatus.js";

function keyForTenant(tenantId, scope = "global") {
    const sc = String(scope || "global").trim().toLowerCase();
    const tn = tenantId == null ? "global" : String(tenantId);
    return `coceo.transfer.workflow.${sc}.${tn}`;
}

function nowIso() {
    return new Date().toISOString();
}

export function loadTransferWorkflow(tenantId, scope = "global") {
    const key = keyForTenant(tenantId, scope);
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { transfers: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.transfers)) return { transfers: [] };
        return { transfers: parsed.transfers.map(sanitizeTransfer).filter(Boolean) };
    } catch (_) {
        return { transfers: [] };
    }
}

export function saveTransferWorkflow(tenantId, state, scope = "global") {
    const key = keyForTenant(tenantId, scope);
    const transfers = Array.isArray(state?.transfers) ? state.transfers.map(sanitizeTransfer).filter(Boolean) : [];
    localStorage.setItem(key, JSON.stringify({ transfers }));
}

export function computeReservedBySku(transfers, erpCode, excludeTransferId = null) {
    const code = String(erpCode || "").trim();
    if (!code) return 0;
    let sum = 0;
    (transfers || []).forEach((t) => {
        if (!t || !isTransferReservingStock(t.status)) return;
        if (excludeTransferId != null && String(t.id) === String(excludeTransferId)) return;
        (t.items || []).forEach((it) => {
            if (String(it.erp_code || "").trim() !== code) return;
            sum += Math.max(0, Number(it.allocatedQty || 0));
        });
    });
    return Math.max(0, Math.round(sum));
}

export function upsertTransfer(state, transfer) {
    const transfers = Array.isArray(state?.transfers) ? [...state.transfers] : [];
    const next = sanitizeTransfer(transfer);
    if (!next) return { transfers };
    const idx = transfers.findIndex((t) => String(t.id) === String(next.id));
    if (idx >= 0) transfers[idx] = { ...transfers[idx], ...next, updatedAt: nowIso() };
    else transfers.push({ ...next, createdAt: next.createdAt || nowIso(), updatedAt: nowIso() });
    return { transfers };
}

export function appendTransferEvent(state, transferId, event) {
    const transfers = Array.isArray(state?.transfers) ? [...state.transfers] : [];
    const idx = transfers.findIndex((t) => String(t.id) === String(transferId));
    if (idx < 0) return { transfers };
    const t = { ...transfers[idx] };
    const history = Array.isArray(t.history) ? [...t.history] : [];
    history.push({
        type: String(event?.type || "UPDATE"),
        message: String(event?.message || ""),
        at: nowIso(),
    });
    t.history = history.slice(-100);
    t.updatedAt = nowIso();
    transfers[idx] = t;
    return { transfers };
}

export function upsertTransferItem(state, transferId, item) {
    const transfers = Array.isArray(state?.transfers) ? [...state.transfers] : [];
    const idx = transfers.findIndex((t) => String(t.id) === String(transferId));
    if (idx < 0) return { transfers };
    const t = { ...transfers[idx] };
    const items = Array.isArray(t.items) ? [...t.items] : [];
    const code = String(item?.erp_code || "").trim();
    if (!code) return { transfers };
    const at = items.findIndex((x) => String(x.erp_code || "").trim() === code);
    const normalizedItem = {
        sku_id: item.sku_id != null ? Number(item.sku_id) : null,
        erp_code: code,
        product_name: String(item.product_name || ""),
        availableCdQty: Math.max(0, Math.round(Number(item.availableCdQty || 0))),
        approvedQty: Math.max(0, Math.round(Number(item.approvedQty || 0))),
        allocatedQty: Math.max(0, Math.round(Number(item.allocatedQty || 0))),
        totalDemand: Math.max(0, Math.round(Number(item.totalDemand || 0))),
        shortage: Math.max(0, Math.round(Number(item.shortage || 0))),
        receivedQty: Math.max(0, Math.round(Number(item.receivedQty || 0))),
        receiveDecision: normalizeTransferItemDecision(item.receiveDecision),
        receiveNote: String(item.receiveNote || ""),
        updatedAt: nowIso(),
    };
    if (at >= 0) items[at] = { ...items[at], ...normalizedItem };
    else items.push(normalizedItem);
    t.items = items;
    t.updatedAt = nowIso();
    transfers[idx] = t;
    return { transfers };
}

function sanitizeTransfer(input) {
    if (!input || input.id == null) return null;
    return {
        id: String(input.id),
        code: input.code != null ? String(input.code) : String(input.id),
        origin: String(input.origin || "Fábrica"),
        dest: String(input.dest || ""),
        date: String(input.date || ""),
        status: normalizeTransferStatus(input.status),
        items: Array.isArray(input.items)
            ? input.items
                  .map((it) => ({
                      sku_id: it.sku_id != null ? Number(it.sku_id) : null,
                      erp_code: String(it.erp_code || "").trim(),
                      product_name: String(it.product_name || ""),
                      availableCdQty: Math.max(0, Math.round(Number(it.availableCdQty || 0))),
                      approvedQty: Math.max(0, Math.round(Number(it.approvedQty || 0))),
                      allocatedQty: Math.max(0, Math.round(Number(it.allocatedQty || 0))),
                      totalDemand: Math.max(0, Math.round(Number(it.totalDemand || 0))),
                      shortage: Math.max(0, Math.round(Number(it.shortage || 0))),
                      receivedQty: Math.max(0, Math.round(Number(it.receivedQty || 0))),
                      receiveDecision: normalizeTransferItemDecision(it.receiveDecision),
                      receiveNote: String(it.receiveNote || ""),
                      updatedAt: String(it.updatedAt || nowIso()),
                  }))
                  .filter((it) => it.erp_code)
            : [],
        createdAt: String(input.createdAt || nowIso()),
        updatedAt: String(input.updatedAt || nowIso()),
        history: Array.isArray(input.history)
            ? input.history.map((h) => ({
                type: String(h?.type || "UPDATE"),
                message: String(h?.message || ""),
                at: String(h?.at || nowIso()),
            }))
            : [],
    };
}


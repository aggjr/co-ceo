export const TRANSFER_STATUSES = [
    "PLANEJADA",
    "EM ANDAMENTO",
    "APROVADA TOTALMENTE",
    "APROVADA COM RESSALVAS",
    "REPROVADA TOTALMENTE",
];
export const TRANSFER_ITEM_DECISIONS = [
    "PENDENTE",
    "APROVADA TOTALMENTE",
    "APROVADA COM RESSALVAS",
    "REPROVADA TOTALMENTE",
];

const RESERVING_SET = new Set([
    "PLANEJADA",
    "EM ANDAMENTO",
    "APROVADA TOTALMENTE",
    "APROVADA COM RESSALVAS",
]);

export function normalizeTransferStatus(status) {
    const s = String(status || "").trim().toUpperCase();
    return TRANSFER_STATUSES.includes(s) ? s : "PLANEJADA";
}

export function normalizeTransferItemDecision(decision) {
    const d = String(decision || "").trim().toUpperCase();
    return TRANSFER_ITEM_DECISIONS.includes(d) ? d : "PENDENTE";
}

const TRANSITION_MAP = {
    "PLANEJADA": new Set(["EM ANDAMENTO", "REPROVADA TOTALMENTE"]),
    "EM ANDAMENTO": new Set(["APROVADA TOTALMENTE", "APROVADA COM RESSALVAS", "REPROVADA TOTALMENTE"]),
    "APROVADA TOTALMENTE": new Set(),
    "APROVADA COM RESSALVAS": new Set(),
    "REPROVADA TOTALMENTE": new Set(),
};

export function canTransitionTransferStatus(fromStatus, toStatus) {
    const from = normalizeTransferStatus(fromStatus);
    const to = normalizeTransferStatus(toStatus);
    if (from === to) return true;
    const allowed = TRANSITION_MAP[from];
    return !!allowed && allowed.has(to);
}

export function deriveTransferStatusFromItems(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return "PLANEJADA";
    const decisions = list.map((it) => normalizeTransferItemDecision(it?.receiveDecision));
    const valid = decisions.filter((d) => d !== "PENDENTE");
    if (!valid.length) return "EM ANDAMENTO";
    if (valid.length === list.length && valid.every((d) => d === "APROVADA TOTALMENTE")) return "APROVADA TOTALMENTE";
    if (valid.length === list.length && valid.every((d) => d === "REPROVADA TOTALMENTE")) return "REPROVADA TOTALMENTE";
    return "APROVADA COM RESSALVAS";
}

export function isTransferReservingStock(status) {
    return RESERVING_SET.has(normalizeTransferStatus(status));
}

export function createTransferStatusBadge(status) {
    const s = normalizeTransferStatus(status);
    return createWorkflowBadge(s);
}

export function createTransferDecisionBadge(decision) {
    const d = normalizeTransferItemDecision(decision);
    if (d === "PENDENTE") return createWorkflowBadge("PENDENTE");
    return createWorkflowBadge(d);
}

function createWorkflowBadge(text) {
    const span = document.createElement("span");
    span.textContent = text;
    span.style.display = "inline-block";
    span.style.padding = "2px 8px";
    span.style.borderRadius = "999px";
    span.style.fontSize = "11px";
    span.style.fontWeight = "700";
    span.style.whiteSpace = "nowrap";

    if (text === "PLANEJADA") {
        span.style.background = "rgba(191,219,254,.7)";
        span.style.color = "#1e3a8a";
        span.style.border = "1px solid rgba(59,130,246,.55)";
    } else if (text === "EM ANDAMENTO") {
        span.style.background = "rgba(254,215,170,.7)";
        span.style.color = "#7c2d12";
        span.style.border = "1px solid rgba(245,158,11,.55)";
    } else if (text === "APROVADA TOTALMENTE") {
        span.style.background = "rgba(187,247,208,.8)";
        span.style.color = "#14532d";
        span.style.border = "1px solid rgba(34,197,94,.55)";
    } else if (text === "APROVADA COM RESSALVAS") {
        span.style.background = "rgba(253,230,138,.8)";
        span.style.color = "#78350f";
        span.style.border = "1px solid rgba(217,119,6,.55)";
    } else if (text === "PENDENTE") {
        span.style.background = "rgba(226,232,240,.8)";
        span.style.color = "#334155";
        span.style.border = "1px solid rgba(148,163,184,.55)";
    } else {
        span.style.background = "rgba(254,202,202,.8)";
        span.style.color = "#7f1d1d";
        span.style.border = "1px solid rgba(239,68,68,.55)";
    }
    return span;
}


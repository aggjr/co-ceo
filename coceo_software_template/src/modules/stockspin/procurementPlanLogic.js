/** Lógica espelhada de decision_procurement_production.html */

export function normalizeCode(v) {
    return String(v || "").trim();
}

export async function loadMakeBuyMap(base) {
    const map = new Map();
    try {
        const r = await fetch(`${base}/data/client/sku_make_buy_map.json`, { cache: "no-store" });
        if (!r.ok) throw new Error("sem mapa");
        const j = await r.json();
        const rows = Array.isArray(j.rows) ? j.rows : [];
        for (const x of rows) {
            const code = normalizeCode(x.erp_code);
            if (!code) continue;
            map.set(code, {
                hasComposition: Boolean(x.has_composition),
                source: x.source || "map"
            });
        }
    } catch (_) {
        /* mapa opcional */
    }
    return map;
}

export function decideAction(r, makeBuyMap) {
    const code = normalizeCode(r.erp_code);
    const inMap = makeBuyMap.get(code);
    if (inMap) {
        return inMap.hasComposition
            ? { action: "PRODUZIR", makeQty: Number(r.demanda_total_cd || 0), buyQty: 0, rule: "Mapa composição" }
            : { action: "COMPRAR", makeQty: 0, buyQty: Number(r.demanda_total_cd || 0), rule: "Mapa composição" };
    }
    const legProd = Number(r.total_em_producao_legacy || 0);
    const legBuy = Number(r.sugestao_compra_legacy || 0);
    const dem = Number(r.demanda_total_cd || 0);
    if (legProd > 0 && legBuy > 0) {
        return {
            action: "MISTO",
            makeQty: Math.round(dem * 0.6),
            buyQty: Math.max(0, dem - Math.round(dem * 0.6)),
            rule: "Fallback legado (prod+compra)"
        };
    }
    if (legProd > 0) return { action: "PRODUZIR", makeQty: dem, buyQty: 0, rule: "Fallback legado (produção)" };
    return { action: "COMPRAR", makeQty: 0, buyQty: dem, rule: "Fallback legado (compra)" };
}

export function statusCls(s) {
    if (s === "RUPTURA") return "s-rup";
    if (s === "CRÍTICO") return "s-cri";
    if (s === "ABAIXO") return "s-aba";
    return "s-aci";
}

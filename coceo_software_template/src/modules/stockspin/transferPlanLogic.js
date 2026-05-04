/** Espelho de transfer_cd_equalizer.html */

export function toStoresArray(lojas) {
    if (!lojas) return [];
    if (Array.isArray(lojas)) return lojas;
    return Object.keys(lojas)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => lojas[k])
        .filter(Boolean);
}

export function prioWeight(p) {
    const s = String(p || "").toUpperCase();
    if (s === "RUPTURA") return 1.5;
    if (s === "CRÍTICO") return 1.3;
    if (s === "ABAIXO") return 1.15;
    if (s === "ACIMA") return 1.0;
    if (s === "MUITO ACIMA") return 0.9;
    return 0.8;
}

export function severityScore(st) {
    const rup = Math.max(0, Number(st.ruptura_pct) || 0);
    const sales = Math.max(0, Number(st.quantidade_vendida) || 0);
    return prioWeight(st.prioridade) * (1 + rup * 0.7) * (1 + Math.log10(1 + sales));
}

export function allocateEqualized(stores, available) {
    const out = stores.map((s) => ({
        ...s,
        demanda: Math.max(0, Math.round(Number(s.demanda) || 0)),
        alloc: 0
    }));
    const totalDem = out.reduce((a, s) => a + s.demanda, 0);
    if (totalDem <= 0 || available <= 0) return { rows: out, totalDem, allocated: 0 };
    if (available >= totalDem) {
        out.forEach((s) => {
            s.alloc = s.demanda;
        });
        return { rows: out, totalDem, allocated: totalDem };
    }
    const ratio = available / totalDem;
    let allocated = 0;
    for (const s of out) {
        s.alloc = Math.min(s.demanda, Math.floor(s.demanda * ratio));
        allocated += s.alloc;
    }
    let rem = available - allocated;
    while (rem > 0) {
        let cand = null;
        for (const s of out) {
            const falta = s.demanda - s.alloc;
            if (falta <= 0) continue;
            const score = severityScore(s) * (1 + falta / Math.max(1, s.demanda));
            if (!cand || score > cand.score) cand = { s, score };
        }
        if (!cand) break;
        cand.s.alloc += 1;
        rem -= 1;
    }
    allocated = out.reduce((a, s) => a + s.alloc, 0);
    return { rows: out, totalDem, allocated };
}

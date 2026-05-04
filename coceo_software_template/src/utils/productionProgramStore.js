/**
 * Programações de produção (OP) — persistência local por tenant, espelhando o padrão de transferências.
 */

function keyForTenant(tenantId, scope = "global") {
    const sc = String(scope || "global").trim().toLowerCase();
    const tn = tenantId == null ? "global" : String(tenantId);
    return `coceo.production.program.${sc}.${tn}`;
}

function nowIso() {
    return new Date().toISOString();
}

const ALLOWED_STATUS = new Set(["PLANEJADA", "EM_PRODUCAO", "ENCERRADA"]);

function normalizeProgramStatus(s) {
    const u = String(s || "").trim().toUpperCase().replace(/\s+/g, "_");
    if (ALLOWED_STATUS.has(u)) return u;
    return "PLANEJADA";
}

function sanitizeItem(it) {
    if (!it || !String(it.erp_code || "").trim()) return null;
    return {
        sku_id: it.sku_id != null && Number.isFinite(Number(it.sku_id)) ? Number(it.sku_id) : null,
        erp_code: String(it.erp_code || "").trim(),
        product_name: String(it.product_name || ""),
        demand_cd: Math.max(0, Math.round(Number(it.demand_cd || 0))),
        lucro_bruto_ref: Number(it.lucro_bruto_ref) || 0,
        valor_bruto_ref: Number(it.valor_bruto_ref) || 0,
        qtd_vendida_ref: Number(it.qtd_vendida_ref) || 0,
        margin_pct_ref: it.margin_pct_ref != null && Number.isFinite(Number(it.margin_pct_ref)) ? Number(it.margin_pct_ref) : null,
        unit_contrib: Number(it.unit_contrib) || 0,
        qty_produce: Math.max(0, Math.round(Number(it.qty_produce || 0))),
        updatedAt: String(it.updatedAt || nowIso()),
    };
}

function sanitizeProgram(input) {
    if (!input || input.id == null) return null;
    return {
        id: String(input.id),
        code: input.code != null ? String(input.code) : String(input.id),
        date: String(input.date || ""),
        status: normalizeProgramStatus(input.status),
        destination: String(input.destination || "Fábrica"),
        items: Array.isArray(input.items) ? input.items.map(sanitizeItem).filter(Boolean) : [],
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

export function loadProductionPrograms(tenantId, scope = "global") {
    const key = keyForTenant(tenantId, scope);
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { programs: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.programs)) return { programs: [] };
        return { programs: parsed.programs.map(sanitizeProgram).filter(Boolean) };
    } catch (_) {
        return { programs: [] };
    }
}

export function saveProductionPrograms(tenantId, state, scope = "global") {
    const key = keyForTenant(tenantId, scope);
    const programs = Array.isArray(state?.programs) ? state.programs.map(sanitizeProgram).filter(Boolean) : [];
    localStorage.setItem(key, JSON.stringify({ programs }));
}

export function upsertProgram(state, program) {
    const programs = Array.isArray(state?.programs) ? [...state.programs] : [];
    const next = sanitizeProgram(program);
    if (!next) return { programs };
    const idx = programs.findIndex((p) => String(p.id) === String(next.id));
    if (idx >= 0) programs[idx] = { ...programs[idx], ...next, updatedAt: nowIso() };
    else programs.push({ ...next, createdAt: next.createdAt || nowIso(), updatedAt: nowIso() });
    return { programs };
}

export function appendProgramEvent(state, programId, event) {
    const programs = Array.isArray(state?.programs) ? [...state.programs] : [];
    const idx = programs.findIndex((p) => String(p.id) === String(programId));
    if (idx < 0) return { programs };
    const p = { ...programs[idx] };
    const history = Array.isArray(p.history) ? [...p.history] : [];
    history.push({
        type: String(event?.type || "UPDATE"),
        message: String(event?.message || ""),
        at: nowIso(),
    });
    p.history = history.slice(-100);
    p.updatedAt = nowIso();
    programs[idx] = p;
    return { programs };
}

export function upsertProgramItem(state, programId, item) {
    const programs = Array.isArray(state?.programs) ? [...state.programs] : [];
    const idx = programs.findIndex((p) => String(p.id) === String(programId));
    if (idx < 0) return { programs };
    const p = { ...programs[idx] };
    const items = Array.isArray(p.items) ? [...p.items] : [];
    const code = String(item?.erp_code || "").trim();
    if (!code) return { programs };
    const normalized = sanitizeItem({ ...item, erp_code: code });
    if (!normalized) return { programs };
    const at = items.findIndex((x) => String(x.erp_code || "").trim() === code);
    if (at >= 0) items[at] = { ...items[at], ...normalized };
    else items.push(normalized);
    p.items = items;
    p.updatedAt = nowIso();
    programs[idx] = p;
    return { programs };
}

export function replaceProgramItems(state, programId, items) {
    const programs = Array.isArray(state?.programs) ? [...state.programs] : [];
    const idx = programs.findIndex((p) => String(p.id) === String(programId));
    if (idx < 0) return { programs };
    const p = { ...programs[idx] };
    p.items = Array.isArray(items) ? items.map(sanitizeItem).filter(Boolean) : [];
    p.updatedAt = nowIso();
    programs[idx] = p;
    return { programs };
}

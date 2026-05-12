'use strict';

/** Slug canônico do tenant SARON (STOCKSPIN apenas; INVEST desligado). */
const SARON_SLUG = 'saron-cortinas';

function parseModuleSettingsRaw(raw) {
    if (raw == null || raw === '') return {};
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
        try {
            const o = JSON.parse(raw.toString('utf8'));
            return o && typeof o === 'object' && !Array.isArray(o) ? { ...o } : {};
        } catch {
            return {};
        }
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        return { ...raw };
    }
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t) return {};
        try {
            const o = JSON.parse(t);
            return o && typeof o === 'object' && !Array.isArray(o) ? { ...o } : {};
        } catch {
            return {};
        }
    }
    return {};
}

/**
 * Ajusta module_settings na borda da API (login / lista de clientes) para bases
 * antigas em que SARON ainda tem JSON nulo ou sem INVEST.enabled.
 */
function applyTenantModulePolicy(slug, moduleSettingsRaw) {
    const settings = parseModuleSettingsRaw(moduleSettingsRaw);
    if (!slug || typeof slug !== 'string') return settings;
    if (slug !== SARON_SLUG) return settings;
    const prev = settings.INVEST && typeof settings.INVEST === 'object' ? settings.INVEST : {};
    return {
        ...settings,
        INVEST: { ...prev, enabled: false }
    };
}

module.exports = { applyTenantModulePolicy, parseModuleSettingsRaw, SARON_SLUG };

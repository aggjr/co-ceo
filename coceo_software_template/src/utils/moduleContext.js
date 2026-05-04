/**
 * Contexto de módulos por tenant (STOCKSPIN, futuros CASH, etc.).
 * Superusuário: usa currentTenantId (personificação) + mapa vindo da lista de clientes.
 * Usuário de tenant: usa tenantId do JWT + moduleSettings devolvidos no login.
 */

const LS_MAP = "tenantModuleSettingsMap";

const defaultStockspinBase = () => {
  /** Em dev/preview, servir pela pasta do repo (vite.config → /co-ceo-stockspin-static) para iframes não ficarem em branco sem :8000. */
  if (typeof window !== "undefined") {
    const preview = String(window.location.port || "") === "4173";
    if (import.meta.env.DEV || preview) {
      return `${window.location.origin}/co-ceo-stockspin-static`;
    }
  }
  return String(
    import.meta.env.VITE_STOCKSPIN_STATIC_DEFAULT ||
      import.meta.env.VITE_STOCKSPIN_STATIC_URL ||
      "http://localhost:8000"
  ).replace(/\/$/, "");
};

export function parseModuleSettings(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return { ...raw };
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function getTenantModuleSettingsMap() {
  try {
    return JSON.parse(localStorage.getItem(LS_MAP) || "{}");
  } catch {
    return {};
  }
}

export function setTenantModuleSettingsForId(tenantId, settings) {
  const id = String(tenantId);
  const map = getTenantModuleSettingsMap();
  map[id] = parseModuleSettings(settings);
  localStorage.setItem(LS_MAP, JSON.stringify(map));
}

/** Chamado após GET /api/tenants (Header, lista de clientes). */
export function syncTenantModuleSettingsFromList(tenants) {
  if (!Array.isArray(tenants)) return;
  const map = getTenantModuleSettingsMap();
  for (const t of tenants) {
    map[String(t.id)] = parseModuleSettings(t.module_settings);
  }
  localStorage.setItem(LS_MAP, JSON.stringify(map));
}

/** Tenant efetivo para carregar módulos (iframe / scripts estáticos). */
export function getActiveTenantIdForModules() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  if (user.isSuperUser) {
    const imp = localStorage.getItem("currentTenantId");
    if (imp) return parseInt(imp, 10);
    return null;
  }
  return user.tenantId != null ? parseInt(String(user.tenantId), 10) : null;
}

/**
 * Index HTML da Arquitetura Física (visão espacial STOCKSPIN).
 * Ordem: VITE_* → localStorage override → module_settings do tenant ativo.
 */
export function getPhysicalArchitectureIndexUrl() {
  const env = import.meta.env.VITE_PHYSICAL_ARCHITECTURE_INDEX_URL;
  if (env && String(env).trim()) return String(env).trim();

  const ls = localStorage.getItem("physicalArchitectureIndexUrlOverride");
  if (ls && String(ls).trim()) return String(ls).trim();

  const tid = getActiveTenantIdForModules();
  const map = getTenantModuleSettingsMap();
  const row = tid != null ? map[String(tid)] : null;
  const u = row && row.STOCKSPIN && row.STOCKSPIN.physicalArchitectureIndexUrl;
  if (u && String(u).trim()) return String(u).trim();

  /* Dev e vite preview (porta 4173): mesmo host — middleware em vite.config.js. */
  if (typeof window !== "undefined") {
    const preview = window.location.port === "4173";
    if (import.meta.env.DEV || preview) {
      return `${window.location.origin}/physical-architecture/index.html`;
    }
  }

  return "";
}

/** Base HTTP onde estão data/client/*.js e HTMLs do STOCKSPIN para o tenant ativo. */
export function getStockspinStaticBaseUrl() {
  const tid = getActiveTenantIdForModules();
  const map = getTenantModuleSettingsMap();
  const row = tid != null ? map[String(tid)] : null;
  const url = row && row.STOCKSPIN && row.STOCKSPIN.staticBaseUrl;
  if (url && String(url).trim()) return String(url).trim().replace(/\/$/, "");
  return defaultStockspinBase();
}

/** Resposta do login: { tenant?: { id, moduleSettings } } */
export function applyModuleContextFromLogin(data) {
  if (data && data.tenant && data.tenant.id != null) {
    setTenantModuleSettingsForId(data.tenant.id, data.tenant.moduleSettings);
  }
}

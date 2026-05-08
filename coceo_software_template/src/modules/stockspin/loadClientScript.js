/**
 * Carrega um script clássico (window.*) a partir da base HTTP do STOCKSPIN (ex.: localhost:8000).
 * Evita recarregar a mesma URL na mesma sessão; use force=true para ignorar cache lógico.
 */
import { getStockspinStaticBaseUrl } from "../../utils/moduleContext.js";

const loaded = new Set();

export function invalidateClientScript(url) {
    loaded.delete(url);
}

/** Limpa cache de scripts quando troca o tenant (base URL muda). */
export function invalidateAllClientScripts() {
    loaded.clear();
}

export function loadClientScript(url, { force = false } = {}) {
    if (force) loaded.delete(url);
    if (loaded.has(url)) return Promise.resolve();

    // Quando force=true, anexa cache-buster para furar cache do navegador/CDN
    const finalUrl = force
        ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`
        : url;

    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = finalUrl;
        s.async = true;
        s.onload = () => {
            loaded.add(url);
            resolve();
        };
        s.onerror = () => reject(new Error(`Falha ao carregar script: ${url}`));
        document.head.appendChild(s);
    });
}

export function stockspinDataBase() {
    return getStockspinStaticBaseUrl();
}

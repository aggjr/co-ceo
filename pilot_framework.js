/**
 * Arcabouço teórico mínimo do piloto (um SKU × uma loja × série diária).
 * Puro cálculo — sem I/O. Depois replica-se por produto/loja; CD agrega séries.
 */

/**
 * @typedef {Object} PilotDay
 * @property {string} date YYYY-MM-DD
 * @property {number} qty_physical
 * @property {number} qty_showcase
 * @property {number} qty_available regra MAX(0, físico - vitrine)
 * @property {number} sales unidades vendidas no dia
 */

/**
 * Estoque disponível canônico (TOC / regras do projeto).
 * @param {number} physical
 * @param {number} showcase
 */
function availableStock(physical, showcase) {
    const p = Number(physical) || 0;
    const s = Number(showcase) || 0;
    return Math.max(0, p - s);
}

/**
 * Demanda implícita do dia a partir do balanço material (sem pipeline de entrada):
 * I_{t+1} ≈ I_t - sales_t + entrada_t  →  entrada_t - sales_t = ΔI
 * Se não observamos entradas, "consumo aparente" ≥ sales quando estoque cai mais que vendas.
 * @param {PilotDay} prev
 * @param {PilotDay} curr
 */
function impliedNetFlow(prev, curr) {
    const dPhys = curr.qty_physical - prev.qty_physical;
    const sales = curr.sales;
    return { deltaPhysical: dPhys, sales, impliedReceipts: dPhys + sales };
}

/**
 * Erro de posição vs mira (percentil p100 do próprio dia, se existir no payload bruto).
 * @param {number} available
 * @param {number} p100
 */
function positionVsMira(available, p100) {
    if (p100 == null || Number.isNaN(p100) || p100 === 0) return null;
    return available / p100;
}

/**
 * Agregação "CD" como soma dos estados das lojas no mesmo dia (batimento agregado).
 * @param {Array<{ qty_physical: number, qty_available: number, sales: number }>} storesSameDay
 */
function aggregateCdDay(storesSameDay) {
    let sumPhys = 0;
    let sumAvail = 0;
    let sumSales = 0;
    for (const s of storesSameDay) {
        sumPhys += Number(s.qty_physical) || 0;
        sumAvail += Number(s.qty_available) || 0;
        sumSales += Number(s.sales) || 0;
    }
    return {
        store_count: storesSameDay.length,
        sum_qty_physical_stores: sumPhys,
        sum_qty_available_stores: sumAvail,
        sum_sales_day: sumSales,
    };
}

module.exports = {
    availableStock,
    impliedNetFlow,
    positionVsMira,
    aggregateCdDay,
};

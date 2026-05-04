/**
 * Piloto: carrega TODOS os dias de estoque (Barreiro + SKU ERP 755 / id 621)
 * a partir de data/processed/sku_621.json para o MySQL schema `ceo`.
 *
 * Regras de disponível: qty_available = MAX(0, qty_physical - qty_showcase).
 *
 * Uso: node pilot_seed_barreiro_755.js
 * Pré-requisito: mysql schema ceo + tabelas sql/ceo/001 e 002 (reaplique 001 se já existia sem qty_sales).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { configCeo } = require('./coceo_db_config');
const { filterTimelineChartWindow } = require('./timeline_window');

const PILOT = {
    storeKey: 'Barreiro',
    skuInternalId: 621,
    skuErpCode: '755',
    productName: 'CORTINA LUX UNICA TERGAL PRATA 2.60X1.70',
    processedJson: path.join(__dirname, 'data', 'processed', 'sku_621.json'),
};

function parseSkuJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

function canonicalAvailable(physical, showcase) {
    const p = Number(physical) || 0;
    const s = Number(showcase) || 0;
    return Math.max(0, p - s);
}

async function main() {
    const data = parseSkuJson(PILOT.processedJson);
    const storeBlock = data.results[PILOT.storeKey];
    if (!storeBlock || !Array.isArray(storeBlock.timeline)) {
        console.error('Loja ou timeline ausente:', PILOT.storeKey, Object.keys(data.results || {}));
        process.exit(1);
    }
    const vitrine = Number(storeBlock.metrics?.vitrine) || 0;
    const rawTL = storeBlock.timeline;
    const timeline = filterTimelineChartWindow(rawTL, {
        years: 2,
        excludeSundays: true,
    });
    console.log(`Timeline: ${rawTL.length} dias brutos → ${timeline.length} pontos (2 anos, sem domingos, até último dia útil).`);
    const runId = crypto.randomUUID();

    let conn;
    try {
        conn = await mysql.createConnection(configCeo);
    } catch (e) {
        console.error('Falha ao conectar no MySQL (database `ceo`). Rode os SQL em sql/ceo/.', e.message);
        process.exit(1);
    }

    await conn.query(
        `INSERT INTO engine_run (run_id, run_type, status, row_counts, notes)
     VALUES (?, 'ingest_snapshot', 'running', NULL, ?)`,
        [runId, `pilot Barreiro sku ${PILOT.skuErpCode}`]
    );

    const rows = timeline.map((day) => {
        const phys = Number(day.physicalStock) || 0;
        const sales = Number(day.sales) || 0;
        const avail = canonicalAvailable(phys, vitrine);
        return [
            runId,
            day.date,
            PILOT.storeKey,
            PILOT.skuInternalId,
            PILOT.skuErpCode,
            PILOT.productName,
            phys,
            vitrine,
            avail,
            sales,
        ];
    });

    const sql = `INSERT INTO daily_stock_snapshot
    (run_id, ref_date, store_key, sku_internal_id, sku_erp_code, product_name,
     qty_physical, qty_showcase, qty_available, qty_sales)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      run_id = VALUES(run_id),
      sku_internal_id = VALUES(sku_internal_id),
      product_name = VALUES(product_name),
      qty_physical = VALUES(qty_physical),
      qty_showcase = VALUES(qty_showcase),
      qty_available = VALUES(qty_available),
      qty_sales = VALUES(qty_sales),
      ingested_at = CURRENT_TIMESTAMP(3)`;

    const chunk = 400;
    for (let i = 0; i < rows.length; i += chunk) {
        await conn.query(sql, [rows.slice(i, i + chunk)]);
    }

    // CD agregado: no piloto = mesma série da única loja (extensão natural para N lojas)
    const cdRows = timeline.map((day) => {
        const phys = Number(day.physicalStock) || 0;
        const sales = Number(day.sales) || 0;
        const avail = canonicalAvailable(phys, vitrine);
        return [
            runId,
            day.date,
            PILOT.skuErpCode,
            PILOT.skuInternalId,
            1,
            phys,
            avail,
            sales,
        ];
    });

    const sqlCd = `INSERT INTO cd_daily_aggregate
    (run_id, ref_date, sku_erp_code, sku_internal_id, store_count,
     sum_qty_physical_stores, sum_qty_available_stores, sum_sales_day)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      run_id = VALUES(run_id),
      sku_internal_id = VALUES(sku_internal_id),
      store_count = VALUES(store_count),
      sum_qty_physical_stores = VALUES(sum_qty_physical_stores),
      sum_qty_available_stores = VALUES(sum_qty_available_stores),
      sum_sales_day = VALUES(sum_sales_day),
      computed_at = CURRENT_TIMESTAMP(3)`;

    for (let i = 0; i < cdRows.length; i += chunk) {
        await conn.query(sqlCd, [cdRows.slice(i, i + chunk)]);
    }

    await conn.query(
        `UPDATE engine_run SET status = 'success', finished_at = CURRENT_TIMESTAMP(3),
     row_counts = ? WHERE run_id = ?`,
        [JSON.stringify({ snapshot_rows: rows.length, cd_aggregate_rows: cdRows.length }), runId]
    );

    await conn.end();
    console.log(`OK run_id=${runId} dias=${rows.length} (Barreiro + ${PILOT.skuErpCode}). CD agregado = soma piloto (1 loja).`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

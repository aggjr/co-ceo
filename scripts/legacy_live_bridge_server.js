"use strict";

const http = require("http");
const url = require("url");
const mysql = require("mysql2/promise");
const path = require("path");
const { assertLegacyConfig } = require(path.join(__dirname, "..", "coceo_db_config"));
const { isClosedRetailExcludedFromStockNetwork } = require(path.join(
  __dirname,
  "..",
  "lib",
  "closed_retail_stores"
));

const PORT = Number(process.env.LEGACY_LIVE_PORT || 8787);
const HOST = process.env.LEGACY_LIVE_HOST || "127.0.0.1";

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function yesterdayIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return isoDay(d);
}

/** Alinhado ao ceo_product_detail_layout (findStoreKeyByName / apollo). */
function normalizeStoreName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rawGuid(v) {
  if (v == null || v === "") return null;
  if (Buffer.isBuffer(v)) return v.toString("utf8").trim();
  return String(v).trim();
}

/**
 * Descobre IdUnidadeNegocio do legado a partir do nome da loja no bundle,
 * usando ativos do SKU (mesma base que alimenta snapshots).
 */
function physicalFromAtivoRow(r) {
  const availRaw = Number(r.available_stock);
  const vitRaw = Number(r.vitrine_stock);
  const avail = Number.isFinite(availRaw) ? Math.max(0, availRaw) : 0;
  const vitrine = Number.isFinite(vitRaw) ? Math.max(0, vitRaw) : 0;
  return avail + vitrine;
}

function resolveUnidadeIdFromAtivoRows(rows, storeFilter) {
  const want = normalizeStoreName(storeFilter);
  if (!want) return null;
  const eligible = (rows || []).filter((r) => {
    const name = String(r.store_name || "");
    const phys = physicalFromAtivoRow(r);
    return !isClosedRetailExcludedFromStockNetwork(name, phys);
  });
  for (let i = 0; i < eligible.length; i++) {
    if (normalizeStoreName(eligible[i].store_name) === want) {
      return rawGuid(eligible[i].id_unidade_negocio);
    }
  }
  for (let i = 0; i < eligible.length; i++) {
    const sn = normalizeStoreName(eligible[i].store_name);
    if (sn.includes(want) || want.includes(sn)) {
      return rawGuid(eligible[i].id_unidade_negocio);
    }
  }
  return null;
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function getSkuYesterdaySnapshot(skuId, legacyStoreName) {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    await conn.query("SET NAMES 'utf8mb4'");
    const refDate = yesterdayIso();
    const storeFilter =
      legacyStoreName != null && String(legacyStoreName).trim() ? String(legacyStoreName).trim() : null;
    const [rows] = await conn.query(
      `
      SELECT
        a.Id AS ativo_id,
        a.IdUnidadeNegocio AS id_unidade_negocio,
        p.Id AS sku_id,
        p.ErpCodigo AS erp_code,
        p.Descricao AS product_name,
        u.NomeFantasia AS store_name,
        CAST(COALESCE(t.EstoqueDisponivel, 0) AS DECIMAL(18,4)) AS available_stock,
        CAST(COALESCE(t.EstoqueVitrine, 0) AS DECIMAL(18,4)) AS vitrine_stock
      FROM ativo a
      JOIN produto p ON p.Id = a.IdProduto
      JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
      LEFT JOIN ativototalizador t ON t.IdAtivo = a.Id
      WHERE a.IdProduto = ?
        AND COALESCE(a.IndDeletado, b'0') = b'0'
      `,
      [skuId]
    );

    const snapshots = rows
      .filter((r) => {
        const phys = physicalFromAtivoRow(r);
        return !isClosedRetailExcludedFromStockNetwork(String(r.store_name || ""), phys);
      })
      .map((r) => {
      const availRaw = Number(r.available_stock);
      const vitRaw = Number(r.vitrine_stock);
      const avail = Number.isFinite(availRaw) ? Math.max(0, availRaw) : 0;
      const vitrine = Number.isFinite(vitRaw) ? Math.max(0, vitRaw) : 0;
      return {
        ativo_id: Number(r.ativo_id),
        store_name: String(r.store_name || ""),
        date: refDate,
        availableStock: avail,
        physicalStock: Math.max(0, avail + vitrine),
        sales: 0,
      };
    });

    const legacyProdSqlSelect = `
        SELECT
          l.IdListaProducao AS batch_id,
          COALESCE(l.DataAlteracao, l.DataCriacao) AS batch_date,
          CAST(COALESCE(l.QtdSugerida, 0) AS DECIMAL(18,4)) AS legacy_suggested_qty,
          CAST(COALESCE(l.TotalEmProducao, 0) AS DECIMAL(18,4)) AS legacy_in_production_qty
        FROM listaproducaoitem l
        LEFT JOIN unidadenegocio u ON u.IdUnidadeNegocio = l.IdUnidadeNegocio
        WHERE l.IdProduto = ?
          AND COALESCE(l.IndDeletado, b'0') = b'0'`;

    let legacyProdRows;
    if (storeFilter) {
      const unidadeId = resolveUnidadeIdFromAtivoRows(rows, storeFilter);
      if (unidadeId) {
        ;[legacyProdRows] = await conn.query(
          legacyProdSqlSelect +
            `
          AND l.IdUnidadeNegocio = ?
        ORDER BY COALESCE(l.DataAlteracao, l.DataCriacao) DESC, l.IdListaProducao DESC, l.Id DESC
        LIMIT 1
        `,
          [skuId, unidadeId]
        );
      } else {
        ;[legacyProdRows] = await conn.query(
          legacyProdSqlSelect +
            `
          AND LOWER(TRIM(COALESCE(u.NomeFantasia, ''))) = LOWER(TRIM(?))
        ORDER BY COALESCE(l.DataAlteracao, l.DataCriacao) DESC, l.IdListaProducao DESC, l.Id DESC
        LIMIT 1
        `,
          [skuId, storeFilter]
        );
      }
    } else {
      ;[legacyProdRows] = await conn.query(
        legacyProdSqlSelect +
          `
          AND (u.NomeFantasia IS NULL OR LOWER(u.NomeFantasia) REGEXP 'fábrica|fabrica|\\bcd\\b|matriz')
        ORDER BY COALESCE(l.DataAlteracao, l.DataCriacao) DESC, l.IdListaProducao DESC, l.Id DESC
        LIMIT 1
        `,
        [skuId]
      );
    }
    const legacyProd = legacyProdRows && legacyProdRows[0] ? legacyProdRows[0] : null;

    const [historyRows] = await conn.query(
      `
      SELECT
        u.NomeFantasia AS store_name,
        DATE(ape.DataMovimentacao) AS ref_date,
        CAST(MAX(GREATEST(0, COALESCE(ape.PosicaoEstoque, 0))) AS DECIMAL(18,4)) AS physical_stock
      FROM ativoposicaoestoque ape
      JOIN ativo a ON a.Id = ape.IdAtivo
      JOIN produto p ON p.Id = a.IdProduto
      JOIN unidadenegocio u ON u.IdUnidadeNegocio = a.IdUnidadeNegocio
      WHERE a.IdProduto = ?
        AND COALESCE(a.IndDeletado, b'0') = b'0'
        AND COALESCE(ape.IndDeletado, b'0') = b'0'
        AND ape.DataMovimentacao >= DATE_SUB(CURDATE(), INTERVAL 800 DAY)
      GROUP BY u.NomeFantasia, DATE(ape.DataMovimentacao)
      ORDER BY DATE(ape.DataMovimentacao)
      `,
      [skuId]
    );
    const peakByStore = new Map();
    for (const r of historyRows) {
      const nm = String(r.store_name || "");
      const v = Math.max(0, Number(r.physical_stock) || 0);
      peakByStore.set(nm, Math.max(peakByStore.get(nm) || 0, v));
    }
    const history = historyRows
      .filter((r) => {
        const nm = String(r.store_name || "");
        const peak = peakByStore.get(nm) || 0;
        return !isClosedRetailExcludedFromStockNetwork(nm, peak);
      })
      .map((r) => ({
      store_name: String(r.store_name || ""),
      date: r.ref_date ? isoDay(r.ref_date) : "",
      physicalStock: Math.max(0, Number(r.physical_stock) || 0),
    }));

    return {
      sku_id: Number(skuId),
      ref_date: refDate,
      snapshots,
      history,
      source: "legacy.ativototalizador",
      legacy_production:
        legacyProd
          ? {
              batch_id: Number(legacyProd.batch_id) || null,
              batch_date: legacyProd.batch_date ? new Date(legacyProd.batch_date).toISOString() : null,
              suggested_qty: Number(legacyProd.legacy_suggested_qty) || 0,
              in_production_qty: Number(legacyProd.legacy_in_production_qty) || 0,
            }
          : null,
    };
  } finally {
    await conn.end();
  }
}

function toPtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function deriveWorkflowStatus(plannedQty, confirmedQty, hasReceipt, legacyStatus) {
  const planned = Math.max(0, Number(plannedQty) || 0);
  const confirmed = Math.max(0, Number(confirmedQty) || 0);
  const st = String(legacyStatus || "").toLowerCase();
  if (st.includes("cancel")) return "REPROVADA TOTALMENTE";
  if (planned > 0 && confirmed >= planned) return "APROVADA TOTALMENTE";
  if (confirmed > 0 && confirmed < planned) return "APROVADA COM RESSALVAS";
  if (hasReceipt || confirmed > 0) return "EM ANDAMENTO";
  return "PLANEJADA";
}

async function getLegacyTransfersUntilYesterday(limitParam, offsetParam) {
  const conn = await mysql.createConnection(assertLegacyConfig());
  try {
    await conn.query("SET NAMES 'utf8mb4'");
    const limit = Math.max(1, Math.min(1000, Number(limitParam) || 300));
    const offset = Math.max(0, Number(offsetParam) || 0);
    const until = yesterdayIso();
    const [rows] = await conn.query(
      `
      SELECT
        t.Id AS transfer_id,
        uo.NomeFantasia AS origin_unit,
        ud.NomeFantasia AS dest_unit,
        COUNT(ti.Id) AS item_count,
        CAST(SUM(COALESCE(ti.QtdTransferir, 0)) AS DECIMAL(18,4)) AS planned_qty,
        CAST(SUM(COALESCE(ti.QtdConfirmada, 0)) AS DECIMAL(18,4)) AS confirmed_qty,
        MAX(t.DataTransferencia) AS planning_date,
        MAX(COALESCE(ti.DataRecebimento, ti.DataExpedicao, t.DataTransferencia, ti.DataCriacao, t.DataCriacao)) AS transfer_date,
        MAX(COALESCE(ti.DataRecebimento, NULL)) AS any_receipt_date,
        MAX(COALESCE(ti.Status, '')) AS legacy_status
      FROM transferencia t
      JOIN transferenciaitem ti ON ti.IdTransferencia = t.Id
      JOIN ativo ao ON ao.Id = ti.IdAtivoOrigem
      JOIN ativo ad ON ad.Id = ti.IdAtivoDestino
      JOIN unidadenegocio uo ON uo.IdUnidadeNegocio = ao.IdUnidadeNegocio
      JOIN unidadenegocio ud ON ud.IdUnidadeNegocio = ad.IdUnidadeNegocio
      WHERE COALESCE(t.IndDeletado, b'0') = b'0'
        AND COALESCE(ti.IndDeletado, b'0') = b'0'
        AND DATE(COALESCE(ti.DataRecebimento, ti.DataExpedicao, t.DataTransferencia, ti.DataCriacao, t.DataCriacao)) <= ?
        AND (COALESCE(ti.QtdConfirmada, 0) > 0 OR ti.DataRecebimento IS NOT NULL OR ti.DataExpedicao IS NOT NULL)
      GROUP BY t.Id, uo.NomeFantasia, ud.NomeFantasia
      ORDER BY MAX(COALESCE(ti.DataRecebimento, ti.DataExpedicao, t.DataTransferencia, ti.DataCriacao, t.DataCriacao)) DESC, t.Id DESC
      LIMIT ?, ?
      `,
      [until, offset, limit]
    );

    const transfers = rows.map((r, idx) => {
      const planned = Math.max(0, Number(r.planned_qty) || 0);
      const confirmed = Math.max(0, Number(r.confirmed_qty) || 0);
      const status = deriveWorkflowStatus(planned, confirmed, !!r.any_receipt_date, r.legacy_status);
      return {
        id: `legacy-${String(r.transfer_id)}-${idx}`,
        legacy_transfer_id: Number(r.transfer_id),
        code: `L-${String(r.transfer_id)}`,
        origin: String(r.origin_unit || "Fábrica"),
        dest: String(r.dest_unit || ""),
        planningDate: toPtDate(r.planning_date || r.transfer_date),
        executionDate: toPtDate(r.transfer_date),
        status,
        itemsCount: Math.max(0, Number(r.item_count) || 0),
        plannedQty: planned,
        confirmedQty: confirmed,
        source: "legacy",
      };
    });

    return {
      until,
      offset,
      limit,
      count: transfers.length,
      hasMore: transfers.length === limit,
      transfers,
    };
  } finally {
    await conn.end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "legacy-live-bridge" });
  }
  if (parsed.pathname === "/legacy/transfers") {
    try {
      const payload = await getLegacyTransfersUntilYesterday(
        parsed.query && parsed.query.limit,
        parsed.query && parsed.query.offset
      );
      return sendJson(res, 200, { ok: true, data: payload });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: "legacy_transfer_query_failed",
        message: err && err.message ? String(err.message) : String(err),
      });
    }
  }
  if (parsed.pathname !== "/legacy/sku-live") {
    return sendJson(res, 404, { ok: false, error: "not_found" });
  }
  const sku = Number(parsed.query && parsed.query.sku);
  if (!Number.isFinite(sku) || sku <= 0) {
    return sendJson(res, 400, { ok: false, error: "sku_invalido" });
  }
  const qStore = parsed.query && parsed.query.store;
  const storeParam =
    typeof qStore === "string"
      ? qStore.trim()
      : Array.isArray(qStore) && qStore.length
        ? String(qStore[0]).trim()
        : "";
  try {
    const payload = await getSkuYesterdaySnapshot(sku, storeParam || null);
    return sendJson(res, 200, { ok: true, data: payload });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: "legacy_query_failed",
      message: err && err.message ? String(err.message) : String(err),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Legacy live bridge on http://${HOST}:${PORT}`);
  console.log("Endpoint: /legacy/sku-live?sku=123  (optional &store=NomeFantasia for loja)");
});


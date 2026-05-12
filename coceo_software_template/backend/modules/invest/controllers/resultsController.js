const express = require('express');
const router  = express.Router();
const db      = require('../../../config/database');

// Ordem de colunas do pivot — mantém sequência fixa independente dos dados
const RESULT_TYPE_ORDER = [
  'TRADE', 'DAY_TRADE',
  'CALL_VENDIDA', 'CALL_COMPRADA',
  'PUT_VENDIDA',  'PUT_COMPRADA',
  'DIVIDENDO', 'JCP', 'FII_RENDIMENTO',
];

// GET /api/invest/results/by-ticker?from=2026-01-01&to=2026-12-31&tickers=PETR4,MXRF11
router.get('/by-ticker', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { from, to, tickers: tickersParam } = req.query;
    const tickerList = tickersParam ? tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean) : [];

    const dateFilter    = from ? `AND date >= '${from}'` : '';
    const dateFilterTo  = to   ? `AND date <= '${to}'`   : '';
    const tickerFilter  = tickerList.length > 0
      ? `AND ticker IN (${tickerList.map(() => '?').join(',')})`
      : '';
    const tickerParams  = tickerList.length > 0 ? tickerList : [];

    // União de todas as fontes de resultado
    const sql = `
      SELECT ticker, result_type, SUM(amount) AS total
      FROM (
        /* Trades realizados: cruza buy × sell mais próximo por custo médio ponderado */
        SELECT t.ticker,
               IF(t.date = (
                 SELECT MIN(b.date) FROM invest_transactions b
                 WHERE b.tenant_id = t.tenant_id AND b.ticker = t.ticker AND b.transaction_type = 'buy'
               ), 'DAY_TRADE', 'TRADE') AS result_type,
               (t.price - t.average_price_snapshot) * t.quantity AS amount
        FROM (
          SELECT s.*, p.average_price AS average_price_snapshot
          FROM invest_transactions s
          JOIN invest_positions p ON p.ticker = s.ticker AND p.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.transaction_type = 'sell' AND s.asset_type = 'equity'
          ${dateFilter} ${dateFilterTo} ${tickerFilter}
        ) t

        UNION ALL

        /* Opções — venda de opção = prêmio recebido */
        SELECT
          COALESCE(JSON_UNQUOTE(metadata->>'$.underlying'), ticker) AS ticker,
          CASE
            WHEN JSON_UNQUOTE(metadata->>'$.option_type') = 'call' AND transaction_type = 'sell' THEN 'CALL_VENDIDA'
            WHEN JSON_UNQUOTE(metadata->>'$.option_type') = 'call' AND transaction_type = 'buy'  THEN 'CALL_COMPRADA'
            WHEN JSON_UNQUOTE(metadata->>'$.option_type') = 'put'  AND transaction_type = 'sell' THEN 'PUT_VENDIDA'
            ELSE 'PUT_COMPRADA'
          END AS result_type,
          (quantity * price) * IF(transaction_type = 'sell', 1, -1) AS amount
        FROM invest_transactions
        WHERE tenant_id = ? AND asset_type = 'option'
        ${dateFilter} ${dateFilterTo}
        ${tickerList.length > 0 ? `AND COALESCE(JSON_UNQUOTE(metadata->>'$.underlying'), ticker) IN (${tickerList.map(() => '?').join(',')})` : ''}

        UNION ALL

        /* Dividendos e JCPs */
        SELECT ticker,
          CASE dividend_type
            WHEN 'dividend'   THEN 'DIVIDENDO'
            WHEN 'jcp'        THEN 'JCP'
            WHEN 'fii_income' THEN 'FII_RENDIMENTO'
            ELSE 'DIVIDENDO'
          END AS result_type,
          (value_per_share * quantity_held) - ir_withheld AS amount
        FROM invest_dividends
        WHERE tenant_id = ?
        ${dateFilter.replace(/date/g,'payment_date')} ${dateFilterTo.replace(/date/g,'payment_date')}
        ${tickerFilter}

      ) AS all_results
      GROUP BY ticker, result_type
      ORDER BY ticker, result_type
    `;

    const queryParams = [
      tenantId, ...tickerParams,
      tenantId, ...tickerParams,
      tenantId, ...tickerParams,
    ];

    const [rows] = await db.query(sql, queryParams);

    // Pivot em JS
    const columnSet = new Set(rows.map(r => r.result_type));
    const columns   = RESULT_TYPE_ORDER.filter(c => columnSet.has(c));

    const byTicker = {};
    for (const row of rows) {
      if (!byTicker[row.ticker]) byTicker[row.ticker] = { ticker: row.ticker };
      byTicker[row.ticker][row.result_type] = Number(row.total);
    }

    const tickerRows = Object.values(byTicker).map(r => ({
      ...r,
      TOTAL: columns.reduce((s, c) => s + (r[c] || 0), 0),
    }));
    tickerRows.sort((a, b) => a.ticker.localeCompare(b.ticker));

    const totals = { ticker: 'TOTAL' };
    for (const col of columns)
      totals[col] = tickerRows.reduce((s, r) => s + (r[col] || 0), 0);
    totals.TOTAL = columns.reduce((s, c) => s + (totals[c] || 0), 0);

    res.json({ ok: true, columns, rows: tickerRows, totals });
  } catch (err) { next(err); }
});

module.exports = router;

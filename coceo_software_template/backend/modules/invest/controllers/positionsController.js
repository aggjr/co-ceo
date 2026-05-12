const express = require('express');
const router  = express.Router();
const db      = require('../../../config/database');
const { getQuotes } = require('../services/brapiService');

// GET /api/invest/positions
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser
      ? (req.headers['x-tenant-id'] || req.user.tenantId)
      : req.user.tenantId;

    const [positions] = await db.query(
      `SELECT p.*,
              COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND et.affects_cost = 1 THEN e.amount ELSE 0 END), 0) AS total_expenses
       FROM invest_positions p
       LEFT JOIN invest_expenses e ON e.ticker = p.ticker AND e.tenant_id = p.tenant_id
       LEFT JOIN invest_expense_types et ON et.id = e.expense_type_id
       WHERE p.tenant_id = ?
       GROUP BY p.id
       ORDER BY p.asset_type, p.ticker`,
      [tenantId]
    );

    // Enrich with live prices from brapi (cached)
    if (positions.length > 0) {
      const equityTypes = ['equity','fii','option'];
      const tickers = [...new Set(
        positions
          .filter(p => equityTypes.includes(p.asset_type))
          .map(p => p.ticker)
      )];
      if (tickers.length > 0) {
        const quotes = await getQuotes(tickers).catch(() => ({}));
        positions.forEach(p => {
          const q = quotes[p.ticker];
          if (q) {
            p.current_price  = q.price;
            p.change_pct     = q.changePct;
            p.current_value  = p.quantity * q.price;
            p.pl_value       = p.current_value - Number(p.total_cost) - Number(p.total_expenses);
            p.pl_pct         = p.total_cost > 0
              ? (p.pl_value / (Number(p.total_cost) + Number(p.total_expenses))) * 100
              : 0;
            p.quote_fetched_at = q.fetchedAt;
          }
        });
      }
    }

    res.json({ ok: true, data: positions });
  } catch (err) { next(err); }
});

// POST /api/invest/positions/recalculate — reconstrói cache de posições a partir de transactions
router.post('/recalculate', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser
      ? (req.headers['x-tenant-id'] || req.user.tenantId)
      : req.user.tenantId;
    const ticker = req.query.ticker || null;

    const whereExtra = ticker ? 'AND ticker = ?' : '';
    const params     = ticker ? [tenantId, ticker] : [tenantId];

    // Recalcula usando a lógica de custo médio ponderado
    const [rows] = await db.query(
      `SELECT
         ticker, asset_type,
         SUM(CASE WHEN transaction_type='buy'  THEN quantity ELSE 0 END)
         - SUM(CASE WHEN transaction_type='sell' THEN quantity ELSE 0 END) AS quantity,
         SUM(CASE WHEN transaction_type='buy' THEN quantity * price + fees ELSE 0 END)
         / NULLIF(SUM(CASE WHEN transaction_type='buy' THEN quantity ELSE 0 END),0) AS average_price,
         SUM(CASE WHEN transaction_type='buy' THEN quantity * price + fees ELSE 0 END) AS total_cost,
         MIN(CASE WHEN transaction_type='buy' THEN date END) AS first_buy
       FROM invest_transactions
       WHERE tenant_id = ? ${whereExtra}
       GROUP BY ticker, asset_type
       HAVING quantity > 0`,
      params
    );

    for (const row of rows) {
      await db.query(
        `INSERT INTO invest_positions
           (tenant_id, asset_type, ticker, quantity, average_price, total_cost, first_buy, last_updated_from_tx)
         VALUES (?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE
           quantity=VALUES(quantity), average_price=VALUES(average_price),
           total_cost=VALUES(total_cost), first_buy=VALUES(first_buy),
           last_updated_from_tx=NOW()`,
        [tenantId, row.asset_type, row.ticker, row.quantity, row.average_price, row.total_cost, row.first_buy]
      );
    }

    res.json({ ok: true, recalculated: rows.length });
  } catch (err) { next(err); }
});

module.exports = router;

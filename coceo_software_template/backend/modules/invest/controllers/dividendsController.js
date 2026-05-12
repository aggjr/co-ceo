const express = require('express');
const router  = express.Router();
const db      = require('../../../config/database');

// GET /api/invest/dividends
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { ticker, from, to, type } = req.query;
    const where = ['tenant_id = ?'], params = [tenantId];
    if (ticker) { where.push('ticker = ?'); params.push(ticker); }
    if (from)   { where.push('payment_date >= ?'); params.push(from); }
    if (to)     { where.push('payment_date <= ?'); params.push(to); }
    if (type)   { where.push('dividend_type = ?'); params.push(type); }

    const [rows] = await db.query(
      `SELECT *, (value_per_share * quantity_held) AS total_gross,
              (value_per_share * quantity_held) - ir_withheld AS total_net
       FROM invest_dividends WHERE ${where.join(' AND ')}
       ORDER BY payment_date DESC`,
      params
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/invest/dividends
router.post('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { ticker, dividend_type, ex_date, payment_date, value_per_share, quantity_held, ir_withheld = 0, notes } = req.body;

    const [r] = await db.query(
      `INSERT INTO invest_dividends (tenant_id, ticker, dividend_type, ex_date, payment_date, value_per_share, quantity_held, ir_withheld, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [tenantId, ticker, dividend_type, ex_date || null, payment_date, value_per_share, quantity_held, ir_withheld, notes || null]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) { next(err); }
});

// DELETE /api/invest/dividends/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    await db.query(`DELETE FROM invest_dividends WHERE id=? AND tenant_id=?`, [req.params.id, tenantId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

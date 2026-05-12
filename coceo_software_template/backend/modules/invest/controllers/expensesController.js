const express = require('express');
const router  = express.Router();
const db      = require('../../../config/database');

// GET /api/invest/expenses/types
router.get('/types', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const [rows] = await db.query(
      `SELECT * FROM invest_expense_types WHERE (tenant_id IS NULL OR tenant_id = ?) AND is_active = 1 ORDER BY name`,
      [tenantId]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/invest/expenses
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { ticker, from, to, type_id } = req.query;
    const where = ['e.tenant_id = ?'], params = [tenantId];
    if (ticker)  { where.push('e.ticker = ?'); params.push(ticker); }
    if (from)    { where.push('e.date >= ?');  params.push(from); }
    if (to)      { where.push('e.date <= ?');  params.push(to); }
    if (type_id) { where.push('e.expense_type_id = ?'); params.push(type_id); }

    const [rows] = await db.query(
      `SELECT e.*, et.name AS type_name, et.code AS type_code, et.affects_cost
       FROM invest_expenses e
       JOIN invest_expense_types et ON et.id = e.expense_type_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.date DESC, e.id DESC`,
      params
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/invest/expenses
router.post('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { expense_type_id, transaction_id, date, ticker, amount, description } = req.body;

    const [r] = await db.query(
      `INSERT INTO invest_expenses (tenant_id, expense_type_id, transaction_id, date, ticker, amount, description)
       VALUES (?,?,?,?,?,?,?)`,
      [tenantId, expense_type_id, transaction_id || null, date, ticker || null, amount, description || null]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) { next(err); }
});

// PUT /api/invest/expenses/:id
router.put('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { expense_type_id, transaction_id, date, ticker, amount, description } = req.body;
    await db.query(
      `UPDATE invest_expenses SET expense_type_id=?, transaction_id=?, date=?, ticker=?, amount=?, description=?
       WHERE id=? AND tenant_id=?`,
      [expense_type_id, transaction_id || null, date, ticker || null, amount, description || null, req.params.id, tenantId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/invest/expenses/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    await db.query(`DELETE FROM invest_expenses WHERE id=? AND tenant_id=?`, [req.params.id, tenantId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

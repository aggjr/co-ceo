const express = require('express');
const router  = express.Router();
const db      = require('../../../config/database');

// GET /api/invest/bank/accounts
router.get('/accounts', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const [rows] = await db.query(
      `SELECT * FROM invest_bank_accounts WHERE tenant_id=? ORDER BY bank_name`,
      [tenantId]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/invest/bank/accounts
router.post('/accounts', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { bank_name, agency, account } = req.body;
    const [r] = await db.query(
      `INSERT INTO invest_bank_accounts (tenant_id, bank_name, agency, account) VALUES (?,?,?,?)`,
      [tenantId, bank_name, agency || null, account || null]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) { next(err); }
});

// GET /api/invest/bank/statements?account_id=1&from=...&to=...
router.get('/statements', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { account_id, from, to, status } = req.query;
    const where = ['s.tenant_id = ?'], params = [tenantId];
    if (account_id) { where.push('s.account_id = ?'); params.push(account_id); }
    if (from)       { where.push('s.date >= ?'); params.push(from); }
    if (to)         { where.push('s.date <= ?'); params.push(to); }
    if (status)     { where.push('s.reconcile_status = ?'); params.push(status); }

    const [rows] = await db.query(
      `SELECT s.*, a.bank_name, a.agency, a.account AS account_number
       FROM invest_bank_statements s
       JOIN invest_bank_accounts a ON a.id = s.account_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.date DESC, s.id DESC`,
      params
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/invest/bank/import-csv — importa extrato em formato CSV genérico
// Formato esperado: Data,Descrição,Débito,Crédito,Saldo  (ou Valor com sinal)
router.post('/import-csv', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { account_id, rows: csvRows } = req.body;

    if (!account_id || !Array.isArray(csvRows) || csvRows.length === 0) {
      return res.status(400).json({ ok: false, error: 'account_id e rows são obrigatórios' });
    }

    let inserted = 0;
    for (const row of csvRows) {
      const { date, description, debit = 0, credit = 0, balance } = row;
      if (!date || !description) continue;
      await db.query(
        `INSERT IGNORE INTO invest_bank_statements (tenant_id, account_id, date, description, debit, credit, balance)
         VALUES (?,?,?,?,?,?,?)`,
        [tenantId, account_id, date, description, debit, credit, balance || null]
      );
      inserted++;
    }
    res.json({ ok: true, inserted });
  } catch (err) { next(err); }
});

// POST /api/invest/bank/reconcile — vincula um statement a uma transaction
router.post('/reconcile', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser ? (req.headers['x-tenant-id'] || req.user.tenantId) : req.user.tenantId;
    const { statement_id, transaction_id, status = 'reconciled' } = req.body;

    await db.query(
      `UPDATE invest_bank_statements
       SET transaction_id=?, reconcile_status=?
       WHERE id=? AND tenant_id=?`,
      [transaction_id || null, status, statement_id, tenantId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

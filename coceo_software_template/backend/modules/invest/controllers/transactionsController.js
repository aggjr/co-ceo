const express = require('express');
const router  = express.Router();
const db      = require('../../../config/database');

// GET /api/invest/transactions
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser
      ? (req.headers['x-tenant-id'] || req.user.tenantId)
      : req.user.tenantId;

    const { ticker, from, to, type, limit = 200, offset = 0 } = req.query;
    const where = ['t.tenant_id = ?'];
    const params = [tenantId];

    if (ticker) { where.push('t.ticker = ?'); params.push(ticker); }
    if (from)   { where.push('t.date >= ?'); params.push(from); }
    if (to)     { where.push('t.date <= ?'); params.push(to); }
    if (type)   { where.push('t.transaction_type = ?'); params.push(type); }

    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.query(
      `SELECT t.*,
              COALESCE(SUM(e.amount),0) AS total_expenses,
              (t.quantity * t.price) + COALESCE(SUM(e.amount),0) + t.ir_withheld AS total_real_cost
       FROM invest_transactions t
       LEFT JOIN invest_expenses e ON e.transaction_id = t.id
       WHERE ${where.join(' AND ')}
       GROUP BY t.id
       ORDER BY t.date DESC, t.id DESC
       LIMIT ? OFFSET ?`,
      params
    );

    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/invest/transactions
router.post('/', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser
      ? (req.headers['x-tenant-id'] || req.user.tenantId)
      : req.user.tenantId;

    const { transaction_type, date, ticker, asset_type, quantity, price, fees = 0, ir_withheld = 0, notes, metadata } = req.body;

    if (!transaction_type || !date || !ticker || !quantity || price === undefined) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: transaction_type, date, ticker, quantity, price' });
    }

    const [result] = await db.query(
      `INSERT INTO invest_transactions
         (tenant_id, transaction_type, date, ticker, asset_type, quantity, price, fees, ir_withheld, notes, metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tenantId, transaction_type, date, ticker, asset_type || 'equity',
       quantity, price, fees, ir_withheld, notes || null,
       metadata ? JSON.stringify(metadata) : null]
    );

    // Dispara recálculo da posição do ticker (via call interna)
    await recalculatePosition(tenantId, ticker, asset_type || 'equity');

    res.json({ ok: true, id: result.insertId });
  } catch (err) { next(err); }
});

// PUT /api/invest/transactions/:id
router.put('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser
      ? (req.headers['x-tenant-id'] || req.user.tenantId)
      : req.user.tenantId;

    const { transaction_type, date, ticker, asset_type, quantity, price, fees, ir_withheld, notes, metadata } = req.body;

    const [[existing]] = await db.query(
      `SELECT ticker, asset_type FROM invest_transactions WHERE id = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!existing) return res.status(404).json({ ok: false, error: 'Transação não encontrada' });

    await db.query(
      `UPDATE invest_transactions SET
         transaction_type=?, date=?, ticker=?, asset_type=?,
         quantity=?, price=?, fees=?, ir_withheld=?, notes=?, metadata=?
       WHERE id = ? AND tenant_id = ?`,
      [transaction_type, date, ticker, asset_type,
       quantity, price, fees ?? 0, ir_withheld ?? 0, notes,
       metadata ? JSON.stringify(metadata) : null,
       req.params.id, tenantId]
    );

    await recalculatePosition(tenantId, ticker || existing.ticker, asset_type || existing.asset_type);
    if (existing.ticker !== ticker) {
      await recalculatePosition(tenantId, existing.ticker, existing.asset_type);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/invest/transactions/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.isSuperUser
      ? (req.headers['x-tenant-id'] || req.user.tenantId)
      : req.user.tenantId;

    const [[existing]] = await db.query(
      `SELECT ticker, asset_type FROM invest_transactions WHERE id = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );
    if (!existing) return res.status(404).json({ ok: false, error: 'Transação não encontrada' });

    await db.query(
      `DELETE FROM invest_transactions WHERE id = ? AND tenant_id = ?`,
      [req.params.id, tenantId]
    );

    await recalculatePosition(tenantId, existing.ticker, existing.asset_type);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── helper ─────────────────────────────────────────────────────────────────
async function recalculatePosition(tenantId, ticker, assetType) {
  const [[row]] = await db.query(
    `SELECT
       SUM(CASE WHEN transaction_type='buy'  THEN quantity ELSE 0 END)
       - SUM(CASE WHEN transaction_type='sell' THEN quantity ELSE 0 END) AS quantity,
       SUM(CASE WHEN transaction_type='buy' THEN quantity * price + fees ELSE 0 END)
       / NULLIF(SUM(CASE WHEN transaction_type='buy' THEN quantity ELSE 0 END),0) AS average_price,
       SUM(CASE WHEN transaction_type='buy' THEN quantity * price + fees ELSE 0 END) AS total_cost,
       MIN(CASE WHEN transaction_type='buy' THEN date END) AS first_buy
     FROM invest_transactions
     WHERE tenant_id = ? AND ticker = ?`,
    [tenantId, ticker]
  );

  if (!row || row.quantity <= 0) {
    // Posição zerada — pode manter com quantity=0 ou remover; mantemos para histórico
    await db.query(
      `UPDATE invest_positions SET quantity=0, last_updated_from_tx=NOW()
       WHERE tenant_id=? AND ticker=?`,
      [tenantId, ticker]
    );
    return;
  }

  await db.query(
    `INSERT INTO invest_positions
       (tenant_id, asset_type, ticker, quantity, average_price, total_cost, first_buy, last_updated_from_tx)
     VALUES (?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE
       quantity=VALUES(quantity), average_price=VALUES(average_price),
       total_cost=VALUES(total_cost), first_buy=VALUES(first_buy),
       last_updated_from_tx=NOW()`,
    [tenantId, assetType, ticker, row.quantity, row.average_price, row.total_cost, row.first_buy]
  );
}

module.exports = router;

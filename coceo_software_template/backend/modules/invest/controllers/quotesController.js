const express = require('express');
const router  = express.Router();
const { getQuotes } = require('../services/brapiService');

// GET /api/invest/quotes?tickers=PETR4,MXRF11
router.get('/', async (req, res, next) => {
  try {
    const raw = req.query.tickers || '';
    const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) return res.json({ ok: true, data: {} });

    const quotes = await getQuotes(tickers);
    res.json({ ok: true, data: quotes });
  } catch (err) { next(err); }
});

module.exports = router;

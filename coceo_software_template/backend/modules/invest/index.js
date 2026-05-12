const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware/auth');

// Health check (sem auth — útil para monitoramento)
router.get('/health', (_req, res) => {
  res.json({ ok: true, module: 'invest', timestamp: new Date().toISOString() });
});

// Todas as rotas abaixo exigem autenticação
router.use(auth);

router.use('/positions',    require('./controllers/positionsController'));
router.use('/transactions', require('./controllers/transactionsController'));
router.use('/dividends',    require('./controllers/dividendsController'));
router.use('/expenses',     require('./controllers/expensesController'));
router.use('/quotes',       require('./controllers/quotesController'));
router.use('/results',      require('./controllers/resultsController'));
router.use('/bank',         require('./controllers/bankController'));

module.exports = router;

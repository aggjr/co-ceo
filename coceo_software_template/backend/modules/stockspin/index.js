const express = require("express");

const router = express.Router();

/**
 * Módulo STOCKSPIN (placeholder de backend).
 * Mantém o namespace do módulo para futura ACL e APIs próprias.
 */
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    module: "stockspin",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;


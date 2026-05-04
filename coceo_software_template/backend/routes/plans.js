const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');
const { auth } = require('../middleware/auth');

/**
 * Plans Routes
 * Protected by authentication
 */

// Get all active plans
router.get('/', auth, planController.getAllPlans);

// Get modules associated with a specific plan
router.get('/:id/modules', auth, planController.getPlanModules);

module.exports = router;

const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { authSuperUser } = require('../middleware/auth');

/**
 * Tenant Routes
 * All routes require super user authentication
 */

// Get all tenants
router.get('/', authSuperUser, tenantController.getAll);

// Get tenant by ID
router.get('/:id', authSuperUser, tenantController.getById);

// Get tenant users
router.get('/:id/users', authSuperUser, tenantController.getUsers);

// Create new tenant
router.post('/', authSuperUser, tenantController.create);

// Update tenant
router.put('/:id', authSuperUser, tenantController.update);

// Delete (deactivate) tenant
router.delete('/:id', authSuperUser, tenantController.delete);

// Get tenant statistics
router.get('/:id/stats', authSuperUser, tenantController.getStats);

// Get database size (with cache)
router.get('/:id/database-size', authSuperUser, tenantController.getDatabaseSize);

// Force recalculation of database size
router.post('/:id/calculate-database-size', authSuperUser, tenantController.calculateDatabaseSize);

module.exports = router;

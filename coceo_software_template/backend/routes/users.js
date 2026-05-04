const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { auth } = require('../middleware/auth');

/**
 * User Routes
 * All routes require authentication
 * Tenant isolation is enforced in the controller
 */

// Get all users (filtered by tenant for non-super users)
router.get('/', auth, userController.getAll);

// Get user by ID
router.get('/:id', auth, userController.getById);

// Create new user
router.post('/', auth, userController.create);

// Update user
router.put('/:id', auth, userController.update);

// Delete user (soft delete)
router.delete('/:id', auth, userController.delete);

// Assign roles to user
router.post('/:id/roles', auth, userController.assignRoles);

// Remove role from user
router.delete('/:id/roles/:roleId', auth, userController.removeRole);

module.exports = router;

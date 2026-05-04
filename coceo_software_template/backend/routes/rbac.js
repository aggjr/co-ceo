const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const { auth, authSuperUser } = require('../middleware/auth');

/**
 * RBAC Routes
 * Manages roles and permissions
 */

// ==================== ROLES ====================

// Get all roles
router.get('/roles', auth, rbacController.getAllRoles);

// Get role by ID
router.get('/roles/:id', auth, rbacController.getRoleById);

// Create new role
router.post('/roles', auth, rbacController.createRole);

// Update role
router.put('/roles/:id', auth, rbacController.updateRole);

// Delete role
router.delete('/roles/:id', auth, rbacController.deleteRole);

// Get permissions for a role
router.get('/roles/:id/permissions', auth, rbacController.getRolePermissions);

// Assign permissions to role
router.post('/roles/:id/permissions', auth, rbacController.assignPermissions);

// ==================== PERMISSIONS ====================

// Get all permissions
router.get('/permissions', auth, rbacController.getAllPermissions);

// Create new permission (super user only)
router.post('/permissions', authSuperUser, rbacController.createPermission);

// Get user permissions
router.get('/users/:id/permissions', auth, rbacController.getUserPermissions);

module.exports = router;

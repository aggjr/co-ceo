const db = require('../config/database');
const AppError = require('../utils/AppError');
const { logAudit } = require('../utils/auditLogger');

/**
 * RBAC Controller
 * Manages roles and permissions
 */

// ==================== ROLES ====================

/**
 * Get all roles
 * @route GET /api/rbac/roles
 * @access Authenticated
 */
exports.getAllRoles = async (req, res, next) => {
    try {
        const [roles] = await db.query(`
            SELECT 
                r.*,
                COUNT(DISTINCT ur.user_id) as user_count
            FROM roles r
            LEFT JOIN user_roles ur ON ur.role_id = r.id
            WHERE r.tenant_id IS NULL OR r.tenant_id = ?
            GROUP BY r.id
            ORDER BY r.level DESC
        `, [req.user.tenantId || null]);

        res.json({ roles });
    } catch (error) {
        next(error);
    }
};

/**
 * Get role by ID
 * @route GET /api/rbac/roles/:id
 * @access Authenticated
 */
exports.getRoleById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const [roles] = await db.query(`
            SELECT 
                r.*,
                COUNT(DISTINCT ur.user_id) as user_count
            FROM roles r
            LEFT JOIN user_roles ur ON ur.role_id = r.id
            WHERE r.id = ?
            GROUP BY r.id
        `, [id]);

        if (roles.length === 0) {
            throw new AppError('RES-001', 'Role não encontrada');
        }

        res.json(roles[0]);
    } catch (error) {
        next(error);
    }
};

/**
 * Create new role
 * @route POST /api/rbac/roles
 * @access Authenticated
 */
exports.createRole = async (req, res, next) => {
    try {
        const {
            name,
            slug,
            description,
            level = 10,
            is_system_role = false
        } = req.body;

        // Validations
        if (!name || !slug) {
            throw new AppError('VAL-002', 'Nome e slug são obrigatórios');
        }

        // Only super users can create system roles
        if (is_system_role && !req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem criar roles de sistema');
        }

        // Check if slug already exists
        const [existing] = await db.query(
            'SELECT id FROM roles WHERE slug = ? AND (tenant_id IS NULL OR tenant_id = ?)',
            [slug, req.user.tenantId]
        );

        if (existing.length > 0) {
            throw new AppError('VAL-003', 'Slug já está em uso');
        }

        // Determine tenant_id (null for system roles, user's tenant for custom roles)
        const tenant_id = is_system_role ? null : req.user.tenantId;

        const [result] = await db.query(`
            INSERT INTO roles (name, slug, description, level, is_system_role, tenant_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [name, slug, description, level, is_system_role, tenant_id]);

        // Audit log
        await logAudit(
            req.user.id,
            'CREATE',
            'roles',
            result.insertId,
            null,
            { name, slug, level }
        );

        const [roles] = await db.query('SELECT * FROM roles WHERE id = ?', [result.insertId]);

        res.status(201).json({
            message: 'Role criada com sucesso',
            role: roles[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update role
 * @route PUT /api/rbac/roles/:id
 * @access Authenticated
 */
exports.updateRole = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, description, level } = req.body;

        // Get current role
        const [current] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
        if (current.length === 0) {
            throw new AppError('RES-001', 'Role não encontrada');
        }

        // Can't edit system roles unless you're super user
        if (current[0].is_system_role && !req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem editar roles de sistema');
        }

        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (description !== undefined) { updates.push('description = ?'); params.push(description); }
        if (level !== undefined) { updates.push('level = ?'); params.push(level); }

        if (updates.length === 0) {
            throw new AppError('VAL-002', 'Nenhum campo para atualizar');
        }

        params.push(id);

        await db.query(
            `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Audit log
        await logAudit(
            req.user.id,
            'UPDATE',
            'roles',
            id,
            current[0],
            req.body
        );

        const [roles] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);

        res.json({
            message: 'Role atualizada com sucesso',
            role: roles[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete role
 * @route DELETE /api/rbac/roles/:id
 * @access Authenticated
 */
exports.deleteRole = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get current role
        const [current] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
        if (current.length === 0) {
            throw new AppError('RES-001', 'Role não encontrada');
        }

        // Can't delete system roles
        if (current[0].is_system_role) {
            throw new AppError('PERM-001', 'Roles de sistema não podem ser excluídas');
        }

        // Check if role is in use
        const [usage] = await db.query('SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?', [id]);
        if (usage[0].count > 0) {
            throw new AppError('VAL-003', 'Role está em uso e não pode ser excluída');
        }

        // Delete role
        await db.query('DELETE FROM roles WHERE id = ?', [id]);

        // Audit log
        await logAudit(
            req.user.id,
            'DELETE',
            'roles',
            id,
            current[0],
            null
        );

        res.json({
            message: 'Role excluída com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

// ==================== PERMISSIONS ====================

/**
 * Get all permissions
 * @route GET /api/rbac/permissions
 * @access Authenticated
 */
exports.getAllPermissions = async (req, res, next) => {
    try {
        const { module, resource } = req.query;

        let query = 'SELECT * FROM permissions WHERE 1=1';
        const params = [];

        if (module) {
            query += ' AND module = ?';
            params.push(module);
        }

        if (resource) {
            query += ' AND resource = ?';
            params.push(resource);
        }

        query += ' ORDER BY module, resource, action';

        const [permissions] = await db.query(query, params);

        res.json({ permissions });
    } catch (error) {
        next(error);
    }
};

/**
 * Create new permission
 * @route POST /api/rbac/permissions
 * @access Super User only
 */
exports.createPermission = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem criar permissões');
        }

        const { module, resource, action, field, description } = req.body;

        // Validations
        if (!module || !resource || !action) {
            throw new AppError('VAL-002', 'Módulo, recurso e ação são obrigatórios');
        }

        // Check if permission already exists
        const [existing] = await db.query(
            'SELECT id FROM permissions WHERE module = ? AND resource = ? AND action = ? AND (field = ? OR (field IS NULL AND ? IS NULL))',
            [module, resource, action, field, field]
        );

        if (existing.length > 0) {
            throw new AppError('VAL-003', 'Permissão já existe');
        }

        const [result] = await db.query(`
            INSERT INTO permissions (module, resource, action, field, description)
            VALUES (?, ?, ?, ?, ?)
        `, [module, resource, action, field, description]);

        // Audit log
        await logAudit(
            req.user.id,
            'CREATE',
            'permissions',
            result.insertId,
            null,
            { module, resource, action, field }
        );

        const [permissions] = await db.query('SELECT * FROM permissions WHERE id = ?', [result.insertId]);

        res.status(201).json({
            message: 'Permissão criada com sucesso',
            permission: permissions[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get permissions for a role
 * @route GET /api/rbac/roles/:id/permissions
 * @access Authenticated
 */
exports.getRolePermissions = async (req, res, next) => {
    try {
        const { id } = req.params;

        const [permissions] = await db.query(`
            SELECT p.*
            FROM permissions p
            INNER JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE rp.role_id = ?
            ORDER BY p.module, p.resource, p.action
        `, [id]);

        res.json({ permissions });
    } catch (error) {
        next(error);
    }
};

/**
 * Assign permissions to role
 * @route POST /api/rbac/roles/:id/permissions
 * @access Authenticated
 */
exports.assignPermissions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { permission_ids } = req.body;

        if (!permission_ids || !Array.isArray(permission_ids)) {
            throw new AppError('VAL-002', 'permission_ids deve ser um array');
        }

        // Get role
        const [roles] = await db.query('SELECT * FROM roles WHERE id = ?', [id]);
        if (roles.length === 0) {
            throw new AppError('RES-001', 'Role não encontrada');
        }

        // Can't edit system roles unless you're super user
        if (roles[0].is_system_role && !req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem editar permissões de roles de sistema');
        }

        // Remove existing permissions
        await db.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);

        // Add new permissions
        if (permission_ids.length > 0) {
            const permValues = permission_ids.map(permId => [id, permId, req.user.id]);
            await db.query(
                'INSERT INTO role_permissions (role_id, permission_id, granted_by) VALUES ?',
                [permValues]
            );
        }

        // Audit log
        await logAudit(
            req.user.id,
            'UPDATE',
            'role_permissions',
            id,
            null,
            { permission_ids }
        );

        res.json({
            message: 'Permissões atribuídas com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user permissions (aggregated from all roles)
 * @route GET /api/rbac/users/:id/permissions
 * @access Authenticated
 */
exports.getUserPermissions = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Tenant isolation
        const [users] = await db.query('SELECT tenant_id, is_super_user FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            throw new AppError('RES-001', 'Usuário não encontrado');
        }

        if (!req.user.isSuperUser && users[0].tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para visualizar permissões deste usuário');
        }

        // Super users have all permissions
        if (users[0].is_super_user) {
            const [allPermissions] = await db.query('SELECT * FROM permissions ORDER BY module, resource, action');
            return res.json({ permissions: allPermissions, isSuperUser: true });
        }

        // Get permissions from user's roles
        const [permissions] = await db.query(`
            SELECT DISTINCT p.*
            FROM permissions p
            INNER JOIN role_permissions rp ON rp.permission_id = p.id
            INNER JOIN user_roles ur ON ur.role_id = rp.role_id
            WHERE ur.user_id = ?
            ORDER BY p.module, p.resource, p.action
        `, [id]);

        res.json({ permissions, isSuperUser: false });
    } catch (error) {
        next(error);
    }
};

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const AppError = require('../utils/AppError');
const { logAudit } = require('../utils/auditLogger');

/**
 * User Controller
 * Manages users within tenants
 * Super users can manage all users, regular users can only manage users in their tenant
 */

/**
 * Get all users
 * @route GET /api/users
 * @access Authenticated
 */
exports.getAll = async (req, res, next) => {
    try {
        const { status, role, search } = req.query;

        let query = `
            SELECT 
                u.id,
                u.tenant_id,
                u.email,
                u.first_name,
                u.last_name,
                u.phone,
                u.avatar_url,
                u.status,
                u.is_super_user,
                u.email_verified,
                u.last_login_at,
                u.created_at,
                t.name as tenant_name,
                GROUP_CONCAT(DISTINCT r.name) as roles
            FROM users u
            LEFT JOIN tenants t ON t.id = u.tenant_id
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.deleted_at IS NULL
        `;
        const params = [];

        // Tenant isolation: 
        // If req.tenantId is set (either by regular user or super user impersonation), filter by it
        // If req.tenantId is undefined (Super User global view), show all
        if (req.tenantId) {
            query += ' AND u.tenant_id = ?';
            params.push(req.tenantId);
        } else if (!req.user.isSuperUser) {
            // Fallback safety (should be covered by middleware but good to double check)
            query += ' AND u.tenant_id = ?';
            params.push(req.user.tenantId);
        }

        if (status) {
            query += ' AND u.status = ?';
            params.push(status);
        }

        if (search) {
            query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        query += ' GROUP BY u.id ORDER BY u.created_at DESC';

        const [users] = await db.query(query, params);

        res.json({
            users,
            total: users.length
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user by ID
 * @route GET /api/users/:id
 * @access Authenticated
 */
exports.getById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const [users] = await db.query(`
            SELECT 
                u.*,
                t.name as tenant_name,
                t.status as tenant_status,
                GROUP_CONCAT(DISTINCT r.id) as role_ids,
                GROUP_CONCAT(DISTINCT r.name) as role_names
            FROM users u
            LEFT JOIN tenants t ON t.id = u.tenant_id
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.id = ? AND u.deleted_at IS NULL
            GROUP BY u.id
        `, [id]);

        if (users.length === 0) {
            throw new AppError('RES-001', 'Usuário não encontrado');
        }

        const user = users[0];

        // Tenant isolation: non-super users can only see users from their tenant
        if (!req.user.isSuperUser && user.tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para visualizar este usuário');
        }

        // Don't send password hash
        delete user.password_hash;

        res.json(user);
    } catch (error) {
        next(error);
    }
};

/**
 * Create new user
 * @route POST /api/users
 * @access Authenticated
 */
exports.create = async (req, res, next) => {
    try {
        const {
            tenant_id,
            email,
            password,
            first_name,
            last_name,
            phone,
            status = 'pending',
            role_ids = []
        } = req.body;

        // Validations
        if (!email || !first_name || !last_name) {
            throw new AppError('VAL-002', 'Email, nome e sobrenome são obrigatórios');
        }

        if (!password || password.length < 8) {
            throw new AppError('VAL-002', 'Senha deve ter no mínimo 8 caracteres');
        }

        // Determine tenant_id
        let finalTenantId = tenant_id;

        // Non-super users can only create users in their own tenant
        if (!req.user.isSuperUser) {
            finalTenantId = req.user.tenantId;
        }

        // If creating a user for a tenant, check user limit
        if (finalTenantId) {
            const [tenantInfo] = await db.query(`
                SELECT 
                    t.max_users,
                    COUNT(u.id) as current_users
                FROM tenants t
                LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
                WHERE t.id = ?
                GROUP BY t.id
            `, [finalTenantId]);

            if (tenantInfo.length === 0) {
                throw new AppError('RES-001', 'Tenant não encontrado');
            }

            if (tenantInfo[0].current_users >= tenantInfo[0].max_users) {
                throw new AppError('VAL-003', `Limite de usuários atingido (${tenantInfo[0].max_users})`);
            }
        }

        // Check if email already exists
        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL',
            [email]
        );

        if (existing.length > 0) {
            throw new AppError('VAL-003', 'Email já está em uso');
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Create user
        const [result] = await db.query(`
            INSERT INTO users (
                tenant_id, email, password_hash, first_name, last_name, phone, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [finalTenantId, email, password_hash, first_name, last_name, phone, status]);

        const userId = result.insertId;

        // Assign roles
        if (role_ids.length > 0) {
            const roleValues = role_ids.map(roleId => [userId, roleId, req.user.id]);
            await db.query(
                'INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ?',
                [roleValues]
            );
        }

        // Audit log
        await logAudit(
            req.user.id,
            'CREATE',
            'users',
            userId,
            null,
            { email, first_name, last_name, tenant_id: finalTenantId }
        );

        // Get created user
        const [users] = await db.query(`
            SELECT 
                u.id, u.tenant_id, u.email, u.first_name, u.last_name, 
                u.phone, u.status, u.created_at,
                GROUP_CONCAT(DISTINCT r.name) as roles
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.id = ?
            GROUP BY u.id
        `, [userId]);

        res.status(201).json({
            message: 'Usuário criado com sucesso',
            user: users[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update user
 * @route PUT /api/users/:id
 * @access Authenticated
 */
exports.update = async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            first_name,
            last_name,
            phone,
            status,
            avatar_url
        } = req.body;

        // Get current user
        const [current] = await db.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
        if (current.length === 0) {
            throw new AppError('RES-001', 'Usuário não encontrado');
        }

        // Tenant isolation
        if (!req.user.isSuperUser && current[0].tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para atualizar este usuário');
        }

        const updates = [];
        const params = [];

        if (first_name !== undefined) { updates.push('first_name = ?'); params.push(first_name); }
        if (last_name !== undefined) { updates.push('last_name = ?'); params.push(last_name); }
        if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url); }

        if (updates.length === 0) {
            throw new AppError('VAL-002', 'Nenhum campo para atualizar');
        }

        params.push(id);

        await db.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Audit log
        await logAudit(
            req.user.id,
            'UPDATE',
            'users',
            id,
            current[0],
            req.body
        );

        // Get updated user
        const [users] = await db.query(`
            SELECT 
                u.id, u.tenant_id, u.email, u.first_name, u.last_name, 
                u.phone, u.avatar_url, u.status, u.updated_at,
                GROUP_CONCAT(DISTINCT r.name) as roles
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.id = ?
            GROUP BY u.id
        `, [id]);

        res.json({
            message: 'Usuário atualizado com sucesso',
            user: users[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Admin reset password (super admin or same-tenant manager).
 * Sets the user's password without requiring the current one.
 * @route POST /api/users/:id/admin-reset-password
 * @access Super admin (any tenant) or admin of the user's tenant
 */
exports.adminResetPassword = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body || {};

        if (!newPassword || typeof newPassword !== 'string') {
            throw new AppError('VAL-002', 'newPassword é obrigatório');
        }
        if (newPassword.length < 8) {
            throw new AppError('VAL-004', 'Senha deve ter no mínimo 8 caracteres');
        }

        const [rows] = await db.query(
            'SELECT id, tenant_id, email FROM users WHERE id = ? AND deleted_at IS NULL',
            [id]
        );
        if (rows.length === 0) throw new AppError('RES-001', 'Usuário não encontrado');
        const target = rows[0];

        if (!req.user.isSuperUser && target.tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para resetar a senha deste usuário');
        }

        const hash = await bcrypt.hash(newPassword, 10);

        await db.query(
            `UPDATE users
             SET password_hash = ?,
                 failed_login_attempts = 0,
                 locked_until = NULL
             WHERE id = ?`,
            [hash, id]
        );

        await logAudit(
            req.user.id,
            'UPDATE',
            'users',
            id,
            null,
            { action: 'ADMIN_RESET_PASSWORD', target_email: target.email }
        );

        res.json({ message: 'Senha redefinida com sucesso', user: { id: Number(id), email: target.email } });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete (soft delete) user
 * @route DELETE /api/users/:id
 * @access Authenticated
 */
exports.delete = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get current user
        const [current] = await db.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
        if (current.length === 0) {
            throw new AppError('RES-001', 'Usuário não encontrado');
        }

        // Tenant isolation
        if (!req.user.isSuperUser && current[0].tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para excluir este usuário');
        }

        // Can't delete yourself
        if (id == req.user.id) {
            throw new AppError('VAL-003', 'Você não pode excluir sua própria conta');
        }

        // Soft delete
        await db.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [id]);

        // Audit log
        await logAudit(
            req.user.id,
            'DELETE',
            'users',
            id,
            current[0],
            null
        );

        res.json({
            message: 'Usuário excluído com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Assign roles to user
 * @route POST /api/users/:id/roles
 * @access Authenticated
 */
exports.assignRoles = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { role_ids } = req.body;

        if (!role_ids || !Array.isArray(role_ids) || role_ids.length === 0) {
            throw new AppError('VAL-002', 'role_ids deve ser um array não vazio');
        }

        // Get user
        const [users] = await db.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
        if (users.length === 0) {
            throw new AppError('RES-001', 'Usuário não encontrado');
        }

        // Tenant isolation
        if (!req.user.isSuperUser && users[0].tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para gerenciar roles deste usuário');
        }

        // Remove existing roles
        await db.query('DELETE FROM user_roles WHERE user_id = ?', [id]);

        // Add new roles
        const roleValues = role_ids.map(roleId => [id, roleId, req.user.id]);
        await db.query(
            'INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ?',
            [roleValues]
        );

        // Audit log
        await logAudit(
            req.user.id,
            'UPDATE',
            'user_roles',
            id,
            null,
            { role_ids }
        );

        res.json({
            message: 'Roles atribuídas com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Remove role from user
 * @route DELETE /api/users/:id/roles/:roleId
 * @access Authenticated
 */
exports.removeRole = async (req, res, next) => {
    try {
        const { id, roleId } = req.params;

        // Get user
        const [users] = await db.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
        if (users.length === 0) {
            throw new AppError('RES-001', 'Usuário não encontrado');
        }

        // Tenant isolation
        if (!req.user.isSuperUser && users[0].tenant_id !== req.user.tenantId) {
            throw new AppError('PERM-001', 'Sem permissão para gerenciar roles deste usuário');
        }

        await db.query('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [id, roleId]);

        // Audit log
        await logAudit(
            req.user.id,
            'DELETE',
            'user_roles',
            id,
            { role_id: roleId },
            null
        );

        res.json({
            message: 'Role removida com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const { applyTenantModulePolicy } = require('../utils/tenantModulePolicy');
const { logAudit } = require('../utils/auditLogger');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Login - Multitenant aware
 * Super users can access any tenant, regular users only their own tenant
 */
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        console.log('=== LOGIN ATTEMPT ===', { email });

        if (!email || !password) {
            throw new AppError('VAL-002', 'Email e senha são obrigatórios');
        }

        // Find user with tenant information
        const [users] = await db.query(`
            SELECT 
                u.id,
                u.tenant_id,
                u.email,
                u.password_hash,
                u.first_name,
                u.last_name,
                u.status,
                u.is_super_user,
                u.email_verified,
                u.failed_login_attempts,
                u.locked_until,
                t.name as tenant_name,
                t.slug as tenant_slug,
                t.status as tenant_status
            FROM users u
            LEFT JOIN tenants t ON u.tenant_id = t.id
            WHERE u.email = ? AND u.deleted_at IS NULL
        `, [email]);

        if (users.length === 0) {
            throw new AppError('AUTH-003', 'Email ou senha incorretos');
        }

        const user = users[0];

        // Check if account is locked
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            throw new AppError('AUTH-004', 'Conta temporariamente bloqueada. Tente novamente mais tarde.');
        }

        // Check if user is active
        if (user.status !== 'active') {
            throw new AppError('AUTH-004', 'Conta inativa. Entre em contato com o administrador.');
        }

        // Check if email is verified
        if (!user.email_verified) {
            throw new AppError('AUTH-004', 'Email não verificado. Verifique seu email.');
        }

        // Check tenant status (skip for super users)
        if (!user.is_super_user && user.tenant_status !== 'active') {
            throw new AppError('TEN-002', 'Tenant inativo ou suspenso');
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            // Increment failed login attempts
            await db.query(`
                UPDATE users 
                SET failed_login_attempts = failed_login_attempts + 1,
                    locked_until = CASE 
                        WHEN failed_login_attempts + 1 >= 5 
                        THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE)
                        ELSE NULL 
                    END
                WHERE id = ?
            `, [user.id]);

            throw new AppError('AUTH-003', 'Email ou senha incorretos');
        }

        // Reset failed login attempts on successful login
        await db.query(`
            UPDATE users 
            SET failed_login_attempts = 0,
                locked_until = NULL,
                last_login_at = NOW(),
                last_login_ip = ?
            WHERE id = ?
        `, [req.ip, user.id]);

        // Get user roles and permissions
        const [roles] = await db.query(`
            SELECT 
                r.id,
                r.name,
                r.slug,
                r.level
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = ? 
                AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        `, [user.id]);

        // Generate JWT token
        const token = jwt.sign({
            id: user.id,
            email: user.email,
            tenantId: user.tenant_id,
            isSuperUser: user.is_super_user,
            roles: roles.map(r => r.slug)
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        // Create session
        const sessionId = `${user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await db.query(`
            INSERT INTO sessions (id, user_id, tenant_id, data, ip_address, user_agent, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            sessionId,
            user.id,
            user.tenant_id,
            JSON.stringify({ roles: roles.map(r => r.slug) }),
            req.ip,
            req.get('user-agent'),
            expiresAt
        ]);

        // Log successful login
        await logAudit(
            { user: { id: user.id, tenantId: user.tenant_id }, ip: req.ip, get: req.get.bind(req) },
            'LOGIN',
            'users',
            user.id,
            { email, success: true }
        );

        console.log('=== LOGIN SUCCESS ===', { userId: user.id, email, tenantId: user.tenant_id });

        let tenantContext = null;
        if (!user.is_super_user && user.tenant_id) {
            const [trows] = await db.query(
                `SELECT id, name, slug, legacy_db_name, module_settings FROM tenants WHERE id = ? LIMIT 1`,
                [user.tenant_id]
            );
            if (trows.length > 0) {
                const t = trows[0];
                tenantContext = {
                    id: t.id,
                    name: t.name,
                    slug: t.slug,
                    legacyDbName: t.legacy_db_name,
                    moduleSettings: applyTenantModulePolicy(t.slug, t.module_settings)
                };
            }
        }

        res.json({
            token,
            sessionId,
            tenant: tenantContext,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                isSuperUser: user.is_super_user,
                tenantId: user.tenant_id,
                tenantName: user.tenant_name,
                tenantSlug: user.tenant_slug || null,
                roles: roles
            }
        });

    } catch (error) {
        console.error('=== LOGIN ERROR ===', error);
        next(error);
    }
};

/**
 * Register - Create new user for a tenant
 * Only super users or tenant admins can create users
 */
exports.register = async (req, res, next) => {
    let connection;
    try {
        const { email, password, firstName, lastName, tenantId, roleIds } = req.body;

        console.log('=== REGISTER START ===', { email, firstName, lastName, tenantId });

        // Validation
        if (!email || !password || !firstName || !lastName) {
            throw new AppError('VAL-002', 'Todos os campos são obrigatórios');
        }

        if (password.length < 8) {
            throw new AppError('VAL-004', 'Senha deve ter no mínimo 8 caracteres');
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new AppError('VAL-003', 'Formato de email inválido');
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Check if user already exists
        const [existing] = await connection.query(
            'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL',
            [email]
        );

        if (existing.length > 0) {
            throw new AppError('RES-002', 'Usuário com este email já existe');
        }

        // If tenantId provided, check tenant limits and status
        if (tenantId) {
            const [tenants] = await connection.query(
                'SELECT status, max_users FROM tenants WHERE id = ?',
                [tenantId]
            );

            if (tenants.length === 0) {
                throw new AppError('TEN-001', 'Tenant não encontrado');
            }

            if (tenants[0].status !== 'active') {
                throw new AppError('TEN-002', 'Tenant inativo ou suspenso');
            }

            // Check user limit
            const [userCount] = await connection.query(
                'SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND deleted_at IS NULL',
                [tenantId]
            );

            if (userCount[0].count >= tenants[0].max_users) {
                throw new AppError('TEN-003', 'Limite de usuários atingido para este tenant');
            }
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user
        const [result] = await connection.query(`
            INSERT INTO users (
                tenant_id,
                email,
                password_hash,
                first_name,
                last_name,
                status,
                email_verified
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            tenantId || null,
            email,
            passwordHash,
            firstName,
            lastName,
            'pending', // Requires email verification
            false
        ]);

        const userId = result.insertId;

        // Assign roles if provided
        if (roleIds && roleIds.length > 0) {
            const roleValues = roleIds.map(roleId => [userId, roleId, req.user?.id || null]);
            await connection.query(
                'INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ?',
                [roleValues]
            );
        }

        await connection.commit();

        console.log('=== REGISTER SUCCESS ===', { userId, email, tenantId });

        // Log user creation
        await logAudit(
            req,
            'CREATE',
            'users',
            userId,
            { email, firstName, lastName, tenantId }
        );

        res.status(201).json({
            message: 'Usuário criado com sucesso',
            userId
        });

    } catch (error) {
        console.error('=== REGISTER ERROR ===', error);
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Change Password
 */
exports.changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            throw new AppError('VAL-002', 'Senha atual e nova senha são obrigatórias');
        }

        if (newPassword.length < 8) {
            throw new AppError('VAL-004', 'Nova senha deve ter no mínimo 8 caracteres');
        }

        // Get current password
        const [users] = await db.query(
            'SELECT password_hash FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            throw new AppError('AUTH-004', 'Usuário não encontrado');
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, users[0].password_hash);
        if (!validPassword) {
            throw new AppError('AUTH-003', 'Senha atual incorreta');
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 10);

        // Update password
        await db.query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [newPasswordHash, userId]
        );

        // Log password change
        await logAudit(req, 'UPDATE', 'users', userId, { action: 'CHANGE_PASSWORD' });

        res.json({ message: 'Senha alterada com sucesso' });

    } catch (error) {
        next(error);
    }
};

/**
 * Logout - Invalidate session
 */
exports.logout = async (req, res, next) => {
    try {
        const sessionId = req.body.sessionId || req.headers['x-session-id'];

        if (sessionId) {
            await db.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
        }

        // Log logout
        await logAudit(req, 'LOGOUT', 'users', req.user.id, {});

        res.json({ message: 'Logout realizado com sucesso' });

    } catch (error) {
        next(error);
    }
};

/**
 * Get current user info
 */
exports.me = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const [users] = await db.query(`
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
                u.language,
                u.timezone,
                u.preferences,
                t.name as tenant_name,
                t.slug as tenant_slug,
                t.plan as tenant_plan
            FROM users u
            LEFT JOIN tenants t ON u.tenant_id = t.id
            WHERE u.id = ? AND u.deleted_at IS NULL
        `, [userId]);

        if (users.length === 0) {
            throw new AppError('AUTH-004', 'Usuário não encontrado');
        }

        const user = users[0];

        // Get roles
        const [roles] = await db.query(`
            SELECT r.id, r.name, r.slug, r.level
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = ?
                AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        `, [userId]);

        res.json({
            ...user,
            roles,
            preferences: user.preferences ? JSON.parse(user.preferences) : {}
        });

    } catch (error) {
        next(error);
    }
};

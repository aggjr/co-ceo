const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

/**
 * Standard authentication middleware
 * Verifies JWT token and attaches user info to req.user
 */
const auth = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            throw new AppError('AUTH-001', 'Token não fornecido', 401);
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Attach user info to request
        req.user = {
            id: decoded.id,
            email: decoded.email,
            tenantId: decoded.tenantId,
            isSuperUser: decoded.isSuperUser,
            roles: decoded.roles || []
        };

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return next(new AppError('AUTH-002', 'Token inválido', 401));
        }
        if (error.name === 'TokenExpiredError') {
            return next(new AppError('AUTH-005', 'Sessão expirada', 401));
        }
        next(error);
    }
};

/**
 * Super User only middleware
 * Requires user to be a super user
 */
const authSuperUser = (req, res, next) => {
    auth(req, res, (err) => {
        if (err) return next(err);

        if (!req.user.isSuperUser) {
            return next(new AppError('AUTH-004', 'Acesso restrito a super usuários', 403));
        }

        next();
    });
};

/**
 * Tenant isolation middleware
 * Ensures users can only access their own tenant's data
 * Super users bypass this check
 */
const authTenant = (req, res, next) => {
    auth(req, res, (err) => {
        if (err) return next(err);

        // Personificação de tenant (ingl.: tenant impersonation). Só superusuário; cabeçalho x-tenant-id.
        const impersonateTenantId = req.headers['x-tenant-id'];

        // Superusuário com personificação ativa
        if (req.user.isSuperUser && impersonateTenantId) {
            req.tenantId = parseInt(impersonateTenantId);
            return next();
        }

        // Super users can access any tenant (global view) if not impersonating
        if (req.user.isSuperUser) {
            return next();
        }

        // Extract tenantId from request (body, params, or query)
        const requestedTenantId = req.body.tenantId || req.params.tenantId || req.query.tenantId;

        // If no tenantId in request, use user's tenantId
        if (!requestedTenantId) {
            req.tenantId = req.user.tenantId;
            return next();
        }

        // Check if user is trying to access different tenant
        if (parseInt(requestedTenantId) !== parseInt(req.user.tenantId)) {
            return next(new AppError('AUTH-004', 'Acesso negado a dados de outro tenant', 403));
        }

        req.tenantId = req.user.tenantId;
        next();
    });
};

/**
 * Role-based authorization middleware
 * Checks if user has required role
 * @param {string|string[]} requiredRoles - Role slug(s) required
 */
const authRole = (requiredRoles) => {
    return (req, res, next) => {
        auth(req, res, (err) => {
            if (err) return next(err);

            // Super users bypass role checks
            if (req.user.isSuperUser) {
                return next();
            }

            const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
            const userRoles = req.user.roles || [];

            const hasRole = roles.some(role => userRoles.includes(role));

            if (!hasRole) {
                return next(new AppError('PERM-001', `Acesso negado. Requer role: ${roles.join(' ou ')}`, 403));
            }

            next();
        });
    };
};

module.exports = {
    auth,
    authSuperUser,
    authTenant,
    authRole,
    // Alias for CASH module compatibility (CASH used authMaster for super-user-only routes)
    authMaster: authSuperUser
};


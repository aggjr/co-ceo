const db = require('../config/database');
const AppError = require('../utils/AppError');

/**
 * Permission Middleware
 * Checks if user has required permission to access a resource
 */

/**
 * Get user permissions from database
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of permissions
 */
async function getUserPermissions(userId) {
    const [permissions] = await db.query(`
        SELECT DISTINCT p.*
        FROM permissions p
        INNER JOIN role_permissions rp ON rp.permission_id = p.id
        INNER JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = ?
    `, [userId]);

    return permissions;
}

/**
 * Check if user has specific permission
 * @param {string} module - Module name (e.g., 'products')
 * @param {string} resource - Resource name (e.g., 'product')
 * @param {string} action - Action name (e.g., 'read', 'create', 'update', 'delete')
 * @param {string|null} field - Optional field name for field-level permissions
 * @returns {Function} Express middleware
 */
function checkPermission(module, resource, action, field = null) {
    return async (req, res, next) => {
        try {
            // Super users always have access
            if (req.user.isSuperUser) {
                return next();
            }

            // Get user permissions
            const permissions = await getUserPermissions(req.user.id);

            // Check if user has the required permission
            const hasPermission = permissions.some(p => {
                // Match module, resource, and action
                const moduleMatch = p.module === module;
                const resourceMatch = p.resource === resource;
                const actionMatch = p.action === action;

                // For field-level permissions:
                // - If checking a specific field, permission must either:
                //   1. Grant access to that specific field (p.field === field)
                //   2. Grant access to all fields (p.field === null)
                // - If not checking a field, permission must grant general access (p.field === null)
                const fieldMatch = field === null
                    ? p.field === null
                    : (p.field === field || p.field === null);

                return moduleMatch && resourceMatch && actionMatch && fieldMatch;
            });

            if (!hasPermission) {
                throw new AppError(
                    'PERM-001',
                    `Sem permissão para ${action} ${resource} em ${module}${field ? ` (campo: ${field})` : ''}`
                );
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Check if user has permission to access any of the specified fields
 * Used for filtering visible fields in responses
 * @param {number} userId - User ID
 * @param {string} module - Module name
 * @param {string} resource - Resource name
 * @param {string} action - Action name
 * @param {Array<string>} fields - Array of field names
 * @returns {Promise<Array<string>>} Array of accessible fields
 */
async function getAccessibleFields(userId, module, resource, action, fields) {
    // Super users have access to all fields
    const [users] = await db.query('SELECT is_super_user FROM users WHERE id = ?', [userId]);
    if (users.length > 0 && users[0].is_super_user) {
        return fields;
    }

    // Get user permissions
    const permissions = await getUserPermissions(userId);

    // Find permissions for this module/resource/action
    const relevantPerms = permissions.filter(p =>
        p.module === module &&
        p.resource === resource &&
        p.action === action
    );

    // If user has general permission (field = null), they can access all fields
    const hasGeneralPermission = relevantPerms.some(p => p.field === null);
    if (hasGeneralPermission) {
        return fields;
    }

    // Otherwise, return only fields they have specific permission for
    const allowedFields = relevantPerms
        .filter(p => p.field !== null)
        .map(p => p.field);

    return fields.filter(field => allowedFields.includes(field));
}

/**
 * Middleware to filter response fields based on user permissions
 * Attaches a helper function to req object
 */
function attachFieldFilter(req, res, next) {
    req.filterFields = async (module, resource, action, data, fields) => {
        const accessibleFields = await getAccessibleFields(
            req.user.id,
            module,
            resource,
            action,
            fields
        );

        // If data is an array, filter each object
        if (Array.isArray(data)) {
            return data.map(item => {
                const filtered = {};
                accessibleFields.forEach(field => {
                    if (item.hasOwnProperty(field)) {
                        filtered[field] = item[field];
                    }
                });
                return filtered;
            });
        }

        // If data is a single object, filter it
        const filtered = {};
        accessibleFields.forEach(field => {
            if (data.hasOwnProperty(field)) {
                filtered[field] = data[field];
            }
        });
        return filtered;
    };

    next();
}

module.exports = {
    checkPermission,
    getUserPermissions,
    getAccessibleFields,
    attachFieldFilter
};

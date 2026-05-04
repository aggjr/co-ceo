const db = require('../config/database');
const AppError = require('../utils/AppError');

/**
 * Middleware para verificar permissões granulares de acesso
 * @param {string} module - Módulo requisitado (ex: 'products')
 * @param {string} resource - Recurso requisitado (ex: 'product')
 * @param {string} action - Ação requisitada (ex: 'read', 'create', 'update', 'delete')
 */
const requirePermission = (module, resource, action) => {
    return async (req, res, next) => {
        try {
            // Se não estiver autenticado, barrar
            if (!req.user) {
                return next(new AppError('AUTH-001', 'Usuário não autenticado', 401));
            }

            // Super usuários têm permissão irrestrita
            if (req.user.isSuperUser) {
                return next();
            }

            // Buscar se o usuário possui alguma role com permissão para este recurso e ação
            const [params] = await db.query(`
                SELECT 1
                FROM user_roles ur
                JOIN role_permissions rp ON ur.role_id = rp.role_id
                JOIN permissions p ON rp.permission_id = p.id
                WHERE ur.user_id = ?
                  AND p.module = ?
                  AND p.resource = ?
                  AND p.action = ?
                LIMIT 1
            `, [req.user.id, module, resource, action]);

            if (params.length === 0) {
                return next(new AppError('PERM-002', `Acesso negado: falha de permissão para ${action} em ${module}.${resource}`, 403));
            }

            // Opcional: injetar no request quais campos ele NÃO pode ler/escrever
            // (Para ser consumido pelo controller)
            const [fieldsRestrictions] = await db.query(`
                SELECT p.field, p.action
                FROM user_roles ur
                JOIN role_permissions rp ON ur.role_id = rp.role_id
                JOIN permissions p ON rp.permission_id = p.id
                WHERE ur.user_id = ?
                  AND p.module = ?
                  AND p.resource = ?
                  AND p.field IS NOT NULL
            `, [req.user.id, module, resource]);

            req.fieldPermissions = fieldsRestrictions;

            next();
        } catch (error) {
            next(error);
        }
    };
};

module.exports = {
    requirePermission
};

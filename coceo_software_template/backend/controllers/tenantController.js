const db = require('../config/database');
const AppError = require('../utils/AppError');
const { logAudit } = require('../utils/auditLogger');

/** Aceita objeto ou string JSON; undefined = não alterar no UPDATE. */
function normalizeModuleSettingsInput(raw) {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t) return null;
        try {
            JSON.parse(t);
            return t;
        } catch {
            return null;
        }
    }
    if (typeof raw === 'object') return JSON.stringify(raw);
    return null;
}

/**
 * Tenant Controller
 * Manages clients (tenants) in the multitenant system
 * Only accessible by super users
 */

/**
 * Get all tenants
 * @route GET /api/tenants
 * @access Super User only
 */
exports.getAll = async (req, res, next) => {
    try {
        // Only super users can list all tenants
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem listar clientes');
        }

        const { status, plan, search } = req.query;

        let query = `
            SELECT 
                t.*,
                COUNT(DISTINCT u.id) as user_count,
                COUNT(DISTINCT CASE WHEN u.status = 'active' THEN u.id END) as active_users
            FROM tenants t
            LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        if (plan) {
            query += ' AND t.plan = ?';
            params.push(plan);
        }

        if (search) {
            query += ' AND (t.name LIKE ? OR t.contact_email LIKE ? OR t.cnpj LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        query += ' GROUP BY t.id ORDER BY t.created_at DESC';

        const [tenants] = await db.query(query, params);

        // Fetch database sizes from cache
        const [sizes] = await db.query(`
            SELECT 
                tenant_id,
                database_size,
                calculated_at,
                DATEDIFF(NOW(), calculated_at) as days_old
            FROM tenant_database_size_cache
        `);

        // Create size map
        const sizeMap = {};
        sizes.forEach(s => {
            sizeMap[s.tenant_id] = {
                size: s.database_size,
                calculated_at: s.calculated_at,
                days_old: s.days_old
            };
        });

        // Add database size to each tenant
        const tenantsWithSize = tenants.map(tenant => ({
            ...tenant,
            database_size: sizeMap[tenant.id]?.size || 0,
            database_size_calculated_at: sizeMap[tenant.id]?.calculated_at || null,
            database_size_days_old: sizeMap[tenant.id]?.days_old || null
        }));

        res.json({
            tenants: tenantsWithSize,
            total: tenantsWithSize.length
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get tenant by ID
 * @route GET /api/tenants/:id
 * @access Super User only
 */
exports.getById = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem visualizar detalhes de clientes');
        }

        const { id } = req.params;

        const [tenants] = await db.query(`
            SELECT 
                t.*,
                COUNT(DISTINCT u.id) as user_count,
                COUNT(DISTINCT CASE WHEN u.status = 'active' THEN u.id END) as active_users
            FROM tenants t
            LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
            WHERE t.id = ?
            GROUP BY t.id
        `, [id]);

        if (tenants.length === 0) {
            throw new AppError('RES-001', 'Cliente não encontrado');
        }

        res.json(tenants[0]);
    } catch (error) {
        next(error);
    }
};

/**
 * Get users for a specific tenant
 * @route GET /api/tenants/:id/users
 * @access Super User only
 */
exports.getUsers = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem listar usuários de clientes');
        }

        const { id } = req.params;

        // Check if tenant exists
        const [tenant] = await db.query('SELECT id FROM tenants WHERE id = ?', [id]);
        if (tenant.length === 0) {
            throw new AppError('RES-001', 'Cliente não encontrado');
        }

        const [users] = await db.query(`
            SELECT 
                u.id, u.first_name, u.last_name, u.email, u.status, u.last_login_at,
                r.id as role_id, r.name as role_name
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE u.tenant_id = ? AND u.deleted_at IS NULL
            ORDER BY u.first_name ASC
        `, [id]);

        // Format response
        const formattedUsers = users.map(user => ({
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            status: user.status,
            last_login_at: user.last_login_at,
            role: user.role_id ? {
                id: user.role_id,
                name: user.role_name
            } : null
        }));

        res.json({
            users: formattedUsers,
            total: formattedUsers.length
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create new tenant
 * @route POST /api/tenants
 * @access Super User only
 */
exports.create = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem criar clientes');
        }

        const {
            name,
            slug,
            legacy_db_name,
            module_settings,
            contact_name,
            contact_email,
            contact_phone,
            cnpj,
            status = 'trial',
            plan = 'free',
            max_users = 5,
            max_products = 100,
            address_street,
            address_city,
            address_state,
            address_zip,
            address_country = 'Brasil'
        } = req.body;

        const moduleSettingsJson =
            module_settings === undefined ? null : normalizeModuleSettingsInput(module_settings);

        // Validations
        if (!name || !contact_email) {
            throw new AppError('VAL-002', 'Nome e email de contato são obrigatórios');
        }

        // Check if slug already exists
        if (slug) {
            const [existing] = await db.query('SELECT id FROM tenants WHERE slug = ?', [slug]);
            if (existing.length > 0) {
                throw new AppError('VAL-003', 'Slug já está em uso');
            }
        }

        // Generate slug if not provided
        const finalSlug = slug || name.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        const [result] = await db.query(`
            INSERT INTO tenants (
                name, slug, legacy_db_name, module_settings,
                contact_name, contact_email, contact_phone,
                cnpj, status, plan, max_users, max_products,
                address_street, address_city, address_state, address_zip, address_country
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name, finalSlug,
            legacy_db_name != null ? legacy_db_name : null,
            moduleSettingsJson,
            contact_name, contact_email, contact_phone,
            cnpj, status, plan, max_users, max_products,
            address_street, address_city, address_state, address_zip, address_country
        ]);

        // Audit log
        await logAudit(
            req.user.id,
            'CREATE',
            'tenants',
            result.insertId,
            null,
            { name, slug: finalSlug, status, plan }
        );

        // Fetch plan ID based on plan code
        const [planRecords] = await db.query('SELECT id FROM plans WHERE code = ?', [plan.toUpperCase()]);
        if (planRecords.length > 0) {
            const planId = planRecords[0].id;
            // Create corresponding subscription
            await db.query(`
                INSERT INTO subscriptions (tenant_id, plan_id, status)
                VALUES (?, ?, ?)
            `, [result.insertId, planId, status]);
        }


        // Get created tenant
        const [tenants] = await db.query('SELECT * FROM tenants WHERE id = ?', [result.insertId]);

        res.status(201).json({
            message: 'Cliente criado com sucesso',
            tenant: tenants[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update tenant
 * @route PUT /api/tenants/:id
 * @access Super User only
 */
exports.update = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem atualizar clientes');
        }

        const { id } = req.params;
        const {
            name,
            legacy_db_name,
            module_settings,
            contact_name,
            contact_email,
            contact_phone,
            cnpj,
            status,
            plan,
            max_users,
            max_products,
            address_street,
            address_city,
            address_state,
            address_zip,
            address_country
        } = req.body;

        const moduleSettingsUpdate = normalizeModuleSettingsInput(module_settings);

        // Get current tenant
        const [current] = await db.query('SELECT * FROM tenants WHERE id = ?', [id]);
        if (current.length === 0) {
            throw new AppError('RES-001', 'Cliente não encontrado');
        }

        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (legacy_db_name !== undefined) { updates.push('legacy_db_name = ?'); params.push(legacy_db_name || null); }
        if (module_settings !== undefined) { updates.push('module_settings = ?'); params.push(moduleSettingsUpdate); }
        if (contact_name !== undefined) { updates.push('contact_name = ?'); params.push(contact_name); }
        if (contact_email !== undefined) { updates.push('contact_email = ?'); params.push(contact_email); }
        if (contact_phone !== undefined) { updates.push('contact_phone = ?'); params.push(contact_phone); }
        if (cnpj !== undefined) { updates.push('cnpj = ?'); params.push(cnpj); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (plan !== undefined) { updates.push('plan = ?'); params.push(plan); }
        if (max_users !== undefined) { updates.push('max_users = ?'); params.push(max_users); }
        if (max_products !== undefined) { updates.push('max_products = ?'); params.push(max_products); }
        if (address_street !== undefined) { updates.push('address_street = ?'); params.push(address_street); }
        if (address_city !== undefined) { updates.push('address_city = ?'); params.push(address_city); }
        if (address_state !== undefined) { updates.push('address_state = ?'); params.push(address_state); }
        if (address_zip !== undefined) { updates.push('address_zip = ?'); params.push(address_zip); }
        if (address_country !== undefined) { updates.push('address_country = ?'); params.push(address_country); }

        if (updates.length === 0) {
            throw new AppError('VAL-002', 'Nenhum campo para atualizar');
        }

        params.push(id);

        await db.query(
            `UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Audit log
        await logAudit(
            req.user.id,
            'UPDATE',
            'tenants',
            id,
            current[0],
            req.body
        );

        // Get updated tenant
        const [tenants] = await db.query('SELECT * FROM tenants WHERE id = ?', [id]);

        res.json({
            message: 'Cliente atualizado com sucesso',
            tenant: tenants[0]
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete (deactivate) tenant
 * @route DELETE /api/tenants/:id
 * @access Super User only
 */
exports.delete = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem desativar clientes');
        }

        const { id } = req.params;

        // Get current tenant
        const [current] = await db.query('SELECT * FROM tenants WHERE id = ?', [id]);
        if (current.length === 0) {
            throw new AppError('RES-001', 'Cliente não encontrado');
        }

        // Deactivate instead of delete
        await db.query('UPDATE tenants SET status = ? WHERE id = ?', ['inactive', id]);

        // Audit log
        await logAudit(
            req.user.id,
            'DELETE',
            'tenants',
            id,
            current[0],
            { status: 'inactive' }
        );

        res.json({
            message: 'Cliente desativado com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get tenant statistics
 * @route GET /api/tenants/:id/stats
 * @access Super User only
 */
exports.getStats = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem visualizar estatísticas');
        }

        const { id } = req.params;

        const [stats] = await db.query(`
            SELECT 
                t.max_users,
                t.max_products,
                COUNT(DISTINCT u.id) as total_users,
                COUNT(DISTINCT CASE WHEN u.status = 'active' THEN u.id END) as active_users,
                COUNT(DISTINCT CASE WHEN u.status = 'inactive' THEN u.id END) as inactive_users,
                MAX(u.last_login_at) as last_user_login
            FROM tenants t
            LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
            WHERE t.id = ?
            GROUP BY t.id
        `, [id]);

        if (stats.length === 0) {
            throw new AppError('RES-001', 'Cliente não encontrado');
        }

        res.json(stats[0]);
    } catch (error) {
        next(error);
    }
};

/**
 * Helper: Format bytes to human readable format
 */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Calculate database size for a tenant using proportional multi-table approach
 * Provides ~75-80% accuracy with excellent performance
 */
async function calculateTenantDatabaseSize(tenantId) {
    // Tables that contain tenant-specific data
    const tenantTables = [
        { name: 'users', column: 'tenant_id' },
        { name: 'audit_log', column: 'tenant_id' }
    ];

    // Tables related via users (need JOIN)
    const relatedTables = [
        { name: 'sessions', column: 'user_id' },
        { name: 'user_roles', column: 'user_id' }
    ];

    let totalSize = 0;
    const tableBreakdown = {};

    // 1. Get actual table sizes from information_schema
    const [tableSizes] = await db.query(`
        SELECT 
            TABLE_NAME,
            DATA_LENGTH + INDEX_LENGTH as table_size,
            TABLE_ROWS as row_count
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?, ?, ?, ?)
    `, ['users', 'audit_log', 'sessions', 'user_roles']);

    const sizeMap = {};
    tableSizes.forEach(t => {
        sizeMap[t.TABLE_NAME] = {
            size: parseInt(t.table_size),
            rows: parseInt(t.row_count)
        };
    });

    // 2. Calculate proportional size for direct tenant tables
    for (const table of tenantTables) {
        const [rows] = await db.query(`
            SELECT COUNT(*) as count
            FROM ${table.name}
            WHERE ${table.column} = ?
        `, [tenantId]);

        const tenantRows = parseInt(rows[0].count);
        const tableInfo = sizeMap[table.name];

        if (tableInfo && tableInfo.rows > 0) {
            const proportion = tenantRows / tableInfo.rows;
            const tenantTableSize = Math.round(tableInfo.size * proportion);
            tableBreakdown[table.name] = tenantTableSize;
            totalSize += tenantTableSize;
        }
    }

    // 3. Calculate proportional size for related tables
    for (const table of relatedTables) {
        const [rows] = await db.query(`
            SELECT COUNT(*) as count
            FROM ${table.name} t
            INNER JOIN users u ON t.${table.column} = u.id
            WHERE u.tenant_id = ?
        `, [tenantId]);

        const tenantRows = parseInt(rows[0].count);
        const tableInfo = sizeMap[table.name];

        if (tableInfo && tableInfo.rows > 0) {
            const proportion = tenantRows / tableInfo.rows;
            const tenantTableSize = Math.round(tableInfo.size * proportion);
            tableBreakdown[table.name] = tenantTableSize;
            totalSize += tenantTableSize;
        }
    }

    return {
        tenant_id: tenantId,
        database_size: totalSize,
        table_breakdown: tableBreakdown,
        calculated_at: new Date()
    };
}

/**
 * Get database size for a tenant (from cache or calculate)
 * @route GET /api/tenants/:id/database-size
 * @access Super User only
 */
exports.getDatabaseSize = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem visualizar tamanho do banco');
        }

        const { id } = req.params;
        const forceRecalculate = req.query.force === 'true';

        if (!forceRecalculate) {
            // Try to get from cache
            const [cached] = await db.query(`
                SELECT 
                    tenant_id,
                    database_size,
                    table_breakdown,
                    calculated_at,
                    DATEDIFF(NOW(), calculated_at) as days_old
                FROM tenant_database_size_cache
                WHERE tenant_id = ?
            `, [id]);

            // If cache exists and is less than 30 days old, use it
            if (cached.length > 0 && cached[0].days_old < 30) {
                return res.json({
                    tenant_id: cached[0].tenant_id,
                    database_size: cached[0].database_size,
                    database_size_formatted: formatBytes(cached[0].database_size),
                    table_breakdown: JSON.parse(cached[0].table_breakdown || '{}'),
                    calculated_at: cached[0].calculated_at,
                    days_old: cached[0].days_old,
                    from_cache: true
                });
            }
        }

        // Cache doesn't exist or is old - recalculate
        const sizeInfo = await calculateTenantDatabaseSize(id);

        // Save to cache
        await db.query(`
            INSERT INTO tenant_database_size_cache 
            (tenant_id, database_size, table_breakdown, calculated_at)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                database_size = VALUES(database_size),
                table_breakdown = VALUES(table_breakdown),
                calculated_at = VALUES(calculated_at)
        `, [
            sizeInfo.tenant_id,
            sizeInfo.database_size,
            JSON.stringify(sizeInfo.table_breakdown),
            sizeInfo.calculated_at
        ]);

        res.json({
            ...sizeInfo,
            database_size_formatted: formatBytes(sizeInfo.database_size),
            days_old: 0,
            from_cache: false
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Force recalculation of database size
 * @route POST /api/tenants/:id/calculate-database-size
 * @access Super User only
 */
exports.calculateDatabaseSize = async (req, res, next) => {
    try {
        if (!req.user.isSuperUser) {
            throw new AppError('PERM-001', 'Apenas super usuários podem recalcular tamanho do banco');
        }

        const { id } = req.params;

        // Calculate size
        const sizeInfo = await calculateTenantDatabaseSize(id);

        // Save to cache
        await db.query(`
            INSERT INTO tenant_database_size_cache 
            (tenant_id, database_size, table_breakdown, calculated_at)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                database_size = VALUES(database_size),
                table_breakdown = VALUES(table_breakdown),
                calculated_at = VALUES(calculated_at)
        `, [
            sizeInfo.tenant_id,
            sizeInfo.database_size,
            JSON.stringify(sizeInfo.table_breakdown),
            sizeInfo.calculated_at
        ]);

        // Audit log
        await logAudit(
            req.user.id,
            'CALCULATE',
            'tenant_database_size',
            id,
            null,
            { database_size: sizeInfo.database_size }
        );

        res.json({
            ...sizeInfo,
            database_size_formatted: formatBytes(sizeInfo.database_size),
            message: 'Tamanho do banco calculado com sucesso'
        });
    } catch (error) {
        next(error);
    }
};

const db = require('../config/database');

/**
 * Log an audit event (CO-CEO adaptation from CASH)
 * @param {Object} req - Express request object (to extract user/tenant info)
 * @param {String} action - CREATE, UPDATE, DELETE, READ
 * @param {String} entity - Table name (entradas, saidas, etc)
 * @param {Number} entityId - ID of the record
 * @param {Object} details - JSON object with details (e.g. {old: ..., new: ...})
 * @param {Object} oldData - Complete record before change (for UNDO)
 * @param {Object} newData - Complete record after change (for UNDO)
 */
const logAudit = async (req, action, entity, entityId, details = {}, oldData = null, newData = null) => {
    try {
        if (!req || !req.user) {
            console.warn('⚠️ AuditLogger: No user in request. Skipping log.');
            return;
        }

        const tenantId = req.user.tenantId || req.tenantId;
        const userId = req.user.id;
        const userName = req.user.name || req.user.email || 'Unknown';

        const detailsJson = JSON.stringify(details);
        const oldDataJson = oldData ? JSON.stringify(oldData) : null;
        const newDataJson = newData ? JSON.stringify(newData) : null;

        await db.query(`
            INSERT INTO audit_log (tenant_id, user_id, action, resource, resource_id, old_data, new_data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [tenantId, userId, action, entity, entityId, oldDataJson || detailsJson, newDataJson]);

    } catch (error) {
        console.error('❌ AuditLogger Error:', error.message);
        // Do not throw, so main flow isn't interrupted
    }
};

module.exports = { logAudit };

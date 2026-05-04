const db = require('../config/database');
const { getBusinessDaysDifference, addBusinessDays } = require('./businessDaysUtils');

/**
 * Validates if a date is within the allowed range based on system settings
 * @param {Date|string} dateToValidate - The date to validate
 * @param {number} projectId - The project ID to get settings for
 * @param {string} userRole - The user's role ('master' or 'user')
 * @returns {Promise<{isValid: boolean, error: string|null, details: object}>}
 */
async function validateDateWithinRange(dateToValidate, projectId, userRole = 'user') {
    try {
        // Convert to Date object if string
        const date = typeof dateToValidate === 'string'
            ? new Date(dateToValidate)
            : dateToValidate;

        if (isNaN(date.getTime())) {
            return {
                isValid: false,
                error: 'Data inválida',
                details: null
            };
        }

        // Get system settings for the project
        const [settings] = await db.query(
            'SELECT numero_dias, unlock_expires_at FROM system_settings WHERE project_id = ?',
            [projectId]
        );

        // If no settings found, initialize with defaults
        if (settings.length === 0) {
            await db.query(
                'INSERT INTO system_settings (project_id, numero_dias, tempo_minutos_liberacao) VALUES (?, 2, 15)',
                [projectId]
            );
            return validateDateWithinRange(dateToValidate, projectId);
        }

        const config = settings[0];
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Start of today

        // Check if unlock is active - BUT ONLY FOR MASTER
        if (config.unlock_expires_at) {
            const unlockExpires = new Date(config.unlock_expires_at);
            if (unlockExpires > new Date()) {
                // Only MASTER can use unlock to modify old dates
                if (userRole === 'master') {
                    return {
                        isValid: true,
                        error: null,
                        details: {
                            unlocked: true,
                            expiresAt: unlockExpires,
                            masterUnlock: true
                        }
                    };
                }
                // For regular users, unlock has no effect - continue validation
            }
        }

        // Normalize date for comparison (midnight)
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);

        // Rule 1: Cannot be in the future
        if (dateOnly > now) {
            return {
                isValid: false,
                error: 'Data real não pode ser uma data futura',
                details: {
                    maxDate: now,
                    providedDate: dateOnly
                }
            };
        }

        // Rule 2: Cannot be older than (today - numero_dias BUSINESS DAYS)
        // Calculate business days difference between provided date and today
        const businessDaysDiff = getBusinessDaysDifference(dateOnly, now);

        // If the difference is greater than allowed business days, reject
        if (businessDaysDiff > config.numero_dias) {
            // Calculate the minimum allowed date (going back N business days from today)
            const minDate = new Date(now);
            // Go back to find the date that is exactly numero_dias business days ago
            let daysBack = 0;
            let tempDate = new Date(now);
            while (daysBack < config.numero_dias) {
                tempDate.setDate(tempDate.getDate() - 1);
                const { isBusinessDay } = require('./businessDaysUtils');
                if (isBusinessDay(tempDate)) {
                    daysBack++;
                }
            }

            const minDateStr = tempDate.toLocaleDateString('pt-BR');
            return {
                isValid: false,
                error: `Data fora do período permitido. Permitido: de ${minDateStr} até hoje (${config.numero_dias} dias úteis)`,
                details: {
                    minDate: tempDate,
                    maxDate: now,
                    providedDate: dateOnly,
                    numeroDiasUteis: config.numero_dias,
                    businessDaysDiff: businessDaysDiff
                }
            };
        }

        // Date is valid
        return {
            isValid: true,
            error: null,
            details: {
                maxDate: now,
                unlocked: false,
                businessDaysDiff: businessDaysDiff
            }
        };

    } catch (error) {
        console.error('Error validating date:', error);
        return {
            isValid: false,
            error: 'Erro ao validar data',
            details: { originalError: error.message }
        };
    }
}

/**
 * Check if unlock is currently active for a project
 * @param {number} projectId - The project ID
 * @returns {Promise<{isUnlocked: boolean, expiresAt: Date|null}>}
 */
async function checkUnlockStatus(projectId) {
    try {
        const [settings] = await db.query(
            'SELECT unlock_expires_at FROM system_settings WHERE project_id = ?',
            [projectId]
        );

        if (settings.length === 0 || !settings[0].unlock_expires_at) {
            return { isUnlocked: false, expiresAt: null };
        }

        const unlockExpires = new Date(settings[0].unlock_expires_at);
        const now = new Date();

        if (unlockExpires > now) {
            return { isUnlocked: true, expiresAt: unlockExpires };
        }

        return { isUnlocked: false, expiresAt: null };
    } catch (error) {
        console.error('Error checking unlock status:', error);
        return { isUnlocked: false, expiresAt: null };
    }
}

module.exports = {
    validateDateWithinRange,
    checkUnlockStatus
};


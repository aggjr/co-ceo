/**
 * Formatters - Shared formatting utilities
 * Centralizes data formatting across the application
 */

/**
 * Formats a date string for display
 * @param {string} dateString - ISO date string
 * @param {boolean} includeTime - Whether to include time
 * @returns {string} Formatted date
 */
export function formatDate(dateString, includeTime = false) {
    if (!dateString) return '-';

    const date = new Date(dateString);

    // Check for invalid date
    if (isNaN(date.getTime())) return '-';

    const dateStr = date.toLocaleDateString('pt-BR');

    if (includeTime) {
        const timeStr = date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        return `${dateStr} ${timeStr}`;
    }

    return dateStr;
}

/**
 * Formats a date string with time
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date and time
 */
export function formatDateTime(dateString) {
    return formatDate(dateString, true);
}

/**
 * Gets the label for a status value
 * @param {string} status - Status value
 * @param {string} type - Type of status (user, tenant)
 * @returns {string} Status label
 */
export function getStatusLabel(status, type = 'user') {
    const labels = {
        user: {
            active: 'Ativo',
            pending: 'Pendente',
            inactive: 'Inativo',
            suspended: 'Suspenso'
        },
        tenant: {
            active: 'Ativo',
            trial: 'Trial',
            inactive: 'Inativo',
            suspended: 'Suspenso'
        }
    };

    return labels[type]?.[status] || status;
}

/**
 * Formats a currency value
 * @param {number} value - Numeric value
 * @returns {string} Formatted currency
 */
export function formatCurrency(value) {
    if (value === null || value === undefined) return 'R$ 0,00';

    const num = parseFloat(value);
    if (isNaN(num)) return 'R$ 0,00';

    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(num);
}

/**
 * Formats a file size in bytes to human readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Version Configuration
 * Central version management for CO-CEO application
 */

export const APP_VERSION = 'v-0.1.90';

/**
 * Get the current application version
 * @returns {string} Current version string
 */
export function getVersion() {
    return APP_VERSION;
}

/**
 * Get version with prefix
 * @param {string} prefix - Prefix to add before version
 * @returns {string} Formatted version string
 */
export function getFormattedVersion(prefix = '') {
    return prefix ? `${prefix} ${APP_VERSION}` : APP_VERSION;
}

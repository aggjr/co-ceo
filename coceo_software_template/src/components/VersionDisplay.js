import { getVersion } from '../utils/version.js';

/**
 * Version Display Component
 * Shows application version in bottom-left corner
 */
export function VersionDisplay() {
    const container = document.createElement('div');
    container.className = 'version-display';
    container.textContent = getVersion();

    return container;
}

/**
 * Initialize version display globally
 * Adds version to body if not already present
 */
export function initVersionDisplay() {
    // Remove existing version display if any
    const existing = document.querySelector('.version-display-global');
    if (existing) {
        existing.remove();
    }

    const versionEl = document.createElement('div');
    versionEl.className = 'version-display-global';
    versionEl.textContent = getVersion();

    document.body.appendChild(versionEl);
}

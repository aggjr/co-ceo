/**
 * API Configuration Utility
 * Provides centralized API endpoint configuration for CO-CEO
 */

/**
 * Get the base URL for API requests
 * @returns {string} The API base URL
 */
export function getApiBaseUrl() {
    // In development, use localhost
    if (import.meta.env.MODE === 'development') {
        return import.meta.env.VITE_API_URL || 'http://localhost:3001';
    }

    // In production, use the same origin
    return window.location.origin;
}

/**
 * Get headers for authenticated requests
 * @returns {Object} Headers object with Authorization token
 */
export function getAuthHeaders() {
    const token = localStorage.getItem('token');

    return {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
    };
}

/**
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint (e.g., '/api/auth/login')
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function apiRequest(endpoint, options = {}) {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}${endpoint}`;

    const defaultOptions = {
        headers: getAuthHeaders(),
        ...options
    };

    return fetch(url, defaultOptions);
}

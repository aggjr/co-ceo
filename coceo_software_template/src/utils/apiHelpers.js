/**
 * API Helpers - Utilities for API requests
 * Centralizes error handling and request logic
 */

import { getApiBaseUrl, getAuthHeaders } from './apiConfig.js';

/**
 * Handles API errors consistently
 * @param {Response} response - Fetch response
 * @throws {Error} If response is not ok
 * @returns {Response} Original response if ok
 */
export async function handleApiError(response) {
    if (!response.ok) {
        let errorMessage = 'Erro na requisição';

        try {
            const error = await response.json();
            errorMessage = error.error?.message || error.message || errorMessage;
        } catch (e) {
            // Response is not JSON, use status text
            errorMessage = response.statusText || errorMessage;
        }

        throw new Error(errorMessage);
    }

    return response;
}

/**
 * Makes an API request with standard error handling
 * @param {string} endpoint - API endpoint (e.g., '/api/users')
 * @param {object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
export async function apiRequest(endpoint, options = {}) {
    const url = `${getApiBaseUrl()}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            ...getAuthHeaders(),
            ...(localStorage.getItem('currentTenantId') ? { 'x-tenant-id': localStorage.getItem('currentTenantId') } : {}),
            ...options.headers
        }
    });

    await handleApiError(response);

    // Handle empty responses (e.g., DELETE)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }

    return null;
}

/**
 * Makes a GET request
 * @param {string} endpoint - API endpoint
 * @returns {Promise<any>} Response data
 */
export async function apiGet(endpoint) {
    return apiRequest(endpoint, { method: 'GET' });
}

/**
 * Makes a POST request
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body
 * @returns {Promise<any>} Response data
 */
export async function apiPost(endpoint, data) {
    return apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

/**
 * Makes a PUT request
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body
 * @returns {Promise<any>} Response data
 */
export async function apiPut(endpoint, data) {
    return apiRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

/**
 * Makes a DELETE request
 * @param {string} endpoint - API endpoint
 * @returns {Promise<any>} Response data
 */
export async function apiDelete(endpoint) {
    return apiRequest(endpoint, { method: 'DELETE' });
}

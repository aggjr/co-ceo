/**
 * Tenant Service - API calls for tenant management
 */

import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiHelpers.js';

export const tenantService = {
    /**
     * Get all tenants
     * @returns {Promise<Array>} List of tenants
     */
    async getTenants() {
        const data = await apiGet('/api/tenants');
        return data.tenants || [];
    },

    /**
     * Create a new tenant
     * @param {object} tenantData - Tenant data
     * @returns {Promise<object>} Created tenant
     */
    async createTenant(tenantData) {
        return await apiPost('/api/tenants', tenantData);
    },

    /**
     * Update an existing tenant
     * @param {number} id - Tenant ID
     * @param {object} tenantData - Updated tenant data
     * @returns {Promise<object>} Updated tenant
     */
    async updateTenant(id, tenantData) {
        return await apiPut(`/api/tenants/${id}`, tenantData);
    },

    /**
     * Delete a tenant
     * @param {number} id - Tenant ID
     * @returns {Promise<void>}
     */
    async deleteTenant(id) {
        return await apiDelete(`/api/tenants/${id}`);
    },

    /**
     * Get tenant statistics
     * @param {number} id - Tenant ID
     * @returns {Promise<object>} Tenant statistics
     */
    async getTenantStats(id) {
        return await apiGet(`/api/tenants/${id}/stats`);
    },

    /**
     * Get users for a specific tenant
     * @param {number} id - Tenant ID
     * @returns {Promise<Array>} List of users
     */
    async getTenantUsers(id) {
        const data = await apiGet(`/api/tenants/${id}/users`);
        return data.users || [];
    }
};

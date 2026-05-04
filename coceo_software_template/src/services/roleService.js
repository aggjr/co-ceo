/**
 * Role Service - API calls for role and permission management
 */

import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiHelpers.js';

export const roleService = {
    /**
     * Get all roles
     * @returns {Promise<Array>} List of roles
     */
    async getRoles() {
        const data = await apiGet('/api/rbac/roles');
        return data.roles || [];
    },

    /**
     * Get all permissions
     * @returns {Promise<Array>} List of permissions
     */
    async getPermissions() {
        const data = await apiGet('/api/rbac/permissions');
        return data.permissions || [];
    },

    /**
     * Create a new role
     * @param {object} roleData - Role data
     * @returns {Promise<object>} Created role
     */
    async createRole(roleData) {
        return await apiPost('/api/rbac/roles', roleData);
    },

    /**
     * Update an existing role
     * @param {number} id - Role ID
     * @param {object} roleData - Updated role data
     * @returns {Promise<object>} Updated role
     */
    async updateRole(id, roleData) {
        return await apiPut(`/api/rbac/roles/${id}`, roleData);
    },

    /**
     * Delete a role
     * @param {number} id - Role ID
     * @returns {Promise<void>}
     */
    async deleteRole(id) {
        return await apiDelete(`/api/rbac/roles/${id}`);
    },

    /**
     * Get permissions for a specific role
     * @param {number} roleId - Role ID
     * @returns {Promise<Array>} List of permissions
     */
    async getRolePermissions(roleId) {
        const data = await apiGet(`/api/rbac/roles/${roleId}/permissions`);
        return data.permissions || [];
    },

    /**
     * Assign permissions to a role
     * @param {number} roleId - Role ID
     * @param {Array<number>} permissionIds - Array of permission IDs
     * @returns {Promise<object>} Result
     */
    async assignPermissions(roleId, permissionIds) {
        return await apiPost(`/api/rbac/roles/${roleId}/permissions`, {
            permission_ids: permissionIds
        });
    }
};

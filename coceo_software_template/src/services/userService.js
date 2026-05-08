/**
 * User Service - API calls for user management
 */

import { apiGet, apiPost, apiPut, apiDelete } from '../utils/apiHelpers.js';

export const userService = {
    /**
     * Get all users
     * @returns {Promise<Array>} List of users
     */
    async getUsers() {
        const data = await apiGet('/api/users');
        return data.users || [];
    },

    /**
     * Get a specific user
     * @param {number} id - User ID
     * @returns {Promise<object>} User data
     */
    async getUser(id) {
        return await apiGet(`/api/users/${id}`);
    },

    /**
     * Create a new user
     * @param {object} userData - User data
     * @returns {Promise<object>} Created user
     */
    async createUser(userData) {
        return await apiPost('/api/users', userData);
    },

    /**
     * Update an existing user
     * @param {number} id - User ID
     * @param {object} userData - Updated user data
     * @returns {Promise<object>} Updated user
     */
    async updateUser(id, userData) {
        return await apiPut(`/api/users/${id}`, userData);
    },

    /**
     * Delete a user
     * @param {number} id - User ID
     * @returns {Promise<void>}
     */
    async deleteUser(id) {
        return await apiDelete(`/api/users/${id}`);
    },

    /**
     * Assign roles to a user
     * @param {number} userId - User ID
     * @param {Array<number>} roleIds - Array of role IDs
     * @returns {Promise<object>} Result
     */
    async assignRoles(userId, roleIds) {
        return await apiPost(`/api/users/${userId}/roles`, { role_ids: roleIds });
    },

    /**
     * Get roles for a specific user
     * @param {number} userId - User ID
     * @returns {Promise<Array>} List of roles
     */
    async getUserRoles(userId) {
        const data = await apiGet(`/api/users/${userId}/roles`);
        return data.roles || [];
    },

    /**
     * Admin reset password (super admin ou admin do mesmo tenant).
     * Não exige a senha atual.
     * @param {number} userId
     * @param {string} newPassword (mín. 8 caracteres)
     */
    async adminResetPassword(userId, newPassword) {
        return await apiPost(`/api/users/${userId}/admin-reset-password`, { newPassword });
    }
};

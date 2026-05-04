import { apiGet } from '../utils/apiHelpers.js';

export const planService = {
    /**
     * Get all active billing plans
     * @returns {Promise<Array>} List of plans
     */
    async getPlans() {
        const data = await apiGet('/api/plans');
        return data.plans || [];
    },

    /**
     * Get modules included in a specific plan
     * @param {number} planId - Plan ID
     * @returns {Promise<Array>} List of modules
     */
    async getPlanModules(planId) {
        const data = await apiGet(`/api/plans/${planId}/modules`);
        return data.modules || [];
    }
};

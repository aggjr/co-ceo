const db = require('../config/database');
const AppError = require('../utils/AppError');

/**
 * Controller to manage Billing Plans and their Modules
 */
exports.getAllPlans = async (req, res, next) => {
    try {
        const [plans] = await db.query(`
            SELECT id, code, name, description, monthly_price, annual_price, limits, is_active, created_at
            FROM plans
            WHERE is_active = 1
            ORDER BY monthly_price ASC
        `);

        res.json({
            status: 'success',
            plans
        });
    } catch (error) {
        next(error);
    }
};

exports.getPlanModules = async (req, res, next) => {
    try {
        const { id } = req.params;

        const [modules] = await db.query(`
            SELECT m.id, m.code, m.name, m.description
            FROM modules m
            JOIN plan_modules pm ON m.id = pm.module_id
            WHERE pm.plan_id = ? AND m.is_active = 1
        `, [id]);

        res.json({
            status: 'success',
            modules
        });
    } catch (error) {
        next(error);
    }
};

const AppError = require('../utils/AppError');

/**
 * Error handling middleware
 * Catches all errors and sends appropriate response
 */
const errorMiddleware = (err, req, res, next) => {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    console.error('Code:', err.code);
    console.error('Stack:', err.stack);

    // Default error
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Erro interno do servidor';
    let code = err.code || 'SRV-001';

    // Handle known error codes
    if (AppError.CODES[code]) {
        statusCode = AppError.CODES[code].status;
        // Only use default message if current message is the code
        if (message === code) {
            message = AppError.CODES[code].message;
        }
    }

    // Handle MySQL errors
    if (err.code && err.code.startsWith('ER_')) {
        statusCode = 500;
        code = 'SRV-002';

        // Specific MySQL errors
        if (err.code === 'ER_DUP_ENTRY') {
            statusCode = 409;
            code = 'RES-002';
            message = 'Registro duplicado';
        } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            statusCode = 400;
            code = 'VAL-001';
            message = 'Referência inválida';
        } else if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            statusCode = 409;
            code = 'RES-003';
            message = 'Não é possível excluir. Registro em uso';
        }
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        code = 'AUTH-002';
        message = 'Token inválido';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        code = 'AUTH-005';
        message = 'Sessão expirada';
    }

    // Send error response
    res.status(statusCode).json({
        error: {
            code,
            message,
            ...(process.env.NODE_ENV === 'development' && {
                stack: err.stack,
                details: err
            })
        }
    });
};

module.exports = errorMiddleware;

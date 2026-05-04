class AppError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message || code);
        this.code = code;
        this.statusCode = statusCode;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

// Common error codes
AppError.CODES = {
    // Validation errors
    'VAL-001': { message: 'Dados inválidos', status: 400 },
    'VAL-002': { message: 'Campos obrigatórios faltando', status: 400 },
    'VAL-003': { message: 'Formato de email inválido', status: 400 },
    'VAL-004': { message: 'Senha deve ter no mínimo 8 caracteres', status: 400 },

    // Authentication errors
    'AUTH-001': { message: 'Token não fornecido', status: 401 },
    'AUTH-002': { message: 'Token inválido ou expirado', status: 401 },
    'AUTH-003': { message: 'Email ou senha incorretos', status: 401 },
    'AUTH-004': { message: 'Usuário não autorizado', status: 403 },
    'AUTH-005': { message: 'Sessão expirada', status: 401 },

    // Permission errors
    'PERM-001': { message: 'Sem permissão para acessar este recurso', status: 403 },
    'PERM-002': { message: 'Sem permissão para esta ação', status: 403 },
    'PERM-003': { message: 'Sem permissão para acessar este campo', status: 403 },

    // Resource errors
    'RES-001': { message: 'Recurso não encontrado', status: 404 },
    'RES-002': { message: 'Recurso já existe', status: 409 },
    'RES-003': { message: 'Recurso em uso', status: 409 },

    // Tenant errors
    'TEN-001': { message: 'Tenant não encontrado', status: 404 },
    'TEN-002': { message: 'Tenant inativo ou suspenso', status: 403 },
    'TEN-003': { message: 'Limite de usuários atingido', status: 403 },
    'TEN-004': { message: 'Limite de recursos atingido', status: 403 },

    // Server errors
    'SRV-001': { message: 'Erro interno do servidor', status: 500 },
    'SRV-002': { message: 'Erro de banco de dados', status: 500 },
    'SRV-003': { message: 'Serviço temporariamente indisponível', status: 503 }
};

module.exports = AppError;

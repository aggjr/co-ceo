const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../.env' });

async function seedMissingPermissions() {
    console.log('Starting migration to add missing permissions...');

    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'co_ceo_db'
        });

        const statements = [
            // TIPO DE SAIDA
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_saida', 'read', NULL, 'Visualizar Tipos de Saída', 'Ver categorias de tipo de saída', TRUE)",
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_saida', 'create', NULL, 'Criar Tipos de Saída', 'Criar categorias de tipo de saída', TRUE)",
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_saida', 'update', NULL, 'Editar Tipos de Saída', 'Editar categorias de tipo de saída', TRUE)",
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_saida', 'delete', NULL, 'Excluir Tipos de Saída', 'Excluir categorias de tipo de saída', TRUE)",
            // TIPO DE PRODUCAO REVENDA
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_producao', 'read', NULL, 'Visualizar Tipos de Produção/Compras', 'Ver categorias de tipo de produção e revenda', TRUE)",
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_producao', 'create', NULL, 'Criar Tipos de Produção/Compras', 'Criar categorias de tipo de produção', TRUE)",
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_producao', 'update', NULL, 'Editar Tipos de Produção/Compras', 'Editar categorias de tipo de produção', TRUE)",
            "INSERT IGNORE INTO permissions (module, resource, action, field, name, description, is_system_permission) VALUES ('CASH', 'tipo_producao', 'delete', NULL, 'Excluir Tipos de Produção/Compras', 'Excluir categorias de tipo de produção', TRUE)"
        ];

        for (const stmt of statements) {
            await connection.query(stmt);
        }

        console.log('Missing permissions inserted successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

seedMissingPermissions();

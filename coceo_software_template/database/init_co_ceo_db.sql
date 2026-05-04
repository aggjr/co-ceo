-- =============================================================================
-- CO-CEO aplicativo: esquema MySQL dedicado (nome = co_ceo_db)
-- Execute como root (ou usuário com permissão CREATE):
--   mysql -u root -p < database/init_co_ceo_db.sql
-- Ou no cliente MySQL: SOURCE .../init_co_ceo_db.sql;
-- =============================================================================

CREATE DATABASE IF NOT EXISTS co_ceo_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE co_ceo_db;

-- ---------------------------------------------------------------------------
-- Multi-tenant + auth + RBAC + auditoria
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  legacy_db_name VARCHAR(191) NULL COMMENT 'Schema MySQL legado (alinhar com LEGACY_MYSQL_DATABASE no .env stockspin)',
  contact_name VARCHAR(255) NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(64) NULL,
  cnpj VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  plan VARCHAR(64) NOT NULL DEFAULT 'FREE',
  max_users INT NOT NULL DEFAULT 5,
  max_products INT NOT NULL DEFAULT 100,
  address_street VARCHAR(255) NULL,
  address_city VARCHAR(128) NULL,
  address_state VARCHAR(64) NULL,
  address_zip VARCHAR(32) NULL,
  address_country VARCHAR(64) NOT NULL DEFAULT 'Brasil',
  module_settings JSON NULL COMMENT 'Config por módulo (ex.: STOCKSPIN.staticBaseUrl)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenants_slug (slug),
  KEY idx_tenants_status (status),
  KEY idx_tenants_plan (plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(128) NOT NULL,
  last_name VARCHAR(128) NOT NULL,
  phone VARCHAR(64) NULL,
  avatar_url VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  is_super_user TINYINT(1) NOT NULL DEFAULT 0,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL DEFAULT NULL,
  language VARCHAR(16) NULL DEFAULT 'pt-BR',
  timezone VARCHAR(64) NULL DEFAULT 'America/Sao_Paulo',
  preferences JSON NULL,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  last_login_ip VARCHAR(64) NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_tenant (tenant_id),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  tenant_id INT NULL,
  data JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  slug VARCHAR(128) NOT NULL,
  description TEXT NULL,
  level INT NOT NULL DEFAULT 10,
  is_system_role TINYINT(1) NOT NULL DEFAULT 0,
  tenant_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_slug_tenant (slug, tenant_id),
  KEY idx_roles_tenant (tenant_id),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module VARCHAR(50) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  field VARCHAR(100) NULL,
  name VARCHAR(200) NULL,
  description TEXT NULL,
  is_system_permission TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_perm_module (module),
  KEY idx_perm_resource (resource)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  granted_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_perm (role_id, permission_id),
  KEY idx_rp_permission (permission_id),
  KEY idx_rp_granted_by (granted_by),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rp_granted_by FOREIGN KEY (granted_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  granted_by INT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, role_id),
  KEY idx_ur_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ur_granted_by FOREIGN KEY (granted_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NULL,
  user_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  resource_id INT NULL,
  old_data JSON NULL,
  new_data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_tenant (tenant_id),
  KEY idx_audit_user (user_id),
  KEY idx_audit_resource (resource, resource_id),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Planos / módulos (billing) — alinhado à migration 20260224 (+ STOCKSPIN)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'e.g., STOCKSPIN, CASH',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO modules (code, name, description) VALUES
('STOCKSPIN', 'Stockspin (CO-CEO)', 'Decisão de estoque, compras e telas analíticas CO-CEO'),
('CASH', 'Financeiro (Cash)', 'Gestão financeira, contas a pagar e receber'),
('SUPPLY', 'Suprimentos (Supply)', 'Gestão de fornecedores e compras'),
('SALES', 'Vendas (Sales)', 'Gestão de clientes e pedidos'),
('PROD', 'Produção (Production)', 'Gestão de produção livre');

CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'e.g., FREE, BASIC, PRO, ENTERPRISE',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  monthly_price DECIMAL(10,2) DEFAULT 0.00,
  annual_price DECIMAL(10,2) DEFAULT 0.00,
  limits JSON COMMENT '{"max_users": 5, "storage_gb": 10}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO plans (code, name, monthly_price, limits) VALUES
('FREE', 'Gratuito', 0.00, '{"max_users": 2}'),
('BASIC', 'Básico', 99.90, '{"max_users": 5}'),
('PRO', 'Profissional', 299.90, '{"max_users": 15}'),
('ENTERPRISE', 'Corporativo', 999.90, '{"max_users": 100}');

CREATE TABLE IF NOT EXISTS plan_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  module_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_plan_module (plan_id, module_id),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p, modules m WHERE p.code = 'FREE' AND m.code IN ('STOCKSPIN');

INSERT IGNORE INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p, modules m WHERE p.code = 'BASIC' AND m.code IN ('STOCKSPIN', 'SUPPLY');

INSERT IGNORE INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p CROSS JOIN modules m WHERE p.code IN ('PRO', 'ENTERPRISE');

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  plan_id INT NOT NULL,
  status ENUM('active', 'canceled', 'suspended', 'trial') DEFAULT 'trial',
  current_period_start TIMESTAMP NULL,
  current_period_end TIMESTAMP NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_status (status),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  subscription_id INT,
  invoice_number VARCHAR(100) UNIQUE,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending', 'paid', 'failed', 'canceled') DEFAULT 'pending',
  due_date DATE NOT NULL,
  paid_at TIMESTAMP NULL,
  payment_url VARCHAR(500),
  pdf_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_status (status),
  INDEX idx_due_date (due_date),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_database_size_cache (
  tenant_id INT NOT NULL,
  database_size BIGINT NOT NULL DEFAULT 0,
  table_breakdown JSON NULL COMMENT 'Breakdown by table',
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_calculated_at (calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed mínimo: 2 clientes — (1) demonstração para testes · (2) SARON CORTINAS (legado real).
-- id=1 Cliente demonstração — contato admin@demo.coceo (sem usuário seed; USUÁRIOS pode ficar 0).
-- id=2 SARON — administrador admin@saroncortinas.com.br | Senha inicial: 12345678 (troque após o 1º login).
-- legacy_db_name da SARON deve coincidir com LEGACY_MYSQL_DATABASE no .env da raiz stockspin.
-- Base antiga só com demo: rode database/patch_upsert_demo_saron_tenants.sql (idempotente).
-- ---------------------------------------------------------------------------

INSERT INTO tenants (
  id, name, slug, legacy_db_name, contact_name, contact_email, contact_phone,
  cnpj, status, plan, max_users, max_products,
  address_street, address_city, address_state, address_zip, address_country,
  module_settings
) VALUES
(
  1,
  'Cliente demonstração',
  'demo',
  NULL,
  'Cliente demonstração',
  'admin@demo.coceo',
  NULL,
  NULL,
  'active',
  'FREE',
  50,
  10000,
  NULL, NULL, NULL, NULL, 'Brasil',
  NULL
),
(
  2,
  'SARON CORTINAS',
  'saron-cortinas',
  'stockspin_core_db_saron',
  'SARON CORTINAS',
  'admin@saroncortinas.com.br',
  NULL,
  NULL,
  'active',
  'FREE',
  50,
  10000,
  NULL, NULL, NULL, NULL, 'Brasil',
  NULL
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  slug = VALUES(slug),
  legacy_db_name = VALUES(legacy_db_name),
  contact_name = VALUES(contact_name),
  contact_email = VALUES(contact_email),
  contact_phone = VALUES(contact_phone),
  cnpj = VALUES(cnpj),
  status = VALUES(status),
  plan = VALUES(plan),
  max_users = VALUES(max_users),
  max_products = VALUES(max_products),
  address_street = VALUES(address_street),
  address_city = VALUES(address_city),
  address_state = VALUES(address_state),
  address_zip = VALUES(address_zip),
  address_country = VALUES(address_country),
  module_settings = VALUES(module_settings);

INSERT IGNORE INTO subscriptions (tenant_id, plan_id, status)
SELECT t.id, p.id, 'active'
FROM tenants t
JOIN plans p ON UPPER(t.plan) = p.code
WHERE t.id IN (1, 2)
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);

INSERT IGNORE INTO roles (id, name, slug, description, level, is_system_role, tenant_id) VALUES
(1, 'Super Administrador', 'super-admin', 'Acesso global ao painel e clientes', 1000, 1, NULL),
(2, 'Administrador do tenant', 'tenant-admin', 'Administra usuários do próprio cliente', 100, 1, NULL);

-- bcrypt cost 10 — SARON (tenant 2): admin@saroncortinas.com.br | senha inicial 12345678
INSERT IGNORE INTO users (
  id, tenant_id, email, password_hash, first_name, last_name,
  status, is_super_user, email_verified
) VALUES (
  1,
  2,
  'admin@saroncortinas.com.br',
  '$2b$10$w9pY9alRRb0lpzsp0xhwX.BNeZREcFwOzZ230q0lU3iww0iGkGlGm',
  'Administrador',
  'SARON',
  'active',
  0,
  1
);

-- Super usuário interno (personificação de tenant no cockpit: cabeçalho "Visualizar como").
-- admin@coceo.com.br | senha inicial Dani160779! (troque após o 1º login).
INSERT IGNORE INTO users (
  id, tenant_id, email, password_hash, first_name, last_name,
  status, is_super_user, email_verified
) VALUES (
  2,
  NULL,
  'admin@coceo.com.br',
  '$2b$10$6MaW8sWmSyPWdoCpxdp5EOX.s5/VCeL1HPzLuoU87aM/5DQgyMME2',
  'Super',
  'Admin',
  'active',
  1,
  1
);

INSERT IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES
(1, 2, NULL),
(2, 1, NULL);

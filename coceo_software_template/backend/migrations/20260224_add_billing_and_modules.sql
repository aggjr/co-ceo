-- ============================================
-- VORTEX - Billing & Modules Migration
-- Adds support for Plans, Modules, Subscriptions, and Invoices
-- ============================================

-- 1. MODULES (Módulos do Sistema)
CREATE TABLE IF NOT EXISTS modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'e.g., CASH, SUPPLY, SALES',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default modules
INSERT IGNORE INTO modules (code, name, description) VALUES
('CASH', 'Financeiro (Cash)', 'Gestão financeira, contas a pagar e receber'),
('SUPPLY', 'Suprimentos (Supply)', 'Gestão de fornecedores e compras'),
('SALES', 'Vendas (Sales)', 'Gestão de clientes e pedidos'),
('PROD', 'Produção (Production)', 'Gestão de produção livre');

-- 2. PLANS (Planos de Assinatura)
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

-- Insert default plans
INSERT IGNORE INTO plans (code, name, monthly_price, limits) VALUES
('FREE', 'Gratuito', 0.00, '{"max_users": 2}'),
('BASIC', 'Básico', 99.90, '{"max_users": 5}'),
('PRO', 'Profissional', 299.90, '{"max_users": 15}'),
('ENTERPRISE', 'Corporativo', 999.90, '{"max_users": 100}');

-- 3. PLAN_MODULES (Relação Plano x Módulo)
CREATE TABLE IF NOT EXISTS plan_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  module_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_plan_module (plan_id, module_id),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link logic: FREE gets CASH. BASIC gets CASH+SUPPLY. PRO gets all.
INSERT IGNORE INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p, modules m WHERE p.code = 'FREE' AND m.code IN ('CASH');

INSERT IGNORE INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p, modules m WHERE p.code = 'BASIC' AND m.code IN ('CASH', 'SUPPLY');

INSERT IGNORE INTO plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM plans p, modules m WHERE p.code IN ('PRO', 'ENTERPRISE');

-- 4. SUBSCRIPTIONS (Assinaturas dos Clientes)
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

-- Migrate existing tenants to have a subscription based on their ENUM plan
INSERT IGNORE INTO subscriptions (tenant_id, plan_id, status)
SELECT t.id, p.id, t.status
FROM tenants t
JOIN plans p ON UPPER(t.plan) = p.code
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);

-- 5. INVOICES (Faturas)
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

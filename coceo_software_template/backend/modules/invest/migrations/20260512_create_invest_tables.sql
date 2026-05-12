-- ============================================================================
-- INVEST Module — Migration SQL
-- Execute em: co_ceo_db
-- Usuário: admin / senha: 301c59c3db1f911fc59b
-- ============================================================================
USE co_ceo_db;

-- 1. Posições (CACHE derivado de transactions — nunca editar manualmente)
CREATE TABLE IF NOT EXISTS invest_positions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT NOT NULL,
  asset_type    ENUM('equity','option','fii','fixed_income','treasury') NOT NULL DEFAULT 'equity',
  ticker        VARCHAR(20) NOT NULL,
  name          VARCHAR(255) NULL,
  quantity      DECIMAL(18,6) NOT NULL DEFAULT 0,
  average_price DECIMAL(18,6) NOT NULL DEFAULT 0,
  total_cost    DECIMAL(18,6) NOT NULL DEFAULT 0,
  first_buy     DATE NULL,
  last_updated_from_tx TIMESTAMP NULL,
  is_short      TINYINT(1) NOT NULL DEFAULT 0,
  metadata      JSON NULL,
  notes         TEXT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pos_tenant_ticker (tenant_id, ticker),
  KEY idx_pos_tenant (tenant_id),
  KEY idx_pos_ticker (ticker),
  CONSTRAINT fk_pos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Transações (SOURCE OF TRUTH — imutável, append-only)
CREATE TABLE IF NOT EXISTS invest_transactions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id        INT NOT NULL,
  position_id      INT NULL,
  transaction_type ENUM('buy','sell','dividend','jcp','redemption','subscription') NOT NULL,
  asset_type       ENUM('equity','option','fii','fixed_income','treasury') NOT NULL DEFAULT 'equity',
  date             DATE NOT NULL,
  ticker           VARCHAR(20) NOT NULL,
  quantity         DECIMAL(18,6) NOT NULL DEFAULT 0,
  price            DECIMAL(18,6) NOT NULL DEFAULT 0,
  fees             DECIMAL(18,6) NOT NULL DEFAULT 0,
  ir_withheld      DECIMAL(18,6) NOT NULL DEFAULT 0,
  metadata         JSON NULL,
  notes            TEXT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_txn_tenant   (tenant_id),
  KEY idx_txn_date     (date),
  KEY idx_txn_ticker   (ticker),
  KEY idx_txn_position (position_id),
  CONSTRAINT fk_txn_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_position FOREIGN KEY (position_id) REFERENCES invest_positions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Proventos (dividendos, JCPs, rendimentos FII)
CREATE TABLE IF NOT EXISTS invest_dividends (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT NOT NULL,
  ticker          VARCHAR(20) NOT NULL,
  dividend_type   ENUM('dividend','jcp','fii_income','interest') NOT NULL,
  ex_date         DATE NULL,
  payment_date    DATE NOT NULL,
  value_per_share DECIMAL(18,6) NOT NULL,
  quantity_held   DECIMAL(18,6) NOT NULL,
  ir_withheld     DECIMAL(18,6) NOT NULL DEFAULT 0,
  notes           TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_div_tenant  (tenant_id),
  KEY idx_div_payment (payment_date),
  KEY idx_div_ticker  (ticker),
  CONSTRAINT fk_div_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tipos de despesa (catálogo — sistema + custom por tenant)
CREATE TABLE IF NOT EXISTS invest_expense_types (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT NULL,
  code          VARCHAR(50) NOT NULL,
  name          VARCHAR(128) NOT NULL,
  description   TEXT NULL,
  affects_cost  TINYINT(1) NOT NULL DEFAULT 1,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  is_system     TINYINT(1) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expense_type_code_tenant (code, tenant_id),
  KEY idx_et_tenant (tenant_id),
  CONSTRAINT fk_et_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: tipos pré-definidos pelo sistema
INSERT IGNORE INTO invest_expense_types (tenant_id, code, name, description, affects_cost, is_system) VALUES
(NULL, 'EMOLUMENTO',        'Emolumento B3',               'Taxa cobrada pela B3 sobre cada operação', 1, 1),
(NULL, 'CORRETAGEM',        'Corretagem',                  'Taxa da corretora por execução da ordem', 1, 1),
(NULL, 'TAXA_LIQUIDACAO',   'Taxa de Liquidação',          'Taxa de liquidação B3/CBLC', 1, 1),
(NULL, 'IOF',               'IOF',                         'Imposto sobre Operações Financeiras', 1, 1),
(NULL, 'ISS',               'ISS sobre Corretagem',        'ISS incidente sobre a corretagem', 1, 1),
(NULL, 'JUROS',             'Juros',                       'Juros de margem ou atraso', 1, 1),
(NULL, 'MULTA',             'Multa',                       'Multa contratual ou regulatória', 1, 1),
(NULL, 'TARIFA_CUSTODIA',   'Tarifa de Custódia',          'Taxa mensal de custódia', 1, 1),
(NULL, 'TARIFA_MANUT',      'Tarifa de Manutenção',        'Tarifa mensal da corretora', 0, 1),
(NULL, 'CUSTO_TRANSFERENCIA','Custo de Transferência',     'TED/DOC para a corretora', 0, 1),
(NULL, 'IMPOSTO_RENDA',     'Imposto de Renda (DARF)',     'IR sobre ganho de capital', 1, 1),
(NULL, 'OUTRO',             'Outro',                       'Despesa não classificada', 1, 1);

-- 5. Despesas (lançamentos)
CREATE TABLE IF NOT EXISTS invest_expenses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT NOT NULL,
  expense_type_id INT NOT NULL,
  transaction_id  INT NULL,
  date            DATE NOT NULL,
  ticker          VARCHAR(20) NULL,
  amount          DECIMAL(18,6) NOT NULL,
  description     VARCHAR(512) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_exp_tenant (tenant_id),
  KEY idx_exp_date   (date),
  KEY idx_exp_ticker (ticker),
  KEY idx_exp_txn    (transaction_id),
  CONSTRAINT fk_exp_tenant  FOREIGN KEY (tenant_id)       REFERENCES tenants(id)              ON DELETE CASCADE,
  CONSTRAINT fk_exp_type    FOREIGN KEY (expense_type_id) REFERENCES invest_expense_types(id),
  CONSTRAINT fk_exp_txn     FOREIGN KEY (transaction_id)  REFERENCES invest_transactions(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Contas bancárias
CREATE TABLE IF NOT EXISTS invest_bank_accounts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id  INT NOT NULL,
  bank_name  VARCHAR(128) NOT NULL,
  agency     VARCHAR(32) NULL,
  account    VARCHAR(64) NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ba_tenant (tenant_id),
  CONSTRAINT fk_ba_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Extrato bancário
CREATE TABLE IF NOT EXISTS invest_bank_statements (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id        INT NOT NULL,
  account_id       INT NOT NULL,
  date             DATE NOT NULL,
  description      VARCHAR(512) NOT NULL,
  debit            DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit           DECIMAL(18,2) NOT NULL DEFAULT 0,
  balance          DECIMAL(18,2) NULL,
  reconcile_status ENUM('pending','reconciled','divergence','ignored') NOT NULL DEFAULT 'pending',
  transaction_id   INT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stmt_tenant  (tenant_id),
  KEY idx_stmt_date    (date),
  KEY idx_stmt_status  (reconcile_status),
  CONSTRAINT fk_stmt_tenant  FOREIGN KEY (tenant_id)      REFERENCES tenants(id)              ON DELETE CASCADE,
  CONSTRAINT fk_stmt_account FOREIGN KEY (account_id)     REFERENCES invest_bank_accounts(id),
  CONSTRAINT fk_stmt_txn     FOREIGN KEY (transaction_id) REFERENCES invest_transactions(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Cache de cotações (proxy brapi.dev — TTL 15 min gerenciado pelo backend)
CREATE TABLE IF NOT EXISTS invest_quote_cache (
  ticker      VARCHAR(20) NOT NULL PRIMARY KEY,
  price       DECIMAL(18,6) NOT NULL,
  change_pct  DECIMAL(8,4) NULL,
  payload     JSON NULL,
  fetched_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cache_fetched (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Registrar módulo INVEST no billing
INSERT IGNORE INTO modules (code, name, description)
VALUES ('INVEST', 'Gestão de Investimentos', 'Controle de ações, FIIs, renda fixa, opções e conciliação bancária');

-- 10. Permissões do módulo INVEST
INSERT IGNORE INTO permissions (module, resource, action, name, description, is_system_permission) VALUES
('INVEST', 'positions',    'read',   'INVEST: Ver posições',              'Visualizar carteira de investimentos', TRUE),
('INVEST', 'positions',    'write',  'INVEST: Gerenciar posições',        'Criar e editar posições', TRUE),
('INVEST', 'transactions', 'read',   'INVEST: Ver operações',             'Visualizar histórico de operações', TRUE),
('INVEST', 'transactions', 'write',  'INVEST: Lançar operações',          'Registrar compras e vendas', TRUE),
('INVEST', 'dividends',    'read',   'INVEST: Ver proventos',             'Visualizar dividendos e JCPs', TRUE),
('INVEST', 'dividends',    'write',  'INVEST: Lançar proventos',          'Registrar dividendos recebidos', TRUE),
('INVEST', 'expenses',     'read',   'INVEST: Ver despesas',              'Visualizar despesas de investimento', TRUE),
('INVEST', 'expenses',     'write',  'INVEST: Lançar despesas',           'Registrar emolumentos, taxas, etc.', TRUE),
('INVEST', 'bank',         'read',   'INVEST: Ver extrato bancário',      'Visualizar extrato e conciliação', TRUE),
('INVEST', 'bank',         'write',  'INVEST: Importar e conciliar',      'Importar CSV e conciliar lançamentos', TRUE),
('INVEST', 'wallet',       'read',   'INVEST: Ver carteira consolidada',  'Dashboard de carteira total', TRUE),
('INVEST', 'results',      'read',   'INVEST: Ver resultados por ação',   'Tela pivot de resultados', TRUE);

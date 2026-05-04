-- Cliente real SARON CORTINAS + ligação ao schema legado (mesmo nome que LEGACY_MYSQL_DATABASE no .env da raiz stockspin).
-- Use quando a base só tiver "Cliente demonstração" (ou qualquer tenant id=1) e faltar a SARON.
--
-- Pré-requisitos: tabela tenants com legacy_db_name (migration 004) e module_settings (005), se ainda não rodou o init novo.
-- Uso: mysql -u ... -p co_ceo_db < database/patch_insert_saron_tenant_complete.sql
--
-- Ajuste legacy_db_name abaixo se o seu .env usar outro nome de schema.

USE co_ceo_db;

INSERT IGNORE INTO tenants (
  id, name, slug, legacy_db_name, contact_name, contact_email, contact_phone,
  cnpj, status, plan, max_users, max_products,
  address_street, address_city, address_state, address_zip, address_country,
  module_settings
) VALUES (
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
);

UPDATE tenants
SET
  legacy_db_name = 'stockspin_core_db_saron',
  name = 'SARON CORTINAS',
  slug = 'saron-cortinas',
  contact_name = 'SARON CORTINAS',
  contact_email = 'admin@saroncortinas.com.br',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 2
   OR slug = 'saron-cortinas';

INSERT IGNORE INTO subscriptions (tenant_id, plan_id, status)
SELECT t.id, p.id, 'active'
FROM tenants t
JOIN plans p ON UPPER(t.plan) = p.code
WHERE t.id = 2
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);

-- Administrador do tenant SARON (senha inicial 12345678 — mesmo hash do init_co_ceo_db.sql)
INSERT INTO users (
  tenant_id, email, password_hash, first_name, last_name,
  status, is_super_user, email_verified
)
SELECT
  2,
  'admin@saroncortinas.com.br',
  '$2b$10$w9pY9alRRb0lpzsp0xhwX.BNeZREcFwOzZ230q0lU3iww0iGkGlGm',
  'Administrador',
  'SARON',
  'active',
  0,
  1
FROM (SELECT 1 AS _) AS _seed
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'admin@saroncortinas.com.br' AND deleted_at IS NULL
);

INSERT IGNORE INTO user_roles (user_id, role_id, granted_by)
SELECT u.id, 2, NULL
FROM users u
WHERE u.email = 'admin@saroncortinas.com.br'
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = 2
  );

UPDATE users
SET tenant_id = 2,
    updated_at = CURRENT_TIMESTAMP
WHERE email = 'admin@saroncortinas.com.br'
  AND deleted_at IS NULL;

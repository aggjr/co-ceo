-- =============================================================================
-- Vínculo completo Demo + SARON (uma vez na base já criada)
-- =============================================================================
-- Rode se no CO-CEO aparecer só "Cliente demonstração" ou faltar admin SARON:
--   (recomendado, usa backend/.env)  cd backend && npm run db:seed-saron
--   ou: mysql -u ... -p co_ceo_db < database/patch_upsert_demo_saron_tenants.sql
--
-- Depois confira:
--   1) SELECT id, name, slug, legacy_db_name FROM tenants ORDER BY id;  → id 1 demo, id 2 SARON
--   2) LEGACY_MYSQL_DATABASE / stockspin .env = mesmo nome que legacy_db_name da SARON (padrão stockspin_core_db_saron)
--   3) Login admin@saroncortinas.com.br (senha seed 12345678) ou super admin; personificar tenant 2 no header
--
-- Idempotente.

USE co_ceo_db;

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

UPDATE users
SET tenant_id = 2,
    updated_at = CURRENT_TIMESTAMP
WHERE email = 'admin@saroncortinas.com.br';

-- Admin do tenant SARON (senha inicial 12345678 — mesmo hash do init_co_ceo_db.sql)
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

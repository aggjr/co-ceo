-- Garante dois tenants: (1) Cliente demonstração · (2) SARON CORTINAS.
-- Use quando a base ainda tiver só SARON em id=1, ou só demo em id=1, ou já estiver correta (no-op seguro).
-- Uso: mysql -u ... co_ceo_db < database/patch_seed_two_tenants_demo_saron.sql

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
  CAST('{"INVEST":{"enabled":false}}' AS JSON)
);

UPDATE tenants
SET module_settings = JSON_SET(
  COALESCE(module_settings, CAST('{}' AS JSON)),
  '$.INVEST.enabled',
  CAST('false' AS JSON)
)
WHERE slug = 'saron-cortinas';

UPDATE tenants
SET legacy_db_name = 'stockspin_core_db_saron',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'saron-cortinas'
  AND (legacy_db_name IS NULL OR legacy_db_name = '');

UPDATE users
SET tenant_id = 2,
    updated_at = CURRENT_TIMESTAMP
WHERE email = 'admin@saroncortinas.com.br';

UPDATE tenants
SET
  name = 'Cliente demonstração',
  slug = 'demo',
  legacy_db_name = NULL,
  contact_name = 'Cliente demonstração',
  contact_email = 'admin@demo.coceo',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND slug = 'saron-cortinas';

INSERT IGNORE INTO subscriptions (tenant_id, plan_id, status)
SELECT t.id, p.id, 'active'
FROM tenants t
JOIN plans p ON UPPER(t.plan) = p.code
WHERE t.id IN (1, 2)
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);

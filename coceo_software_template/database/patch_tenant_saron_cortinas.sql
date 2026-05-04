-- Histórico: este patch convertia o tenant id=1 de "demo" para SARON (seed muito antigo).
-- O seed atual já traz DOIS clientes (demo id=1 + SARON id=2). Para bases antigas com SARON só em id=1,
-- use: database/patch_seed_two_tenants_demo_saron.sql
--
-- Atualização leve de nome/contato da SARON quando já existir como id=2:

USE co_ceo_db;

UPDATE tenants
SET
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

-- Opcional: legacy_db_name = mesmo valor que LEGACY_MYSQL_DATABASE no .env da raiz stockspin.
-- UPDATE tenants SET legacy_db_name = 'stockspin_core_db_saron' WHERE id = 2;

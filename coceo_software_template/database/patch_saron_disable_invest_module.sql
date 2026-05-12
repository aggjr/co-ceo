-- Desliga o módulo INVEST só para o tenant SARON (menu CO-CEO mostra apenas STOCKSPIN).
-- Seguro em bases que já têm outros campos em module_settings (preserva chaves existentes).
--
-- Uso: mysql -u ... -p co_ceo_db < database/patch_saron_disable_invest_module.sql

USE co_ceo_db;

UPDATE tenants
SET module_settings = JSON_SET(
  COALESCE(module_settings, CAST('{}' AS JSON)),
  '$.INVEST.enabled',
  CAST('false' AS JSON)
)
WHERE slug = 'saron-cortinas' OR id = 2;

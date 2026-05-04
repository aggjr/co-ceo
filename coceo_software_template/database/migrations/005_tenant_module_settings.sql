-- Configuração de módulos por tenant (JSON). Ex.: {"STOCKSPIN":{"staticBaseUrl":"https://..."}}
-- mysql -u ... co_ceo_db < database/migrations/005_tenant_module_settings.sql

USE co_ceo_db;

ALTER TABLE tenants
  ADD COLUMN module_settings JSON NULL
    COMMENT 'Config por módulo (STOCKSPIN.staticBaseUrl, futuros CASH, etc.)'
    AFTER address_country;

USE `ceo`;

-- Sinal agregado “CD” (batimento de palmas somado nas lojas) por dia e SKU.
-- No piloto com uma loja, coincide com essa loja; ao incluir lojas, o job soma/regras.
CREATE TABLE IF NOT EXISTS `cd_daily_aggregate` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `ref_date` DATE NOT NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `sku_internal_id` INT UNSIGNED NULL,
  `store_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `sum_qty_physical_stores` DECIMAL(16,4) NOT NULL DEFAULT 0.0000,
  `sum_qty_available_stores` DECIMAL(16,4) NOT NULL DEFAULT 0.0000,
  `sum_sales_day` DECIMAL(16,4) NOT NULL DEFAULT 0.0000 COMMENT 'Soma vendas do SKU no dia nas lojas agregadas',
  `computed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cd_day_sku` (`ref_date`, `sku_erp_code`),
  KEY `idx_cd_run` (`run_id`),
  KEY `idx_cd_sku` (`sku_erp_code`, `ref_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

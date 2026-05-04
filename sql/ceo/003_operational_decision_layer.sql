USE `ceo`;

-- ---------------------------------------------------------------------------
-- Controle de sincronização incremental por origem (legado/API/arquivo).
-- Guarda watermark para processar "ontem" por padrão e reprocessar só janelas afetadas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `source_sync_state` (
  `source_name` VARCHAR(80) NOT NULL COMMENT 'Ex.: legacy_ativoposicaoestoque',
  `last_success_run_id` CHAR(36) NULL,
  `last_source_max_ts` DATETIME(3) NULL COMMENT 'Maior timestamp observado na origem',
  `last_source_max_ref_date` DATE NULL COMMENT 'Maior data de referência observada',
  `last_processed_ref_date` DATE NULL COMMENT 'Última data efetivamente materializada',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `meta` JSON NULL,
  PRIMARY KEY (`source_name`),
  KEY `idx_sync_last_processed` (`last_processed_ref_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Solicitações de recálculo parcial (retroativo).
-- Quando houver ajuste retroativo no legado, abre janela [from_date ...] até hoje.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `recalc_request` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` VARCHAR(80) NOT NULL DEFAULT 'system',
  `reason` VARCHAR(255) NOT NULL,
  `source_name` VARCHAR(80) NULL,
  `sku_erp_code` VARCHAR(32) NULL COMMENT 'NULL = todos os SKUs',
  `store_key` VARCHAR(64) NULL COMMENT 'NULL = todas as lojas',
  `from_ref_date` DATE NOT NULL,
  `to_ref_date` DATE NULL COMMENT 'NULL = até o último dia disponível',
  `status` ENUM('pending','running','done','failed','cancelled') NOT NULL DEFAULT 'pending',
  `run_id` CHAR(36) NULL,
  `meta` JSON NULL,
  PRIMARY KEY (`id`),
  KEY `idx_recalc_status` (`status`, `created_at`),
  KEY `idx_recalc_scope` (`sku_erp_code`, `store_key`, `from_ref_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Curvas calculadas por SKU x loja x dia (materialização estática histórica).
-- Permite não recalcular passado inteiro: só ontem + janela retroativa afetada.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stock_curve_daily` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `ref_date` DATE NOT NULL,
  `store_key` VARCHAR(64) NOT NULL,
  `sku_internal_id` INT UNSIGNED NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `qty_physical` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `qty_showcase` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `qty_available` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `qty_sales` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `p10` DECIMAL(14,4) NULL,
  `p50` DECIMAL(14,4) NULL,
  `p100` DECIMAL(14,4) NULL,
  `p150` DECIMAL(14,4) NULL,
  `p200` DECIMAL(14,4) NULL,
  `p400` DECIMAL(14,4) NULL,
  `p800` DECIMAL(14,4) NULL,
  `status_code` VARCHAR(24) NULL COMMENT 'RUPTURA/CRITICO/ABAIXO/ACIMA/...',
  `status_pct` DECIMAL(10,4) NULL COMMENT '(disponivel / denominador_status) * 100',
  `status_denominator` DECIMAL(14,4) NULL COMMENT 'max(P150 Mira protegido, P150 motor)',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_curve_day_store_sku` (`ref_date`, `store_key`, `sku_erp_code`),
  KEY `idx_curve_sku_date` (`sku_erp_code`, `ref_date`),
  KEY `idx_curve_store_date` (`store_key`, `ref_date`),
  KEY `idx_curve_status_date` (`status_code`, `ref_date`),
  KEY `idx_curve_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Preço/custo aplicado por SKU x loja x dia (realizado legado).
-- Base temporal para rentabilidade, ROI, investimento em estoque e evolução histórica.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sku_store_daily_finance` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `ref_date` DATE NOT NULL,
  `store_key` VARCHAR(64) NOT NULL,
  `sku_internal_id` INT UNSIGNED NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `unit_price_sale_applied` DECIMAL(16,6) NULL,
  `unit_price_cost_applied` DECIMAL(16,6) NULL,
  `qty_sales` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `gross_sales_value` DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
  `gross_margin_value` DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
  `gross_margin_pct` DECIMAL(10,4) NULL,
  `stock_qty_physical` DECIMAL(14,4) NULL COMMENT 'físico canônico no fim do dia',
  `stock_capital_sale_basis` DECIMAL(18,4) NULL COMMENT 'unit_price_sale_applied * stock_qty_physical',
  `stock_capital_cost_basis` DECIMAL(18,4) NULL COMMENT 'unit_price_cost_applied * stock_qty_physical',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fin_day_store_sku` (`ref_date`, `store_key`, `sku_erp_code`),
  KEY `idx_fin_sku_date` (`sku_erp_code`, `ref_date`),
  KEY `idx_fin_store_date` (`store_key`, `ref_date`),
  KEY `idx_fin_margin_date` (`gross_margin_value`, `ref_date`),
  KEY `idx_fin_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Snapshot diário da saúde do estoque por faixa/status.
-- Permite evolução temporal sem reprocessar gráficos antigos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stock_health_daily` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `ref_date` DATE NOT NULL,
  `store_key` VARCHAR(64) NOT NULL COMMENT 'Loja, Fábrica/CD ou TOTAL',
  `scope_code` ENUM('single_store','total_retail','total_full') NOT NULL DEFAULT 'single_store',
  `status_code` VARCHAR(24) NOT NULL,
  `sku_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `financial_mass_sale_basis` DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
  `financial_mass_cost_basis` DECIMAL(18,4) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_health_day_scope_status` (`ref_date`, `store_key`, `scope_code`, `status_code`),
  KEY `idx_health_date` (`ref_date`),
  KEY `idx_health_status_date` (`status_code`, `ref_date`),
  KEY `idx_health_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Snapshot diário dos produtos prioritários para diretoria (Top 30 / Top 100).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `top_product_daily_snapshot` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `ref_date` DATE NOT NULL,
  `list_name` ENUM('top_30','top_100') NOT NULL,
  `rank_pos` SMALLINT UNSIGNED NOT NULL,
  `sku_internal_id` INT UNSIGNED NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `product_name` VARCHAR(255) NULL,
  `importance_score` DECIMAL(18,6) NULL,
  `status_code` VARCHAR(24) NULL,
  `availability_pct` DECIMAL(10,4) NULL,
  `gross_margin_value_90d` DECIMAL(18,4) NULL,
  `rupture_weighted_pct` DECIMAL(10,4) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_top_day_list_rank` (`ref_date`, `list_name`, `rank_pos`),
  KEY `idx_top_day_list` (`ref_date`, `list_name`),
  KEY `idx_top_sku_date` (`sku_erp_code`, `ref_date`),
  KEY `idx_top_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


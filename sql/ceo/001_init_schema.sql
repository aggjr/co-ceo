-- Schema Co-CEO / motor de estoque (MySQL 8+)
-- Executar com usuário que tenha CREATE no servidor.

CREATE SCHEMA IF NOT EXISTS `ceo` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ceo`;

-- ---------------------------------------------------------------------------
-- Metadado de cada execução (ingestão, sugestão, aprendizado)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `engine_run` (
  `run_id` CHAR(36) NOT NULL,
  `run_type` ENUM('ingest_snapshot','replenish_suggest','learn_params','other') NOT NULL DEFAULT 'other',
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL DEFAULT NULL,
  `status` ENUM('running','success','failed') NOT NULL DEFAULT 'running',
  `row_counts` JSON NULL,
  `error_message` TEXT NULL,
  `notes` VARCHAR(512) NULL,
  PRIMARY KEY (`run_id`),
  KEY `idx_engine_run_started` (`started_at`),
  KEY `idx_engine_run_type` (`run_type`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Posição de estoque diária (SKU × loja × dia) — base do piloto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daily_stock_snapshot` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `ref_date` DATE NOT NULL,
  `store_key` VARCHAR(64) NOT NULL COMMENT 'Ex.: Barreiro',
  `sku_internal_id` INT UNSIGNED NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `product_name` VARCHAR(255) NULL,
  `qty_physical` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `qty_showcase` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `qty_available` DECIMAL(14,4) NOT NULL DEFAULT 0.0000 COMMENT 'Preferencialmente MAX(0, físico - vitrine)',
  `qty_sales` DECIMAL(14,4) NOT NULL DEFAULT 0.0000 COMMENT 'Vendas unidades no dia (reconciliadas no pipeline)',
  `ingested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_snapshot` (`ref_date`, `store_key`, `sku_erp_code`),
  KEY `idx_snapshot_run` (`run_id`),
  KEY `idx_snapshot_store_date` (`store_key`, `ref_date`),
  KEY `idx_snapshot_sku` (`sku_erp_code`, `ref_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Parâmetros aprendidos / calibrados por SKU (e opcionalmente por loja)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `learned_parameter` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `store_key` VARCHAR(64) NULL COMMENT 'NULL = parâmetro global do SKU',
  `sku_internal_id` INT UNSIGNED NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `param_key` VARCHAR(64) NOT NULL COMMENT 'Ex.: lead_time_days, demand_sigma, buffer_factor',
  `param_value` DOUBLE NOT NULL,
  `meta` JSON NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_learned` (`sku_erp_code`, `param_key`, `store_key`),
  KEY `idx_learned_sku` (`sku_erp_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sugestões de reposição (loja, CD, fábrica — origem/destino em texto estável)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `replenishment_suggestion` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ref_snapshot_date` DATE NULL COMMENT 'Dia de estoque que baseou o cálculo',
  `origin` VARCHAR(64) NOT NULL COMMENT 'Ex.: CD, FABRICA',
  `destination` VARCHAR(64) NOT NULL COMMENT 'Ex.: Barreiro',
  `sku_internal_id` INT UNSIGNED NULL,
  `sku_erp_code` VARCHAR(32) NOT NULL,
  `qty_suggested` DECIMAL(14,4) NOT NULL,
  `algorithm_id` VARCHAR(64) NOT NULL COMMENT 'Ex.: v1_buffer',
  `algorithm_params` JSON NULL,
  `status` ENUM('draft','published','accepted','rejected','superseded') NOT NULL DEFAULT 'draft',
  PRIMARY KEY (`id`),
  KEY `idx_sugg_run` (`run_id`),
  KEY `idx_sugg_dest_created` (`destination`, `created_at`),
  KEY `idx_sugg_sku` (`sku_erp_code`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

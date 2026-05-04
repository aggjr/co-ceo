-- Migration: Add tenant database size cache table
-- Stores calculated database sizes per tenant with monthly refresh

CREATE TABLE IF NOT EXISTS tenant_database_size_cache (
    tenant_id INT NOT NULL,
    database_size BIGINT NOT NULL DEFAULT 0,
    table_breakdown JSON NULL COMMENT 'Breakdown by table: {"users": 1048576, "audit_log": 5242880}',
    calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_calculated_at (calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initial calculation for existing tenants will be done via endpoint

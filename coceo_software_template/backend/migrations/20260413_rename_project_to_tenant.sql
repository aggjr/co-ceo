-- ================================================
-- Migration: Rename project_id to tenant_id
-- Date: 2026-04-13
-- Focus: Standardize multi-tenancy field name
-- ================================================
-- ATENÇÃO: só aplique se o banco tiver as tabelas legadas do módulo CASH
-- (empresas, contas, entradas, etc.). O schema novo co_ceo_db do CO-CEO
-- não inclui essas tabelas; neste caso, ignore este arquivo.

-- Ajuste o nome do schema se usar outro DB_NAME no .env
USE co_ceo_db;

ALTER TABLE empresas CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE contas CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE tipo_entrada CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE tipo_saida CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE entradas CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE saidas CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE retiradas CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE transferencias CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE aportes CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE producao_revenda CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE centros_custo CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE emprestimos_dividas CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE system_settings CHANGE COLUMN project_id tenant_id INT NOT NULL;
ALTER TABLE audit_logs CHANGE COLUMN project_id tenant_id INT;

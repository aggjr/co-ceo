-- Liga o tenant da app ao nome lógico do banco legado (deve coincidir com LEGACY_MYSQL_DATABASE no .env da raiz stockspin).
-- Executar uma vez em bases já criadas: mysql -u ... co_ceo_db < database/migrations/004_tenant_legacy_db_name.sql
-- Se `init_co_ceo_db.sql` já foi aplicado com esta coluna, ignore este ficheiro (o ALTER falharia com "Duplicate column").

USE co_ceo_db;

ALTER TABLE tenants
  ADD COLUMN legacy_db_name VARCHAR(191) NULL
    COMMENT 'Nome do schema MySQL legado (mesmo valor que LEGACY_MYSQL_DATABASE no .env)'
    AFTER slug;

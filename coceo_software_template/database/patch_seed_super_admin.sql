-- Superusuário interno para personificação de tenant no cockpit (cabeçalho + x-tenant-id).
-- Uso se a base ainda não tiver admin@coceo.com.br: mysql -u ... co_ceo_db < database/patch_seed_super_admin.sql
--
-- Login: admin@coceo.com.br | Senha inicial: Dani160779!

USE co_ceo_db;

INSERT IGNORE INTO users (
  id, tenant_id, email, password_hash, first_name, last_name,
  status, is_super_user, email_verified
) VALUES (
  2,
  NULL,
  'admin@coceo.com.br',
  '$2b$10$6MaW8sWmSyPWdoCpxdp5EOX.s5/VCeL1HPzLuoU87aM/5DQgyMME2',
  'Super',
  'Admin',
  'active',
  1,
  1
);

INSERT IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES
(2, 1, NULL);

-- Atualiza senha se o usuário já existia (INSERT IGNORE não sobrescreve hash).
UPDATE users
SET password_hash = '$2b$10$6MaW8sWmSyPWdoCpxdp5EOX.s5/VCeL1HPzLuoU87aM/5DQgyMME2',
    updated_at = CURRENT_TIMESTAMP
WHERE email = 'admin@coceo.com.br'
  AND deleted_at IS NULL;

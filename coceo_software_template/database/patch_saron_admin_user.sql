-- Atualiza o tenant SARON e o primeiro usuário para o administrador real da empresa.
-- Use em bases já criadas com seed antigo (admin@coceo.com.br / superusuário).
-- Uso: mysql -u ... co_ceo_db < database/patch_saron_admin_user.sql
--
-- Credencial alvo: admin@saroncortinas.com.br — senha inicial 12345678 (troque após o primeiro login).

USE co_ceo_db;

UPDATE tenants
SET
  contact_email = 'admin@saroncortinas.com.br',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 2 OR slug = 'saron-cortinas';

UPDATE users
SET
  tenant_id = 2,
  email = 'admin@saroncortinas.com.br',
  password_hash = '$2b$10$w9pY9alRRb0lpzsp0xhwX.BNeZREcFwOzZ230q0lU3iww0iGkGlGm',
  first_name = 'Administrador',
  last_name = 'SARON',
  status = 'active',
  is_super_user = 0,
  email_verified = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

DELETE FROM user_roles WHERE user_id = 1;
INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (1, 2, NULL);

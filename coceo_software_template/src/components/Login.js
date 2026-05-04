import { Dialogs } from './Dialogs.js';
import { getApiBaseUrl } from '../utils/apiConfig.js';
import { applyModuleContextFromLogin } from '../utils/moduleContext.js';
import { getVersion } from '../utils/version.js';

export function Login(onLoginSuccess) {
  const container = document.createElement('div');
  container.className = 'login-container';

  container.innerHTML = `
    <div class="login-card">
      <div class="login-header">
        <h1 class="login-logo">CO-CEO</h1>
        <p class="login-subtitle">Decisão, estoque e operações</p>
        <div class="login-version">Versão ${getVersion()}</div>
      </div>
      
      <form class="login-form" id="login-form">
        <div class="form-group">
          <label for="email">E-mail</label>
          <input 
            type="email" 
            id="email" 
            name="email" 
            placeholder="seu@email.com"
            required
          />
        </div>
        
        <div class="form-group">
          <label for="password">Senha</label>
          <div class="login-password-wrap">
            <input 
              type="password" 
              id="password" 
              name="password" 
              class="login-password-input"
              placeholder="••••••••"
              autocomplete="current-password"
              required
            />
            <button type="button" class="login-password-toggle" id="password-toggle" aria-label="Mostrar senha" title="Mostrar senha">
              <span class="login-password-icon login-password-icon--show" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </span>
              <span class="login-password-icon login-password-icon--hide" aria-hidden="true" hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </span>
            </button>
          </div>
        </div>
        
        <button type="submit" class="btn btn-primary btn-block">
          Entrar
        </button>
        
        <div class="login-footer">
          <a href="#" class="link-secondary">Esqueceu a senha?</a>
          <span class="separator">•</span>
          <a href="#" class="link-secondary" id="register-link">Criar conta</a>
        </div>
      </form>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .login-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 50%, var(--color-dark) 100%);
      position: relative;
    }
    
    .login-card {
      background: white;
      border-radius: var(--radius-xl);
      padding: var(--space-2xl);
      box-shadow: var(--shadow-xl);
      width: 100%;
      max-width: 420px;
      animation: slideIn 0.4s ease;
    }
    
    .login-header {
      text-align: center;
      margin-bottom: var(--space-xl);
    }
    
    .login-logo {
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 50%, var(--color-accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-size: 3rem;
      font-weight: 700;
      margin-bottom: var(--space-sm);
      letter-spacing: 2px;
    }
    
    .login-subtitle {
      color: var(--color-text-secondary);
      font-family: var(--font-secondary);
      font-size: 1rem;
      font-weight: 300;
    }
    
    .login-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-lg);
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    
    .form-group label {
      font-weight: 600;
      color: var(--color-text);
    }
    
    .form-group input {
      padding: var(--space-md);
      font-size: 1rem;
    }

    .login-password-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .login-password-input {
      width: 100%;
      padding-right: 3rem;
      box-sizing: border-box;
    }

    .login-password-toggle {
      position: absolute;
      right: 0.25rem;
      top: 50%;
      transform: translateY(-50%);
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0.4rem;
      color: var(--color-text-secondary, #64748b);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }

    .login-password-toggle:hover {
      color: var(--color-primary, #0d9488);
      background: rgba(13, 148, 136, 0.08);
    }

    .login-password-toggle:focus-visible {
      outline: 2px solid var(--color-primary, #0d9488);
      outline-offset: 2px;
    }

    .login-password-icon[hidden] {
      display: none !important;
    }
    
    .btn-block {
      width: 100%;
      padding: var(--space-md);
      font-size: 1rem;
      margin-top: var(--space-sm);
    }
    
    .login-footer {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--space-sm);
      margin-top: var(--space-md);
      font-size: 0.875rem;
    }
    
    .link-secondary {
      color: var(--color-secondary);
      text-decoration: none;
      transition: color var(--transition-base);
    }
    
    .link-secondary:hover {
      color: var(--color-primary);
      text-decoration: underline;
    }
    
    .separator {
      color: var(--color-text-muted);
    }
    
    .login-version {
      margin-top: 0.4rem;
      color: var(--color-text-muted);
      font-size: 0.78rem;
      font-family: var(--font-mono);
      letter-spacing: 0.4px;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;

  container.appendChild(style);

  const pwdInput = container.querySelector('#password');
  const pwdToggle = container.querySelector('#password-toggle');
  const iconShow = pwdToggle.querySelector('.login-password-icon--show');
  const iconHide = pwdToggle.querySelector('.login-password-icon--hide');

  pwdToggle.addEventListener('click', () => {
    const willShowPlain = pwdInput.type === 'password';
    pwdInput.type = willShowPlain ? 'text' : 'password';
    pwdToggle.setAttribute('aria-label', willShowPlain ? 'Ocultar senha' : 'Mostrar senha');
    pwdToggle.setAttribute('title', willShowPlain ? 'Ocultar senha' : 'Mostrar senha');
    iconShow.toggleAttribute('hidden', willShowPlain);
    iconHide.toggleAttribute('hidden', !willShowPlain);
  });

  // Form submission handler with real authentication
  const form = container.querySelector('#login-form');
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = form.email.value.trim();
    const password = form.password.value;

    // Basic validation
    if (!email || !password) {
      await Dialogs.alert('Por favor, preencha todos os campos.', 'Aviso');
      return;
    }

    // Disable button and show loading state
    submitButton.disabled = true;
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Entrando...';

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Store authentication data
        localStorage.setItem('token', data.token);
        localStorage.setItem('sessionId', data.sessionId);
        localStorage.setItem('user', JSON.stringify(data.user));
        applyModuleContextFromLogin(data);

        console.log('✅ Login successful:', {
          user: data.user.email,
          tenant: data.user.tenantName || 'Super User',
          roles: data.user.roles.map(r => r.name).join(', ')
        });

        // Call success callback
        if (onLoginSuccess) {
          onLoginSuccess();
        }
      } else {
        // Handle error response
        const errorMessage = data.error?.message || data.error || 'Erro ao fazer login';
        await Dialogs.alert(errorMessage, 'Erro de Autenticação');
      }
    } catch (error) {
      console.error('Login error:', error);
      await Dialogs.alert(
        `Erro de conexão com o servidor.\n\nVerifique se o backend está rodando em ${getApiBaseUrl()}`,
        'Erro de Conexão'
      );
    } finally {
      // Re-enable button
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });

  // Register link handler (placeholder for now)
  const registerLink = container.querySelector('#register-link');
  registerLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await Dialogs.alert(
      'Registro em desenvolvimento!\n\nEsta funcionalidade será implementada nas próximas fases.',
      'CO-CEO'
    );
  });

  return container;
}

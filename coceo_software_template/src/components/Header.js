import { tenantService } from '../services/tenantService.js';
import { syncTenantModuleSettingsFromList } from '../utils/moduleContext.js';
import { getVersion } from '../utils/version.js';

export function Header(user, onLogout) {
    const header = document.createElement('header');
    header.className = 'dashboard-header';

    // Only render if Super User (Logic also in main.js but safe here too)
    if (!user.isSuperUser) {
        header.style.display = 'none';
        return header;
    }

    // Tenant Switcher Logic
    header.innerHTML = `
        <div class="tenant-switcher-container">
            <span class="user-info-header">
                Logado como <strong class="text-primary">${user.firstName} ${user.lastName}</strong>
            </span>
            <label for="tenant-select" class="tenant-label" title="Em inglês: tenant impersonation. O backend usa o cabeçalho HTTP x-tenant-id.">Personificar cliente (contexto do tenant):</label>
            <select id="tenant-select" class="tenant-select" title="Personificação: requisições à API usam o tenant escolhido, como se você fosse aquele cliente.">
                <option value="">Visão global — sem personificar</option>
            </select>
            <span class="tenant-version-badge" title="Versão atual do front-end">
                ${getVersion()}
            </span>
        </div>
    `;

    // Load tenants logic
    const select = header.querySelector('#tenant-select');
    const currentTenantId = localStorage.getItem('currentTenantId');

    // Fetch tenants
    tenantService.getTenants().then(tenants => {
        syncTenantModuleSettingsFromList(tenants);
        tenants.forEach(tenant => {
            const option = document.createElement('option');
            option.value = tenant.id;
            option.textContent = tenant.name;
            if (currentTenantId && parseInt(currentTenantId) === tenant.id) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }).catch(err => console.error('Error loading tenants:', err));

    // Change handler
    select.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
            localStorage.setItem('currentTenantId', val);
        } else {
            localStorage.removeItem('currentTenantId');
        }
        // Reload to apply changes
        window.location.reload();
    });

    return header;
}

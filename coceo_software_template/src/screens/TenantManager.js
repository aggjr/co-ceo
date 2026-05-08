import { Dialogs } from '../components/Dialogs.js';
import { ExcelTable } from '../components/ExcelTable.js';
import { tenantService } from '../services/tenantService.js';
import { userService } from '../services/userService.js';
import { roleService } from '../services/roleService.js';
import { planService } from '../services/planService.js';
import { formatFileSize } from '../utils/formatters.js';
import { attachPhoneMask } from '../utils/phoneMask.js';
import { syncTenantModuleSettingsFromList } from '../utils/moduleContext.js';

/**
 * Tenant Manager Screen
 * Manages clients (tenants) in the system
 * Only accessible by super users
 */
export function TenantManager() {
    const container = document.createElement('div');
    container.className = 'screen-container';

    let excelTable = null;

    // Check if user is super user
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.isSuperUser) {
        container.innerHTML = `
            <div class="error-message">
                <h2>⛔ Acesso Negado</h2>
                <p>Apenas super usuários podem acessar esta tela.</p>
            </div>
        `;
        return container;
    }

    container.innerHTML = `
        <div class="screen-header">
            <div class="header-title">
                <h1>🏢 Gerenciamento de Clientes</h1>
                <p>Gerencie os clientes (tenants) do sistema</p>
            </div>
            <button class="btn btn-primary" id="btn-new-tenant">
                <span style="font-weight: bold; font-size: 1.2em;">+</span> Novo Cliente
            </button>
        </div>

        <div id="table-container" style="flex: 1; display: flex; flex-direction: column;"></div>
    `;

    // Event Listeners
    const btnNewTenant = container.querySelector('#btn-new-tenant');
    btnNewTenant.addEventListener('click', () => showTenantModal());

    // Initialize ExcelTable
    const tableContainer = container.querySelector('#table-container');

    excelTable = new ExcelTable({
        container: tableContainer,
        gridId: 'tenant-manager-grid-v1',
        columns: [
            {
                key: 'actions',
                label: '',
                width: '100px',
                noFilter: true,
                align: 'center',
                render: (item) => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.gap = '2px';
                    div.style.justifyContent = 'center';

                    // Impersonate Button
                    const btnImpersonate = document.createElement('button');
                    btnImpersonate.className = 'btn-icon';
                    btnImpersonate.innerHTML = '👁️';
                    btnImpersonate.title = 'Entrar como este Cliente';
                    btnImpersonate.style.fontSize = '0.85rem';
                    btnImpersonate.style.padding = '4px 6px';
                    btnImpersonate.onclick = (e) => {
                        e.stopPropagation();
                        localStorage.setItem('currentTenantId', item.id);
                        window.location.reload();
                    };
                    div.appendChild(btnImpersonate);

                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn-icon';
                    btnEdit.innerHTML = '✏️';
                    btnEdit.title = 'Editar';
                    btnEdit.style.fontSize = '0.85rem';
                    btnEdit.style.padding = '4px 6px';
                    btnEdit.onclick = (e) => {
                        e.stopPropagation();
                        showTenantModal(item);
                    };

                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn-icon btn-danger';
                    btnDelete.innerHTML = '🗑️';
                    btnDelete.title = 'Excluir';
                    btnDelete.style.fontSize = '0.85rem';
                    btnDelete.style.padding = '4px 6px';
                    btnDelete.onclick = async (e) => {
                        e.stopPropagation();
                        const confirmed = await Dialogs.confirm(
                            `Excluir cliente "${item.name}"?`,
                            'Esta ação não pode ser desfeita. Todos os dados do cliente serão removidos.'
                        );
                        if (confirmed) {
                            deleteTenant(item.id);
                        }
                    };

                    div.appendChild(btnEdit);
                    div.appendChild(btnDelete);
                    return div;
                }
            },
            {
                key: 'name',
                label: 'Cliente',
                type: 'text',
                width: '220px',
                sticky: true
            },
            {
                key: 'contact_email',
                label: 'Contato',
                type: 'text',
                width: '240px'
            },
            {
                key: 'status',
                label: 'Status',
                type: 'text',
                width: '120px',
                align: 'center',
                render: (item) => {
                    const statusMap = {
                        'active': { label: 'Ativo', color: '#10B981' },
                        'trial': { label: 'Trial', color: '#F59E0B' },
                        'inactive': { label: 'Inativo', color: '#6B7280' },
                        'suspended': { label: 'Suspenso', color: '#EF4444' }
                    };
                    const status = statusMap[item.status] || { label: item.status, color: '#6B7280' };
                    const span = document.createElement('span');
                    span.style.padding = '4px 12px';
                    span.style.borderRadius = '12px';
                    span.style.backgroundColor = status.color + '20';
                    span.style.color = status.color;
                    span.style.fontWeight = '600';
                    span.style.fontSize = '0.85rem';
                    span.textContent = status.label;
                    return span;
                }
            },
            {
                key: 'plan',
                label: 'Plano',
                type: 'text',
                width: '140px',
                align: 'center',
                render: (item) => {
                    const span = document.createElement('span');
                    // item.plan contains the ID if not joined, but API currently returns item.plan string in older format. 
                    // Let's protect against ID or string format.
                    let planName = item.plan;

                    // Display formatting
                    if (String(item.plan).toUpperCase() === 'FREE') {
                        span.textContent = `🆓 Gratuito`;
                    } else if (String(item.plan).toUpperCase() === 'BASIC') {
                        span.textContent = `📦 Básico`;
                    } else if (String(item.plan).toUpperCase() === 'PRO') {
                        span.textContent = `💼 Profissional`;
                    } else if (String(item.plan).toUpperCase() === 'ENTERPRISE') {
                        span.textContent = `🏢 Corporativo`;
                    } else {
                        span.textContent = `📋 ${planName}`;
                    }

                    return span;
                }
            },
            {
                key: 'active_users',
                label: 'Usuários',
                type: 'number',
                width: '100px',
                align: 'center'
            },
            {
                key: 'created_at',
                label: 'Criado em',
                type: 'date',
                width: '120px',
                align: 'center'
            },
            {
                key: 'database_size',
                label: 'Tamanho do BD',
                type: 'text',
                width: '140px',
                align: 'right',
                render: (item) => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.flexDirection = 'column';
                    div.style.alignItems = 'flex-end';
                    div.style.gap = '2px';

                    // Size
                    const sizeSpan = document.createElement('span');
                    sizeSpan.textContent = formatFileSize(item.database_size || 0);
                    sizeSpan.style.fontFamily = 'monospace';
                    sizeSpan.style.fontWeight = '600';
                    sizeSpan.style.fontSize = '0.9rem';
                    div.appendChild(sizeSpan);

                    // Calculation date
                    if (item.database_size_calculated_at) {
                        const dateSpan = document.createElement('small');
                        const daysOld = item.database_size_days_old || 0;
                        dateSpan.textContent = daysOld === 0 ? 'Hoje' : `${daysOld}d atrás`;
                        dateSpan.style.color = daysOld > 30 ? '#EF4444' : 'var(--color-text-muted)';
                        dateSpan.style.fontSize = '0.7rem';
                        div.appendChild(dateSpan);
                    } else {
                        const dateSpan = document.createElement('small');
                        dateSpan.textContent = 'Não calculado';
                        dateSpan.style.color = 'var(--color-text-muted)';
                        dateSpan.style.fontSize = '0.7rem';
                        div.appendChild(dateSpan);
                    }

                    return div;
                }
            }
        ],
        enableSelection: true,
        summaryLabels: {
            total: 'Total de Clientes: \u00A0\u00A0',
            selected: 'Selecionados'
        },
        onBulkDelete: async () => {
            const selected = excelTable.getSelectedTotal();
            if (selected.count === 0) return;

            const confirmed = await Dialogs.confirm(
                `Excluir ${selected.count} cliente(s)?`,
                'Esta ação não pode ser desfeita.'
            );

            if (confirmed) {
                bulkDeleteTenants(selected.items);
            }
        }
    });

    // Load tenants
    loadTenants();

    // Functions
    async function loadTenants() {
        try {
            const tenants = await tenantService.getTenants();
            syncTenantModuleSettingsFromList(tenants);
            excelTable.render(tenants);
        } catch (error) {
            console.error('Error loading tenants:', error);
            Dialogs.alert('Erro ao carregar clientes: ' + error.message);
        }
    }

    async function deleteTenant(tenantId) {
        try {
            await tenantService.deleteTenant(tenantId);
            Dialogs.alert('Cliente excluído com sucesso!');
            loadTenants(); // Reload
        } catch (error) {
            console.error('Error deleting tenant:', error);
            Dialogs.alert('Erro ao excluir cliente: ' + error.message);
        }
    }

    async function bulkDeleteTenants(tenants) {
        try {
            const promises = tenants.map(tenant => tenantService.deleteTenant(tenant.id));
            await Promise.all(promises);

            Dialogs.alert(`${tenants.length} clientes excluídos com sucesso!`);
            excelTable.clearSelection();
            loadTenants(); // Reload
        } catch (error) {
            console.error('Error bulk deleting tenants:', error);
            Dialogs.alert('Erro ao excluir clientes: ' + error.message);
        }
    }

    async function showTenantModal(tenant = null) {
        const tenantId = tenant?.id;
        const isEdit = !!tenantId;

        // Fetch plans dynamically
        let activePlans = [];
        try {
            activePlans = await planService.getPlans();
        } catch (err) {
            console.error('Failed to load plans', err);
        }

        const modal = Dialogs.modal({
            title: isEdit ? '✏️ Editar Cliente' : '+ Novo Cliente',
            content: `
                <form id="tenant-form" class="form" novalidate>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="tenant-name">Nome do Cliente <span class="required-asterisk">*</span></label>
                            <input type="text" id="tenant-name" value="${tenant?.name || ''}" required>
                        </div>

                        <div class="form-group">
                            <label for="tenant-contact-email">E-mail do Cliente <span class="required-asterisk">*</span></label>
                            <input type="email" id="tenant-contact-email" value="${tenant?.contact_email || ''}" required>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="tenant-contact-name">Nome do Contato <span class="required-asterisk">*</span></label>
                            <input type="text" id="tenant-contact-name" value="${tenant?.contact_name || ''}" required>
                        </div>

                        <div class="form-group">
                            <label for="tenant-phone">Telefone do Contato <span class="required-asterisk">*</span></label>
                            <input type="tel" id="tenant-phone" value="${tenant?.contact_phone || ''}" required>
                        </div>
                    </div>

                    <div class="form-row" style="grid-template-columns: 1fr 1fr 1fr;">
                        <div class="form-group">
                            <label for="tenant-status">Status <span class="required-asterisk">*</span></label>
                            <select id="tenant-status" required>
                                <option value="trial" ${tenant?.status === 'trial' ? 'selected' : ''}>Trial</option>
                                <option value="active" ${tenant?.status === 'active' ? 'selected' : ''}>Ativo</option>
                                <option value="inactive" ${tenant?.status === 'inactive' ? 'selected' : ''}>Inativo</option>
                                <option value="suspended" ${tenant?.status === 'suspended' ? 'selected' : ''}>Suspenso</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="tenant-plan">Plano <span class="required-asterisk">*</span></label>
                            <select id="tenant-plan" required>
                                ${activePlans.map(plan => `
                                    <option value="${plan.code}" ${String(tenant?.plan).toUpperCase() === plan.code ? 'selected' : ''}>
                                        ${plan.name} (R$ ${plan.monthly_price})
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="tenant-max-users">Máx. Usuários <span class="required-asterisk">*</span></label>
                            <input type="number" id="tenant-max-users" value="${tenant?.max_users || 5}" min="1" required>
                        </div>
                    </div>

                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" id="btn-cancel">Cancelar</button>
                        <button type="submit" class="btn btn-primary" id="btn-save">
                            ${isEdit ? 'Salvar' : 'Criar'}
                        </button>
                    </div>
                </form>

                <div class="users-section" id="users-section" style="display: ${isEdit ? 'block' : 'none'};">
                    <div class="users-header">
                        <h3 id="users-toggle" style="cursor: pointer; user-select: none;">
                            <span class="expand-icon" id="expand-icon">▼</span>
                            Usuários (<span id="users-count">0</span>)
                        </h3>
                        <button id="btn-add-user" class="btn btn-sm btn-primary" style="display: none;">
                            + Novo Usuário
                        </button>
                    </div>
                    
                    <div id="users-content" class="users-content">
                        <div id="users-placeholder" class="users-placeholder">
                            <p style="margin: 0; color: var(--color-text-muted);">
                                ℹ️ Salve o cliente primeiro para adicionar usuários
                            </p>
                        </div>
                        
                        <div id="users-table-container" style="display: none;">
                            <!-- ExcelTable will be rendered here -->
                        </div>
                    </div>
                </div>
            `,
            width: '700px'
        });

        const form = modal.querySelector('#tenant-form');
        const btnCancel = modal.querySelector('#btn-cancel');

        btnCancel.onclick = () => modal.remove();

        // Attach phone mask
        const phoneInput = modal.querySelector('#tenant-phone');
        attachPhoneMask(phoneInput);

        // Users Section Logic
        const usersToggle = modal.querySelector('#users-toggle');
        const usersContent = modal.querySelector('#users-content');
        const expandIcon = modal.querySelector('#expand-icon');
        const usersPlaceholder = modal.querySelector('#users-placeholder');
        const usersTableContainer = modal.querySelector('#users-table-container');
        const btnAddUser = modal.querySelector('#btn-add-user');
        const usersCount = modal.querySelector('#users-count');

        // Expand/Collapse toggle
        let isExpanded = true;
        usersToggle.onclick = () => {
            isExpanded = !isExpanded;
            usersContent.style.maxHeight = isExpanded ? '400px' : '0';
            usersContent.style.overflow = isExpanded ? 'auto' : 'hidden';
            expandIcon.textContent = isExpanded ? '▼' : '▶';
        };

        // If editing existing tenant, load users
        if (tenantId) {
            usersPlaceholder.style.display = 'none';
            usersTableContainer.style.display = 'block';
            btnAddUser.style.display = 'inline-block';

            // Load users for this tenant
            loadTenantUsers(tenantId);
        }

        // Add user button
        btnAddUser.onclick = () => {
            showUserModal(null, tenantId, () => loadTenantUsers(tenantId));
        };

        // Function to load users
        async function loadTenantUsers(tid) {
            try {
                // Load users via tenantService
                const users = await tenantService.getTenantUsers(tid);
                renderUsersTable(users);
                usersCount.textContent = users.length;
            } catch (error) {
                console.error('Error loading users:', error);
                Dialogs.alert('Erro ao carregar usuários: ' + error.message);
            }
        }

        // Function to render users table
        let usersExcelTable = null;

        function renderUsersTable(users) {
            const container = modal.querySelector('#users-table-container');

            container.innerHTML = '';

            // ExcelTable usa render(item) com item sendo a linha completa,
            // e o constructor aceita um único objeto com { container, columns, ... }.
            const columns = [
                {
                    key: 'name',
                    label: 'Nome',
                    type: 'text',
                    width: '200px',
                    render: (item) => `${item.firstName || ''} ${item.lastName || ''}`.trim()
                },
                {
                    key: 'email',
                    label: 'Email',
                    type: 'text',
                    width: '250px'
                },
                {
                    key: 'role',
                    label: 'Papel',
                    type: 'text',
                    width: '150px',
                    render: (item) => item.role?.name || 'N/A'
                },
                {
                    key: 'actions',
                    label: 'Ações',
                    width: '90px',
                    align: 'center',
                    noFilter: true,
                    render: (item) =>
                        `<button class="btn-icon" data-action="edit" data-id="${item.id}" title="Editar">✏️</button>` +
                        `<button class="btn-icon btn-danger" data-action="delete" data-id="${item.id}" title="Excluir">🗑️</button>`
                }
            ];

            usersExcelTable = new ExcelTable({
                container,
                gridId: 'tenant-users-grid-v1',
                columns,
                enableSelection: false,
                summaryLabels: { total: 'Total de Usuários' }
            });
            usersExcelTable.render(users);

            // Attach event listeners for action buttons using delegation
            // We need to remove previous listeners if re-rendering within same modal instance, 
            // but here we clear container so it's fine.
            // However, ExcelTable might rebuild internally. 
            // Better to attach to container which persists? 
            // ExcelTable appends to container.

            // Let's attach to the container itself, but we need to handle the case where ExcelTable 
            // re-renders its body (e.g. sorting). 
            // ExcelTable attaches its own events. 
            // Our custom render returns HTML strings. 
            // We should attach the listener to the container ONCE or ensure we don't duplicate.
            container.addEventListener('click', async (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;

                const action = target.dataset.action;
                const userId = parseInt(target.dataset.id);
                const user = users.find(u => u.id === userId);

                if (action === 'edit') {
                    showUserModal(userId, tenantId, () => loadTenantUsers(tenantId));
                } else if (action === 'delete' && user) {
                    const confirmed = await Dialogs.confirm(
                        `Excluir usuário ${user.firstName} ${user.lastName}?`,
                        'Esta ação não pode ser desfeita.'
                    );
                    if (confirmed) {
                        try {
                            await userService.deleteUser(userId);
                            Dialogs.alert('Usuário excluído com sucesso!');
                            loadTenantUsers(tenantId);
                        } catch (error) {
                            console.error('Error deleting user:', error);
                            Dialogs.alert('Erro ao excluir usuário: ' + error.message);
                        }
                    }
                }
            });
        }
        // Function to show user modal (placeholder for now)
        // Function to show user modal
        async function showUserModal(userId, tid, onSuccess) {
            const isEdit = !!userId;
            let userData = null;
            let roles = [];

            try {
                // Load roles first
                roles = await roleService.getRoles();

                // If edit, load user data
                if (isEdit) {
                    const response = await userService.getUser(userId);
                    userData = response.user || response;
                }
            } catch (error) {
                console.error('Error loading data:', error);
                Dialogs.alert('Erro ao carregar dados: ' + error.message);
                return;
            }

            const modal = Dialogs.modal({
                title: isEdit ? '✏️ Editar Usuário' : '+ Novo Usuário',
                content: `
                    <form id="user-form" class="form" novalidate>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="user-first-name">Nome <span class="required-asterisk">*</span></label>
                                <input type="text" id="user-first-name" value="${userData?.firstName || ''}" required>
                            </div>
                            <div class="form-group">
                                <label for="user-last-name">Sobrenome <span class="required-asterisk">*</span></label>
                                <input type="text" id="user-last-name" value="${userData?.lastName || ''}" required>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="user-email">Email <span class="required-asterisk">*</span></label>
                                <input type="email" id="user-email" value="${userData?.email || ''}" required>
                            </div>

                            <div class="form-group">
                                <label for="user-role">Papel <span class="required-asterisk">*</span></label>
                                <select id="user-role" required>
                                    <option value="">Selecione...</option>
                                    ${roles.map(role => `
                                        <option value="${role.id}" ${userData?.role?.id === role.id ? 'selected' : ''}>
                                            ${role.name}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="user-password">Senha ${isEdit ? '' : '<span class="required-asterisk">*</span>'}</label>
                                <div style="position: relative;">
                                    <input type="password" id="user-password" ${isEdit ? '' : 'required'} style="padding-right: 40px;">
                                    <span class="password-toggle" data-target="user-password" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; font-size: 1.2rem; user-select: none;">🙈</span>
                                </div>
                                ${isEdit ? '<small style="color: var(--color-text-muted);">Deixe em branco para manter a senha atual</small>' : ''}
                            </div>
                            <div class="form-group">
                                <label for="user-confirm-password">Confirmar Senha ${isEdit ? '' : '<span class="required-asterisk">*</span>'}</label>
                                <div style="position: relative;">
                                    <input type="password" id="user-confirm-password" ${isEdit ? '' : 'required'} style="padding-right: 40px;">
                                    <span class="password-toggle" data-target="user-confirm-password" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; font-size: 1.2rem; user-select: none;">🙈</span>
                                </div>
                            </div>
                        </div>

                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" id="btn-user-cancel">Cancelar</button>
                            <button type="submit" class="btn btn-primary">
                                ${isEdit ? 'Salvar' : 'Criar'}
                            </button>
                        </div>
                    </form>
                `,
                width: '600px'
            });

            const form = modal.querySelector('#user-form');
            const btnCancel = modal.querySelector('#btn-user-cancel');

            // Password toggle logic
            modal.querySelectorAll('.password-toggle').forEach(toggle => {
                toggle.onclick = () => {
                    const targetId = toggle.dataset.target;
                    const input = modal.querySelector(`#${targetId}`);
                    const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
                    input.setAttribute('type', type);
                    toggle.textContent = type === 'password' ? '🙈' : '🐵';
                };
            });

            btnCancel.onclick = () => modal.remove();

            form.onsubmit = async (e) => {
                e.preventDefault();

                // Validate form manually to apply styles
                const requiredFields = form.querySelectorAll('[required]');
                let isValid = true;
                requiredFields.forEach(field => {
                    // Remove error on input
                    field.addEventListener('input', () => {
                        if (field.value.trim()) field.classList.remove('input-error');
                    });

                    if (!field.value.trim()) {
                        field.classList.add('input-error');
                        isValid = false;
                    } else {
                        field.classList.remove('input-error');
                    }
                });

                if (!isValid) {
                    Dialogs.alert('Preencha todos os campos obrigatórios');
                    return;
                }

                const formData = {
                    firstName: document.getElementById('user-first-name').value,
                    lastName: document.getElementById('user-last-name').value,
                    email: document.getElementById('user-email').value,
                    role_id: parseInt(document.getElementById('user-role').value),
                    password: document.getElementById('user-password').value,
                    confirmPassword: document.getElementById('user-confirm-password').value,
                    tenant_id: tid // Pass tenant ID for creation
                };

                if (formData.password !== formData.confirmPassword) {
                    Dialogs.alert('As senhas não coincidem!');
                    return;
                }

                if (isEdit && !formData.password) {
                    delete formData.password;
                }
                // Always remove confirmPassword before sending to API
                delete formData.confirmPassword;

                try {
                    if (isEdit) {
                        await userService.updateUser(userId, formData);
                    } else {
                        await userService.createUser(formData);
                    }

                    Dialogs.alert(isEdit ? 'Usuário atualizado com sucesso!' : 'Usuário criado com sucesso!');
                    modal.remove();
                    if (onSuccess) onSuccess();
                } catch (error) {
                    console.error('Error saving user:', error);
                    Dialogs.alert('Erro ao salvar usuário: ' + error.message);
                }
            };
        }

        form.onsubmit = async (e) => {
            e.preventDefault();

            // Validate form manually to apply styles
            const requiredFields = form.querySelectorAll('[required]');
            let isValid = true;
            requiredFields.forEach(field => {
                // Remove error on input
                field.addEventListener('input', () => {
                    if (field.value.trim()) field.classList.remove('input-error');
                });

                if (!field.value.trim()) {
                    field.classList.add('input-error');
                    isValid = false;
                } else {
                    field.classList.remove('input-error');
                }
            });

            if (!isValid) {
                Dialogs.alert('Preencha todos os campos obrigatórios');
                return;
            }

            const formData = {
                name: document.getElementById('tenant-name').value,
                contact_email: document.getElementById('tenant-contact-email').value,
                contact_name: document.getElementById('tenant-contact-name').value,
                contact_phone: document.getElementById('tenant-phone').value,
                status: document.getElementById('tenant-status').value,
                plan: document.getElementById('tenant-plan').value,
                max_users: parseInt(document.getElementById('tenant-max-users').value)
            };

            // Basic check for new required fields (auto-validation handles visuals, this is a safety net)
            if (!formData.name || !formData.contact_email || !formData.contact_name || !formData.contact_phone) {
                Dialogs.alert('Preencha todos os campos obrigatórios');
                return;
            }

            try {
                if (tenantId) {
                    await tenantService.updateTenant(tenantId, formData);
                } else {
                    await tenantService.createTenant(formData);
                }

                Dialogs.alert(tenantId ? 'Cliente atualizado com sucesso!' : 'Cliente criado com sucesso!');
                modal.remove();
                loadTenants(); // Reload
            } catch (error) {
                console.error('Error saving tenant:', error);
                Dialogs.alert('Erro ao salvar cliente: ' + error.message);
            }
        }
    }

    return container;
}

import { Dialogs } from '../components/Dialogs.js';
import { ExcelTable } from '../components/ExcelTable.js';
import { userService } from '../services/userService.js';
import { roleService } from '../services/roleService.js';
import { formatDateTime, getStatusLabel } from '../utils/formatters.js';

/**
 * User Manager Screen
 * Manages users within tenants
 * Super users see all users, regular users see only their tenant's users
 */
export function UserManager() {
    const container = document.createElement('div');
    container.className = 'screen-container';

    let excelTable = null;
    let roles = [];
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    container.innerHTML = `
        <div class="screen-header">
            <div class="header-title">
                <h1>👥 Gerenciamento de Usuários</h1>
                <p>Gerencie os usuários ${currentUser.isSuperUser ? 'do sistema' : 'da sua empresa'}</p>
            </div>
            <button class="btn btn-primary" id="btn-new-user">
                <span>➕</span> Novo Usuário
            </button>
        </div>

        <div id="table-container" style="flex: 1; display: flex; flex-direction: column;"></div>
    `;

    // Event Listeners
    const btnNewUser = container.querySelector('#btn-new-user');
    btnNewUser.addEventListener('click', () => showUserModal());

    // Initialize ExcelTable
    const tableContainer = container.querySelector('#table-container');

    const columns = [
        {
            key: 'full_name',
            label: 'Usuário',
            type: 'text',
            width: '220px',
            sticky: true,
            render: (user) => {
                const div = document.createElement('div');
                div.className = 'user-info';
                div.style.display = 'flex';
                div.style.flexDirection = 'column';
                div.style.gap = '4px';

                const strong = document.createElement('strong');
                strong.textContent = `${user.first_name} ${user.last_name}`;
                strong.style.color = '#0f172a';
                div.appendChild(strong);

                if (user.is_super_user) {
                    const badge = document.createElement('span');
                    badge.className = 'badge badge-super';
                    badge.textContent = 'Super User';
                    badge.style.fontSize = '0.75rem';
                    badge.style.marginTop = '2px';
                    div.appendChild(badge);
                }

                return div;
            }
        },
        {
            key: 'email',
            label: 'Email',
            type: 'text',
            width: '240px'
        },
        {
            key: 'roles',
            label: 'Roles',
            type: 'text',
            width: '200px',
            render: (user) => {
                const div = document.createElement('div');
                div.className = 'roles-list';
                div.style.display = 'flex';
                div.style.flexWrap = 'wrap';
                div.style.gap = '4px';

                if (user.roles) {
                    const roleNames = user.roles.split(',');
                    roleNames.forEach(roleName => {
                        const badge = document.createElement('span');
                        badge.className = 'badge badge-role';
                        badge.textContent = roleName.trim();
                        badge.style.fontSize = '0.75rem';
                        div.appendChild(badge);
                    });
                } else {
                    div.textContent = '-';
                }

                return div;
            }
        },
        {
            key: 'status',
            label: 'Status',
            type: 'text',
            width: '120px',
            align: 'center',
            render: (user) => {
                const statusMap = {
                    'active': { label: 'Ativo', color: '#10B981' },
                    'pending': { label: 'Pendente', color: '#F59E0B' },
                    'inactive': { label: 'Inativo', color: '#6B7280' },
                    'suspended': { label: 'Suspenso', color: '#EF4444' }
                };
                const status = statusMap[user.status] || { label: user.status, color: '#6B7280' };
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
            key: 'last_login_at',
            label: 'Último Login',
            type: 'date',
            width: '160px',
            align: 'center',
            render: (user) => {
                const span = document.createElement('span');
                if (!user.last_login_at) {
                    span.textContent = 'Nunca';
                    span.style.color = 'var(--color-text-muted)';
                    span.style.fontStyle = 'italic';
                } else {
                    span.textContent = formatDateTime(user.last_login_at);
                }
                return span;
            }
        },
        {
            key: 'actions',
            label: 'Ações',
            width: '160px',
            noFilter: true,
            align: 'center',
            render: (user) => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.gap = '8px';
                div.style.justifyContent = 'center';

                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn-icon';
                btnEdit.innerHTML = '✏️';
                btnEdit.title = 'Editar';
                btnEdit.onclick = (e) => {
                    e.stopPropagation();
                    showUserModal(user.id);
                };

                const btnRoles = document.createElement('button');
                btnRoles.className = 'btn-icon';
                btnRoles.innerHTML = '🎭';
                btnRoles.title = 'Gerenciar Roles';
                btnRoles.onclick = (e) => {
                    e.stopPropagation();
                    manageUserRoles(user.id);
                };

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn-icon btn-danger';
                btnDelete.innerHTML = '🗑️';
                btnDelete.title = 'Excluir';
                btnDelete.onclick = async (e) => {
                    e.stopPropagation();
                    if (user.id === currentUser.id) return; // Can't delete self
                    const confirmed = await Dialogs.confirm(
                        `Excluir usuário "${user.first_name} ${user.last_name}"?`,
                        'Esta ação não pode ser desfeita.'
                    );
                    if (confirmed) {
                        deleteUser(user.id);
                    }
                };

                div.appendChild(btnEdit);
                div.appendChild(btnRoles);
                if (user.id !== currentUser.id) {
                    div.appendChild(btnDelete);
                }

                return div;
            }
        }
    ];

    // Add tenant column for super users
    if (currentUser.isSuperUser) {
        columns.splice(2, 0, {
            key: 'tenant_name',
            label: 'Cliente',
            type: 'text',
            width: '180px',
            render: (user) => {
                const span = document.createElement('span');
                if (user.tenant_name) {
                    span.textContent = user.tenant_name;
                    span.style.color = '#0f172a';
                } else {
                    span.textContent = 'Super User';
                    span.style.fontStyle = 'italic';
                    span.style.color = '#64748b';
                }
                return span;
            }
        });
    }

    excelTable = new ExcelTable({
        container: tableContainer,
        columns: columns,
        gridId: 'user-manager-grid-v1',
        enableSelection: true,
        summaryLabels: {
            total: 'Total de Usuários',
            selected: 'Selecionados'
        },
        onSelectionChange: (items, selection) => {
            console.log(`${selection.size} usuários selecionados`);
        },
        onBulkDelete: async () => {
            const selected = excelTable.getSelectedTotal();
            const confirmed = await Dialogs.confirm(
                `Excluir ${selected.count} usuários?`,
                'Esta ação não pode ser desfeita.'
            );
            if (confirmed) {
                bulkDeleteUsers(selected.items);
            }
        }
    });

    // Load data
    Promise.all([loadUsers(), loadRoles()]);

    // Functions
    async function loadUsers() {
        try {
            const users = await userService.getUsers();
            excelTable.render(users);
        } catch (error) {
            console.error('Error loading users:', error);
            Dialogs.alert('Erro ao carregar usuários: ' + error.message);
        }
    }

    async function loadRoles() {
        try {
            roles = await roleService.getRoles();
        } catch (error) {
            console.error('Error loading roles:', error);
        }
    }

    async function deleteUser(userId) {
        try {
            await userService.deleteUser(userId);
            Dialogs.alert('Usuário excluído com sucesso!');
            loadUsers(); // Reload
        } catch (error) {
            console.error('Error deleting user:', error);
            Dialogs.alert('Erro ao excluir usuário: ' + error.message);
        }
    }

    async function bulkDeleteUsers(users) {
        try {
            const promises = users.map(user => userService.deleteUser(user.id));
            await Promise.all(promises);

            Dialogs.alert(`${users.length} usuários excluídos com sucesso!`);
            excelTable.clearSelection();
            loadUsers(); // Reload
        } catch (error) {
            console.error('Error bulk deleting users:', error);
            Dialogs.alert('Erro ao excluir usuários: ' + error.message);
        }
    }

    function showUserModal(userId = null) {
        const isEdit = userId !== null;
        const users = excelTable.originalData || [];
        const user = isEdit ? users.find(u => u.id === userId) : null;

        const modalContent = `
            <div class="modal-header">
                <h2>${isEdit ? 'Editar Usuário' : 'Novo Usuário'}</h2>
            </div>
            <form id="user-form" class="modal-form">
                <div class="form-row">
                    <div class="form-group">
                        <label for="user-first-name">Nome *</label>
                        <input 
                            type="text" 
                            id="user-first-name" 
                            value="${user?.first_name || ''}" 
                            required
                        />
                    </div>
                    <div class="form-group">
                        <label for="user-last-name">Sobrenome *</label>
                        <input 
                            type="text" 
                            id="user-last-name" 
                            value="${user?.last_name || ''}" 
                            required
                        />
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="user-email">Email *</label>
                        <input 
                            type="email" 
                            id="user-email" 
                            value="${user?.email || ''}" 
                            required
                            ${isEdit ? 'disabled' : ''}
                        />
                    </div>
                    <div class="form-group">
                        <label for="user-phone">Telefone</label>
                        <input 
                            type="tel" 
                            id="user-phone" 
                            value="${user?.phone || ''}"
                        />
                    </div>
                </div>

                ${!isEdit ? `
                    <div class="form-group">
                        <label for="user-password">Senha *</label>
                        <input 
                            type="password" 
                            id="user-password" 
                            minlength="8"
                            required
                            placeholder="Mínimo 8 caracteres"
                        />
                    </div>
                ` : ''}

                <div class="form-row">
                    <div class="form-group">
                        <label for="user-status">Status</label>
                        <select id="user-status">
                            <option value="pending" ${user?.status === 'pending' ? 'selected' : ''}>Pendente</option>
                            <option value="active" ${user?.status === 'active' ? 'selected' : ''}>Ativo</option>
                            <option value="inactive" ${user?.status === 'inactive' ? 'selected' : ''}>Inativo</option>
                            <option value="suspended" ${user?.status === 'suspended' ? 'selected' : ''}>Suspenso</option>
                        </select>
                    </div>
                </div>

                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" id="btn-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">${isEdit ? 'Salvar' : 'Criar'}</button>
                </div>
            </form>
        `;

        const modal = Dialogs.custom(modalContent, { width: '600px' });
        const form = modal.querySelector('#user-form');
        const btnCancel = modal.querySelector('#btn-cancel');

        btnCancel.addEventListener('click', () => Dialogs.close());

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = {
                first_name: document.getElementById('user-first-name').value,
                last_name: document.getElementById('user-last-name').value,
                phone: document.getElementById('user-phone').value,
                status: document.getElementById('user-status').value
            };

            if (!isEdit) {
                formData.email = document.getElementById('user-email').value;
                formData.password = document.getElementById('user-password').value;
            }

            try {
                if (isEdit) {
                    await userService.updateUser(userId, formData);
                } else {
                    await userService.createUser(formData);
                }

                Dialogs.close();
                Dialogs.alert(isEdit ? 'Usuário atualizado com sucesso!' : 'Usuário criado com sucesso!');
                loadUsers();
            } catch (error) {
                console.error('Error saving user:', error);
                Dialogs.alert('Erro: ' + error.message);
            }
        });
    }

    async function manageUserRoles(userId) {
        const users = excelTable.originalData || [];
        const user = users.find(u => u.id === userId);

        // Get current user roles
        const currentRoleIds = user.roles ? user.roles.split(',').map(roleName => {
            const role = roles.find(r => r.name === roleName.trim());
            return role ? role.id : null;
        }).filter(id => id !== null) : [];

        const modalContent = `
            <div class="modal-header">
                <h2>🎭 Gerenciar Roles - ${user.first_name} ${user.last_name}</h2>
            </div>
            <form id="roles-form" class="modal-form">
                <div class="roles-checklist">
                    ${roles.map(role => `
                        <label class="role-checkbox">
                            <input 
                                type="checkbox" 
                                name="role" 
                                value="${role.id}"
                                ${currentRoleIds.includes(role.id) ? 'checked' : ''}
                            />
                            <span class="role-info">
                                <strong>${role.name}</strong>
                                <small>${role.description || ''}</small>
                            </span>
                        </label>
                    `).join('')}
                </div>

                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" id="btn-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </form>
        `;

        const modal = Dialogs.custom(modalContent, { width: '500px' });
        const form = modal.querySelector('#roles-form');
        const btnCancel = modal.querySelector('#btn-cancel');

        btnCancel.addEventListener('click', () => Dialogs.close());

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const checkboxes = form.querySelectorAll('input[name="role"]:checked');
            const roleIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

            try {
                await userService.assignRoles(userId, roleIds);
                Dialogs.close();
                Dialogs.alert('Roles atualizadas com sucesso!');
                loadUsers();
            } catch (error) {
                console.error('Error assigning roles:', error);
                Dialogs.alert('Erro: ' + error.message);
            }
        });
    }

    return container;
}

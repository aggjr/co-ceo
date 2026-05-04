import { Dialogs } from '../components/Dialogs.js';
import { ExcelTable } from '../components/ExcelTable.js';
import { roleService } from '../services/roleService.js';
import { formatDate } from '../utils/formatters.js';

/**
 * Role Manager Screen
 * Manages roles and their permissions
 */
export function RoleManager() {
    const container = document.createElement('div');
    container.className = 'screen-container';

    let excelTable = null;
    let permissions = [];
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    container.innerHTML = `
        <div class="screen-header">
            <div class="header-title">
                <h1>🎭 Gerenciamento de Papéis</h1>
                <p>Gerencie os papéis e suas permissões</p>
            </div>
            <button class="btn btn-primary" id="btn-new-role">
                <span>➕</span> Novo Papel
            </button>
        </div>

        <div id="table-container" style="flex: 1; display: flex; flex-direction: column;"></div>
    `;

    // Event Listeners
    const btnNewRole = container.querySelector('#btn-new-role');
    btnNewRole.addEventListener('click', () => showRoleModal());

    // Initialize ExcelTable
    const tableContainer = container.querySelector('#table-container');

    excelTable = new ExcelTable({
        container: tableContainer,
        gridId: 'role-manager-grid-v1',
        columns: [
            {
                key: 'name',
                label: 'Papel',
                type: 'text',
                width: '250px',
                sticky: true,
                render: (role) => {
                    const div = document.createElement('div');
                    div.className = 'role-info';
                    div.style.display = 'flex';
                    div.style.flexDirection = 'column';
                    div.style.gap = '4px';

                    const strong = document.createElement('strong');
                    strong.textContent = role.name;
                    div.appendChild(strong);

                    if (role.description) {
                        const small = document.createElement('small');
                        small.textContent = role.description;
                        small.style.color = 'var(--color-text-muted)';
                        small.style.fontSize = '0.85rem';
                        div.appendChild(small);
                    }

                    return div;
                }
            },
            {
                key: 'level',
                label: 'Nível',
                type: 'number',
                width: '100px',
                align: 'center',
                render: (role) => {
                    const span = document.createElement('span');
                    span.className = 'badge badge-level';
                    span.textContent = role.level;
                    span.style.padding = '4px 12px';
                    span.style.borderRadius = '12px';
                    span.style.backgroundColor = '#3B82F620';
                    span.style.color = '#3B82F6';
                    span.style.fontWeight = '600';
                    span.style.fontSize = '0.85rem';
                    return span;
                }
            },
            {
                key: 'is_system_role',
                label: 'Tipo',
                type: 'text',
                width: '140px',
                align: 'center',
                render: (role) => {
                    const span = document.createElement('span');
                    if (role.is_system_role) {
                        span.className = 'badge badge-super';
                        span.textContent = 'Sistema';
                        span.style.backgroundColor = '#8B5CF620';
                        span.style.color = '#8B5CF6';
                    } else {
                        span.className = 'badge badge-role';
                        span.textContent = 'Customizada';
                        span.style.backgroundColor = '#10B98120';
                        span.style.color = '#10B981';
                    }
                    span.style.padding = '4px 12px';
                    span.style.borderRadius = '12px';
                    span.style.fontWeight = '600';
                    span.style.fontSize = '0.85rem';
                    return span;
                }
            },
            {
                key: 'user_count',
                label: 'Usuários',
                type: 'number',
                width: '100px',
                align: 'center',
                render: (role) => {
                    const span = document.createElement('span');
                    span.className = 'user-count';
                    span.textContent = role.user_count || 0;
                    span.style.fontWeight = '600';
                    span.style.color = 'var(--color-primary)';
                    return span;
                }
            },
            {
                key: 'created_at',
                label: 'Criada em',
                type: 'date',
                width: '120px',
                align: 'center',
                render: (role) => {
                    const span = document.createElement('span');
                    span.textContent = formatDate(role.created_at);
                    return span;
                }
            },
            {
                key: 'actions',
                label: 'Ações',
                width: '160px',
                noFilter: true,
                align: 'center',
                render: (role) => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.gap = '8px';
                    div.style.justifyContent = 'center';

                    const btnPermissions = document.createElement('button');
                    btnPermissions.className = 'btn-icon';
                    btnPermissions.innerHTML = '🔐';
                    btnPermissions.title = 'Permissões';
                    btnPermissions.onclick = (e) => {
                        e.stopPropagation();
                        manageRolePermissions(role.id);
                    };

                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn-icon';
                    btnEdit.innerHTML = '✏️';
                    btnEdit.title = 'Editar';
                    btnEdit.onclick = (e) => {
                        e.stopPropagation();
                        showRoleModal(role.id);
                    };

                    const btnDelete = document.createElement('button');
                    btnDelete.className = 'btn-icon btn-danger';
                    btnDelete.innerHTML = '🗑️';
                    btnDelete.title = 'Excluir';
                    btnDelete.onclick = async (e) => {
                        e.stopPropagation();
                        // Can't delete system roles or roles with users
                        if (role.is_system_role || role.user_count > 0) return;
                        const confirmed = await Dialogs.confirm(
                            `Excluir role "${role.name}"?`,
                            'Esta ação não pode ser desfeita.'
                        );
                        if (confirmed) {
                            deleteRole(role.id);
                        }
                    };

                    div.appendChild(btnPermissions);
                    div.appendChild(btnEdit);
                    if (!role.is_system_role && role.user_count === 0) {
                        div.appendChild(btnDelete);
                    }

                    return div;
                }
            }
        ],
        enableSelection: true,
        summaryLabels: {
            total: 'Total de Papéis',
            selected: 'Selecionados'
        },
        onSelectionChange: (items, selection) => {
            console.log(`${selection.size} papéis selecionados`);
        },
        onBulkDelete: async () => {
            const selected = excelTable.getSelectedTotal();
            // Filter out system roles and roles with users
            const deletableRoles = selected.items.filter(r => !r.is_system_role && r.user_count === 0);

            if (deletableRoles.length === 0) {
                Dialogs.alert('Nenhum papel pode ser excluído. Papéis de sistema e papéis com usuários não podem ser removidos.');
                return;
            }

            const confirmed = await Dialogs.confirm(
                `Excluir ${deletableRoles.length} papéis?`,
                'Esta ação não pode ser desfeita. Papéis de sistema e com usuários serão ignorados.'
            );
            if (confirmed) {
                bulkDeleteRoles(deletableRoles);
            }
        }
    });

    // Load data
    Promise.all([loadRoles(), loadPermissions()]);

    // Functions
    async function loadRoles() {
        try {
            const roles = await roleService.getRoles();
            excelTable.render(roles);
        } catch (error) {
            console.error('Error loading roles:', error);
            Dialogs.alert('Erro ao carregar roles: ' + error.message);
        }
    }

    async function loadPermissions() {
        try {
            permissions = await roleService.getPermissions();
        } catch (error) {
            console.error('Error loading permissions:', error);
        }
    }

    async function deleteRole(roleId) {
        try {
            await roleService.deleteRole(roleId);
            Dialogs.alert('Papel excluído com sucesso!');
            loadRoles(); // Reload
        } catch (error) {
            console.error('Error deleting role:', error);
            Dialogs.alert('Erro ao excluir papel: ' + error.message);
        }
    }

    async function bulkDeleteRoles(roles) {
        try {
            const promises = roles.map(role => roleService.deleteRole(role.id));
            await Promise.all(promises);

            Dialogs.alert(`${roles.length} papéis excluídos com sucesso!`);
            excelTable.clearSelection();
            loadRoles(); // Reload
        } catch (error) {
            console.error('Error bulk deleting roles:', error);
            Dialogs.alert('Erro ao excluir papéis: ' + error.message);
        }
    }

    function showRoleModal(roleId = null) {
        const isEdit = roleId !== null;
        const roles = excelTable.originalData || [];
        const role = isEdit ? roles.find(r => r.id === roleId) : null;

        // Can't edit system roles unless super user
        if (isEdit && role.is_system_role && !currentUser.isSuperUser) {
            Dialogs.alert('Apenas super usuários podem editar papéis de sistema.');
            return;
        }

        const modalContent = `
            <div class="modal-header">
                <h2>${isEdit ? 'Editar Papel' : 'Novo Papel'}</h2>
            </div>
            <form id="role-form" class="modal-form">
                <div class="form-group">
                    <label for="role-name">Nome *</label>
                    <input 
                        type="text" 
                        id="role-name" 
                        value="${role?.name || ''}" 
                        required
                    />
                </div>

                ${!isEdit ? `
                    <div class="form-group">
                        <label for="role-slug">Slug *</label>
                        <input 
                            type="text" 
                            id="role-slug" 
                            value="${role?.slug || ''}" 
                            required
                            placeholder="ex: gerente-producao"
                        />
                    </div>
                ` : ''}

                <div class="form-group">
                    <label for="role-description">Descrição</label>
                    <textarea 
                        id="role-description" 
                        rows="3"
                    >${role?.description || ''}</textarea>
                </div>

                <div class="form-group">
                    <label for="role-level">Nível (1-100)</label>
                    <input 
                        type="number" 
                        id="role-level" 
                        value="${role?.level || 10}" 
                        min="1"
                        max="100"
                    />
                    <small style="color: var(--color-text-secondary);">
                        Níveis mais altos têm mais autoridade
                    </small>
                </div>

                ${currentUser.isSuperUser && !isEdit ? `
                    <div class="form-group">
                        <label>
                            <input 
                                type="checkbox" 
                                id="role-is-system"
                            />
                            Papel de Sistema (disponível para todos os clientes)
                        </label>
                    </div>
                ` : ''}

                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" id="btn-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">${isEdit ? 'Salvar' : 'Criar'}</button>
                </div>
            </form>
        `;

        const modal = Dialogs.custom(modalContent, { width: '500px' });
        const form = modal.querySelector('#role-form');
        const btnCancel = modal.querySelector('#btn-cancel');

        btnCancel.addEventListener('click', () => Dialogs.close());

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = {
                name: document.getElementById('role-name').value,
                description: document.getElementById('role-description').value,
                level: parseInt(document.getElementById('role-level').value)
            };

            if (!isEdit) {
                formData.slug = document.getElementById('role-slug').value;
                if (currentUser.isSuperUser) {
                    formData.is_system_role = document.getElementById('role-is-system')?.checked || false;
                }
            }

            try {
                if (isEdit) {
                    await roleService.updateRole(roleId, formData);
                } else {
                    await roleService.createRole(formData);
                }

                Dialogs.close();
                Dialogs.alert(isEdit ? 'Papel atualizado com sucesso!' : 'Papel criado com sucesso!');
                loadRoles();
            } catch (error) {
                console.error('Error saving role:', error);
                Dialogs.alert('Erro: ' + error.message);
            }
        });
    }

    async function manageRolePermissions(roleId) {
        const roles = excelTable.originalData || [];
        const role = roles.find(r => r.id === roleId);

        // Load current permissions for this role
        let currentPermissions = [];
        try {
            currentPermissions = await roleService.getRolePermissions(roleId);
        } catch (error) {
            console.error('Error loading role permissions:', error);
        }

        const currentPermissionIds = currentPermissions.map(p => p.id);

        // Group permissions by module
        const permissionsByModule = permissions.reduce((acc, perm) => {
            if (!acc[perm.module]) {
                acc[perm.module] = [];
            }
            acc[perm.module].push(perm);
            return acc;
        }, {});

        const modalContent = `
            <div class="modal-header">
                <h2>🔐 Permissões - ${role.name}</h2>
            </div>
            <form id="permissions-form" class="modal-form">
                <div class="permissions-container">
                    ${Object.entries(permissionsByModule).map(([module, perms]) => `
                        <div class="permission-module">
                            <h3 class="module-title">${module}</h3>
                            <div class="permissions-grid">
                                ${perms.map(perm => `
                                    <label class="permission-checkbox">
                                        <input 
                                            type="checkbox" 
                                            name="permission" 
                                            value="${perm.id}"
                                            ${currentPermissionIds.includes(perm.id) ? 'checked' : ''}
                                        />
                                        <span class="permission-info">
                                            <strong>${perm.resource}.${perm.action}</strong>
                                            ${perm.field ? `<small>Campo: ${perm.field}</small>` : ''}
                                            ${perm.description ? `<small>${perm.description}</small>` : ''}
                                        </span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" id="btn-cancel">Cancelar</button>
                    <button type="submit" class="btn btn-primary">Salvar Permissões</button>
                </div>
            </form>
        `;

        const modal = Dialogs.custom(modalContent, { width: '800px', maxHeight: '80vh' });
        const form = modal.querySelector('#permissions-form');
        const btnCancel = modal.querySelector('#btn-cancel');

        btnCancel.addEventListener('click', () => Dialogs.close());

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const checkboxes = form.querySelectorAll('input[name="permission"]:checked');
            const permissionIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

            try {
                await roleService.assignPermissions(roleId, permissionIds);
                Dialogs.close();
                Dialogs.alert('Permissões atualizadas com sucesso!');
            } catch (error) {
                console.error('Error assigning permissions:', error);
                Dialogs.alert('Erro: ' + error.message);
            }
        });
    }

    return container;
}

/**
 * bankView.js — Extrato Bancário e Conciliação
 */
import { ExcelTable } from '../../../components/ExcelTable.js';

const API = '/api/invest/bank';

function fmtMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—'; }

const STATUS_BADGE = {
  pending:    '<span style="color:#cbd5e0;background:rgba(255,255,255,.1);padding:2px 6px;border-radius:4px;font-size:.7rem;">Pendente</span>',
  reconciled: '<span style="color:#68d391;background:rgba(72,187,120,.15);padding:2px 6px;border-radius:4px;font-size:.7rem;">✅ Conciliado</span>',
  divergence: '<span style="color:#fc8181;background:rgba(245,101,101,.15);padding:2px 6px;border-radius:4px;font-size:.7rem;">⚠️ Divergência</span>',
  ignored:    '<span style="color:#a0aec0;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:4px;font-size:.7rem;">Ignorado</span>',
};

const GRID_ID = 'invest-bank-v1';

const COLUMNS = [
  { key: 'date',             label: 'Data',          width: 100, render: r => fmtDate(r.date) },
  { key: 'bank_name',        label: 'Banco',         width: 120, render: r => r.bank_name },
  { key: 'description',      label: 'Histórico',     width: 250, render: r => r.description },
  { key: 'debit',            label: 'Saída (-)',     width: 100, align: 'right', render: r => r.debit > 0 ? `<span class="invest-negative">${fmtMoney(r.debit)}</span>` : '' },
  { key: 'credit',           label: 'Entrada (+)',   width: 100, align: 'right', render: r => r.credit > 0 ? `<span class="invest-positive">${fmtMoney(r.credit)}</span>` : '' },
  { key: 'balance',          label: 'Saldo',         width: 110, align: 'right', render: r => fmtMoney(r.balance) },
  { key: 'reconcile_status', label: 'Status',        width: 110, align: 'center', render: r => STATUS_BADGE[r.reconcile_status] || r.reconcile_status },
];

export async function mount(host) {
  const currentYear = new Date().getFullYear();

  const toolbar = document.createElement('div');
  toolbar.className = 'invest-toolbar';
  toolbar.innerHTML = `
    <span class="invest-toolbar-title">🏦 Conciliação Bancária</span>
    <div class="invest-toolbar-actions">
      <select id="inv-bank-acc" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;max-width:180px;">
        <option value="">Selecione a Conta...</option>
      </select>
      <button id="inv-bank-search">🔍 Buscar</button>
      <button class="invest-btn" id="inv-bank-import">📤 Importar CSV</button>
    </div>
  `;
  host.appendChild(toolbar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
  host.appendChild(content);

  async function loadAccounts() {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      if (JSON.parse(localStorage.getItem('user') || '{}').isSuperUser) {
         const tid = localStorage.getItem('activeTenantId'); if (tid) headers['x-tenant-id'] = tid;
      }
      const resp = await fetch(`${API}/accounts`, { headers });
      const { data } = await resp.json();
      const select = document.getElementById('inv-bank-acc');
      if (data && select) {
        data.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = `${a.bank_name} (${a.account || '—'})`;
          select.appendChild(opt);
        });
        if (data.length === 1) {
          select.value = data[0].id;
          loadData();
        }
      }
    } catch (e) { console.error(e); }
  }

  async function loadData() {
    const accId = document.getElementById('inv-bank-acc')?.value;
    if (!accId) {
      content.innerHTML = `<div class="invest-empty"><span>Selecione uma conta bancária para ver o extrato.</span></div>`;
      return;
    }

    content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Buscando extrato…</span></div>`;
    const token  = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    if (JSON.parse(localStorage.getItem('user') || '{}').isSuperUser) {
       const tid = localStorage.getItem('activeTenantId'); if (tid) headers['x-tenant-id'] = tid;
    }

    try {
      const resp = await fetch(`${API}/statements?account_id=${accId}`, { headers });
      const { data } = await resp.json();

      if (!data || data.length === 0) {
        content.innerHTML = `<div class="invest-empty"><span>Nenhum lançamento encontrado nesta conta.</span><br/>
          <button class="invest-btn" onclick="document.getElementById('inv-bank-import').click()">Importar extrato agora</button></div>`;
        return;
      }
      content.innerHTML = '';
      const table = new ExcelTable({ gridId: GRID_ID, columns: COLUMNS, data, readOnly: true, stickyHeader: true });
      content.appendChild(table.el);
    } catch (err) {
      content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⚠️</span><span>${err.message}</span></div>`;
    }
  }

  toolbar.querySelector('#inv-bank-search').addEventListener('click', loadData);
  toolbar.querySelector('#inv-bank-import').addEventListener('click', () => alert('Seletor de CSV — em breve!'));
  document.getElementById('inv-bank-acc').addEventListener('change', loadData);

  await loadAccounts();
}

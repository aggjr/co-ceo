/**
 * expensesView.js — Gestão de Despesas (Taxas, Emolumentos, DARF)
 */
import { ExcelTable } from '../../../components/ExcelTable.js';

const API = '/api/invest';

function fmtMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—'; }

const GRID_ID = 'invest-expenses-v1';

const COLUMNS = [
  { key: 'date',          label: 'Data',         width: 100, render: r => fmtDate(r.date) },
  { key: 'type_name',     label: 'Tipo Despesa', width: 160, render: r => r.type_name },
  { key: 'ticker',        label: 'Ativo',        width: 90,  render: r => r.ticker ? `<strong>${r.ticker}</strong>` : '—' },
  { key: 'amount',        label: 'Valor',        width: 110, align: 'right', render: r => `<strong class="invest-negative">${fmtMoney(r.amount)}</strong>` },
  { key: 'affects_cost',  label: 'Afeta PM?',    width: 80,  align: 'center', render: r => r.affects_cost ? '✅ Sim' : '❌ Não' },
  { key: 'description',   label: 'Descrição',    width: 250, render: r => r.description || '' },
];

export async function mount(host) {
  const currentYear = new Date().getFullYear();

  const toolbar = document.createElement('div');
  toolbar.className = 'invest-toolbar';
  toolbar.innerHTML = `
    <span class="invest-toolbar-title">🧾 Despesas de Investimento</span>
    <div class="invest-toolbar-actions">
      <label style="font-size:.78rem;color:#718096;">De:&nbsp;<input type="date" id="inv-exp-from" value="${currentYear}-01-01" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <label style="font-size:.78rem;color:#718096;">Até:&nbsp;<input type="date" id="inv-exp-to" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <select id="inv-exp-type" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;max-width:150px;">
        <option value="">Todos os Tipos</option>
      </select>
      <button id="inv-exp-search">🔍 Buscar</button>
      <button class="invest-btn invest-btn--primary" id="inv-exp-add">+ Lançar Despesa</button>
    </div>
  `;
  host.appendChild(toolbar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
  host.appendChild(content);

  async function loadFilters() {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const resp = await fetch(`${API}/expenses/types`, { headers });
      const { data } = await resp.json();
      const select = document.getElementById('inv-exp-type');
      if (data && select) {
        data.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name;
          select.appendChild(opt);
        });
      }
    } catch (e) { console.error('Filtro despesas falhou:', e); }
  }

  async function loadData() {
    content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Carregando despesas…</span></div>`;
    const token  = localStorage.getItem('token');
    const user   = JSON.parse(localStorage.getItem('user') || '{}');
    const headers = { Authorization: `Bearer ${token}` };
    if (user.isSuperUser) { const tid = localStorage.getItem('activeTenantId'); if (tid) headers['x-tenant-id'] = tid; }

    const from   = document.getElementById('inv-exp-from')?.value || '';
    const to     = document.getElementById('inv-exp-to')?.value   || '';
    const tid    = document.getElementById('inv-exp-type')?.value || '';

    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    if (tid)  qs.set('type_id', tid);

    try {
      const resp = await fetch(`${API}/expenses?${qs}`, { headers });
      const { data } = await resp.json();

      if (!data || data.length === 0) {
        content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">🧾</span><span>Nenhuma despesa lançada.</span></div>`;
        return;
      }
      content.innerHTML = '';
      const table = new ExcelTable({ gridId: GRID_ID, columns: COLUMNS, data, readOnly: true, stickyHeader: true });
      content.appendChild(table.el);

      const total = data.reduce((s, r) => s + Number(r.amount || 0), 0);
      const summary = document.createElement('div');
      summary.style.cssText = 'display:flex;padding:0.6rem 1.25rem;background:rgba(0,0,0,.3);border-top:1px solid rgba(255,255,255,.06);font-size:0.85rem;flex-shrink:0;';
      summary.innerHTML = `Total Despesas: <strong class="invest-negative" style="margin-left: 8px;">${fmtMoney(total)}</strong>`;
      content.appendChild(summary);
    } catch (err) {
      content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⚠️</span><span>${err.message}</span></div>`;
    }
  }

  toolbar.querySelector('#inv-exp-search').addEventListener('click', loadData);
  toolbar.querySelector('#inv-exp-add').addEventListener('click', () => alert('Modal lançamento de despesa — em breve!'));

  await loadFilters();
  await loadData();
}

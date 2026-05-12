/**
 * transactionsView.js — Histórico de Operações INVEST
 */
import { ExcelTable } from '../../../components/ExcelTable.js';

const API = '/api/invest';

function fmtMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—'; }

const TYPE_LABELS = {
  buy: '🟢 Compra', sell: '🔴 Venda',
  dividend: '💰 Dividendo', jcp: '💵 JCP',
  redemption: '↩️ Resgate', subscription: '📋 Subscrição',
};
const ASSET_LABELS = {
  equity: 'Ação', option: 'Opção', fii: 'FII', fixed_income: 'Renda Fixa', treasury: 'Tesouro',
};

const GRID_ID = 'invest-transactions-v1';

const COLUMNS = [
  { key: 'date',             label: 'Data',         width: 100, render: r => fmtDate(r.date) },
  { key: 'transaction_type', label: 'Tipo',         width: 120, render: r => TYPE_LABELS[r.transaction_type] || r.transaction_type },
  { key: 'asset_type',       label: 'Classe',       width: 90,  render: r => ASSET_LABELS[r.asset_type] || r.asset_type },
  { key: 'ticker',           label: 'Ativo',        width: 90,  render: r => `<strong>${r.ticker}</strong>` },
  { key: 'quantity',         label: 'Qtd',          width: 80,  align: 'right', render: r => Number(r.quantity).toLocaleString('pt-BR') },
  { key: 'price',            label: 'Preço',        width: 100, align: 'right', render: r => fmtMoney(r.price) },
  { key: 'fees',             label: 'Taxas',        width: 90,  align: 'right', render: r => fmtMoney(r.fees) },
  { key: 'ir_withheld',      label: 'IR Retido',    width: 90,  align: 'right', render: r => fmtMoney(r.ir_withheld) },
  { key: 'total_expenses',   label: 'Despesas',     width: 90,  align: 'right', render: r => fmtMoney(r.total_expenses) },
  { key: 'total_real_cost',  label: 'Total Real',   width: 110, align: 'right', render: r => fmtMoney(r.total_real_cost) },
  { key: 'notes',            label: 'Obs.',         width: 200, render: r => r.notes || '' },
];

export async function mount(host) {
  const currentYear = new Date().getFullYear();

  const toolbar = document.createElement('div');
  toolbar.className = 'invest-toolbar';
  toolbar.innerHTML = `
    <span class="invest-toolbar-title">🔄 Operações</span>
    <div class="invest-toolbar-actions">
      <label style="font-size:.78rem;color:#718096;">De:&nbsp;<input type="date" id="inv-txn-from" value="${currentYear}-01-01" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <label style="font-size:.78rem;color:#718096;">Até:&nbsp;<input type="date" id="inv-txn-to" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <input type="text" id="inv-txn-ticker" placeholder="Ativo (ex: PETR4)" style="width:110px;background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 8px;font-size:.78rem;">
      <button id="inv-txn-search">🔍 Buscar</button>
      <button class="invest-btn invest-btn--primary" id="inv-txn-add">+ Lançar</button>
    </div>
  `;
  host.appendChild(toolbar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
  host.appendChild(content);

  async function loadData() {
    content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Carregando operações…</span></div>`;
    const token  = localStorage.getItem('token');
    const user   = JSON.parse(localStorage.getItem('user') || '{}');
    const headers = { Authorization: `Bearer ${token}` };
    if (user.isSuperUser) { const tid = localStorage.getItem('activeTenantId'); if (tid) headers['x-tenant-id'] = tid; }

    const from   = document.getElementById('inv-txn-from')?.value || '';
    const to     = document.getElementById('inv-txn-to')?.value   || '';
    const ticker = (document.getElementById('inv-txn-ticker')?.value || '').trim().toUpperCase();

    const qs = new URLSearchParams();
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (ticker) qs.set('ticker', ticker);
    qs.set('limit', '500');

    try {
      const resp = await fetch(`${API}/transactions?${qs}`, { headers });
      const { data } = await resp.json();

      if (!data || data.length === 0) {
        content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">📋</span><span>Nenhuma operação encontrada.</span></div>`;
        return;
      }
      content.innerHTML = '';
      const table = new ExcelTable({ gridId: GRID_ID, columns: COLUMNS, data, readOnly: true, stickyHeader: true });
      content.appendChild(table.el);
    } catch (err) {
      content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⚠️</span><span>${err.message}</span></div>`;
    }
  }

  toolbar.querySelector('#inv-txn-search').addEventListener('click', loadData);
  toolbar.querySelector('#inv-txn-add').addEventListener('click', () => alert('Modal de lançamento — em breve!'));

  await loadData();
}

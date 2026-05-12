/**
 * dividendsView.js — Proventos (Dividendos, JCP, FII)
 */
import { ExcelTable } from '../../components/ExcelTable.js';

const API = '/api/invest';

function fmtMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—'; }

const DIV_TYPE_LABELS = {
  dividend: '💰 Dividendo',
  jcp: '💵 JCP',
  fii_income: '🏢 Rend. FII',
  interest: '📈 Juros',
};

const GRID_ID = 'invest-dividends-v1';

const COLUMNS = [
  { key: 'payment_date',   label: 'Pagamento',    width: 100, render: r => fmtDate(r.payment_date) },
  { key: 'ex_date',        label: 'Data EX',      width: 100, render: r => fmtDate(r.ex_date) },
  { key: 'dividend_type',  label: 'Tipo',         width: 120, render: r => DIV_TYPE_LABELS[r.dividend_type] || r.dividend_type },
  { key: 'ticker',         label: 'Ativo',        width: 90,  render: r => `<strong>${r.ticker}</strong>` },
  { key: 'quantity_held',  label: 'Qtd. Base',    width: 90,  align: 'right', render: r => Number(r.quantity_held).toLocaleString('pt-BR') },
  { key: 'value_per_share',label: 'Valor/Unit',   width: 100, align: 'right', render: r => fmtMoney(r.value_per_share) },
  { key: 'total_gross',    label: 'Bruto',        width: 110, align: 'right', render: r => fmtMoney(r.total_gross) },
  { key: 'ir_withheld',    label: 'IR Retido',    width: 90,  align: 'right', render: r => fmtMoney(r.ir_withheld) },
  { key: 'total_net',      label: 'Líquido',      width: 110, align: 'right', render: r => `<strong class="invest-positive">${fmtMoney(r.total_net)}</strong>` },
  { key: 'notes',          label: 'Obs.',         width: 200, render: r => r.notes || '' },
];

export async function mount(host) {
  const currentYear = new Date().getFullYear();

  const toolbar = document.createElement('div');
  toolbar.className = 'invest-toolbar';
  toolbar.innerHTML = `
    <span class="invest-toolbar-title">💰 Proventos</span>
    <div class="invest-toolbar-actions">
      <label style="font-size:.78rem;color:#718096;">De:&nbsp;<input type="date" id="inv-div-from" value="${currentYear}-01-01" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <label style="font-size:.78rem;color:#718096;">Até:&nbsp;<input type="date" id="inv-div-to" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <input type="text" id="inv-div-ticker" placeholder="Ativo" style="width:90px;background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 8px;font-size:.78rem;">
      <button id="inv-div-search">🔍 Filtrar</button>
      <button class="invest-btn invest-btn--primary" id="inv-div-add">+ Lançar Provento</button>
    </div>
  `;
  host.appendChild(toolbar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
  host.appendChild(content);

  async function loadData() {
    content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Carregando proventos…</span></div>`;
    const token  = localStorage.getItem('token');
    const user   = JSON.parse(localStorage.getItem('user') || '{}');
    const headers = { Authorization: `Bearer ${token}` };
    if (user.isSuperUser) { const tid = localStorage.getItem('activeTenantId'); if (tid) headers['x-tenant-id'] = tid; }

    const from   = document.getElementById('inv-div-from')?.value || '';
    const to     = document.getElementById('inv-div-to')?.value   || '';
    const ticker = (document.getElementById('inv-div-ticker')?.value || '').trim().toUpperCase();

    const qs = new URLSearchParams();
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (ticker) qs.set('ticker', ticker);

    try {
      const resp = await fetch(`${API}/dividends?${qs}`, { headers });
      const { data } = await resp.json();

      if (!data || data.length === 0) {
        content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">💰</span><span>Nenhum provento registrado no período.</span></div>`;
        return;
      }
      content.innerHTML = '';
      const table = new ExcelTable({ gridId: GRID_ID, columns: COLUMNS, data, readOnly: true, stickyHeader: true });
      content.appendChild(table.el);

      // Totalizador
      const totalNet = data.reduce((s, r) => s + Number(r.total_net || 0), 0);
      const summary = document.createElement('div');
      summary.style.cssText = 'display:flex;padding:0.6rem 1.25rem;background:rgba(0,0,0,.3);border-top:1px solid rgba(255,255,255,.06);font-size:0.85rem;flex-shrink:0;';
      summary.innerHTML = `Total Líquido no Período: <strong class="invest-positive" style="margin-left: 8px;">${fmtMoney(totalNet)}</strong>`;
      content.appendChild(summary);

    } catch (err) {
      content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⚠️</span><span>${err.message}</span></div>`;
    }
  }

  toolbar.querySelector('#inv-div-search').addEventListener('click', loadData);
  toolbar.querySelector('#inv-div-add').addEventListener('click', () => alert('Lançamento manual de proventos — em breve!'));

  await loadData();
}

/**
 * portfolioView.js — Carteira de Investimentos
 * Tela principal do módulo INVEST: posições abertas com preços em tempo real.
 */
import { ExcelTable } from '../../components/ExcelTable.js';

const API = '/api/invest';

function fmtMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtPct(v) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
}
function fmtQty(v) {
  return v == null ? '—' : Number(v).toLocaleString('pt-BR');
}
function assetBadge(type) {
  const MAP = {
    equity:        ['equity',   'Ação'],
    option:        ['option',   'Opção'],
    fii:           ['fii',      'FII'],
    fixed_income:  ['fixed',    'Renda Fixa'],
    treasury:      ['treasury', 'Tesouro'],
  };
  const [cls, label] = MAP[type] || ['equity', type];
  return `<span class="invest-badge invest-badge--${cls}">${label}</span>`;
}
function plClass(v) { return v > 0 ? 'invest-positive' : v < 0 ? 'invest-negative' : 'invest-neutral'; }

const GRID_ID = 'invest-portfolio-v1';

const COLUMNS = [
  { key: 'asset_type',    label: 'Tipo',       width: 90,  render: r => assetBadge(r.asset_type) },
  { key: 'ticker',        label: 'Ativo',      width: 90,  render: r => `<strong>${r.ticker}</strong>` },
  { key: 'name',          label: 'Nome',       width: 200, render: r => r.name || '—' },
  { key: 'quantity',      label: 'Qtd',        width: 80,  align: 'right', render: r => fmtQty(r.quantity) },
  { key: 'average_price', label: 'PM (R$)',    width: 100, align: 'right', render: r => fmtMoney(r.average_price) },
  { key: 'total_cost',    label: 'Custo Total',width: 120, align: 'right', render: r => fmtMoney(r.total_cost) },
  { key: 'current_price', label: 'Cotação',    width: 100, align: 'right',
    render: r => r.current_price != null
      ? `<div>${fmtMoney(r.current_price)}</div><div class="invest-quote-ts">${r.quote_fetched_at ? new Date(r.quote_fetched_at).toLocaleTimeString('pt-BR') : ''}</div>`
      : '—'
  },
  { key: 'change_pct',    label: 'Dia %',      width: 80,  align: 'right',
    render: r => r.change_pct != null
      ? `<span class="${plClass(r.change_pct)}">${fmtPct(r.change_pct)}</span>` : '—'
  },
  { key: 'current_value', label: 'Valor Atual', width: 120, align: 'right',
    render: r => `<span class="${plClass(r.pl_value)}">${fmtMoney(r.current_value)}</span>`
  },
  { key: 'pl_value', label: 'P&L (R$)', width: 120, align: 'right',
    render: r => r.pl_value != null
      ? `<span class="${plClass(r.pl_value)}">${fmtMoney(r.pl_value)}</span>` : '—'
  },
  { key: 'pl_pct', label: 'P&L %', width: 80, align: 'right',
    render: r => r.pl_pct != null
      ? `<span class="${plClass(r.pl_pct)}">${fmtPct(r.pl_pct)}</span>` : '—'
  },
  { key: 'total_expenses', label: 'Despesas', width: 100, align: 'right',
    render: r => fmtMoney(r.total_expenses)
  },
  { key: 'notes', label: 'Obs.', width: 180, render: r => r.notes || '' },
];

export async function mount(host) {
  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'invest-toolbar';
  toolbar.innerHTML = `
    <span class="invest-toolbar-title">💼 Carteira de Investimentos</span>
    <div class="invest-toolbar-actions">
      <button id="inv-refresh-btn">🔄 Atualizar preços</button>
      <button id="inv-recalc-btn">⚙️ Recalcular posições</button>
      <button class="invest-btn invest-btn--primary" id="inv-add-txn-btn">+ Nova Operação</button>
    </div>
  `;
  host.appendChild(toolbar);

  // Loading state
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
  content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Carregando posições…</span></div>`;
  host.appendChild(content);

  async function loadData() {
    content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Carregando posições…</span></div>`;
    try {
      const token = localStorage.getItem('token');
      const user  = JSON.parse(localStorage.getItem('user') || '{}');
      const headers = { Authorization: `Bearer ${token}` };
      if (user.isSuperUser) {
        const tid = localStorage.getItem('activeTenantId');
        if (tid) headers['x-tenant-id'] = tid;
      }

      const resp = await fetch(`${API}/positions`, { headers });
      const { data } = await resp.json();

      if (!data || data.length === 0) {
        content.innerHTML = `
          <div class="invest-empty">
            <span class="invest-empty-icon">💼</span>
            <span>Nenhuma posição encontrada.</span>
            <button class="invest-btn invest-btn--primary" id="inv-empty-add">+ Lançar primeira operação</button>
          </div>`;
        content.querySelector('#inv-empty-add')?.addEventListener('click', openTxnModal);
        return;
      }

      content.innerHTML = '';
      const table = new ExcelTable({
        gridId:   GRID_ID,
        columns:  COLUMNS,
        data,
        readOnly: true,
        striped:  true,
        stickyHeader: true,
        onCellEdit: null,
      });
      content.appendChild(table.el);

      // Resumo totais
      const totals = data.reduce((acc, r) => {
        acc.cost  += Number(r.total_cost)    || 0;
        acc.value += Number(r.current_value) || 0;
        acc.pl    += Number(r.pl_value)      || 0;
        acc.exp   += Number(r.total_expenses)|| 0;
        return acc;
      }, { cost: 0, value: 0, pl: 0, exp: 0 });

      const summary = document.createElement('div');
      summary.style.cssText = 'display:flex;gap:2rem;padding:0.6rem 1.25rem;background:rgba(0,0,0,.3);border-top:1px solid rgba(255,255,255,.06);font-size:0.8rem;flex-shrink:0;';
      summary.innerHTML = `
        <span>Custo total: <strong>${fmtMoney(totals.cost)}</strong></span>
        <span>Valor atual: <strong>${fmtMoney(totals.value)}</strong></span>
        <span class="${plClass(totals.pl)}">P&L: <strong>${fmtMoney(totals.pl)}</strong></span>
        <span style="margin-left:auto;color:#4a5568;">Despesas: ${fmtMoney(totals.exp)}</span>
      `;
      content.appendChild(summary);

    } catch (err) {
      content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⚠️</span><span>${err.message}</span></div>`;
    }
  }

  async function recalculate() {
    try {
      const token = localStorage.getItem('token');
      const user  = JSON.parse(localStorage.getItem('user') || '{}');
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      if (user.isSuperUser) {
        const tid = localStorage.getItem('activeTenantId');
        if (tid) headers['x-tenant-id'] = tid;
      }
      await fetch(`${API}/positions/recalculate`, { method: 'POST', headers });
      await loadData();
    } catch (err) {
      alert('Erro ao recalcular: ' + err.message);
    }
  }

  function openTxnModal() {
    // TODO: modal de nova operação (fase 2)
    alert('Modal de nova operação — em breve!');
  }

  toolbar.querySelector('#inv-refresh-btn').addEventListener('click', loadData);
  toolbar.querySelector('#inv-recalc-btn').addEventListener('click', recalculate);
  toolbar.querySelector('#inv-add-txn-btn').addEventListener('click', openTxnModal);

  await loadData();
}

/**
 * resultsView.js — Resultados por Ação (Pivot Dinâmico)
 * Renderizado via ExcelTable Component para máxima fidelidade de interface.
 */
import { ExcelTable } from '../../../components/ExcelTable.js';

const API = '/api/invest';

function fmtMoney(v) {
  if (v == null || v === 0) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function plClass(v) { 
  return v > 0 ? 'invest-positive' : v < 0 ? 'invest-negative' : 'invest-neutral'; 
}

const COL_LABELS = {
  TRADE:         '📈 Trade',
  DAY_TRADE:     '⚡ Day Trade',
  CALL_VENDIDA:  '📤 CALL Vendida',
  CALL_COMPRADA: '📥 CALL Comprada',
  PUT_VENDIDA:   '📤 PUT Vendida',
  PUT_COMPRADA:  '📥 PUT Comprada',
  DIVIDENDO:     '💰 Dividendo',
  JCP:           '💵 JCP',
  FII_RENDIMENTO:'🏢 FII Rend.',
  TOTAL:         '💼 Total',
};

export async function mount(host) {
  const currentYear = new Date().getFullYear();

  const toolbar = document.createElement('div');
  toolbar.className = 'invest-toolbar';
  toolbar.innerHTML = `
    <span class="invest-toolbar-title">📊 Resultados Consolidados por Ativo</span>
    <div class="invest-toolbar-actions">
      <label style="font-size:.78rem;color:#718096;">De:&nbsp;<input type="date" id="inv-res-from" value="${currentYear}-01-01" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <label style="font-size:.78rem;color:#718096;">Até:&nbsp;<input type="date" id="inv-res-to" style="background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 6px;font-size:.78rem;"></label>
      <input type="text" id="inv-res-tickers" placeholder="Filtro de Ativos (ex: PETR4)" style="width:170px;background:#1a2234;color:#e2eaf4;border:1px solid #2d3748;border-radius:4px;padding:2px 8px;font-size:.78rem;">
      <button class="invest-btn invest-btn--primary" id="inv-res-search">🔍 Gerar</button>
    </div>
  `;
  host.appendChild(toolbar);

  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
  host.appendChild(content);

  async function loadData() {
    content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⏳</span><span>Calculando resultados…</span></div>`;

    const token  = localStorage.getItem('token');
    const user   = JSON.parse(localStorage.getItem('user') || '{}');
    const headers = { Authorization: `Bearer ${token}` };
    if (user.isSuperUser) { const tid = localStorage.getItem('activeTenantId'); if (tid) headers['x-tenant-id'] = tid; }

    const from    = document.getElementById('inv-res-from')?.value    || '';
    const to      = document.getElementById('inv-res-to')?.value      || '';
    const tickers = (document.getElementById('inv-res-tickers')?.value || '').trim();

    const qs = new URLSearchParams();
    if (from)    qs.set('from', from);
    if (to)      qs.set('to', to);
    if (tickers) qs.set('tickers', tickers);

    try {
      const resp = await fetch(`${API}/results/by-ticker?${qs}`, { headers });
      const { columns, rows, totals } = await resp.json();

      if (!rows || rows.length === 0) {
        content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">📊</span><span>Sem resultados consolidados no período.</span></div>`;
        return;
      }

      // CONSTRUÇÃO DO DEFINITION DE COLUNAS DINÂMICAS
      const tableColumns = [
        { 
          key: 'ticker', 
          label: 'Ativo Base', 
          width: 110, 
          render: r => `<strong>${r.ticker}</strong>` 
        }
      ];

      // Adiciona apenas as colunas de tipos que foram preenchidas
      columns.forEach(colKey => {
        tableColumns.push({
          key: colKey,
          label: COL_LABELS[colKey] || colKey,
          width: 130,
          align: 'right',
          render: r => {
            const val = Number(r[colKey]) || 0;
            return `<span class="${plClass(val)}">${fmtMoney(val)}</span>`;
          }
        });
      });

      // Coluna de TOTAL à direita
      tableColumns.push({
        key: 'TOTAL',
        label: COL_LABELS.TOTAL,
        width: 140,
        align: 'right',
        render: r => {
          const val = Number(r.TOTAL) || 0;
          return `<span class="${plClass(val)}" style="font-weight:bold;">${fmtMoney(val)}</span>`;
        }
      });

      content.innerHTML = '';

      // Injeta os dados no ExcelTable oficial
      const excelTable = new ExcelTable({
        gridId: 'invest-results-pivot-v1',
        columns: tableColumns,
        data: rows,
        readOnly: true,
        striped: true,
        stickyHeader: true
      });

      content.appendChild(excelTable.el);

      // Barra de rodapé com os Totais consolidados gerais
      const summaryFooter = document.createElement('div');
      summaryFooter.style.cssText = 'display:flex; gap:1.5rem; padding:0.75rem 1.25rem; background:rgba(0,0,0,0.4); border-top:1px solid rgba(255,255,255,0.08); font-size:0.85rem; color:#a0aec0; overflow-x:auto; flex-shrink:0;';
      
      let totalsHtml = `<span style="font-weight:600; color:#fff; white-space:nowrap;">TOTAIS DO PERÍODO:</span>`;
      columns.forEach(col => {
        const val = totals[col] || 0;
        if (val !== 0) {
           totalsHtml += `<span style="white-space:nowrap;">${COL_LABELS[col] || col}: <strong class="${plClass(val)}">${fmtMoney(val)}</strong></span>`;
        }
      });
      
      const netTotal = Number(totals.TOTAL) || 0;
      totalsHtml += `<span style="margin-left:auto; background:rgba(255,255,255,0.05); padding:2px 10px; border-radius:4px; white-space:nowrap;">RESULTADO LÍQUIDO: <strong class="${plClass(netTotal)}" style="font-size:1rem;">${fmtMoney(netTotal)}</strong></span>`;
      
      summaryFooter.innerHTML = totalsHtml;
      content.appendChild(summaryFooter);

    } catch (err) {
      content.innerHTML = `<div class="invest-empty"><span class="invest-empty-icon">⚠️</span><span>Falha ao carregar relatório: ${err.message}</span></div>`;
    }
  }

  toolbar.querySelector('#inv-res-search').addEventListener('click', loadData);
  // Trigger inicial
  await loadData();
}

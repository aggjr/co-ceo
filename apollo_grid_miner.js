const fs = require('fs');
const path = require('path');
const { configLegacy, assertLegacyConfig } = require('./coceo_db_config');
const mysql = require('mysql2/promise');
const { parseApolloBundleFileContent } = require('./lib/parse_apollo_bundle');
const { isClosedRetailStore } = require('./lib/closed_retail_stores');

const PROC_DIR = path.join(__dirname, 'data', 'processed');
const JS_DIR = path.join(__dirname, 'data', 'js');

function asBool(v) {
    if (v == null) return false;
    if (Buffer.isBuffer(v)) return v[0] === 1;
    const n = Number(v);
    if (!Number.isNaN(n)) return n !== 0;
    return Boolean(v);
}

function hasSqlDate(v) {
    if (v == null) return false;
    const s = String(v).trim();
    if (!s || s.startsWith('0000-00-00')) return false;
    return true;
}

/**
 * Rótulo em PT para o ciclo de vida no cadastro legado (produto).
 * Usa IndDeletado, fila de processamento, Status textual e IndAtivo.
 */
function deriveCadastroEstado(p) {
    const indDel = p.ind_deletado !== undefined ? p.ind_deletado : p.IndDeletado;
    if (asBool(indDel)) return 'Excluído (cadastro)';

    const entrada = p.data_entrada_fila !== undefined ? p.data_entrada_fila : p.DataEntradaFilaProcessamento;
    const saida = p.data_saida_fila !== undefined ? p.data_saida_fila : p.DataSaidaFilaProcessamento;
    const inFila = hasSqlDate(entrada) && !hasSqlDate(saida);
    if (inFila) {
        const sr = String(
            (p.status_reprocessamento !== undefined ? p.status_reprocessamento : p.StatusReprocessamento) || ''
        ).trim();
        if (sr) return 'Em processamento (fila)';
        return 'Sendo processado';
    }

    const st = String((p.legacy_status !== undefined ? p.legacy_status : p.Status) || '').trim();
    const u = st.toUpperCase();
    if (
        u &&
        u.includes('INATIV') &&
        (u.includes('PEND') || u.includes('AGUARD') || u.includes('PROCESS') || u.includes('ANDAMENTO'))
    ) {
        return 'Sendo inativado';
    }
    if (
        u &&
        (u.includes('INSERT') ||
            u.includes('IMPORT') ||
            u.includes('NOVO') ||
            u.includes('CRIACAO') ||
            u.includes('CADASTRO PEND'))
    ) {
        return 'Sendo inserido';
    }

    const indAtv = p.ind_ativo !== undefined ? p.ind_ativo : p.IndAtivo;
    if (asBool(indAtv)) return 'Ativo';
    return 'Inativo';
}

/** Preferir data/js (mesmo ficheiro dos gráficos); fallback data/processed. */
function normalizeCode(code) {
    return String(code == null ? '' : code).trim();
}

function toYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}

function isHubLikeStoreName(name) {
    const n = String(name || '');
    return n === 'Fábrica' || n === 'CD SARON' || /fábrica|fabrica/i.test(n);
}

/** Mesma subquery de `scripts/build_cd_purchase_plan.js` (PrecoRealVenda → PrecoVenda → histórico). */
const LEGACY_SALES_DETAIL_SQL = `
      SELECT
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS erp_code,
        un.NomeFantasia AS store,
        CAST(SUM(COALESCE(mv.Quantidade, 0)) AS DECIMAL(18,4)) AS quantidade_vendida,
        CAST(SUM(COALESCE(mv.preco_venda_aplicado, 0) * COALESCE(mv.Quantidade, 0)) AS DECIMAL(18,4)) AS valor_bruto_vendas,
        CAST(SUM((COALESCE(mv.preco_venda_aplicado, 0) - COALESCE(mv.preco_custo_aplicado, 0)) * COALESCE(mv.Quantidade, 0)) AS DECIMAL(18,4)) AS margem_contribuicao_total
      FROM (
        SELECT
          m.IdAtivo,
          m.IdUnidadeNegocio,
          m.Quantidade,
          m.DataMovimentacao,
          COALESCE(NULLIF(m.PrecoRealVenda, 0), NULLIF(m.PrecoVenda, 0), (
            SELECT hpun.PrecoVenda
            FROM historicoprecoundnegocio hpun
            WHERE hpun.IdAtivo = m.IdAtivo
              AND COALESCE(hpun.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hpun.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hpun.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hpun.DataInicioVigencia, '1900-01-01') DESC, hpun.Id DESC
            LIMIT 1
          ), (
            SELECT hp.PrecoVenda
            FROM ativo ax
            JOIN historicopreco hp
              ON hp.IdProduto = ax.IdProduto
            WHERE ax.Id = m.IdAtivo
              AND COALESCE(hp.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hp.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hp.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hp.DataInicioVigencia, '1900-01-01') DESC, hp.Id DESC
            LIMIT 1
          ), 0) AS preco_venda_aplicado,
          COALESCE((
            SELECT hpun.PrecoCusto
            FROM historicoprecoundnegocio hpun
            WHERE hpun.IdAtivo = m.IdAtivo
              AND COALESCE(hpun.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hpun.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hpun.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hpun.DataInicioVigencia, '1900-01-01') DESC, hpun.Id DESC
            LIMIT 1
          ), (
            SELECT hp.PrecoCusto
            FROM ativo ax
            JOIN historicopreco hp
              ON hp.IdProduto = ax.IdProduto
            WHERE ax.Id = m.IdAtivo
              AND COALESCE(hp.IndDeletado, b'0') = b'0'
              AND m.DataMovimentacao >= COALESCE(hp.DataInicioVigencia, '1900-01-01')
              AND m.DataMovimentacao <= COALESCE(hp.DataFimVigencia, '2999-12-31')
            ORDER BY COALESCE(hp.DataInicioVigencia, '1900-01-01') DESC, hp.Id DESC
            LIMIT 1
          ), 0) AS preco_custo_aplicado
        FROM movimentacao m
        JOIN tipomovimentacao tm
          ON tm.Id = m.IdTipoMovimentacao
        WHERE COALESCE(m.IndDeletado, b'0') = b'0'
          AND COALESCE(tm.IndDeletado, b'0') = b'0'
          AND COALESCE(tm.IndVenda, b'0') = b'1'
          AND m.DataMovimentacao BETWEEN ? AND ?
      ) mv
      JOIN ativo a
        ON a.Id = mv.IdAtivo
       AND COALESCE(a.IndDeletado, b'0') = b'0'
      JOIN produto p
        ON p.Id = a.IdProduto
       AND COALESCE(p.IndDeletado, b'0') = b'0'
      JOIN unidadenegocio un
        ON un.IdUnidadeNegocio = mv.IdUnidadeNegocio
      GROUP BY
        COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')),
        un.NomeFantasia
`;

async function resolveLegacySalesWindow12m(conn) {
    const [[mxRow]] = await conn.query(`
        SELECT MAX(m.DataMovimentacao) AS mx
        FROM movimentacao m
        JOIN tipomovimentacao tm ON tm.Id = m.IdTipoMovimentacao
        WHERE COALESCE(m.IndDeletado, b'0') = b'0'
          AND COALESCE(tm.IndDeletado, b'0') = b'0'
          AND COALESCE(tm.IndVenda, b'0') = b'1'
          AND m.DataMovimentacao < CURDATE()
    `);
    const endD = mxRow && mxRow.mx ? new Date(mxRow.mx) : new Date();
    const startD = new Date(endD);
    startD.setDate(startD.getDate() - 364);
    const pad = (n) => String(n).padStart(2, '0');
    const startIso = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())} 00:00:00`;
    const endIso = `${endD.getFullYear()}-${pad(endD.getMonth() + 1)}-${pad(endD.getDate())} 23:59:59`;
    const dateStartStr = toYmd(startD);
    const dateEndStr = toYmd(endD);
    return { startIso, endIso, dateStartStr, dateEndStr };
}

async function loadLegacySalesAggregatedByProduct(conn, startIso, endIso, codeToProdId) {
    const [rows] = await conn.query(LEGACY_SALES_DETAIL_SQL, [startIso, endIso]);
    const byProd = new Map();
    for (const r of rows) {
        const store = String(r.store || '').trim();
        if (isClosedRetailStore(store)) continue;
        const code = normalizeCode(r.erp_code);
        const prodId = codeToProdId.get(code);
        if (prodId == null) continue;
        const qty = Number(r.quantidade_vendida) || 0;
        const gross = Number(r.valor_bruto_vendas) || 0;
        const margin = Number(r.margem_contribuicao_total) || 0;
        const cur = byProd.get(prodId) || { quantidade_vendida: 0, valor_bruto_vendas: 0, margem_contribuicao_total: 0 };
        cur.quantidade_vendida += qty;
        cur.valor_bruto_vendas += gross;
        cur.margem_contribuicao_total += margin;
        byProd.set(prodId, cur);
    }
    return byProd;
}

/**
 * Média ponderada do % ruptura (métrica bundle) pelo volume vendido na janela — alinhado ao conceito do Plano CD.
 */
function computeRupturaPonderadaVendasPct(skuData, dateStartStr, dateEndStr) {
    if (!skuData || !skuData.results) return null;
    let wSum = 0;
    let wrSum = 0;
    for (const [sName, storeData] of Object.entries(skuData.results)) {
        if (isHubLikeStoreName(sName)) continue;
        if (!storeData || !Array.isArray(storeData.timeline)) continue;
        const rupt = Number(storeData.metrics && storeData.metrics.ruptureRate) || 0;
        let w = 0;
        for (const day of storeData.timeline) {
            const d = day.date;
            if (!d || d < dateStartStr || d > dateEndStr) continue;
            const s = Number(day.sales);
            if (Number.isFinite(s) && s > 0) w += s;
        }
        if (w > 0) {
            wSum += w;
            wrSum += w * rupt;
        }
    }
    if (wSum <= 0) return null;
    return Number((wrSum / wSum).toFixed(2));
}

function loadSkuNetworkForGridStats(id) {
    const jsPath = path.join(JS_DIR, `sku_${id}.js`);
    const procPath = path.join(PROC_DIR, `sku_${id}.json`);
    if (fs.existsSync(jsPath)) {
        try {
            return parseApolloBundleFileContent(fs.readFileSync(jsPath, 'utf8'));
        } catch (_) {
            return null;
        }
    }
    if (fs.existsSync(procPath)) {
        try {
            return JSON.parse(fs.readFileSync(procPath, 'utf8'));
        } catch (_) {
            return null;
        }
    }
    return null;
}

async function runMiner() {
    console.log("🌐 Iniciando Apollo Grid Miner...");

    // 1. Conexão e Encoding
    const c = await mysql.createConnection(assertLegacyConfig());
    await c.query("SET NAMES 'utf8mb4'");

    // 2. Resgatar as categorias globais para mapeamento rápido (Parent/Child)
    const [cats] = await c.query("SELECT Id, Nome, IdParent FROM categoria WHERE IndDeletado = 0");
    const catMap = {};
    cats.forEach(cat => {
        catMap[cat.Id] = {
            id: cat.Id,
            name: cat.Nome,
            parentId: cat.IdParent
        };
    });

    // 3. Todos os produtos (incl. IndDeletado=1) — uma linha por Id.
    //    Batimento categoria/subcategoria:
    //    - pega produtocategoria não deletado
    //    - prioriza vínculos ativos
    //    - em empate, usa o vínculo mais recente (DataAlteracao/DataCriacao)
    //    - fallback por IdCategoria
    const [productsRaw] = await c.query(`
        SELECT 
            p.Id,
            COALESCE(NULLIF(TRIM(p.ErpCodigo), ''), NULLIF(TRIM(p.IdExterno), '')) AS code,
            NULLIF(TRIM(p.IdExterno), '') AS id_externo,
            p.Descricao AS name,
            (
                SELECT pc2.IdCategoria FROM produtocategoria pc2
                WHERE pc2.IdProduto = p.Id AND pc2.IndDeletado = 0
                ORDER BY
                    COALESCE(pc2.IndAtivo, 1) DESC,
                    COALESCE(pc2.DataAlteracao, pc2.DataCriacao, '1900-01-01') DESC,
                    pc2.IdCategoria ASC
                LIMIT 1
            ) AS IdCategoria,
            p.IndAtivo AS ind_ativo,
            p.IndDeletado AS ind_deletado,
            p.Status AS legacy_status,
            p.StatusReprocessamento AS status_reprocessamento,
            p.DataEntradaFilaProcessamento AS data_entrada_fila,
            p.DataSaidaFilaProcessamento AS data_saida_fila
        FROM produto p
        ORDER BY p.Id ASC
    `);

    const codeToProdId = new Map();
    for (const p of productsRaw) {
        const prodId = p.Id != null ? p.Id : p.id;
        let code = p.code != null && p.code !== '' ? p.code : p.Code || '';
        if (code.startsWith('"') && code.endsWith('"')) code = code.slice(1, -1);
        if (code.toLowerCase().includes('digo')) continue;
        const nk = normalizeCode(code);
        if (nk) codeToProdId.set(nk, prodId);
        const idExt = p.id_externo != null ? String(p.id_externo).trim() : p.IdExterno != null ? String(p.IdExterno).trim() : '';
        if (idExt) codeToProdId.set(normalizeCode(idExt), prodId);
    }

    const salesWindow = await resolveLegacySalesWindow12m(c);
    let salesByProdId = new Map();
    try {
        salesByProdId = await loadLegacySalesAggregatedByProduct(c, salesWindow.startIso, salesWindow.endIso, codeToProdId);
        console.log(
            `📊 Vendas 12m (legado): ${salesByProdId.size} produto(s) com movimento · janela ${salesWindow.dateStartStr} → ${salesWindow.dateEndStr}`
        );
    } catch (e) {
        console.warn('⚠️ Vendas 12m (legado) não agregadas — colunas financeiras ficam zeradas:', e.message || e);
    }

    // Estruturar dados final
    const gridData = [];

    let noDataCount = 0;
    
    for (const p of productsRaw) {
        const prodId = p.Id != null ? p.Id : p.id;
        let code = p.code != null && p.code !== '' ? p.code : p.Code || '';
        if (code.startsWith('"') && code.endsWith('"')) code = code.slice(1, -1);
        if (code.toLowerCase().includes('digo')) continue; // Header artifacts

        const cadastroEstado = deriveCadastroEstado(p);

        let categoria = 'SEM CATEGORIA';
        let subCategoria = '-';

        const idCat = p.IdCategoria != null ? p.IdCategoria : p.id_categoria;
        if (idCat && catMap[idCat]) {
            const myCat = catMap[idCat];
            if (myCat.parentId) {
                // É sub-categoria
                subCategoria = myCat.name;
                categoria = catMap[myCat.parentId] ? catMap[myCat.parentId].name : 'DESCONHECIDO';
            } else {
                // É apenas categoria raiz
                categoria = myCat.name;
            }
        }

        // 4. Calcular Vendas Totais da Malha a partir do arquivo JSON
        // Isso evita precisar refazer SQL massivo. O processo em lote já fez isso pra nós.
        let totalSales = 0;
        let rupturePctNetwork = 0; // média simples (legado no JSON)
        let rupturaPonderadaVendasPct = null;

        let hasData = false;
        const skuData = loadSkuNetworkForGridStats(prodId);
        if (skuData) {
            hasData = true;
            try {
                let totalRup = 0;
                let cVendas = 0;
                let nStores = 0;

                Object.keys(skuData.results).forEach(sName => {
                    const storeData = skuData.results[sName];
                    if (storeData && storeData.timeline) {
                        nStores += 1;
                        for (const day of storeData.timeline) {
                            if (day.sales && !isNaN(day.sales)) cVendas += day.sales;
                        }
                        totalRup += (storeData.metrics.ruptureRate || 0);
                    }
                });

                totalSales = cVendas;
                rupturePctNetwork = nStores > 0 ? totalRup / nStores : 0;
                rupturaPonderadaVendasPct = computeRupturaPonderadaVendasPct(
                    skuData,
                    salesWindow.dateStartStr,
                    salesWindow.dateEndStr
                );
            } catch (err) {
                // Skip if JSON is broken
            }
        } else {
            noDataCount++;
        }

        const leg = salesByProdId.get(prodId) || null;
        const vendaBruta12m = leg ? Number(leg.valor_bruto_vendas.toFixed(2)) : 0;
        const quantidadeVendas12m = leg ? Number(Number(leg.quantidade_vendida || 0).toFixed(2)) : 0;
        const lucroBruto12m = leg ? Number(leg.margem_contribuicao_total.toFixed(2)) : 0;
        const pctLucro12m =
            vendaBruta12m > 0 && Number.isFinite(lucroBruto12m)
                ? Number(((lucroBruto12m / vendaBruta12m) * 100).toFixed(2))
                : null;

        const idExt =
            p.id_externo != null
                ? String(p.id_externo).trim()
                : p.IdExterno != null
                  ? String(p.IdExterno).trim()
                  : '';

        gridData.push({
            id: prodId,
            code: code || String(prodId),
            idExterno: idExt,
            name: p.name,
            category: categoria,
            subcategory: subCategoria,
            totalSales: Math.round(totalSales),
            rupture: Number(rupturePctNetwork.toFixed(1)),
            vendaBruta12m,
            quantidadeVendas12m,
            lucroBruto12m,
            pctLucro12m,
            rupturaPonderadaVendasPct,
            legacyAtivo: asBool(p.ind_ativo !== undefined ? p.ind_ativo : p.IndAtivo),
            indDeletado: asBool(p.ind_deletado !== undefined ? p.ind_deletado : p.IndDeletado),
            legacyStatus: String(p.legacy_status !== undefined ? p.legacy_status : p.Status || ''),
            statusReprocessamento: String(
                p.status_reprocessamento !== undefined ? p.status_reprocessamento : p.StatusReprocessamento || ''
            ),
            cadastroEstado,
            dataEntradaFila: p.data_entrada_fila,
            dataSaidaFila: p.data_saida_fila
        });
    }

    await c.end();

    // 5. Catálogo completo: ordenar por Id (estável); vendas ainda na coluna para ordenação no ExcelTable
    gridData.sort((a, b) => Number(a.id) - Number(b.id));

    console.log(`Processados: ${gridData.length} SKUs. (Sem arquivo de processamento: ${noDataCount})`);

    // 6. Escrever o Catalog Grid JS (para a nova UI carregar perfeitamente via script tag sem CORS)
    const outData = 'const CATALOG_GRID = ' + JSON.stringify(gridData) + ';';
    fs.writeFileSync(path.join(__dirname, 'data', 'catalog_grid.js'), outData);
    console.log('✅ data/catalog_grid.js gerado com sucesso!');
}

runMiner().catch(err => {
    console.error('Erro Fatal no Grid Miner:', err);
});

const mysql = require('mysql2/promise');
const { assertLegacyConfig } = require('./coceo_db_config');
const { isClosedRetailStore } = require('./lib/closed_retail_stores');
const fs = require('fs');
const path = require('path');

/**
 * APOLLO ENTERPRISE MINER v20.0
 * Extrator massivo de histórico (desde START_DATE) — um JSON bruto por SKU em data/raw/.
 * Lista de SKUs = produtos não excluídos no legado (IndDeletado=0), inclusive IndAtivo=0 com movimento/estoque.
 */

const RAW_DIR = path.join(__dirname, 'data', 'raw');
const CHUNK_SIZE = 20; // Extrair de 20 em 20 SKUs para não sobrecarregar
/** Pausa em ms entre cada SKU (ex.: 25) para aliviar o MySQL legado: APOLLO_MINER_MS_PAUSE_PER_SKU=25 */
const MS_PAUSE_PER_SKU = Math.max(0, parseInt(process.env.APOLLO_MINER_MS_PAUSE_PER_SKU || '0', 10) || 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toIsoDay(d) {
    const x = new Date(d);
    return x.toISOString().slice(0, 10);
}

function resolveMinerWindow() {
    const envStart = String(process.env.APOLLO_MINER_START_DATE || '').trim();
    const envEnd = String(process.env.APOLLO_MINER_END_DATE || '').trim();

    const yesterday = new Date();
    yesterday.setHours(12, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    const defaultEnd = toIsoDay(yesterday);

    // Regra padrão do diário: buscar somente o dia anterior.
    const startDate = envStart || defaultEnd;
    const endDate = envEnd || defaultEnd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error(`Janela inválida do miner. Use YYYY-MM-DD. start=${startDate} end=${endDate}`);
    }
    if (startDate > endDate) {
        throw new Error(`Janela inválida do miner: start > end (${startDate} > ${endDate})`);
    }
    return { startDate, endDate };
}

function normalizeDateTime(v) {
    if (v == null) return '';
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return String(v);
}

function mergeNetworkRaw(existingData, newData) {
    const merged = {};
    const stores = new Set([
        ...Object.keys(existingData || {}),
        ...Object.keys(newData || {})
    ]);

    for (const store of stores) {
        const prev = Array.isArray(existingData?.[store]) ? existingData[store] : [];
        const curr = Array.isArray(newData?.[store]) ? newData[store] : [];
        const byKey = new Map();

        for (const row of prev) {
            const key = row.movimento_id != null
                ? `id:${row.movimento_id}`
                : `f:${normalizeDateTime(row.data_evento)}|${row.natureza || ''}|${row.operacao || ''}|${Number(row.quantidade || 0)}`;
            byKey.set(key, row);
        }
        for (const row of curr) {
            const normalized = {
                ...row,
                data_evento: normalizeDateTime(row.data_evento)
            };
            const key = normalized.movimento_id != null
                ? `id:${normalized.movimento_id}`
                : `f:${normalized.data_evento}|${normalized.natureza || ''}|${normalized.operacao || ''}|${Number(normalized.quantidade || 0)}`;
            byKey.set(key, normalized);
        }

        merged[store] = [...byKey.values()].sort((a, b) => {
            const da = normalizeDateTime(a.data_evento);
            const db = normalizeDateTime(b.data_evento);
            if (da < db) return -1;
            if (da > db) return 1;
            const ia = Number(a.movimento_id || 0);
            const ib = Number(b.movimento_id || 0);
            return ia - ib;
        });
    }
    return merged;
}

async function runMiner() {
    const { startDate, endDate } = resolveMinerWindow();
    console.log("🚀 Iniciando Extração Massiva Apollo Enterprise...");
    console.log(`🗓️ Janela de movimentações: ${startDate} → ${endDate}`);
    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
    const connection = await mysql.createConnection(assertLegacyConfig());

    try {
        // 1. Obter lista de produtos (ativos e inativos — só exclui deletados)
        const [products] = await connection.query(`
            SELECT Id,
                   COALESCE(NULLIF(TRIM(ErpCodigo), ''), NULLIF(TRIM(IdExterno), '')) AS ErpCodigo,
                   Descricao
            FROM produto
            WHERE IndDeletado = 0
            ORDER BY Id ASC
        `);

        console.log(`📊 Encontrados ${products.length} SKUs para processar.`);

        for (let i = 0; i < products.length; i += CHUNK_SIZE) {
            const chunk = products.slice(i, i + CHUNK_SIZE);
            console.log(`📥 Processando Lote ${i / CHUNK_SIZE + 1}...`);

            for (let product of chunk) {
                const skuId = product.Id;
                const skuCode = product.ErpCodigo || `SKU-${skuId}`;
                const skuName = product.Descricao;

                // Extrair movimentação de todas as unidades para este SKU
                const [moves] = await connection.query(`
                    SELECT 
                        m.Id as movimento_id,
                        m.Quantidade as quantidade, 
                        m.DataMovimentacao as data_evento,
                        m.IdUnidadeNegocio as id_unidade,
                        un.NomeFantasia as unidade_nome,
                        tm.Nome as natureza,
                        tm.AdicionaEstoque as op_adiciona,
                        tm.SubtraiEstoque as op_subtrai
                    FROM movimentacao m
                    JOIN tipomovimentacao tm ON m.IdTipoMovimentacao = tm.Id
                    JOIN unidadenegocio un ON m.IdUnidadeNegocio = un.IdUnidadeNegocio
                    WHERE m.IdAtivo IN (SELECT Id FROM ativo WHERE IdProduto = ? AND IndDeletado = 0)
                    AND m.DataMovimentacao >= ?
                    AND m.DataMovimentacao < DATE_ADD(?, INTERVAL 1 DAY)
                    AND m.IndDeletado = 0
                    ORDER BY m.DataMovimentacao ASC
                `, [skuId, startDate, endDate]);

                // Organizar em formato de rede (Unidade -> Movimentos)
                const networkRaw = {};
                moves.forEach(m => {
                    const unit = m.unidade_nome;
                    if (!networkRaw[unit]) networkRaw[unit] = [];
                    
                    let operacao = 'DEBITO';
                    if (m.op_adiciona && m.op_adiciona[0] === 1) operacao = 'CREDITO';

                    networkRaw[unit].push({
                        movimento_id: m.movimento_id != null ? Number(m.movimento_id) : null,
                        quantidade: m.quantidade,
                        data_evento: normalizeDateTime(m.data_evento),
                        natureza: m.natureza,
                        operacao: operacao
                    });
                });

                for (const k of Object.keys(networkRaw)) {
                    if (isClosedRetailStore(k)) delete networkRaw[k];
                }

                const skuData = {
                    info: { id: skuId, code: skuCode, name: skuName, timestamp: new Date() },
                    data: networkRaw
                };

                const outFile = path.join(RAW_DIR, `sku_${skuId}.json`);
                if (fs.existsSync(outFile)) {
                    try {
                        const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
                        skuData.data = mergeNetworkRaw(prev?.data || {}, networkRaw);
                    } catch (_) {
                        // fallback: mantém apenas dados novos se arquivo antigo estiver inválido
                    }
                }
                fs.writeFileSync(outFile, JSON.stringify(skuData, null, 2));
                if (MS_PAUSE_PER_SKU) await sleep(MS_PAUSE_PER_SKU);
            }
        }

        console.log("✅ Extração Massiva concluída com sucesso.");

    } catch (err) {
        console.error("❌ Erro na extração:", err.message);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

runMiner();

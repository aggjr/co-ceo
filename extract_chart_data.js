const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');
const fs = require('fs');

async function extract() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());

        const idAtivo = 13712;

        // 1. Legado (Snapshot esparsos)
        const [legHistory] = await connLegacy.query(`
            SELECT DATE(DataMovimentacao) as d, Quantidade as q 
            FROM historicoestoque 
            WHERE IdAtivo = ? 
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        // 2. Co-CEO Real (Original vs Reconciliado)
        const [reconciled] = await connLocal.query(`
            SELECT data, saldo_real_reprocessado as saldo 
            FROM estoque_diario 
            WHERE id_ativo = ? 
            ORDER BY data ASC
        `, [idAtivo]);

        // 3. Movimentos Originais para reconstruir a curva sem o ajuste de 117
        const [origMoves] = await connLocal.query(`
            SELECT DATE(data_evento) as d, SUM(CASE WHEN n.operacao = 'CREDITO' THEN quantidade ELSE -quantidade END) as delta
            FROM movimento_estoque m
            JOIN natureza_movimento n ON m.id_natureza = n.id
            WHERE m.id_ativo = ? AND (m.id_natureza <= 12 OR m.id_natureza > 101)
            GROUP BY DATE(data_evento)
            ORDER BY d ASC
        `, [idAtivo]);

        const legacyMap = {};
        legHistory.forEach(h => {
            legacyMap[h.d.toISOString().split('T')[0]] = h.q;
        });

        const origDeltaMap = {};
        origMoves.forEach(m => {
            origDeltaMap[m.d.toISOString().split('T')[0]] = parseFloat(m.delta);
        });

        let lastQualityLegacy = 0;
        let runningOrigBalance = 0;

        const chartLabels = [];
        const chartLegacy = [];
        const chartOrig = [];
        const chartReconciled = [];

        for (const r of reconciled) {
            const dStr = r.data.toISOString().split('T')[0];
            
            // Legacy with Forward Fill
            if (legacyMap[dStr] !== undefined) {
                lastQualityLegacy = legacyMap[dStr];
            }
            
            // Original Balance (Cumulative)
            if (origDeltaMap[dStr] !== undefined) {
                runningOrigBalance += origDeltaMap[dStr];
            }

            chartLabels.push(dStr);
            chartLegacy.push(lastQualityLegacy);
            chartOrig.push(runningOrigBalance);
            chartReconciled.push(r.saldo);
        }

        const chartData = {
            labels: chartLabels,
            legacy: chartLegacy,
            coceo_original: chartOrig,
            coceo_reconciled: chartReconciled
        };

        fs.writeFileSync('./chart_data.json', JSON.stringify(chartData, null, 2));
        console.log("✅ Dados exportados com preenchimento de lacunas (Forward Fill).");

    } catch (err) {
        console.error(err);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

extract();

const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');
const fs = require('fs');

async function extractMulti(idAtivo) {
    let connLocal, connLegacy;
    try {
        console.log(`🚀 Iniciando Extração para Ativo: ${idAtivo}`);
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());

        // 1. Extração do Snapshot Legado (historicoestoque) -> Linha Branca
        console.log("📥 Puxando Snapshots do Legado...");
        const [legHistory] = await connLegacy.query(`
            SELECT DATE(DataMovimentacao) as d, Quantidade as q 
            FROM historicoestoque 
            WHERE IdAtivo = ? 
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        // 2. Extração da Verdade Foccus (ativoposicaoestoque) -> Linha Azul
        console.log("📥 Puxando Posições Operacionais (Foccus)...");
        const [foccusHistory] = await connLegacy.query(`
            SELECT DataMovimentacao, PosicaoEstoque 
            FROM ativoposicaoestoque 
            WHERE IdAtivo = ? AND IndDeletado = 0 
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        // 3. Extração do Co-CEO local (Auditoria v7) -> Linha Verde
        console.log("📥 Puxando Dados Auditados do Co-CEO...");
        const [reconciled] = await connLocal.query(`
            SELECT data, saldo_real_reprocessado as saldo 
            FROM estoque_diario 
            WHERE id_ativo = ? 
            ORDER BY data ASC
        `, [idAtivo]);

        // Mapeamento para preenchimento de lacunas (Forward Fill)
        const legacyMap = {};
        legHistory.forEach(h => { legacyMap[h.d.toISOString().split('T')[0]] = h.q; });

        const foccusMap = {};
        foccusHistory.forEach(h => { foccusMap[h.DataMovimentacao.toISOString().split('T')[0]] = h.PosicaoEstoque; });

        const chartLabels = [];
        const chartLegacy = [];
        const chartReconciled = [];
        const chartFoccus = [];

        let lastLeg = 0;
        let lastFoccus = 0;

        for (const r of reconciled) {
            const dStr = r.data.toISOString().split('T')[0];
            
            if (legacyMap[dStr] !== undefined) lastLeg = legacyMap[dStr];
            if (foccusMap[dStr] !== undefined) lastFoccus = foccusMap[dStr];

            chartLabels.push(dStr);
            chartLegacy.push(lastLeg);
            chartFoccus.push(lastFoccus);
            chartReconciled.push(r.saldo);
        }

        const finalData = {
            labels: chartLabels,
            legacy_snapshot: chartLegacy,
            coceo_logs: chartReconciled,
            foccus_operational: chartFoccus
        };

        fs.writeFileSync('./triple_chart_data.json', JSON.stringify(finalData, null, 2));
        console.log(`✅ Extração e Consolidação concluídas para o Ativo ${idAtivo}.`);

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

// Rodar para o Ativo da Fábrica da Cortina 12152
extractMulti(26910);

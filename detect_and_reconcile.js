const mysql = require('mysql2/promise');
const { configLocal, configLegacy, assertLegacyConfig } = require('./coceo_db_config');

async function automateReconciliation() {
    let connLocal, connLegacy;
    try {
        connLocal = await mysql.createConnection(configLocal);
        connLegacy = await mysql.createConnection(assertLegacyConfig());
        console.log("✅ Conectado para Auditoria Global.");

        const idAtivo = 13712; // CD focal
        console.log(`--- Iniciando Detecção e Reconciliação: Ativo ${idAtivo} ---`);

        // 1. Obter snapshot do Co-CEO (Calculado dia a dia)
        const [coceoHistory] = await connLocal.query(`
            SELECT data, saldo_real_reprocessado as saldo 
            FROM estoque_diario 
            WHERE id_ativo = ? 
            ORDER BY data ASC
        `, [idAtivo]);

        // 2. Obter snapshot do Legado (Histórico oficial)
        const [legacyHistory] = await connLegacy.query(`
            SELECT DATE(DataMovimentacao) as data, Quantidade as saldo 
            FROM historicoestoque 
            WHERE IdAtivo = ? 
            ORDER BY DataMovimentacao ASC
        `, [idAtivo]);

        const legacyMap = {};
        legacyHistory.forEach(h => {
            const dStr = h.data.toISOString().split('T')[0];
            legacyMap[dStr] = h.saldo;
        });

        let previousDelta = 0;
        let totalAdjustments = 0;

        console.log("Data       | Delta Ant | Delta Novo | Var (Mistério) | Ação");
        console.log("-----------|-----------|------------|----------------|-------");

        for (const day of coceoHistory) {
            const dStr = day.data.toISOString().split('T')[0];
            const coceoStockAtStartOfDay = day.saldo; // Saldo calculado pelo Co-CEO até aquele dia
            const legacyStockAtStartOfDay = legacyMap[dStr];

            if (legacyStockAtStartOfDay === undefined) continue;

            const currentDelta = coceoStockAtStartOfDay - legacyStockAtStartOfDay;
            const variance = currentDelta - previousDelta;

            if (Math.abs(variance) > 0.001) {
                // PONTO DE MISTÉRIO!
                const action = variance > 0 ? "DEBITO (Sumiu)" : "CREDITO (Surgiu)";
                const natureId = variance > 0 ? 101 : 100; // 101: Divergencia Negativa (Legacy < CoCEO), 100: Pos
                
                // No Co-CEO, o log deve refletir o que o legado disse. 
                // Se o legado diz que tem MENOS que o log, inserimos um AJUSTE NEGATIVO no Co-CEO para igualar.
                const adjustmentQty = Math.abs(variance);

                console.log(`${dStr} | ${previousDelta.toFixed(2).padEnd(9)} | ${currentDelta.toFixed(2).padEnd(10)} | ${variance.toFixed(2).padEnd(14)} | ${action}`);

                // Inserir movimento de reconciliação no banco local
                await connLocal.query(`
                    INSERT INTO movimento_estoque (id, id_ativo, id_natureza, quantidade, data_evento, doc_origem)
                    VALUES (UUID(), ?, ?, ?, ?, ?)
                `, [idAtivo, natureId, adjustmentQty, dStr, `RECONCILIACAO_MISTERIO_${dStr}`]);

                totalAdjustments++;
                
                // Após o ajuste, o Delta volta a ser 0 (relativamente ao snapshot anterior)
                // Na verdade, o ajuste zera o Delta NOVO.
                previousDelta = currentDelta; 
            }
        }

        console.log(`\n🚀 Concluído! ${totalAdjustments} ajustes de reconciliação criados.`);
        console.log("💡 Agora, rode 'generate_daily_history.js' para reprocessar a curva com os ajustes.");

    } catch (err) {
        console.error("❌ Erro na automação:", err.message);
    } finally {
        if (connLocal) await connLocal.end();
        if (connLegacy) await connLegacy.end();
    }
}

automateReconciliation();

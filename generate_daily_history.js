const mysql = require('mysql2/promise');
const { configLocal } = require('./coceo_db_config');

async function generateHistory() {
    let conn;
    try {
        conn = await mysql.createConnection(configLocal);
        console.log("✅ Conectado ao MySQL local.");

        const [ativos] = await conn.query("SELECT id FROM ativo");

        for (const ativo of ativos) {
            console.log(`--- Processando Ativo ${ativo.id} ---`);

            const [moves] = await conn.query(`
                SELECT m.*, n.operacao 
                FROM movimento_estoque m
                JOIN natureza_movimento n ON m.id_natureza = n.id
                WHERE id_ativo = ?
                ORDER BY data_evento ASC, data_inclusao ASC
            `, [ativo.id]);

            if (moves.length === 0) continue;

            let runningBalance = 0;
            const dailyBalances = {};

            for (const m of moves) {
                const qty = parseFloat(m.quantidade) || 0;
                if (m.operacao === 'CREDITO') {
                    runningBalance += qty;
                } else {
                    runningBalance -= qty;
                }
                
                if (isNaN(runningBalance)) {
                    console.error(`❌ ERRO: Saldo ficou NaN no movimento ${m.id}`);
                    continue;
                }

                // Atualizar o saldo_apos no log (Single Truth)
                await conn.query("UPDATE movimento_estoque SET saldo_apos = ? WHERE id = ?", [runningBalance, m.id]);

                const dateStr = m.data_evento.toISOString().split('T')[0];
                dailyBalances[dateStr] = runningBalance;
            }

            // Preencher lacunas e criar a série histórica
            const dates = Object.keys(dailyBalances).sort();
            const startDate = new Date(dates[0]);
            const endDate = new Date(); // Até hoje
            
            let lastBalance = 0;
            let currentDate = new Date(startDate);

            while (currentDate <= endDate) {
                const dStr = currentDate.toISOString().split('T')[0];
                if (dailyBalances[dStr] !== undefined) {
                    lastBalance = dailyBalances[dStr];
                }

                await conn.query(`
                    INSERT INTO estoque_diario (id_ativo, data, saldo_real_reprocessado, saldo_original_decisao, status_buffer)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE saldo_real_reprocessado = VALUES(saldo_real_reprocessado)
                `, [ativo.id, dStr, lastBalance, lastBalance, 'VERDE']);

                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Atualizar o saldo atual no Ativo (para conveniência)
            await conn.query("UPDATE ativo SET posicao_calc = ? WHERE id = ?", [lastBalance, ativo.id]);
            
            console.log(`🚀 Histórico gerado. Saldo Final: ${lastBalance}`);
        }

    } catch (err) {
        console.error("❌ Erro ao gerar histórico:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

generateHistory();

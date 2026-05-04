const mysql = require('mysql2/promise');
const fs = require('fs');
const { configLocal } = require('./coceo_db_config');

async function calculate() {
    let conn;
    try {
        conn = await mysql.createConnection(configLocal);
        const idAtivo = 13712;
        const leadTime = 90; // 3 meses conforme exemplo do usuário

        console.log("📊 Calculando Curvas de Inteligência para Paciente Zero...");

        // 1. Obter Saldo Real Reprocessado (Histórico v7)
        // Como o estoque_diario pode não estar completo, vamos reconstruir a partir dos movimentos
        const [moves] = await conn.query(`
            SELECT data_evento, SUM(quantidade) as delta
            FROM movimento_estoque 
            WHERE id_ativo = ? 
            GROUP BY data_evento 
            ORDER BY data_evento ASC
        `, [idAtivo]);

        const historyMap = {};
        let currentBalance = 0;
        moves.forEach(m => {
            const dateStr = new Date(m.data_evento).toISOString().split('T')[0];
            currentBalance += parseFloat(m.delta);
            historyMap[dateStr] = currentBalance;
        });

        // 2. Parâmetros da Senóide (Fitted para Jan/Fev peak)
        // No gráfico do usuário, a Mira parece oscilar entre 2 e 5 (Púrpura em 14 => Mira em 3.5)
        const piso = 4.0;
        const amplitude = 2.0;
        const phase = 15; // Pico em 15 de Janeiro

        function getMira(dateStr, lt) {
            const d = new Date(dateStr);
            d.setDate(d.getDate() + lt);
            const start = new Date(d.getFullYear(), 0, 0);
            const diff = d - start;
            const oneDay = 1000 * 60 * 60 * 24;
            const dayOfYear = Math.floor(diff / oneDay);
            
            // Senóide: 100% do foco
            return piso + amplitude * Math.cos(2 * Math.PI * (dayOfYear - phase) / 365);
        }

        // 3. Gerar dados para os últimos 365 dias
        const labels = [];
        const stock = [];
        const red = [];
        const yellow = [];
        const green = [];
        const blue = [];
        const purple = [];

        const endDate = new Date('2026-04-16'); // Fim do histórico disponível
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - 365);

        let lastKnownBalance = 0;
        // Encontrar o saldo inicial antes do range
        for (const [d, b] of Object.entries(historyMap)) {
            if (new Date(d) < startDate) lastKnownBalance = b;
        }

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dStr = d.toISOString().split('T')[0];
            labels.push(dStr);

            // Saldo Real
            if (historyMap[dStr] !== undefined) lastKnownBalance = historyMap[dStr];
            stock.push(lastKnownBalance);

            // Mira (100%) com Offset de Lead Time para decisão futura
            // Mas no gráfico, mostramos a mira de "Hoje" para referência de status
            const mira = getMira(dStr, 0); 
            
            // Limites baseados na escala exponencial do usuário
            red.push(mira * 0.5);    // Top of Crítico
            yellow.push(mira * 1.0); // Top of Abaixo (A Mira!)
            green.push(mira * 1.5);  // Top of Acima
            blue.push(mira * 2.0);   // Top of Muito Acima
            purple.push(mira * 4.0); // Top of Encalhado
        }

        const chartData = {
            labels,
            datasets: [
                { label: 'Posição Estoque', data: stock, color: '#31C6F7' }, // Azul claro da imagem
                { label: 'Crítico (50%)', data: red, color: '#F43F5E' },
                { label: 'Abaixo (100%)', data: yellow, color: '#EAB308' },
                { label: 'Acima (150%)', data: green, color: '#22C55E' },
                { label: 'Muito Acima (200%)', data: blue, color: '#3B82F6' },
                { label: 'Encalhado (400%)', data: purple, color: '#A855F7' }
            ]
        };

        fs.writeFileSync('./paciente_zero_data.json', JSON.stringify(chartData, null, 2));
        console.log("✅ Dados salvos em paciente_zero_data.json");

    } catch (err) {
        console.error("❌ ERRO:", err.message);
    } finally {
        if (conn) await conn.end();
    }
}

calculate();

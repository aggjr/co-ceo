const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./chart_data.json', 'utf8'));
// Sanitizar dados para evitar NaN/null que quebram o Chart.js
data.legacy = data.legacy.map(v => (v === null || isNaN(v)) ? 0 : v);
data.coceo_original = data.coceo_original.map(v => (v === null || isNaN(v)) ? 0 : v);
data.coceo_reconciled = data.coceo_reconciled.map(v => (v === null || isNaN(v)) ? 0 : v);

const dataStr = JSON.stringify(data);

const htmlTemplate = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Co-CEO: Auditoria CD (Simulação 117)</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --navy-bg: #050d1a;
            --gold: #DAB177;
            --gold-dim: rgba(218, 177, 119, 0.1);
            --white: #F8FAFC;
            --ruby: #F43F5E;
            --emerald: #10B981;
        }

        body {
            background: radial-gradient(circle at 50% 50%, #1a3a6d 0%, var(--navy-bg) 100%);
            color: var(--white);
            font-family: 'Montserrat', sans-serif;
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }

        .chart-container {
            width: 90%;
            max-width: 1100px;
            background: rgba(10, 28, 61, 0.8);
            border: 1px solid var(--gold-dim);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            position: relative;
        }

        canvas {
            max-width: 100%;
        }

        header { text-align: center; margin-bottom: 20px; }
        h1 { color: var(--gold); letter-spacing: 2px; margin: 0; }
        .subtitle { opacity: 0.7; font-size: 0.9rem; }

        .stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            width: 90%;
            max-width: 1100px;
            margin-top: 20px;
        }

        .card {
            background: rgba(255,255,255,0.05);
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            border: 1px solid rgba(218, 177, 119, 0.1);
        }

        .val { font-size: 1.5rem; font-weight: 700; color: var(--gold); }
        .lab { font-size: 0.7rem; text-transform: uppercase; opacity: 0.6; }

        #error-msg {
            color: var(--ruby);
            background: rgba(244, 63, 94, 0.1);
            padding: 10px;
            border-radius: 5px;
            display: none;
            margin-top: 10px;
        }
    </style>
</head>
<body>

    <header>
        <h1>CO-CEO: NECRÓPSIA CD</h1>
        <div class="subtitle">Simulação de Alinhamento Único: Ruptura de Jan/2023</div>
    </header>

    <div id="error-msg"></div>

    <div class="chart-container">
        <canvas id="mainChart"></canvas>
    </div>

    <div class="stats">
        <div class="card">
            <div class="val" id="st-leg">--</div>
            <div class="lab">Saldo Legado (Fiel)</div>
        </div>
        <div class="card">
            <div class="val" id="st-coceo">--</div>
            <div class="lab">Auditado Co-CEO</div>
        </div>
        <div class="card" style="border-color: var(--emerald);">
            <div class="val" id="st-gap" style="color: var(--emerald);">0</div>
            <div class="lab">Diferença Residual</div>
        </div>
    </div>

    <script>
        try {
            const rawData = ${dataStr};
            console.log("Dados carregados:", rawData.labels.length, "pontos.");

            const ctx = document.getElementById('mainChart').getContext('2d');
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: rawData.labels,
                    datasets: [
                        {
                            label: 'HISTÓRICO LEGADO (ORIGINAL)',
                            data: rawData.legacy,
                            borderColor: '#F8FAFC',
                            borderWidth: 2,
                            pointRadius: 0,
                            fill: false
                        },
                        {
                            label: 'VERDADE CO-CEO (SIMULADO -117)',
                            data: rawData.coceo_reconciled,
                            borderColor: '#10B981',
                            borderWidth: 1,
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            fill: true,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    animation: false, // Desligar para evitar lentidão
                    scales: {
                        x: { ticks: { color: '#94A3B8', maxTicksLimit: 15 }, grid: { display: false } },
                        y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    },
                    plugins: {
                        legend: { labels: { color: '#F8FAFC' } }
                    }
                }
            });

            const last = rawData.labels.length - 1;
            document.getElementById('st-leg').textContent = rawData.legacy[last];
            document.getElementById('st-coceo').textContent = Math.round(rawData.coceo_reconciled[last]);
            document.getElementById('st-gap').textContent = Math.round(rawData.coceo_reconciled[last] - rawData.legacy[last]);

        } catch (e) {
            console.error(e);
            const err = document.getElementById('error-msg');
            err.style.display = 'block';
            err.textContent = "Erro ao renderizar gráfico: " + e.message;
        }
    </script>
</body>
</html>`;

fs.writeFileSync('./cd_necropsy_dashboard.html', htmlTemplate);
console.log("✅ Dashboard robusto gerado com dados sanitizados.");

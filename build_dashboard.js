const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./chart_data.json', 'utf8'));
const dataStr = JSON.stringify(data);

const htmlTemplate = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Co-CEO: Necrópsia do CD (Paciente Zero)</title>
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

        header {
            text-align: center;
            margin-bottom: 30px;
        }

        h1 {
            color: var(--gold);
            font-size: 2.2rem;
            margin: 0;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .subtitle {
            color: var(--white);
            opacity: 0.8;
            font-weight: 300;
        }

        .chart-container {
            width: 90%;
            max-width: 1200px;
            background: rgba(10, 28, 61, 0.7);
            border: 1px solid var(--gold-dim);
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            width: 90%;
            max-width: 1200px;
            margin-top: 30px;
        }

        .stat-card {
            background: var(--gold-dim);
            border: 1px solid var(--gold-dim);
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }

        .stat-value {
            font-size: 1.8rem;
            font-weight: 700;
            color: var(--gold);
        }

        .stat-label {
            font-size: 0.8rem;
            text-transform: uppercase;
            opacity: 0.7;
            margin-top: 5px;
        }

        .divergence-alert {
            margin-top: 30px;
            padding: 15px 30px;
            background: rgba(244, 63, 94, 0.1);
            border: 1px solid var(--ruby);
            color: var(--ruby);
            border-radius: 50px;
            font-weight: 600;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(244, 63, 94, 0); }
            100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
        }
    </style>
</head>
<body>

    <header>
        <h1>CO-CEO: Necrópsia de Inventário</h1>
        <div class="subtitle">Análise Comparativa Global — Ativo 13712 (CD SARON)</div>
    </header>

    <div class="chart-container">
        <canvas id="comparisonChart"></canvas>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value" id="val-legacy">--</div>
            <div class="stat-label">Saldo Oficial Legado</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="val-coceo">--</div>
            <div class="stat-label">Saldo Co-CEO (Sincronizado)</div>
        </div>
        <div class="stat-card" style="border-color: var(--ruby);">
            <div class="stat-value" id="val-gap" style="color: var(--ruby);">--</div>
            <div class="stat-label">Rombo Detectado (Ganhos/Perdas)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="val-mysteries">--</div>
            <div class="stat-label">Pontos de Mistério</div>
        </div>
    </div>

    <div class="divergence-alert">
        ⚠️ Investigação em tempo real: 55 tabelas auditadas.
    </div>

    <script>
        const auditData = ${dataStr};

        function loadChart() {
            const ctx = document.getElementById('comparisonChart').getContext('2d');
            
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: auditData.labels,
                    datasets: [
                        {
                            label: 'VERDADE DO LEGADO (Histórico Oficial)',
                            data: auditData.legacy,
                            borderColor: '#F8FAFC',
                            borderWidth: 3,
                            fill: false,
                            tension: 0.1,
                            pointRadius: 0
                        },
                        {
                            label: 'VERDADE CO-CEO (Somente Logs)',
                            data: auditData.coceo_original,
                            borderColor: '#DAB177',
                            borderDash: [5, 5],
                            borderWidth: 2,
                            fill: false,
                            tension: 0.1,
                            pointRadius: 0
                        },
                        {
                            label: 'VERDADE RECONCILIADA (Pós-Auditoria)',
                            data: auditData.coceo_reconciled,
                            borderColor: '#10B981',
                            borderWidth: 1,
                            fill: true,
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            tension: 0.1,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { labels: { color: '#F8FAFC', font: { family: 'Montserrat' } } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: { 
                            ticks: { color: '#94A3B8', maxTicksLimit: 20 },
                            grid: { color: 'rgba(218, 177, 119, 0.05)' }
                        },
                        y: { 
                            ticks: { color: '#94A3B8' },
                            grid: { color: 'rgba(218, 177, 119, 0.05)' }
                        }
                    }
                }
            });

            // Atualizar Stats
            const lastIdx = auditData.labels.length - 1;
            document.getElementById('val-legacy').textContent = auditData.legacy[lastIdx] !== null ? auditData.legacy[lastIdx] : '--';
            document.getElementById('val-coceo').textContent = Math.round(auditData.coceo_original[lastIdx]);
            document.getElementById('val-gap').textContent = Math.round(auditData.coceo_original[lastIdx] - (auditData.legacy[lastIdx] || 0));
            document.getElementById('val-mysteries').textContent = '28';
        }

        loadChart();
    </script>
</body>
</html>`;

fs.writeFileSync('./cd_necropsy_dashboard.html', htmlTemplate);
console.log("✅ Dashboard atualizado com dados embutidos.");

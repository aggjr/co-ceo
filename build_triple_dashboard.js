const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./triple_chart_data.json', 'utf8'));
const dataStr = JSON.stringify(data);

const htmlTemplate = `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Co-CEO: Auditoria Tripla de Convergência (CD) - Cortina 12152</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --navy-bg: #050d1a;
            --gold: #DAB177;
            --white: #F8FAFC;
            --ruby: #F43F5E;
            --emerald: #10B981;
            --blue-foccus: #3B82F6;
        }

        body {
            background: radial-gradient(circle at 50% 50%, #1a3a6d 0%, var(--navy-bg) 100%);
            color: var(--white);
            font-family: 'Montserrat', sans-serif;
            margin: 0; padding: 20px;
            display: flex; flex-direction: column; align-items: center;
        }

        .container { width: 95%; max-width: 1200px; }
        .chart-box { 
            background: rgba(10, 28, 61, 0.9); 
            border: 1px solid rgba(218, 177, 119, 0.2); 
            border-radius: 12px; padding: 25px; 
            box-shadow: 0 10px 50px rgba(0,0,0,0.8);
        }
        
        header { text-align: center; margin-bottom: 30px; }
        h1 { color: var(--gold); letter-spacing: 3px; margin: 0; text-transform: uppercase; }
        .subtitle { opacity: 0.6; font-size: 0.9rem; margin-top: 5px; }

        .legend-custom {
            display: flex; justify-content: center; gap: 30px; margin-top: 20px; font-size: 0.8rem;
        }
        .leg-item { display: flex; align-items: center; gap: 8px; }
        .dot { width: 12px; height: 12px; border-radius: 2px; }

        .stats-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 30px;
        }
        .card {
            background: rgba(255,255,255,0.03); 
            padding: 20px; border-radius: 10px; text-align: center;
            border-bottom: 3px solid transparent;
        }
        .val { font-size: 2rem; font-weight: 700; margin-bottom: 5px; }
        .lab { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.5; }
    </style>
</head>
<body>

    <div class="container">
        <header>
            <h1>Auditoria de Tripla Convergência</h1>
            <div class="subtitle">Análise Comparativa: Logs vs. Snapshots vs. Operacional (CD)</div>
        </header>

        <div class="chart-box">
            <canvas id="tripleChart"></canvas>
            
            <div class="legend-custom">
                <div class="leg-item"><div class="dot" style="background: var(--white);"></div> 1. Histórico Snapshot (Legado)</div>
                <div class="leg-item"><div class="dot" style="background: var(--emerald); border: 2px dashed #000;"></div> 2. Cálculo Co-CEO (Logs)</div>
                <div class="leg-item"><div class="dot" style="background: var(--blue-foccus);"></div> 3. Verdade Foccus (Operacional)</div>
            </div>
        </div>

        <div class="stats-grid">
            <div class="card" style="border-color: var(--white);">
                <div class="lab">Saldo Snapshot</div>
                <div class="val" id="v-leg">--</div>
            </div>
            <div class="card" style="border-color: var(--emerald);">
                <div class="lab">Saldo Co-CEO (Auditado)</div>
                <div class="val" id="v-ceo">--</div>
            </div>
            <div class="card" style="border-color: var(--blue-foccus);">
                <div class="lab">Saldo Foccus (Alvo)</div>
                <div class="val" id="v-foccus">--</div>
            </div>
        </div>
    </div>

    <script>
        const ctx = document.getElementById('tripleChart').getContext('2d');
        const audit = ${dataStr};

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: audit.labels,
                datasets: [
                    {
                        label: '1. LEGADO SNAPSHOT',
                        data: audit.legacy_snapshot,
                        borderColor: '#F8FAFC',
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: '2. CO-CEO LOGS (PONTILHADO)',
                        data: audit.coceo_logs,
                        borderColor: '#10B981',
                        borderDash: [5, 5],
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: '3. FOCCUS OPERACIONAL',
                        data: audit.foccus_operational,
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        pointRadius: 0,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                animation: false,
                scales: {
                    x: { ticks: { color: '#94A3B8', maxTicksLimit: 12 }, grid: { display: false } },
                    y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });

        const lastIdx = audit.labels.length - 1;
        document.getElementById('v-leg').textContent = Math.round(audit.legacy_snapshot[lastIdx]);
        document.getElementById('v-ceo').textContent = Math.round(audit.coceo_logs[lastIdx]);
        document.getElementById('v-foccus').textContent = Math.round(audit.foccus_operational[lastIdx]);
    </script>
</body>
</html>`;

fs.writeFileSync('./cd_triple_necropsy_dashboard.html', htmlTemplate);
console.log("✅ Dashboard de Auditoria Tripla gerado com sucesso.");

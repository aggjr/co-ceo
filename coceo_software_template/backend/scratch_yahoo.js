const https = require('https');

function fetchY(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    console.log(`Testing Yahoo Finance for: ${ticker}`);
    return new Promise(res => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }}, (r) => {
            let d = ''; r.on('data', c => d+=c);
            r.on('end', () => {
                try {
                    const j = JSON.parse(d);
                    const meta = j.chart?.result?.[0]?.meta;
                    if (meta) {
                        console.log(`  [OK] ${ticker}: Price=${meta.regularMarketPrice} Cur=${meta.currency}`);
                    } else {
                        console.log(`  [FAIL] ${ticker}: No valid meta. Response length ${d.length}`);
                    }
                } catch (e) { console.log(`  [ERROR] Parse fail for ${ticker}`); }
                res();
            });
        });
    });
}

async function run() {
    await fetchY('PETR4.SA');
    // In May 2026, PETRE options exist. Let's guess a generic structure.
    // Yahoo format for B3 options varies. Often it is like PETRE300.SA ?
    // Or PETR4E28.SA? 
    await fetchY('PETRE300.SA');
    await fetchY('PETRE30.SA');
}
run();

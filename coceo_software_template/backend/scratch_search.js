const https = require('https');

function testSearch(term) {
    const url = `https://statusinvest.com.br/home/mainsearchquery?q=${term}`;
    console.log(`Searching StatusInvest for: ${term}`);
    return new Promise(resolve => {
        const opt = { headers: { 'User-Agent': 'Mozilla/5.0' }};
        https.get(url, opt, r => {
            let d = ''; r.on('data', c => d+=c);
            r.on('end', () => {
                try {
                    const j = JSON.parse(d);
                    console.log(`Search Result for ${term}:`, JSON.stringify(j, null, 2));
                } catch (e) { console.log('Parse error', d.substring(0, 50)); }
                resolve();
            });
        });
    });
}

async function run() {
    await testSearch('PETR4');
    await testSearch('PETRH322');
}
run();

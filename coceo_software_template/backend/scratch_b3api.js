const https = require('https');

function fetchB3Api(ticker) {
    const url = `https://b3api.vercel.app/api/quote/${ticker}`;
    console.log(`Testing B3Api for: ${url}`);
    return new Promise(resolve => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`STATUS: ${res.statusCode}`);
                if (res.statusCode === 200) {
                    try {
                        const j = JSON.parse(data);
                        console.log(`SUCCESS for ${ticker}:`, JSON.stringify(j).substring(0, 100));
                    } catch (e) { console.log('JSON Parse failed'); }
                } else {
                    console.log('Failed (not 200)');
                }
                resolve();
            });
        }).on('error', e => { console.log(e.message); resolve(); });
    });
}

async function run() {
    // Test if they have options. Example: PETRE120 or PETRE250
    await fetchB3Api('PETR4');
    await fetchB3Api('PETRE300');
}

run();

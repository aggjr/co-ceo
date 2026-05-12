const https = require('https');

async function run() {
    console.log('--- Fetching StatusInvest Options Master List ---');
    
    // JSON advanced search for category=3 (options)
    const searchPayload = encodeURIComponent(JSON.stringify({
        Sector: "", SubSector: "", Segment: "", isin: "",
        Earnings: {}, CompanyId: "", OptionsType: 0, Currency: ""
    }));
    
    const url = `https://statusinvest.com.br/category/advancedsearchresult?CategoryType=3&search=${searchPayload}`;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': 'https://statusinvest.com.br/opcoes/busca-avancada'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`URL: https://statusinvest.com.br/...`);
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`HEAD: ${res.headers['content-type']}`);
        console.log(`LENGTH: ${data.length} bytes`);
        if (data.length > 2) {
            try {
                const list = JSON.parse(data);
                console.log(`SUCCESS! Got ${list.length} options in master list.`);
                if (list.length > 0) {
                    console.log('Sample Item:', JSON.stringify(list[0], null, 2));
                }
            } catch (e) {
                console.log('PARSE ERROR:', e.message);
                console.log('RAW (first 200):', data.substring(0, 200));
            }
        } else {
            console.log('Empty body.');
        }
        process.exit(0);
      });
    }).on('error', (e) => { console.error(e); process.exit(1); });
}

run();

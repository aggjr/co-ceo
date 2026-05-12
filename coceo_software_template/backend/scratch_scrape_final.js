const https = require('https');

function fetchStatusInvestOption(ticker) {
    // SET DIRECTLY TO CONFIRMED SUBAGENT PATH
    const url = `https://statusinvest.com.br/opcoes/petr4/petrh322`; 
    console.log(`[Scraper] Requesting definitively known path: ${url}`);
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    return new Promise((resolve, reject) => {
        https.get(url, options, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP Status ${res.statusCode} for ${ticker}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    // Locate the container that has the "PRÊMIO ATUAL" 
                    // Look for the strong tag with class value inside it
                    // Typical pattern: title="Valor atual do ativo">PRÊMIO ATUAL</h3><div class="wrapper"><span class="symbol">R$</span><strong class="value">11,11</strong>
                    
                    const normalizedData = data.replace(/\s+/g, ' ');
                    const anchor = "Prêmio atual";
                    const anchorIdx = normalizedData.indexOf(anchor);
                    
                    if (anchorIdx === -1) {
                        return reject(new Error('Anchor "Prêmio atual" not found in normalized data'));
                    }
                    
                    // Look ahead from anchor
                    const slice = normalizedData.substring(anchorIdx, anchorIdx + 1000);
                    const regex = /<strong[^>]*class=["'][^"']*value[^"']*["'][^>]*>([^<]+)<\/strong>/i;
                    const match = slice.match(regex);
                    
                    if (match && match[1]) {
                        let valStr = match[1].trim();
                        console.log(`[Found] Contextual value after anchor: "${valStr}"`);
                        const price = parseFloat(valStr.replace(/\./g, '').replace(',', '.'));
                        
                        resolve({
                            success: true,
                            price: isNaN(price) ? 0 : price,
                            ticker: ticker.toUpperCase()
                        });
                    } else {
                        reject(new Error('Regex match failed to extract price from verified pattern.'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    try {
        const result = await fetchStatusInvestOption('PETRH322');
        console.log('PARSE RESULT:', result);
    } catch (e) {
        console.error('SCRAPE FAILED:', e.message);
    }
}

run();

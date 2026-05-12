const https = require('https');

async function run() {
    console.log('--- Scraping Opcoes.net.br Initial State ---');
    const url = 'https://www.opcoes.net.br/opcoes/bovespa/PETR4';
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`STATUS: ${res.statusCode}`);
        
        // Look for data variables
        const regexList = [
            /var\s+data\s*=\s*\[/i,
            /window\._data\s*=/i,
            /listaOpcoes/i,
            /var\s+model\s*=/i
        ];
        
        for (const r of regexList) {
            const match = data.match(r);
            if (match) {
                console.log(`FOUND VARIABLE MATCH: ${match[0]} at position ${match.index}`);
                console.log(data.substring(match.index, match.index + 500));
            }
        }
        
        // Just dump the first occurrence of table data if found
        if (data.includes('<table')) {
            console.log('TABLE tag found in source HTML');
        }
        
        // Check for hidden inputs holding data
        if (data.includes('id="lista-opcoes"')) {
            console.log('Found container with ID lista-opcoes');
        }

        process.exit(0);
      });
    }).on('error', (e) => { console.error(e); process.exit(1); });
}

run();

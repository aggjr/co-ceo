const https = require('https');

function testRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`URL: ${url}`);
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`RESPONSE LENGTH: ${data.length}`);
        if (res.statusCode === 200) {
            try {
                const j = JSON.parse(data);
                console.log('JSON SUCCESS');
                // console.log(data.substring(0, 500));
            } catch (e) {
                console.log('HTML/TEXT RETURNED');
                // console.log(data.substring(0, 500));
            }
        }
        resolve();
      });
    }).on('error', reject);
  });
}

async function run() {
    console.log('--- Testing Yahoo Finance for B3 Option ---');
    // In Yahoo Finance, options typically are like PETRK30.SA but their formatting fluctuates. 
    // Let's just check if a generic quote summary endpoint can see them.
    // Actually, let's try StatusInvest search API endpoint for an option.
    
    // CategoryType=3 means options. Ticker search.
    const siUrl = 'https://statusinvest.com.br/home/mainsearchquery?q=PETRE30'; 
    await testRequest(siUrl);
    
    console.log('\n--- Testing Opcoes.net.br JSON interface ---');
    // They sometimes have a JSON endpoint used by their grid.
    const opNet = 'https://www.opcoes.net.br/listaopcoes/completa?idAcao=PETR4&listarVencimentos=true';
    await testRequest(opNet);
}

run();

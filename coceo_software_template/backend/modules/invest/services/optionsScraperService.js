const https = require('https');

/**
 * Real-time Option fallback parser for StatusInvest
 * This is dynamically utilized whenever BRAPI does not include derivative quotes
 */
async function fetchOptionPrice(ticker) {
    const baseTicker = ticker.substring(0, 4).toLowerCase();
    const optionTicker = ticker.toLowerCase();

    // Options typically derive from XX3 or XX4. We will try PN (4) first as it is most common, then ON (3).
    const candidates = [
        `https://statusinvest.com.br/opcoes/${baseTicker}4/${optionTicker}`,
        `https://statusinvest.com.br/opcoes/${baseTicker}3/${optionTicker}`,
        // Case fallback if the underlying is unusual (e.g. BOVA11 options)
        `https://statusinvest.com.br/opcoes/${baseTicker}11/${optionTicker}`
    ];

    for (const url of candidates) {
        try {
            console.log(`[OptionScraper] Attempting fetch: ${url}`);
            const result = await fetchSingleUrl(url);
            if (result) {
                console.log(`[OptionScraper] Successfully retrieved quote for ${ticker}: R$ ${result.price}`);
                return { ...result, ticker: ticker.toUpperCase() };
            }
        } catch (e) {
            // Log fail, continue loop to next candidate
            console.log(`[OptionScraper] Candidate failed (${url}): ${e.message}`);
        }
    }

    throw new Error(`Unable to locate current quotes for option ${ticker} on available free resources.`);
}

function fetchSingleUrl(url) {
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 8000
    };

    return new Promise((resolve, reject) => {
        https.get(url, options, (res) => {
            if (res.statusCode === 404) {
                return resolve(null); // Silent candidate miss
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            let rawBody = '';
            res.on('data', chunk => rawBody += chunk);
            res.on('end', () => {
                try {
                    // Standardize spacing
                    const normalized = rawBody.replace(/\s+/g, ' ');
                    
                    // Target exact price container following "Prêmio atual" anchor
                    const anchor = "Prêmio atual";
                    const anchorIdx = normalized.indexOf(anchor);
                    if (anchorIdx === -1) {
                        return reject(new Error('Found page but pricing anchor "Prêmio atual" was missing. Structure may have changed.'));
                    }

                    const slice = normalized.substring(anchorIdx, anchorIdx + 1000);
                    const regex = /<strong[^>]*class=["'][^"']*value[^"']*["'][^>]*>([^<]+)<\/strong>/i;
                    const match = slice.match(regex);

                    if (match && match[1]) {
                        let valStr = match[1].trim();
                        if (valStr === '-' || valStr === '--') {
                            return resolve({ price: 0, date: new Date(), source: 'scraper' });
                        }
                        const price = parseFloat(valStr.replace(/\./g, '').replace(',', '.'));
                        
                        // Try to get variation if available nearby
                        let changePct = 0;
                        const varMatch = slice.match(/<span[^>]*class=["'][^"']*percentage[^"']*["'][^>]*>\(([^)%]+)%\)<\/span>/i);
                        if (varMatch) {
                            changePct = parseFloat(varMatch[1].trim().replace(/\./g, '').replace(',', '.'));
                        }

                        resolve({
                            price: isNaN(price) ? 0 : price,
                            change_percent: isNaN(changePct) ? 0 : changePct,
                            updated_at: new Date(),
                            source: 'scraper'
                        });
                    } else {
                        reject(new Error('Unable to parse <strong class="value"> pattern in extracted slice.'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

module.exports = {
    fetchOptionPrice
};

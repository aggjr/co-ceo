/**
 * brapiService.js
 * Wrapper para a API brapi.dev com cache em banco MySQL (TTL 15 min para ações/FIIs,
 * e cache EOD para opções — atualiza 1x/dia após 19h BRT).
 */
const https = require('https');
const db    = require('../../../config/database');

const BRAPI_TOKEN = process.env.BRAPI_TOKEN || '';
const CACHE_TTL_MS = parseInt(process.env.INVEST_QUOTE_CACHE_TTL_MS || '900000', 10); // 15 min

// ── helpers ──────────────────────────────────────────────────────────────────

function brapiGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://brapi.dev${path}${path.includes('?') ? '&' : '?'}token=${BRAPI_TOKEN}`;
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`brapi parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function getCachedQuote(ticker) {
  const [[row]] = await db.query(
    `SELECT price, change_pct, payload, fetched_at FROM invest_quote_cache WHERE ticker = ?`,
    [ticker]
  );
  if (!row) return null;
  const age = Date.now() - new Date(row.fetched_at).getTime();
  if (age > CACHE_TTL_MS) return null;          // expirado
  return { price: row.price, changePct: row.change_pct, ...JSON.parse(row.payload || '{}') };
}

async function upsertCache(ticker, price, changePct, payload) {
  await db.query(
    `INSERT INTO invest_quote_cache (ticker, price, change_pct, payload, fetched_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE price=VALUES(price), change_pct=VALUES(change_pct),
       payload=VALUES(payload), fetched_at=NOW()`,
    [ticker, price, changePct, JSON.stringify(payload)]
  );
}

// ── exports ───────────────────────────────────────────────────────────────────

/**
 * Retorna cotações para um array de tickers (ações, FIIs, ETFs, BDRs).
 * Usa cache MySQL de 15 min; busca em lote os que estão expirados.
 */
async function getQuotes(tickers) {
  const results = {};
  const toFetch = [];

  for (const ticker of tickers) {
    const cached = await getCachedQuote(ticker);
    if (cached) { results[ticker] = cached; }
    else { toFetch.push(ticker); }
  }

  if (toFetch.length > 0) {
    const joined = toFetch.join(',');
    try {
      const data = await brapiGet(`/api/quote/${joined}`);
      for (const q of (data.results || [])) {
        const entry = {
          ticker:     q.symbol,
          price:      q.regularMarketPrice,
          changePct:  q.regularMarketChangePercent,
          change:     q.regularMarketChange,
          high:       q.regularMarketDayHigh,
          low:        q.regularMarketDayLow,
          volume:     q.regularMarketVolume,
          name:       q.shortName,
          fetchedAt:  new Date().toISOString(),
        };
        results[q.symbol] = entry;
        await upsertCache(q.symbol, entry.price, entry.changePct, entry);
      }
    } catch (e) {
       console.error(`[BrapiService] Primary API fetch failed: ${e.message}`);
    }

    // Fallback: For tickers still missing, if they appear to be Options (length >= 7), utilize the Scraper.
    const remaining = toFetch.filter(t => !results[t]);
    for (const ticker of remaining) {
      if (ticker.length >= 7) {
        try {
          const optionsScraper = require('./optionsScraperService');
          const scraped = await optionsScraper.fetchOptionPrice(ticker);
          if (scraped) {
            const entry = {
              ticker: ticker,
              price: scraped.price,
              changePct: scraped.change_percent || 0,
              fetchedAt: new Date().toISOString(),
              source: 'web_scraper'
            };
            results[ticker] = entry;
            await upsertCache(ticker, entry.price, entry.changePct, entry);
          }
        } catch (scrapeErr) {
          console.error(`[BrapiService] Scraper fallback failed for ${ticker}: ${scrapeErr.message}`);
        }
      }
    }
  }

  return results;
}

/**
 * Retorna dados macroeconômicos: SELIC, CDI, IPCA (cache 24h via tabela).
 */
async function getMacro() {
  // Cache simples em memória — macro não muda durante o pregão
  if (getMacro._cache && (Date.now() - getMacro._ts) < 86_400_000) {
    return getMacro._cache;
  }
  const data = await brapiGet('/api/v2/prime-rate?country=brazil');
  getMacro._cache = data;
  getMacro._ts = Date.now();
  return data;
}

module.exports = { getQuotes, getMacro, brapiGet };

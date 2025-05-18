// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // Try these Pump.fun API endpoints in order
  const endpoints = [
    'https://frontend-api-v3.pump.fun/coins/',
    'https://frontend-api-v2.pump.fun/coins/',
    'https://frontend-api.pump.fun/coins/'
  ];

  let coin = null;
  let lastError = null;

  // 1) Attempt to fetch from each endpoint until one succeeds
  for (const base of endpoints) {
    try {
      const r = await fetch(`${base}${address}`);
      if (!r.ok) {
        lastError = `Status ${r.status} from ${base}`;
        // If service unavailable, try next
        continue;
      }
      coin = await r.json();
      break;
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  // 2) If all three failed, return error
  if (!coin) {
    return res
      .status(502)
      .json({ success: false, error: `All Pump.fun APIs failed: ${lastError}` });
  }

  // 3) Extract & compute
  const name   = coin.name  || coin.symbol || address;
  const symbol = coin.symbol || '';
  const pool   = coin.pool   || {};

  // Price & currency
  const price = pool.price != null ? pool.price.toString() : 'N/A';
  let priceCurrency = 'SOL';
  if (pool.pool_name?.toUpperCase().includes('/ USDC')) {
    priceCurrency = 'USDC';
  }

  // Buy Score via DexScreener fallback
  let buyScore = 'N/A';
  try {
    const dex = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    ).then(r => r.json());
    const arr = Array.isArray(dex) ? dex : (dex.pairs || []);
    if (arr.length) {
      arr.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const tx = arr[0].txns?.h24 || {};
      const { buys = 0, sells = 0 } = tx;
      if (buys + sells > 0) {
        buyScore = Math.round((buys / (buys + sells)) * 100).toString();
      }
    }
  } catch {
    // leave N/A
  }

  // Predicted ROI from 24h change
  let predictedRoi = 'N/A';
  if (pool.price_change_24h != null) {
    predictedRoi = pool.price_change_24h.toFixed(2) + '%';
  } else if (pool.price_change_6h != null) {
    predictedRoi = pool.price_change_6h.toFixed(2) + '%';
  }

  // Safety warnings
  const warnings = [];
  if (coin.nsfw)                   warnings.push('Marked NSFW');
  if (coin.usd_market_cap < 1000)  warnings.push('Low market cap (<$1k)');
  if (pool.price_change_24h != null) {
    if (pool.price_change_24h < -50)  warnings.push('Down >50% in 24h');
    if (pool.price_change_24h > 1000) warnings.push('Up >1000% in 24h');
  }

  // 4) Respond
  return res.status(200).json({
    success: true,
    name,
    symbol,
    price,
    priceCurrency,
    buyScore,
    predictedRoi,
    warnings
  });
}

// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // 1) Try Pump.fun official API
  const endpoints = [
    'https://frontend-api-v3.pump.fun/coins/',
    'https://frontend-api-v2.pump.fun/coins/',
    'https://frontend-api.pump.fun/coins/'
  ];
  let coin = null, lastErr = '';
  for (const url of endpoints) {
    try {
      const r = await fetch(url + address);
      if (!r.ok) { lastErr = `Status ${r.status}`; continue; }
      coin = await r.json();
      break;
    } catch (e) {
      lastErr = e.message;
    }
  }
  if (!coin) {
    return res
      .status(502)
      .json({ success: false, error: `Pump.fun APIs down: ${lastErr}` });
  }

  // 2) Pull what we can from Pump.fun
  const pool = coin.pool || {};
  const usdMarketCap = coin.usd_market_cap ?? null;
  let marketCap = usdMarketCap != null ? usdMarketCap.toString() : null;

  // 3) Compute buyScore from DexScreener (unchanged)
  let buyScore = 'N/A';
  try {
    const dex = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    ).then(r => r.json());
    const arr = Array.isArray(dex) ? dex : dex.pairs || [];
    if (arr.length) {
      arr.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
      const tx = arr[0].txns?.h24 || {};
      if (tx.buys+tx.sells>0) {
        buyScore = Math.round(tx.buys/(tx.buys+tx.sells)*100).toString();
      }
    }
  } catch {}

  // 4) Compute ROI:
  // 4a) Try Pump.fun 24h or 6h change
  let predictedRoi = null;
  if (typeof pool.price_change_24h === 'number') {
    predictedRoi = pool.price_change_24h.toFixed(2) + '%';
  } else if (typeof pool.price_change_6h === 'number') {
    predictedRoi = pool.price_change_6h.toFixed(2) + '%';
  }

  // 4b) If no ROI or marketCap from Pump.fun, fallback to DexScreener
  if (predictedRoi === null || marketCap === null) {
    try {
      const dex2 = await fetch(
        `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
      ).then(r => r.json());
      const arr2 = Array.isArray(dex2) ? dex2 : dex2.pairs || [];
      if (arr2.length) {
        arr2.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
        const p = arr2[0];
        // fallback marketCap = FDV or liquidity
        if (marketCap === null) {
          marketCap = p.fdv != null
            ? p.fdv.toString()
            : (p.liquidity?.usd||0).toString();
        }
        // fallback ROI
        if (predictedRoi === null) {
          const change = p.priceChange?.h24 ?? p.priceChange?.h6 ?? p.priceChange?.h1;
          if (typeof change === 'number') {
            predictedRoi = change.toFixed(2) + '%';
          }
        }
      }
    } catch {}
  }

  // 4c) Final fallback for ROI: heuristic if still missing
  if (predictedRoi === null) {
    const vel = pool.recent_buy_velocity || 0;
    const sol = pool.total_sol_raised    || 0;
    predictedRoi = (vel * sol * 0.75).toFixed(1) + '%';
  }

  // 5) Default marketCap if still null
  marketCap = marketCap || 'N/A';

  // 6) Warnings (unchanged)
  const warnings = [];
  if (coin.nsfw)                 warnings.push('Marked NSFW');
  if (coin.usd_market_cap < 1000)warnings.push('Low market cap (< $1k)');
  if (typeof pool.price_change_24h === 'number') {
    if (pool.price_change_24h < -50)  warnings.push('Down >50% in 24h');
    if (pool.price_change_24h > 1000) warnings.push('Up >1000% in 24h');
  }

  // 7) Return JSON
  return res.status(200).json({
    success:     true,
    marketCap,         // now always filled
    buyScore,
    predictedRoi,
    warnings
  });
}

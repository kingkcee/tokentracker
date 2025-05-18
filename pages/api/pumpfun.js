// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // try official Pump.fun API endpoints…
  const endpoints = [
    'https://frontend-api-v3.pump.fun/coins/',
    'https://frontend-api-v2.pump.fun/coins/',
    'https://frontend-api.pump.fun/coins/'
  ];
  let coin, lastError;
  for (const base of endpoints) {
    try {
      const r = await fetch(base + address);
      if (!r.ok) { lastError = `Status ${r.status}`; continue; }
      coin = await r.json(); 
      break;
    } catch (e) { lastError = e.message; }
  }
  if (!coin) {
    return res
      .status(502)
      .json({ success:false, error:`All APIs failed: ${lastError}` });
  }

  // extract market cap
  const marketCap = coin.usd_market_cap != null
    ? coin.usd_market_cap.toString()
    : 'N/A';

  // compute buyScore & predictedRoi as before (unchanged)…
  let buyScore = 'N/A';
  try {
    const dex = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`)
      .then(r=>r.json());
    const arr = Array.isArray(dex) ? dex : (dex.pairs||[]);
    if (arr.length) {
      arr.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
      const tx = arr[0].txns.h24||{};
      if (tx.buys+tx.sells) {
        buyScore = Math.round(tx.buys/(tx.buys+tx.sells)*100).toString();
      }
    }
  } catch {}
  // ROI from 24h change on Pump.fun
  let predictedRoi = 'N/A';
  const pool = coin.pool||{};
  if (pool.price_change_24h != null) {
    predictedRoi = pool.price_change_24h.toFixed(2) + '%';
  }

  // warnings
  const warnings = [];
  if (coin.nsfw)                 warnings.push('Marked NSFW');
  if (coin.usd_market_cap < 1000) warnings.push('Low market cap (<$1k)');
  if (pool.price_change_24h != null) {
    if (pool.price_change_24h < -50)  warnings.push('Down >50% in 24h');
    if (pool.price_change_24h > 1000) warnings.push('Up >1000% in 24h');
  }

  return res.status(200).json({
    success:     true,
    marketCap,           // <-- new
    buyScore,
    predictedRoi,
    warnings
  });
}

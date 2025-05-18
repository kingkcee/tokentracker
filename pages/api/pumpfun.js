// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // 1) Fetch Pump.fun data (v3 → v2 → v1)
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

  // 2) Destructure data
  const pool = coin.pool || {};
  const buyCount   = pool.buy_count    ?? 0;
  const sellCount  = pool.sell_count   ?? 0;
  const totalSol   = pool.total_sol_raised    ?? 0;
  const recentVel  = pool.recent_buy_velocity ?? 0;
  const holders    = coin.holder_count        ?? 0;
  const holder24   = pool.holder_count_24h    ?? 0;

  // 3) Multi-interval weighted momentum → raw ROI
  const windows = [
    { key: 'price_change_5m',  weight: 0.05 },
    { key: 'price_change_15m', weight: 0.10 },
    { key: 'price_change_1h',  weight: 0.15 },
    { key: 'price_change_6h',  weight: 0.25 },
    { key: 'price_change_24h', weight: 0.45 }
  ];
  let rawRoi = windows.reduce((sum, w) => sum + ((pool[w.key] ?? 0) * w.weight), 0);

  // 4) Volume-weight
  const vol24 = pool.volume_24h_usd ?? 0;
  const volF  = Math.log10(1 + vol24);
  rawRoi *= (1 + volF / 10);

  // 5) Liquidity adjustment
  const liqUsd = pool.liquidity_usd ?? pool.liquidity?.usd ?? 0;
  const liqF   = Math.log10(1 + liqUsd);
  rawRoi *= (0.75 + 0.25 * (liqF / 6));

  // 6) Buy/Sell ratio boost (0.5–1.0)
  const totalTx = buyCount + sellCount;
  const ratio   = totalTx > 0 ? (buyCount / totalTx) : 0.5;
  rawRoi *= ratio;

  // 7) Holder growth bonus (+ up to +10%)
  rawRoi += Math.min(10, holder24 * 0.1);

  const predictedRoi = rawRoi.toFixed(2) + '%';

  // 8) Compute Buy Score (0–100) using same factors
  let buyScore = 100;
  if (!pool.liquidity_locked) buyScore -= 30;
  if (pool.mint_enabled)      buyScore -= 25;
  if (!pool.deployer_buying)  buyScore -= 15;
  if (totalTx < 20)           buyScore -= 10;
  if (recentVel < 5)          buyScore -= 10;
  if (totalSol < 1)           buyScore -= 10;
  // apply buy/sell ratio and holder growth
  buyScore = Math.round(Math.max(0, buyScore) * ratio + holder24 * 0.1);
  buyScore = Math.min(100, buyScore);

  // 9) Market Cap & Warnings
  const marketCap = coin.usd_market_cap != null
    ? coin.usd_market_cap.toString()
    : 'N/A';

  const warnings = [];
  if (coin.nsfw)                 warnings.push('Marked NSFW');
  if (coin.usd_market_cap < 1000)warnings.push('Low market cap (< $1k)');
  if (pool.price_change_24h < -50)  warnings.push('Down >50% 24h');
  if (pool.price_change_24h > 1000) warnings.push('Up >1000% 24h');

  // 10) Return all fields
  return res.status(200).json({
    success:      true,
    marketCap,
    buyScore:     buyScore.toString(),
    predictedRoi,
    warnings
  });
}

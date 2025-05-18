// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // 1) Multi-endpoint Pump.fun API fallback
  const endpoints = [
    'https://frontend-api-v3.pump.fun/coins/',
    'https://frontend-api-v2.pump.fun/coins/',
    'https://frontend-api.pump.fun/coins/'
  ];
  let coin = null, lastError = '';
  for (const base of endpoints) {
    try {
      const r = await fetch(base + address);
      if (!r.ok) { lastError = `Status ${r.status}`; continue; }
      coin = await r.json();
      break;
    } catch (e) {
      lastError = e.message;
    }
  }
  if (!coin) {
    return res
      .status(502)
      .json({ success: false, error: `All Pump.fun APIs failed: ${lastError}` });
  }

  // 2) Destructure the pool data
  const pool = coin.pool || {};
  const totalSolRaised    = pool.total_sol_raised    ?? 0;
  const recentBuyVelocity = pool.recent_buy_velocity ?? 0;

  // 3) Compute Buy Score (unchanged)
  let buyScore = 100;
  if (!pool.liquidity_locked) buyScore -= 30;
  if (pool.mint_enabled)      buyScore -= 25;
  if (!pool.deployer_buying)  buyScore -= 15;
  if ((pool.buy_count    ?? 0) < 10) buyScore -= 10;
  if (recentBuyVelocity < 5)        buyScore -= 10;
  if (totalSolRaised  < 1)          buyScore -= 10;
  buyScore = Math.max(0, buyScore);

  // 4) Improved ROI calculation:
  // 4a) Multi-interval weighted momentum
  const windows = [
    { key: 'price_change_5m',  weight: 0.05 },
    { key: 'price_change_15m', weight: 0.10 },
    { key: 'price_change_1h',  weight: 0.15 },
    { key: 'price_change_6h',  weight: 0.25 },
    { key: 'price_change_24h', weight: 0.40 }
  ];
  let rawRoi = windows.reduce((sum, w) => {
    const val = pool[w.key] ?? 0;
    return sum + val * w.weight;
  }, 0);

  // 4b) Volume-weight: boost by log(volume24h)
  const vol24     = pool.volume_24h_usd || 0;
  const volFactor = Math.log10(1 + vol24);
  rawRoi *= (1 + volFactor / 10);

  // 4c) Liquidity adjustment: modest boost for deep pools
  const liqUsd    = pool.liquidity_usd || pool.liquidity?.usd || 0;
  const liqFactor = Math.log10(1 + liqUsd);
  rawRoi *= (0.75 + 0.25 * (liqFactor / 6));

  // 4d) Final formatted ROI
  const predictedRoi = rawRoi.toFixed(2) + '%';

  // 5) Warnings (unchanged)
  const warnings = [];
  if (coin.nsfw)                 warnings.push('Marked NSFW');
  if (coin.usd_market_cap < 1000)warnings.push('Low market cap (< $1k)');
  if (typeof pool.price_change_24h === 'number') {
    if (pool.price_change_24h < -50)  warnings.push('Down >50% in 24h');
    if (pool.price_change_24h > 1000) warnings.push('Up >1000% in 24h');
  }

  // 6) Return JSON
  return res.status(200).json({
    success:     true,
    buyScore,
    predictedRoi,
    warnings
  });
}

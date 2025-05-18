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
      .json({ success: false, error: `All Pump.fun APIs failed: ${lastErr}` });
  }

  // 2) Destructure Pump.fun pool fields
  const pool      = coin.pool || {};
  const buyCount  = pool.buy_count    ?? 0;
  const sellCount = pool.sell_count   ?? 0;
  const totalSol  = pool.total_sol_raised    ?? 0;
  const recentVel = pool.recent_buy_velocity ?? 0;
  const liqLocked = !!pool.liquidity_locked;
  const mintEn    = !!pool.mint_enabled;
  const deplBuy   = !!pool.deployer_buying;

  // 3) Fetch Solscan meta: age & supply & top holders
  let tokenAgeDays = null, totalSupply = null, topHolders = [];
  try {
    const meta = await fetch(
      `https://public-api.solscan.io/token/meta?tokenAddress=${address}`
    ).then(r => r.json());
    if (meta.createTime) {
      tokenAgeDays = (Date.now()/1000 - meta.createTime) / 86400;
    }
    if (meta.tokenAmount?.amount) {
      totalSupply =
        Number(meta.tokenAmount.amount) / (10 ** meta.tokenAmount.decimals);
    }
    const holderRes = await fetch(
      `https://public-api.solscan.io/token/holders?tokenAddress=${address}&offset=0&limit=50`
    ).then(r => r.json());
    topHolders = holderRes.data || [];
  } catch {
    // ignore
  }

  // 4) Bundling detection: top 5 >20% of supply
  let top5SumPct = 0;
  if (totalSupply && topHolders.length) {
    topHolders.slice(0,5).forEach(h => {
      const amt = Number(h.amount) / (10 ** h.decimals);
      top5SumPct += amt / totalSupply;
    });
  }
  const bundled = top5SumPct > 0.20;

  // 5) Compute advanced Predicted ROI
  const windows = [
    { key: 'price_change_5m',  w: 0.05 },
    { key: 'price_change_15m', w: 0.10 },
    { key: 'price_change_1h',  w: 0.15 },
    { key: 'price_change_6h',  w: 0.25 },
    { key: 'price_change_24h', w: 0.45 }
  ];
  let rawRoi = windows.reduce(
    (sum, {key,w}) => sum + ((pool[key] ?? 0) * w),
    0
  );
  const vol24     = pool.volume_24h_usd || 0;
  const volFactor = Math.log10(1 + vol24);
  rawRoi *= (1 + volFactor / 10);
  const liqUsd    = pool.liquidity_usd || pool.liquidity?.usd || 0;
  const liqFactor = Math.log10(1 + liqUsd);
  rawRoi *= (0.75 + 0.25 * (liqFactor / 6));
  // holder-growth boost
  if (topHolders.length > 1) {
    rawRoi *= 1 + (Math.log10(topHolders.length) / 10);
  }
  const predictedRoi = rawRoi.toFixed(2) + '%';

  // 6) Compute advanced Buy Score (WITHOUT age penalty)
  let buyScore = 100;
  if (!liqLocked)                 buyScore -= 30;
  if (mintEn)                     buyScore -= 25;
  if (!deplBuy)                   buyScore -= 15;
  if (buyCount + sellCount < 20)  buyScore -= 10;
  if (recentVel < 5)              buyScore -= 10;
  if (totalSol < 1)               buyScore -= 10;
  if (bundled)                    buyScore -= 20;  // bundled penalty only
  buyScore = Math.max(0, Math.min(100, Math.round(buyScore)));

  // 7) Format numbers with commas
  const marketCapRaw = coin.usd_market_cap  ?? 0;
  const marketCap    = marketCapRaw.toLocaleString();
  const holdersCount = totalSupply
    ? totalSupply.toLocaleString()
    : 'N/A';

  // 8) Build warnings (remove age warning)
  const warnings = [];
  if (coin.nsfw)                            warnings.push('Marked NSFW');
  if (marketCapRaw < 1000)                  warnings.push('Low market cap (<1 k USD)');
  if (!liqLocked)                           warnings.push('Liquidity unlocked');
  if (bundled)                              warnings.push('Possible bundling (top 5 > 20%)');
  if (holdersCount !== 'N/A' && holdersCount < 100) warnings.push('Very few holders');

  // 9) Return complete result
  return res.status(200).json({
    success:        true,
    marketCap,
    tokenAgeDays:   tokenAgeDays?.toFixed(1) ?? 'N/A',
    holders:        holdersCount,
    top5Pct:        (top5SumPct * 100).toFixed(2) + '%',
    buyScore:       buyScore.toString(),
    predictedRoi,
    warnings
  });
}

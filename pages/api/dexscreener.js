// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // 1) Fetch DexScreener pools
  let pools;
  try {
    const apiRes = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    );
    if (!apiRes.ok) throw new Error('Not found on DexScreener');
    const data = await apiRes.json();
    pools = Array.isArray(data) ? data : data.pairs || [];
    if (!pools.length) throw new Error('No trading pairs');
  } catch (err) {
    return res.status(404).json({ success: false, error: err.message });
  }

  // 2) Most liquid pool
  pools.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pools[0];

  // 3) Solscan: age, supply & top holders
  let tokenAgeDays = null, totalSupply = null, topHolders = [];
  try {
    const meta = await fetch(
      `https://public-api.solscan.io/token/meta?tokenAddress=${address}`
    ).then(r => r.json());
    if (meta.createTime) {
      tokenAgeDays = (Date.now() / 1000 - meta.createTime) / 86400;
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
    /* ignore failures */
  }

  // 4) Single‐wallet & bundling (top 5 >20%)
  let singlePct = 0, top5Sum = 0;
  if (totalSupply && topHolders.length) {
    const first = topHolders[0];
    const amt0 = Number(first.amount) / 10 ** first.decimals;
    singlePct = amt0 / totalSupply;
    topHolders.slice(0, 5).forEach(h => {
      const amt = Number(h.amount) / 10 ** h.decimals;
      top5Sum += amt / totalSupply;
    });
  }
  const bundled = top5Sum > 0.20;

  // 5) Market Cap (fdv or liquidity)
  const marketCap = p.fdv != null
    ? Number(p.fdv).toLocaleString()
    : (p.liquidity?.usd || 0).toLocaleString();

  // 6) Buy/Sell ratio
  const tx24 = p.txns?.h24 || { buys: 0, sells: 0 };
  const totalTx = tx24.buys + tx24.sells;
  const buySellRatio = totalTx > 0 ? tx24.buys / totalTx : 0.5;

  // 7) Multi-interval weighted Buy Score
  const windowsBS = [
    { key: 'm5',  weight: 0.05 },
    { key: 'm15', weight: 0.10 },
    { key: 'h1',  weight: 0.15 },
    { key: 'h6',  weight: 0.25 },
    { key: 'h24', weight: 0.45 }
  ];
  let scoreSum = 0;
  for (const w of windowsBS) {
    const tx = p.txns?.[w.key] || { buys: 0, sells: 0 };
    const tot = tx.buys + tx.sells;
    const ratio = tot > 0 ? tx.buys / tot : 0.5;
    scoreSum += ratio * w.weight * 100;
  }
  const vol24     = p.volume?.h24 || 0;
  const volFactor = Math.log10(1 + vol24);
  let buyScore    = scoreSum * (1 + volFactor / 10) * buySellRatio;

  // 8) Volatility penalty (std dev of % changes)
  const changeMap = p.priceChange || {};
  const changes = windowsBS.map(w => changeMap[w.key] ?? 0);
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, v) => a + (v - mean) ** 2, 0) / changes.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev > 10) buyScore -= 10;

  // 9) Moving-Average Crossover
  // approximation: short MA = m5, long MA = h1
  const shortMA = changeMap.m5  ?? 0;
  const longMA  = changeMap.h1 ?? 0;
  if (shortMA > longMA) buyScore += 5;    // golden cross bonus
  else if (shortMA < longMA) buyScore -= 5; // death cross penalty

  // 10) Single-wallet & bundling penalties
  if (singlePct > 0.04) buyScore -= 20;
  if (bundled)          buyScore -= 20;

  // 11) Top-holders bonus
  if (topHolders.length > 1) {
    buyScore += Math.min(10, Math.log10(topHolders.length) * 2);
  }

  // 12) Reddit mentions (social sentiment boost)
  let mentionBoost = 1;
  try {
    const now     = Math.floor(Date.now() / 1000);
    const since   = now - 86400;
    const reddit  = await fetch(
      `https://api.pushshift.io/reddit/comment/search?size=500&after=${since}&query=${address}`
    ).then(r => r.json());
    const mentions = reddit.data?.length || 0;
    // up to +10 points for >=200 mentions
    mentionBoost = 1 + Math.min(10, mentions / 20) / 100;
  } catch {
    /* ignore */
  }
  buyScore *= mentionBoost;

  buyScore = Math.round(Math.max(0, Math.min(100, buyScore)));

  // 13) Compute advanced Predicted ROI
  let rawRoi = windowsBS.reduce((sum, w) => sum + ((changeMap[w.key] ?? 0) * w.weight), 0);
  rawRoi *= (1 + volFactor / 10);
  const liqUsd  = p.liquidity?.usd || 0;
  const liqFact = Math.log10(1 + liqUsd);
  rawRoi *= (0.75 + 0.25 * (liqFact / 6));
  rawRoi *= buySellRatio;
  if (topHolders.length > 1) rawRoi *= 1 + (Math.log10(topHolders.length) / 10);
  if (shortMA > longMA)       rawRoi *= 1.05;  // ROI boost on golden cross
  else if (shortMA < longMA)  rawRoi *= 0.95;  // ROI penalty on death cross
  rawRoi *= mentionBoost;
  const predictedRoi = rawRoi.toFixed(2) + '%';

  // 14) Format holders & top5%
  const holdersCount = totalSupply
    ? totalSupply.toLocaleString()
    : 'N/A';
  const top5Pct = (top5Sum * 100).toFixed(2) + '%';

  // 15) Build warnings
  const warnings = [];
  if (p.labels?.includes('mintable'))   warnings.push('Mintable');
  if (p.labels?.includes('freezable'))  warnings.push('Freezable');
  if (p.labels?.includes('honeypot'))   warnings.push('Honeypot');
  if (liqUsd < 1000)                    warnings.push('Low liquidity (<$1k)');
  if (singlePct > 0.04)                 warnings.push('Single wallet >4%');
  if (bundled)                          warnings.push('Bundled (top5 >20%)');
  if (stdDev > 10)                      warnings.push('High volatility');
  if (shortMA > longMA)                 warnings.push('Golden cross');
  if (shortMA < longMA)                 warnings.push('Death cross');

  // 16) Return JSON
  return res.status(200).json({
    success:        true,
    marketCap,
    tokenAgeDays:   tokenAgeDays?.toFixed(1) ?? 'N/A',
    holders:        holdersCount,
    top5Pct,
    buyScore:       buyScore.toString(),
    predictedRoi,
    warnings
  });
}

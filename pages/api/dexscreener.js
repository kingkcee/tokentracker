// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // 1) Fetch DexScreener pools for this token
  let pools;
  try {
    const apiRes = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    );
    if (!apiRes.ok) throw new Error('Not found on DexScreener');
    const data = await apiRes.json();
    pools = Array.isArray(data) ? data : data.pairs || [];
    if (pools.length === 0) throw new Error('No trading pairs');
  } catch (err) {
    return res.status(404).json({ success: false, error: err.message });
  }

  // 2) Pick the most liquid pool
  pools.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pools[0];

  // 3) Solscan meta for age & supply & top holders
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
    // ignore failures
  }

  // 4) Bundling detection: top 5 >20% supply
  let top5Sum = 0;
  if (totalSupply && topHolders.length) {
    topHolders.slice(0,5).forEach(h => {
      const amt = Number(h.amount) / (10 ** h.decimals);
      top5Sum += amt / totalSupply;
    });
  }
  const bundled = top5Sum > 0.20;

  // 5) Market Cap (fdv or liquidity)
  const marketCap = p.fdv != null
    ? p.fdv.toLocaleString()
    : (p.liquidity?.usd || 0).toLocaleString();

  // 6) Buy/Sell ratio
  const txns24 = p.txns?.h24 || { buys: 0, sells: 0 };
  const totalTx = txns24.buys + txns24.sells;
  const buySellRatio = totalTx > 0 ? txns24.buys / totalTx : 0.5;

  // 7) Compute advanced buyScore
  const windowsBS = [
    { key: 'm5',  weight: 0.05 },
    { key: 'm15', weight: 0.10 },
    { key: 'h1',  weight: 0.15 },
    { key: 'h6',  weight: 0.25 },
    { key: 'h24', weight: 0.45 }
  ];
  let scoreSum = 0;
  for (const w of windowsBS) {
    const t = p.txns?.[w.key] || { buys: 0, sells: 0 };
    const tot = t.buys + t.sells;
    const ratio = tot > 0 ? t.buys / tot : 0.5;
    scoreSum += ratio * w.weight * 100;
  }
  const vol24    = p.volume?.h24 || 0;
  const volF     = Math.log10(1 + vol24);
  let buyScore   = scoreSum * (1 + volF/10) * buySellRatio;

  // penalties/bonuses
  if (tokenAgeDays !== null && tokenAgeDays < 1) buyScore *= 0.8;  // –20%
  if (bundled)                                  buyScore *= 0.8;  // –20%
  if (totalSupply && topHolders.length>1) {
    buyScore += Math.min(10, Math.log10(topHolders.length)*2);
  }
  buyScore = Math.round(Math.max(0, Math.min(100, buyScore)));

  // 8) Compute advanced predicted ROI
  const changeMap = p.priceChange || {};
  let rawRoi = windowsBS.reduce((s, w) => {
    const pct = changeMap[w.key] ?? 0;
    return s + pct * w.weight;
  }, 0);
  rawRoi *= (1 + volF/10);
  const liqUsd   = p.liquidity?.usd || 0;
  const liqFact  = Math.log10(1 + liqUsd);
  rawRoi *= (0.75 + 0.25 * (liqFact/6));
  rawRoi *= buySellRatio;
  // holder-growth boost
  if (topHolders.length>1) rawRoi *= 1 + (Math.log10(topHolders.length)/10);
  const predictedRoi = rawRoi.toFixed(2) + '%';

  // 9) Format holders & top5%
  const holdersCount = totalSupply
    ? totalSupply.toLocaleString()
    : 'N/A';
  const top5Pct = (top5Sum * 100).toFixed(2) + '%';

  // 10) Warnings
  const warnings = [];
  if (p.labels?.includes('mintable'))   warnings.push('Mintable');
  if (p.labels?.includes('freezable'))  warnings.push('Freezable');
  if (p.labels?.includes('honeypot'))   warnings.push('Honeypot');
  if (liqUsd < 1000)                    warnings.push('Low liquidity (<$1k)');
  if (bundled)                          warnings.push('Bundled (top 5 >20%)');
  if (tokenAgeDays !== null && tokenAgeDays < 1) warnings.push('Token <1 day old');

  // 11) Return JSON
  return res.status(200).json({
    success:       true,
    marketCap,
    tokenAgeDays:  tokenAgeDays?.toFixed(1) ?? 'N/A',
    holders:       holdersCount,
    top5Pct,
    buyScore:      buyScore.toString(),
    predictedRoi,
    warnings
  });
}

// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  try {
    // 1) Fetch all Solana pools for this token
    const apiRes = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    );
    if (!apiRes.ok) throw new Error('Not found on DexScreener');
    const data = await apiRes.json();
    const pools = Array.isArray(data) ? data : data.pairs || [];
    if (pools.length === 0) throw new Error('No trading pairs');

    // 2) Pick the most liquid pool
    pools.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const p = pools[0];

    // 3) Market Cap (fdv or fallback liquidity)
    const marketCap = p.fdv != null
      ? p.fdv.toString()
      : (p.liquidity?.usd || 0).toString();

    // 4) Compute Buy/Sell Ratio
    const txns  = p.txns?.h24 || { buys: 0, sells: 0 };
    const total = txns.buys + txns.sells;
    const buySellRatio = total > 0 ? txns.buys / total : 0.5;

    // 5) Compute Buy Score: multi-interval weighted + volume
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
    const vol24    = p.volume?.h24 || 0;
    const volFact  = Math.log10(1 + vol24);
    let buyScore   = Math.min(100, Math.round(scoreSum * (1 + volFact / 10) * buySellRatio));

    // 6) Compute Predicted ROI: multi-interval momentum, volume & liquidity
    const changeMap = p.priceChange || {};
    const windowsRoi = windowsBS; // reuse same weights
    let rawRoi = windowsRoi.reduce((sum, w) => {
      const pct = changeMap[w.key] ?? 0;
      return sum + pct * w.weight;
    }, 0);
    rawRoi *= (1 + volFact / 10);
    const liqUsd   = p.liquidity?.usd || 0;
    const liqFact  = Math.log10(1 + liqUsd);
    rawRoi *= (0.75 + 0.25 * (liqFact / 6));
    rawRoi *= buySellRatio;
    const predictedRoi = rawRoi.toFixed(2) + '%';

    // 7) Warnings
    const warnings = [];
    if (p.labels?.includes('mintable'))   warnings.push('Mintable');
    if (p.labels?.includes('freezable'))  warnings.push('Freezable');
    if (p.labels?.includes('honeypot'))   warnings.push('Possible honeypot');
    if (liqUsd < 1000)                    warnings.push('Low liquidity (<$1k)');
    if (typeof changeMap.h24 === 'number') {
      if (changeMap.h24 < -50)  warnings.push('Down >50% 24h');
      if (changeMap.h24 > 1000) warnings.push('Up >1000% 24h');
    }

    // 8) Return everything
    return res.status(200).json({
      success:      true,
      marketCap,
      buyScore:     buyScore.toString(),
      predictedRoi,
      warnings
    });
  } catch (err) {
    return res.status(404).json({ success: false, error: err.message });
  }
}

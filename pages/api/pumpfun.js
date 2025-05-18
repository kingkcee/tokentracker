// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // 1) Fetch from Pump.fun endpoints
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

  // 2) Destructure pool data
  const pool = coin.pool || {};

  // 3) Compute improved buyScore via DexScreener
  let buyScore = 'N/A';
  try {
    // fetch DexScreener data
    const dex = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    ).then(r => r.json());
    const arr = Array.isArray(dex) ? dex : dex.pairs || [];
    if (arr.length) {
      // pick the most liquid pair
      arr.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
      const p = arr[0];

      // weights for different intervals
      const windows = [
        { key: 'h1',  weight: 0.20 },
        { key: 'h6',  weight: 0.30 },
        { key: 'h24', weight: 0.50 }
      ];

      // compute base score (0–100)
      let scoreSum = 0;
      for (const w of windows) {
        const tx = p.txns?.[w.key] || { buys: 0, sells: 0 };
        const total = tx.buys + tx.sells;
        // if no data, assume neutral 50%
        const ratio = total > 0 ? tx.buys / total : 0.5;
        scoreSum += ratio * w.weight * 100;
      }

      // volume-weight: boost by log(volume24h)
      const vol24     = p.volume?.h24 || 0;
      const volFactor = Math.log10(1 + vol24);
      let weighted   = scoreSum * (1 + volFactor / 10);

      buyScore = Math.min(100, Math.round(weighted)).toString();
    }
  } catch {
    buyScore = 'N/A';
  }

  // 4) Compute ROI & marketCap (same as before, or add your logic)...

  // (for brevity, return only updated buyScore here)
  return res.status(200).json({
    success:   true,
    buyScore,
    // ...other fields: marketCap, predictedRoi, warnings
  });
}

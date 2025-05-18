// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ success:false, error:"Address is required." });
  }

  try {
    const apiRes = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    );
    if (!apiRes.ok) throw new Error("Not found on DexScreener");
    const data = await apiRes.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Token not found on DexScreener");
    }

    // 1) Pick highest-liquidity pool
    data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const pair = data[0];

    // 2) Market cap (fdv) or fallback liquidity
    const marketCap = pair.fdv != null
      ? pair.fdv.toString()
      : (pair.liquidity?.usd || 0).toString();

    // 3) Compute Buy Score
    let buyScore = "N/A";
    const tx24 = pair.txns?.h24;
    if (tx24 && tx24.buys + tx24.sells > 0) {
      buyScore = Math.round((tx24.buys / (tx24.buys + tx24.sells)) * 100).toString();
    }

    // 4) Improved ROI calculation:
    // 4a) Multi-interval weighted momentum
    const windows = [
      { key: 'm5',  weight: 0.05 },
      { key: 'm15', weight: 0.10 },
      { key: 'h1',  weight: 0.15 },
      { key: 'h6',  weight: 0.25 },
      { key: 'h24', weight: 0.40 }
    ];
    const mapKey = {
      m5:  pair.priceChange?.m5,
      m15: pair.priceChange?.m15,
      h1:  pair.priceChange?.h1,
      h6:  pair.priceChange?.h6,
      h24: pair.priceChange?.h24
    };
    let rawRoi = windows.reduce((sum, w) => {
      const val = mapKey[w.key] ?? 0;
      return sum + val * w.weight;
    }, 0);

    // 4b) Volume-weight
    const vol24     = pair.volume?.h24 || 0;
    const volFactor = Math.log10(1 + vol24);
    rawRoi *= (1 + volFactor / 10);

    // 4c) Liquidity adjust
    const liqUsd    = pair.liquidity?.usd || 0;
    const liqFactor = Math.log10(1 + liqUsd);
    rawRoi *= (0.75 + 0.25 * (liqFactor / 6));

    // 4d) Format
    const predictedRoi = rawRoi.toFixed(2) + '%';

    // 5) Warnings
    const warnings = [];
    if (pair.labels?.includes("mintable"))   warnings.push("Mint authority not renounced");
    if (pair.labels?.includes("freezable")) warnings.push("Freeze authority not renounced");
    if (pair.labels?.includes("honeypot"))  warnings.push("Possible honeypot");
    if ((pair.liquidity?.usd || 0) < 1000) warnings.push("Low liquidity (<$1k)");
    if (typeof pair.priceChange?.h24 === "number") {
      if (pair.priceChange.h24 < -50)  warnings.push("Down >50% in 24h");
      if (pair.priceChange.h24 > 1000) warnings.push("Up >1000% in 24h");
    }

    // 6) Return JSON
    return res.status(200).json({
      success:     true,
      marketCap,
      buyScore,
      predictedRoi,
      warnings
    });
  } catch (err) {
    return res.status(404).json({ success:false, error:err.message });
  }
}

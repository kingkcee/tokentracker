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
    const arr  = Array.isArray(data) ? data : (data.pairs||[]);
    if (!arr.length) throw new Error("No trading pairs");

    // pick most liquid pool
    arr.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
    const pair = arr[0];

    // 1) Multi-interval weighted buy score
    const windows = [
      { key: 'm5',  weight: 0.05 },
      { key: 'm15', weight: 0.10 },
      { key: 'h1',  weight: 0.15 },
      { key: 'h6',  weight: 0.25 },
      { key: 'h24', weight: 0.45 }  // gives 45% to 24h
    ];
    const mapKey = {
      m5:  pair.priceChange?.m5,
      m15: pair.priceChange?.m15,
      h1:  pair.priceChange?.h1,
      h6:  pair.priceChange?.h6,
      h24: pair.priceChange?.h24
    };
    let scoreSum = 0;
    for (const w of windows) {
      const tx = pair.txns?.[w.key] || { buys: 0, sells: 0 };
      const total = tx.buys + tx.sells;
      const ratio = total > 0 ? tx.buys / total : 0.5;
      scoreSum += ratio * w.weight * 100;
    }
    // volume-weight
    const vol24 = pair.volume?.h24 || 0;
    const volFactor = Math.log10(1 + vol24);
    let buyScore = Math.min(100, Math.round(scoreSum * (1 + volFactor/10)));

    // return buyScore (plus your existing marketCap, predictedRoi, warnings)
    return res.status(200).json({
      success:   true,
      buyScore:  buyScore.toString(),
      // ...other fields
    });
  } catch (err) {
    return res.status(404).json({ success:false, error:err.message });
  }
}

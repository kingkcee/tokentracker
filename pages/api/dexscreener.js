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
    const arr = Array.isArray(data) ? data : (data.pairs||[]);
    if (!arr.length) throw new Error("No pairs");

    // pick highest-liquidity pair
    arr.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
    const pair = arr[0];

    // use FDV (fully diluted valuation) if available, else fallback to pool liquidity
    const marketCap = pair.fdv != null
      ? pair.fdv.toString()
      : (pair.liquidity?.usd || 0).toString();

    // buyScore
    let buyScore = "N/A";
    const tx24 = pair.txns?.h24;
    if (tx24 && tx24.buys+tx24.sells>0) {
      buyScore = Math.round(tx24.buys/(tx24.buys+tx24.sells)*100).toString();
    }

    // predictedRoi: 24h priceChange
    let predictedRoi = "N/A";
    const change = pair.priceChange?.h24 ?? pair.priceChange?.h6 ?? pair.priceChange?.h1;
    if (typeof change === "number") predictedRoi = change.toFixed(2) + "%";

    // warnings
    const warnings = [];
    if ((pair.liquidity?.usd||0)<1000) warnings.push("Low liquidity (<$1k)");
    for (const lbl of pair.labels||[]) {
      if (lbl==="mintable")   warnings.push("Mint authority not renounced");
      if (lbl==="freezable")  warnings.push("Freeze authority not renounced");
      if (lbl==="honeypot")   warnings.push("Possible honeypot");
    }
    if (typeof pair.priceChange?.h24==="number") {
      if (pair.priceChange.h24<-50)  warnings.push("Down >50% in 24h");
      if (pair.priceChange.h24>1000) warnings.push("Up >1000% in 24h");
    }

    return res.status(200).json({
      success:     true,
      marketCap,           // <-- new
      buyScore,
      predictedRoi,
      warnings
    });
  } catch (err) {
    return res.status(404).json({ success:false, error:err.message });
  }
}

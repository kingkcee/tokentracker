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
    const pairs = Array.isArray(data) ? data : (data.pairs || []);
    if (pairs.length === 0) throw new Error("No pairs found");

    // pick highest-liquidity pair
    pairs.sort((a,b)=>(b.liquidity.usd||0) - (a.liquidity.usd||0));
    const pair = pairs[0];

    // identify which side is our token
    const tokenInfo = pair.baseToken.address === address
      ? pair.baseToken
      : pair.quoteToken;
    const name = tokenInfo.name || tokenInfo.symbol || address;
    const symbol = tokenInfo.symbol || "";

    // price USD
    let priceUsd = pair.priceUsd || pair.priceNative || 0;
    priceUsd = priceUsd.toString();

    // buy score
    let buyScore = "N/A";
    const tx = pair.txns?.h24 || {};
    if (tx.buys + tx.sells > 0) {
      buyScore = Math.round((tx.buys/(tx.buys + tx.sells))*100).toString();
    }

    // predicted ROI = 24h price change
    let predictedRoi = "N/A";
    const change = pair.priceChange?.h24 ?? pair.priceChange?.h6 ?? pair.priceChange?.h1;
    if (typeof change === "number") predictedRoi = change.toFixed(2) + "%";

    // warnings
    const warnings = [];
    if ((pair.liquidity.usd || 0) < 1000) warnings.push("Low liquidity (<$1k)");
    if (pair.labels?.includes("mintable"))   warnings.push("Mint authority not renounced");
    if (pair.labels?.includes("freezable")) warnings.push("Freeze authority not renounced");
    if (typeof pair.priceChange?.h24 === "number") {
      if (pair.priceChange.h24 < -50) warnings.push("Down >50% in 24h");
      if (pair.priceChange.h24 > 1000) warnings.push("Up >1000% in 24h");
    }

    res.status(200).json({
      success: true, name, symbol,
      priceUsd, buyScore, predictedRoi, warnings
    });
  } catch (err) {
    res.status(404).json({ success:false, error: err.message });
  }
}

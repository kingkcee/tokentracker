// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: "Address is required." });
  }

  try {
    // Fetch the single 'pair' object
    const apiRes = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${address}`
    );
    if (!apiRes.ok) throw new Error("Not found on DexScreener");
    const json = await apiRes.json();
    const pair = json.pair;
    if (!pair) throw new Error("Token not found on DexScreener");

    // Determine token side
    const tokenSide =
      pair.baseToken.address === address
        ? pair.baseToken
        : pair.quoteToken || pair.baseToken;

    const name = tokenSide.name || tokenSide.symbol || address;
    const symbol = tokenSide.symbol || "";

    // Price USD
    let priceUsd = "N/A";
    if (pair.priceUsd != null) {
      priceUsd = pair.priceUsd.toString();
    } else if (pair.priceNative != null && pair.quoteToken?.symbol === "USDC") {
      priceUsd = pair.priceNative.toString();
    }

    // Buy Score (24h buys vs sells)
    let buyScore = "N/A";
    const tx24 = pair.txns?.h24;
    if (tx24 && (tx24.buys + tx24.sells) > 0) {
      buyScore = Math.round((tx24.buys / (tx24.buys + tx24.sells)) * 100).toString();
    }

    // Predicted ROI (24h price change)
    let predictedRoi = "N/A";
    const change =
      pair.priceChange?.h24 ??
      pair.priceChange?.h6 ??
      pair.priceChange?.h1 ??
      pair.priceChange?.m5;
    if (typeof change === "number") {
      predictedRoi = change.toFixed(2) + "%";
    }

    // Warnings
    const warnings = [];
    const liqUsd = pair.liquidity?.usd || 0;
    if (liqUsd < 1000) warnings.push("Low liquidity (< $1k)");
    for (const label of pair.labels || []) {
      if (label === "mintable")   warnings.push("Mint authority not renounced");
      if (label === "freezable")  warnings.push("Freeze authority not renounced");
      if (label === "honeypot")   warnings.push("Possible honeypot");
    }
    if (typeof pair.priceChange?.h24 === "number") {
      if (pair.priceChange.h24 < -50)  warnings.push("Down >50% in 24h");
      if (pair.priceChange.h24 > 1000) warnings.push("Up >1000% in 24h");
    }

    return res.status(200).json({
      success: true,
      name,
      symbol,
      priceUsd,
      buyScore,
      predictedRoi,
      warnings
    });
  } catch (err) {
    return res
      .status(404)
      .json({ success: false, error: err.message });
  }
}

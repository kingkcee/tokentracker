// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ success: false, error: "Address is required." });
  }

  try {
    // Fetch trading pairs for this token on Solana
    const apiRes = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${address}`
    );
    if (!apiRes.ok) throw new Error("Not found on DexScreener");

    const json = await apiRes.json();
    // DexScreener returns an array directly under `json.pairs` or `json`
    const pairs = Array.isArray(json) ? json : (json.pairs || []);
    if (pairs.length === 0) throw new Error("No trading pairs found");

    // Pick the most liquid pair (highest USD liquidity)
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const pair = pairs[0];

    // Identify which token side matches the address
    const tokenSide =
      pair.baseToken?.address === address ? pair.baseToken : pair.quoteToken || pair.baseToken;

    const name = tokenSide.name || tokenSide.symbol || address;
    const symbol = tokenSide.symbol || "";

    // Price in USD
    let priceUsd = "N/A";
    if (pair.priceUsd != null) {
      priceUsd = pair.priceUsd.toString();
    } else if (pair.priceNative != null && pair.quoteToken?.symbol === "USDC") {
      priceUsd = pair.priceNative.toString();
    }

    // Buy Score: % of buys vs sells in last 24h
    let buyScore = "N/A";
    const tx24 = pair.txns?.h24;
    if (tx24 && (tx24.buys + tx24.sells) > 0) {
      buyScore = Math.round((tx24.buys / (tx24.buys + tx24.sells)) * 100).toString();
    }

    // Predicted ROI: 24h price change
    let predictedRoi = "N/A";
    const change =
      pair.priceChange?.h24 ??
      pair.priceChange?.h6 ??
      pair.priceChange?.h1 ??
      pair.priceChange?.m5;
    if (typeof change === "number") {
      predictedRoi = change.toFixed(2) + "%";
    }

    // Safety warnings
    const warnings = [];
    const liqUsd = pair.liquidity?.usd || 0;
    if (liqUsd < 1000) warnings.push("Low liquidity (<$1k)");
    if (Array.isArray(pair.labels)) {
      if (pair.labels.includes("mintable")) warnings.push("Mint authority not renounced");
      if (pair.labels.includes("freezable")) warnings.push("Freeze authority not renounced");
      if (pair.labels.includes("honeypot")) warnings.push("Possible honeypot");
    }
    if (typeof pair.priceChange?.h24 === "number") {
      if (pair.priceChange.h24 < -50) warnings.push("Down >50% in 24h");
      if (pair.priceChange.h24 > 1000) warnings.push("Up >1000% in 24h");
    }

    // Return JSON
    res.status(200).json({
      success: true,
      name,
      symbol,
      priceUsd,
      buyScore,
      predictedRoi,
      warnings,
    });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
}

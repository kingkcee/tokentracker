export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    res.status(400).json({ success:false, error:"Address is required." });
    return;
  }

  try {
    // 1) Fetch DexScreener data
    const apiRes = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`);
    if (!apiRes.ok) throw new Error("Not found on DexScreener");
    const data = await apiRes.json();
    const pairs = Array.isArray(data) ? data : (data.pairs||[]);
    if (!pairs.length) throw new Error("No trading pairs");

    // 2) Pick the most liquid pair
    pairs.sort((a,b)=>(b.liquidity.usd||0)-(a.liquidity.usd||0));
    const pair = pairs[0];

    // 3) Identify token info
    const tokenInfo = pair.baseToken.address===address ? pair.baseToken : pair.quoteToken;
    const name = tokenInfo.name || tokenInfo.symbol || address;
    const symbol = tokenInfo.symbol || '';

    // 4) Price USD
    let priceUsd = pair.priceUsd || pair.priceNative || 0;
    priceUsd = priceUsd.toString();

    // 5) Buy score
    let buyScore = 'N/A';
    if (pair.txns.h24) {
      const { buys=0, sells=0 } = pair.txns.h24;
      if (buys+sells) buyScore = Math.round((buys/(buys+sells))*100).toString();
    }

    // 6) Predicted ROI
    let predictedRoi = 'N/A';
    const change = (pair.priceChange.h24 ?? pair.priceChange.h6 ?? pair.priceChange.h1);
    if (typeof change === 'number') predictedRoi = change.toFixed(2)+'%';

    // 7) Warnings
    const warnings = [];
    pair.labels?.includes('mintable')   && warnings.push("Mint authority not renounced");
    pair.labels?.includes('freezable') && warnings.push("Freeze authority not renounced");
    pair.labels?.includes('honeypot')  && warnings.push("Possible honeypot");
    if ((pair.liquidity.usd||0) < 1000) warnings.push("Low liquidity (<$1k)");
    if (typeof pair.priceChange.h24==='number') {
      if (pair.priceChange.h24 < -50) warnings.push("Down >50% in 24h");
      if (pair.priceChange.h24 > 1000) warnings.push("Up >1000% in 24h");
    }

    res.status(200).json({
      success: true, name, symbol, priceUsd,
      buyScore, predictedRoi, warnings
    });
  } catch (err) {
    res.status(404).json({ success:false, error:"Token not found on DexScreener" });
  }
}

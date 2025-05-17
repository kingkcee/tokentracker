export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    res.status(400).json({ success:false, error:"Address is required." });
    return;
  }

  try {
    // 1) Fetch Pump.fun data
    const apiRes = await fetch(`https://frontend-api.pump.fun/coins/${address}`);
    if (!apiRes.ok) throw new Error("Not found on Pump.fun");
    const coin = await apiRes.json();

    // 2) Extract core info
    const name   = coin.name  || coin.symbol || address;
    const symbol = coin.symbol|| '';
    const pool   = coin.pool   || {};
    const price  = pool.price?.toString() || 'N/A';
    let   priceCurrency = 'SOL';
    if (pool.pool_name?.toUpperCase().includes('/ USDC')) priceCurrency = 'USDC';

    // 3) Compute buyScore (% of buys vs sells in last 24h via DexScreener)
    let buyScore = 'N/A';
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`);
      const dexJson = await dexRes.json();
      const pairs = Array.isArray(dexJson) ? dexJson : (dexJson.pairs||[]);
      if (pairs.length) {
        // pick highest-liquidity pair
        pairs.sort((a,b)=>(b.liquidity.usd||0)-(a.liquidity.usd||0));
        const tx = pairs[0].txns.h24 || {};
        const { buys=0, sells=0 } = tx;
        if (buys+sells) buyScore = Math.round((buys/(buys+sells))*100).toString();
      }
    } catch {}

    // 4) Predicted ROI from Pump.fun's 24h price change
    let predictedRoi = 'N/A';
    const change24 = pool.price_change_24h;
    if (typeof change24 === 'number') predictedRoi = change24.toFixed(2)+'%';

    // 5) Warnings
    const warnings = [];
    if (coin.nsfw) warnings.push("Marked NSFW");
    if (coin.usd_market_cap < 1000) warnings.push("Low market cap (<$1k)");
    if (typeof pool.price_change_24h === 'number') {
      if (pool.price_change_24h < -50) warnings.push("Down >50% in 24h");
      if (pool.price_change_24h > 1000) warnings.push("Up >1000% in 24h");
    }

    res.status(200).json({
      success: true, name, symbol, price, priceCurrency,
      buyScore, predictedRoi, warnings
    });
  } catch (err) {
    res.status(404).json({ success:false, error:"Token not found on Pump.fun" });
  }
}

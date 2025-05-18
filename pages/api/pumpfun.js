// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  try {
    // 1) Fetch token info from Pump.fun's public API
    const apiRes = await fetch(
      `https://frontend-api.pump.fun/coins/${address}`
    );
    if (!apiRes.ok) {
      throw new Error(`Pump.fun API returned ${apiRes.status}`);
    }
    const coin = await apiRes.json();

    // 2) Extract basic info
    const name   = coin.name  || coin.symbol || address;
    const symbol = coin.symbol || '';
    const pool   = coin.pool   || {};

    // 3) Price & currency
    const price = pool.price != null ? pool.price.toString() : 'N/A';
    let priceCurrency = 'SOL';
    if (pool.pool_name?.toUpperCase().includes('/ USDC')) {
      priceCurrency = 'USDC';
    }

    // 4) Buy Score via DexScreener (optional fallback)
    let buyScore = 'N/A';
    try {
      const dexRes = await fetch(
        `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
      );
      const dexJson = await dexRes.json();
      const pairs = Array.isArray(dexJson) ? dexJson : dexJson.pairs || [];
      if (pairs.length) {
        pairs.sort((a, b) => (b.liquidity.usd || 0) - (a.liquidity.usd || 0));
        const tx = pairs[0].txns.h24 || {};
        const { buys = 0, sells = 0 } = tx;
        if (buys + sells > 0) {
          buyScore = Math.round((buys / (buys + sells)) * 100).toString();
        }
      }
    } catch {
      // leave as N/A
    }

    // 5) Predicted ROI from 24h change
    let predictedRoi = 'N/A';
    if (pool.price_change_24h != null) {
      predictedRoi = pool.price_change_24h.toFixed(2) + '%';
    } else if (pool.price_change_6h != null) {
      predictedRoi = pool.price_change_6h.toFixed(2) + '%';
    }

    // 6) Safety warnings
    const warnings = [];
    if (coin.nsfw) warnings.push('Marked NSFW');
    if (coin.usd_market_cap < 1000) warnings.push('Low market cap (<$1k)');
    if (pool.price_change_24h != null) {
      if (pool.price_change_24h < -50)
        warnings.push('Price down >50% in 24h');
      if (pool.price_change_24h > 1000)
        warnings.push('Price up >1000% in 24h');
    }

    return res.status(200).json({
      success: true,
      name,
      symbol,
      price,
      priceCurrency,
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

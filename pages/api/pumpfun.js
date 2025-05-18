// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // Helper to fetch from your Railway scraper
  async function fetchScraper(addr) {
    const url = `https://solana-pumpfun-scraper-production.up.railway.app/api/scrape?address=${addr}`;
    const r = await fetch(url).then(r => r.json());
    if (!r.success) throw new Error(r.error || 'Scraper error');
    return r;
  }

  try {
    // 1) Try Pump.fun official API first
    const apiRes = await fetch(`https://frontend-api.pump.fun/coins/${address}`);
    if (apiRes.status === 503) {
      // Service unavailable → fallback
      throw new Error('Pump.fun API 503');
    }
    if (!apiRes.ok) {
      throw new Error(`Pump.fun API returned ${apiRes.status}`);
    }
    const coin = await apiRes.json();

    // 2) Extract info from official API
    const name   = coin.name  || coin.symbol || address;
    const symbol = coin.symbol || '';
    const pool   = coin.pool   || {};
    const price  = pool.price != null ? pool.price.toString() : 'N/A';
    let priceCurrency = 'SOL';
    if (pool.pool_name?.toUpperCase().includes('/ USDC')) {
      priceCurrency = 'USDC';
    }

    // 3) Compute buyScore via DexScreener fallback logic
    let buyScore = 'N/A';
    try {
      const dexRes = await fetch(
        `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
      );
      const dexJson = await dexRes.json();
      const arr = Array.isArray(dexJson) ? dexJson : dexJson.pairs || [];
      if (arr.length) {
        arr.sort((a, b) => (b.liquidity.usd || 0) - (a.liquidity.usd || 0));
        const tx = arr[0].txns.h24 || {};
        const { buys = 0, sells = 0 } = tx;
        if (buys + sells > 0) {
          buyScore = Math.round((buys / (buys + sells)) * 100).toString();
        }
      }
    } catch { /* ignore */ }

    // 4) Predicted ROI from 24h change
    let predictedRoi = 'N/A';
    if (pool.price_change_24h != null) {
      predictedRoi = pool.price_change_24h.toFixed(2) + '%';
    } else if (pool.price_change_6h != null) {
      predictedRoi = pool.price_change_6h.toFixed(2) + '%';
    }

    // 5) Warnings
    const warnings = [];
    if (coin.nsfw)                warnings.push('Marked NSFW');
    if (coin.usd_market_cap < 1000) warnings.push('Low market cap (<$1k)');
    if (pool.price_change_24h != null) {
      if (pool.price_change_24h < -50)  warnings.push('Down >50% in 24h');
      if (pool.price_change_24h > 1000) warnings.push('Up >1000% in 24h');
    }

    return res.status(200).json({
      success: true,
      name, symbol, price, priceCurrency,
      buyScore, predictedRoi, warnings
    });

  } catch (err) {
    // If official API failed with 503 or other error, fallback to scraper
    if (err.message.includes('503') || err.message.includes('Scraper error') === false) {
      try {
        const data = await fetchScraper(address);
        // Destructure scraped data
        const {
          totalSolRaised = 0,
          buyCount = 0,
          recentBuyVelocity = 0,
          liquidityLocked = false,
          mintEnabled = false,
          deployerBuying = false
        } = data;

        let buyScore = 100;
        if (!liquidityLocked)      buyScore -= 30;
        if (mintEnabled)           buyScore -= 25;
        if (!deployerBuying)       buyScore -= 15;
        if (buyCount < 10)         buyScore -= 10;
        if (recentBuyVelocity < 5) buyScore -= 10;
        if (totalSolRaised < 1)    buyScore -= 10;
        buyScore = Math.max(0, buyScore);

        const predictedRoi = (recentBuyVelocity * totalSolRaised * 0.75).toFixed(1) + '%';
        const warnings = [];
        if (!liquidityLocked)      warnings.push('Liquidity not locked');
        if (mintEnabled)           warnings.push('Mint still enabled');
        if (!deployerBuying)       warnings.push('Deployer not buying');

        return res.status(200).json({
          success: true,
          buyScore,
          predictedRoi,
          warnings,
          details: data
        });
      } catch (fall) {
        // Both failed
        return res
          .status(500)
          .json({ success: false, error: 'Both Pump.fun API and scraper failed.' });
      }
    }
    // Other errors (not 503) simply return the error
    return res
      .status(500)
      .json({ success: false, error: err.message });
  }
}

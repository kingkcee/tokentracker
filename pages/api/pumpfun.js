// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  // Multi-endpoint fallback for the official Pump.fun API
  const endpoints = [
    'https://frontend-api-v3.pump.fun/coins/',
    'https://frontend-api-v2.pump.fun/coins/',
    'https://frontend-api.pump.fun/coins/'
  ];

  let coin = null, lastError = null;
  for (const base of endpoints) {
    try {
      const r = await fetch(`${base}${address}`);
      if (!r.ok) {
        lastError = `Status ${r.status} from ${base}`;
        continue;
      }
      coin = await r.json();
      break;
    } catch (e) {
      lastError = e.message;
    }
  }
  if (!coin) {
    return res
      .status(502)
      .json({ success: false, error: `All Pump.fun APIs failed: ${lastError}` });
  }

  const name   = coin.name  || coin.symbol || address;
  const symbol = coin.symbol || '';
  const pool   = coin.pool   || {};

  // 1) Try to pull price & 24h change from Pump.fun pool
  let price         = pool.price != null ? pool.price.toString() : null;
  let priceCurrency = pool.pool_name?.toUpperCase().includes('/ USDC') ? 'USDC' : 'SOL';
  let predictedRoi  = null;
  if (pool.price_change_24h != null) {
    predictedRoi = pool.price_change_24h.toFixed(2) + '%';
  } else if (pool.price_change_6h != null) {
    predictedRoi = pool.price_change_6h.toFixed(2) + '%';
  }

  // 2) Fallback to DexScreener if either price or ROI is missing
  if (price === null || predictedRoi === null) {
    try {
      const dexRes = await fetch(
        `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
      );
      const dexJson = await dexRes.json();
      const arr = Array.isArray(dexJson) ? dexJson : dexJson.pairs || [];
      if (arr.length) {
        // pick highest-liquidity pool
        arr.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        const p = arr[0];

        // fallback price
        if (price === null) {
          if (p.priceUsd != null) {
            price = p.priceUsd.toString();
            priceCurrency = 'USD';
          } else if (p.priceNative != null) {
            price = p.priceNative.toString();
            priceCurrency = p.quoteToken?.symbol || 'SOL';
          }
        }

        // fallback ROI
        if (predictedRoi === null) {
          const change =
            p.priceChange?.h24 ?? p.priceChange?.h6 ?? p.priceChange?.h1;
          if (typeof change === 'number') {
            predictedRoi = change.toFixed(2) + '%';
          }
        }
      }
    } catch {
      // swallow any errors — we'll default to N/A below
    }
  }

  // default to N/A if still missing
  price        = price        || 'N/A';
  priceCurrency= priceCurrency|| 'SOL';
  predictedRoi = predictedRoi || 'N/A';

  // 3) Compute Buy Score (using DexScreener 24h txns as proxy)
  let buyScore = 'N/A';
  try {
    const dex2 = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/solana/${address}`
    ).then(r => r.json());
    const list = Array.isArray(dex2) ? dex2 : dex2.pairs || [];
    if (list.length) {
      list.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const tx = list[0].txns?.h24 || {};
      const { buys = 0, sells = 0 } = tx;
      if (buys + sells > 0) {
        buyScore = Math.round((buys / (buys + sells)) * 100).toString();
      }
    }
  } catch {
    buyScore = 'N/A';
  }

  // 4) Safety warnings from Pump.fun data
  const warnings = [];
  if (coin.nsfw)                warnings.push('Marked NSFW');
  if (coin.usd_market_cap < 1000) warnings.push('Low market cap (<$1k)');
  if (pool.price_change_24h != null) {
    if (pool.price_change_24h < -50)  warnings.push('Down >50% in 24h');
    if (pool.price_change_24h > 1000) warnings.push('Up >1000% in 24h');
  }

  return res.status(200).json({
    success:      true,
    name,
    symbol,
    price,
    priceCurrency,
    buyScore,
    predictedRoi,
    warnings
  });
}

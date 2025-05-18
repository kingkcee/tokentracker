// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success:false, error:'Token address is required.' });
  }

  // 1) Fetch Pump.fun data (v3→v2→v1)
  const endpoints = [
    'https://frontend-api-v3.pump.fun/coins/',
    'https://frontend-api-v2.pump.fun/coins/',
    'https://frontend-api.pump.fun/coins/'
  ];
  let coin = null, lastErr = '';
  for (const url of endpoints) {
    try {
      const r = await fetch(url + address);
      if (!r.ok) { lastErr = `Status ${r.status}`; continue; }
      coin = await r.json();
      break;
    } catch (e) {
      lastErr = e.message;
    }
  }
  if (!coin) {
    return res
      .status(502)
      .json({ success:false, error:`All Pump.fun APIs failed: ${lastErr}` });
  }

  // 2) Destructure Pump.fun pool fields
  const pool      = coin.pool || {};
  const buyCount  = pool.buy_count    ?? 0;
  const sellCount = pool.sell_count   ?? 0;
  const totalSol  = pool.total_sol_raised    ?? 0;
  const recentVel = pool.recent_buy_velocity ?? 0;
  const liqLocked = !!pool.liquidity_locked;
  const mintEn    = !!pool.mint_enabled;
  const deplBuy   = !!pool.deployer_buying;

  // 3) Fetch Solscan meta for age, supply & top holders
  let tokenAgeDays = null, totalSupply = null, topHolders = [];
  try {
    const meta = await fetch(
      `https://public-api.solscan.io/token/meta?tokenAddress=${address}`
    ).then(r=>r.json());
    if (meta.createTime) {
      tokenAgeDays = (Date.now()/1000 - meta.createTime) / 86400;
    }
    if (meta.tokenAmount?.amount) {
      totalSupply = Number(meta.tokenAmount.amount) / (10**meta.tokenAmount.decimals);
    }
    const holderRes = await fetch(
      `https://public-api.solscan.io/token/holders?tokenAddress=${address}&offset=0&limit=50`
    ).then(r=>r.json());
    topHolders = holderRes.data || [];
  } catch {
    /* ignore */
  }

  // 4) Single-wallet & bundling detection (top5 >20%)
  let singlePct = 0, top5Sum = 0;
  if (totalSupply && topHolders.length) {
    const first = topHolders[0];
    const amt0 = Number(first.amount)/(10**first.decimals);
    singlePct = amt0/totalSupply;
    topHolders.slice(0,5).forEach(h=>{
      const amt = Number(h.amount)/(10**h.decimals);
      top5Sum += amt/totalSupply;
    });
  }
  const bundled = top5Sum > 0.20;

  // 5) Market Cap formatting
  const marketCapRaw = coin.usd_market_cap ?? 0;
  const marketCap = Number(marketCapRaw).toLocaleString();

  // 6) Buy/Sell ratio
  const tx24 = pool.txns?.h24 || { buys:0, sells:0 };
  const totalTx = tx24.buys + tx24.sells;
  const buySellRatio = totalTx>0 ? tx24.buys/totalTx : 0.5;

  // 7) Compute advanced Buy Score
  const windowsBS = [
    { key:'price_change_5m',  w:0.05 },
    { key:'price_change_15m', w:0.10 },
    { key:'price_change_1h',  w:0.15 },
    { key:'price_change_6h',  w:0.25 },
    { key:'price_change_24h', w:0.45 }
  ];
  let scoreSum = 0;
  for (const {key,w} of windowsBS) {
    const tx = pool.txns?.h24 && key.startsWith('price_change') 
      ? {} 
      : pool.txns?.[key.replace('price_change_','')] || { buys:0, sells:0 };
    const buys  = tx.buys || 0;
    const sells = tx.sells || 0;
    const ratio = (buys+sells)>0 ? buys/(buys+sells) : 0.5;
    scoreSum += ratio * w * 100;
  }
  const vol24 = pool.volume_24h_usd || 0;
  const volF  = Math.log10(1+vol24);
  let buyScore = scoreSum * (1+volF/10) * buySellRatio;

  // 8) Volatility penalty (std dev of price changes)
  const changeMap = pool;
  const changes = windowsBS.map(w=> changeMap[w.key] ?? 0);
  const mean = changes.reduce((a,b)=>a+b,0)/changes.length;
  const stdDev = Math.sqrt(
    changes.reduce((a,v)=>a+(v-mean)**2,0)/changes.length
  );
  if (stdDev>10) buyScore -= 10;

  // 9) Moving-Average Crossover (5 m vs 1 h)
  const shortMA = pool.price_change_5m  ?? 0;
  const longMA  = pool.price_change_1h  ?? 0;
  if (shortMA>longMA) buyScore += 5;
  else if (shortMA<longMA) buyScore -= 5;

  // 10) Single-wallet & bundling penalties
  if (singlePct>0.04) buyScore -= 20;
  if (bundled)        buyScore -= 20;

  // 11) Holder-growth bonus
  if (topHolders.length>1) {
    buyScore += Math.min(10, Math.log10(topHolders.length)*2);
  }

  // 12) Reddit mentions boost via Pushshift
  let mentionBoost = 1;
  try {
    const since   = Math.floor(Date.now()/1000) - 86400;
    const reddit  = await fetch(
      `https://api.pushshift.io/reddit/comment/search?size=500&after=${since}&query=${address}`
    ).then(r=>r.json());
    const mentions= reddit.data?.length || 0;
    mentionBoost = 1 + Math.min(10, mentions/20)/100;
  } catch { /* ignore */ }
  buyScore *= mentionBoost;

  buyScore = Math.round(Math.max(0,Math.min(100,buyScore)));

  // 13) Compute advanced Predicted ROI
  let rawRoi = windowsBS.reduce((s,{key,w})=> s + ((changeMap[key]||0)*w),0);
  rawRoi *= (1+volF/10);
  const liqUsd = pool.liquidity_usd || pool.liquidity?.usd || 0;
  rawRoi *= (0.75 + 0.25*(Math.log10(1+liqUsd)/6));
  rawRoi *= buySellRatio;
  if (shortMA>longMA) rawRoi*=1.05;
  else if (shortMA<longMA) rawRoi*=0.95;
  rawRoi *= mentionBoost;
  const predictedRoi = rawRoi.toFixed(2) + '%';

  // 14) Format holders & top5%
  const holdersCount = totalSupply
    ? totalSupply.toLocaleString()
    : 'N/A';
  const top5Pct = (top5Sum*100).toFixed(2) + '%';

  // 15) Build warnings
  const warnings = [];
  if (coin.nsfw)                            warnings.push('Marked NSFW');
  if (marketCapRaw<1000)                    warnings.push('Low market cap (<1 k USD)');
  if (!liqLocked)                           warnings.push('Liquidity unlocked');
  if (singlePct>0.04)                       warnings.push('Single wallet >4%');
  if (bundled)                              warnings.push('Bundled (top5 >20%)');
  if (stdDev>10)                            warnings.push('High volatility');
  if (shortMA>longMA)                       warnings.push('Golden cross');
  if (shortMA<longMA)                       warnings.push('Death cross');

  return res.status(200).json({
    success:        true,
    marketCap,
    tokenAgeDays:   tokenAgeDays?.toFixed(1) ?? 'N/A',
    holders:        holdersCount,
    top5Pct,
    buyScore:       buyScore.toString(),
    predictedRoi,
    warnings
  });
}

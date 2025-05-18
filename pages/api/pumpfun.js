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
      const r = await fetch(`${url}${address}`);
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

  // 2) Destructure pool fields
  const pool      = coin.pool || {};
  const buyCount  = pool.buy_count    ?? 0;
  const sellCount = pool.sell_count   ?? 0;
  const totalSol  = pool.total_sol_raised    ?? 0;
  const recentVel = pool.recent_buy_velocity ?? 0;
  const liqLocked = !!pool.liquidity_locked;
  const mintEn    = !!pool.mint_enabled;
  const deplBuy   = !!pool.deployer_buying;

  // 3) Fetch Solscan meta: age, supply, holders
  let tokenAgeDays = null, totalSupply = null, topHolders = [];
  try {
    const meta = await fetch(
      `https://public-api.solscan.io/token/meta?tokenAddress=${address}`
    ).then(r => r.json());
    if (meta.createTime) {
      tokenAgeDays = (Date.now()/1000 - meta.createTime)/86400;
    }
    if (meta.tokenAmount?.amount) {
      totalSupply = Number(meta.tokenAmount.amount)/(10**meta.tokenAmount.decimals);
    }
    const holderRes = await fetch(
      `https://public-api.solscan.io/token/holders?tokenAddress=${address}&offset=0&limit=50`
    ).then(r => r.json());
    topHolders = holderRes.data || [];
  } catch {}

  // 4) Single-wallet & bundling detection
  let singlePct = 0, top5Sum = 0;
  if (totalSupply && topHolders.length) {
    const first = topHolders[0];
    const amt0  = Number(first.amount)/(10**first.decimals);
    singlePct   = amt0/totalSupply;
    topHolders.slice(0,5).forEach(h => {
      const amt = Number(h.amount)/(10**h.decimals);
      top5Sum   += amt/totalSupply;
    });
  }
  const bundled = top5Sum > 0.20;

  // 5) Market cap format
  const marketCapRaw = coin.usd_market_cap ?? 0;
  const marketCap    = Number(marketCapRaw).toLocaleString();

  // 6) Buy/sell ratio
  const tx24       = pool.txns?.h24 || { buys:0, sells:0 };
  const totalTx24  = tx24.buys + tx24.sells;
  const buySellRatio = totalTx24>0 ? tx24.buys/totalTx24 : 0.5;

  // 7) Compute advanced Buy Score
  const windowsBS = [
    { key:'price_change_5m',  w:0.05 },
    { key:'price_change_15m', w:0.10 },
    { key:'price_change_1h',  w:0.15 },
    { key:'price_change_6h',  w:0.25 },
    { key:'price_change_24h', w:0.45 }
  ];
  let scoreSum = 0;
  windowsBS.forEach(({key,w}) => {
    const change = pool[key] ?? 0;
    // approximate buy/sell ratio for timeframe
    const tx = pool.txns?.[key.replace('price_change_','')] || { buys:0, sells:0 };
    const tot = tx.buys + tx.sells;
    const ratio = tot>0 ? tx.buys/tot : 0.5;
    scoreSum += ratio * w * 100;
  });
  const vol24  = pool.volume_24h_usd || 0;
  const volF   = Math.log10(1 + vol24);
  let buyScore = scoreSum * (1 + volF/10) * buySellRatio;

  // 8) Volatility penalty (std dev)
  const changes = windowsBS.map(w=> pool[w.key] ?? 0);
  const mean    = changes.reduce((a,b)=>a+b,0)/changes.length;
  const stdDev  = Math.sqrt(changes.reduce((a,v)=>a+(v-mean)**2,0)/changes.length);
  if (stdDev > 10) buyScore -= 10;

  // 9) MA crossover (5m vs 1h)
  const shortMA = pool.price_change_5m ?? 0;
  const longMA  = pool.price_change_1h ?? 0;
  if (shortMA > longMA) buyScore += 5;
  else if (shortMA < longMA) buyScore -= 5;

  // 10) Bundling & concentration penalties
  if (singlePct > 0.04) buyScore -= 20;
  if (bundled)          buyScore -= 20;

  // 11) Holder-growth bonus
  if (topHolders.length > 1) {
    buyScore += Math.min(10, Math.log10(topHolders.length)*2);
  }

  // 12) Twitter shill detection (human-only)
  const BEARER = process.env.TWITTER_BEARER_TOKEN;
  let tweetCount24h = 0, shillCount24h = 0, shillScore = '0%';
  if (BEARER) {
    try {
      const now  = Math.floor(Date.now()/1000);
      const since = now - 86400;
      const q     = `"${address}" lang:en -is:retweet`;
      const url   = `https://api.twitter.com/2/tweets/search/recent`
                  + `?query=${encodeURIComponent(q)}&max_results=100`
                  + `&tweet.fields=text,created_at`
                  + `&expansions=author_id`
                  + `&user.fields=username,created_at,public_metrics`;
      const r     = await fetch(url,{headers:{Authorization:`Bearer ${BEARER}`}});
      const j     = await r.json();
      const tweets= j.data || [];
      const users = (j.includes?.users||[]).reduce((m,u)=>{m[u.id]=u; return m;},{});

      const human = tweets.filter(t=>{
        const u = users[t.author_id];
        if(!u) return false;
        const ageDays = (now - Math.floor(new Date(u.created_at).getTime()/1000))/86400;
        if(ageDays<7) return false;
        if((u.public_metrics?.followers_count||0)<20) return false;
        if(/bot/i.test(u.username)) return false;
        return true;
      });
      tweetCount24h = human.length;
      shillCount24h = human.filter(t=>/🚀|💎|moon|gem/i.test(t.text)).length;
      if(tweetCount24h>0) shillScore = Math.round(shillCount24h/tweetCount24h*100)+'%';
    }catch{}
  }
  const shillPct = parseInt(shillScore) || 0;
  if (shillPct < 20) buyScore = Math.min(100,buyScore+5);
  else if (shillPct > 50) buyScore = Math.max(0,buyScore-10);

  // 13) Apply Twitter ROI tweak
  let rawRoi = windowsBS.reduce((s,{key,w})=>s+(pool[key]??0)*w,0);
  rawRoi *= (1+volF/10);
  const liqUsd = pool.liquidity_usd||pool.liquidity?.usd||0;
  rawRoi *= (0.75+0.25*(Math.log10(1+liqUsd)/6));
  rawRoi *= buySellRatio;
  if (shortMA>longMA) rawRoi*=1.05;
  else if(shortMA<longMA) rawRoi*=0.95;
  rawRoi *= (1 + Math.min(10, tweetCount24h/20)/100);
  const predictedRoi = rawRoi.toFixed(2)+'%';

  buyScore = Math.round(Math.max(0,Math.min(100,buyScore)));

  // 14) Format holders & top5%
  const holdersCount = totalSupply? totalSupply.toLocaleString():'N/A';
  const top5Pct      = (top5Sum*100).toFixed(2)+'%';

  // 15) Build warnings
  const warnings = [];
  if(coin.nsfw)                        warnings.push('Marked NSFW');
  if(marketCapRaw<1000)                warnings.push('Low market cap (<1k USD)');
  if(!liqLocked)                       warnings.push('Liquidity unlocked');
  if(singlePct>0.04)                   warnings.push('Single wallet >4%');
  if(bundled)                          warnings.push('Bundled (top5 >20%)');
  if(stdDev>10)                        warnings.push('High volatility');
  if(shortMA>longMA)                   warnings.push('Golden cross');
  if(shortMA<longMA)                   warnings.push('Death cross');

  // 16) Final response
  return res.status(200).json({
    success:        true,
    marketCap,
    tokenAgeDays:   tokenAgeDays?.toFixed(1) ?? 'N/A',
    holders:        holdersCount,
    top5Pct,
    buyScore:       buyScore.toString(),
    predictedRoi,
    warnings,
    tweetCount24h,
    shillCount24h,
    shillScore
  });
}

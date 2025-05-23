// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success:false, error:'Token address is required.' });
  }

  // 1) Fetch Pump.fun data
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

  // 2) Basic fields
  const name       = coin.name || 'Unknown';
  const symbol     = coin.symbol || '';
  const pool       = coin.pool || {};
  const buyCount   = pool.buy_count    ?? 0;
  const sellCount  = pool.sell_count   ?? 0;
  const totalSol   = pool.total_sol_raised    ?? 0;
  const recentVel  = pool.recent_buy_velocity ?? 0;
  const liqLocked  = !!pool.liquidity_locked;
  const mintEn     = !!pool.mint_enabled;
  const deplBuy    = !!pool.deployer_buying;

  // 3) Solscan meta
  let tokenAgeDays=null, totalSupply=null, topHolders=[];
  try {
    const meta = await fetch(
      `https://public-api.solscan.io/token/meta?tokenAddress=${address}`
    ).then(r=>r.json());
    if(meta.createTime){
      tokenAgeDays=(Date.now()/1000-meta.createTime)/86400;
    }
    if(meta.tokenAmount?.amount){
      totalSupply=Number(meta.tokenAmount.amount)/(10**meta.tokenAmount.decimals);
    }
    const holderRes=await fetch(
      `https://public-api.solscan.io/token/holders?tokenAddress=${address}&offset=0&limit=50`
    ).then(r=>r.json());
    topHolders=holderRes.data||[];
  }catch{}

  // 4) Concentration & bundling
  let singlePct=0, top5Sum=0;
  if(totalSupply && topHolders.length){
    const f=topHolders[0];
    const amt0=Number(f.amount)/(10**f.decimals);
    singlePct=amt0/totalSupply;
    topHolders.slice(0,5).forEach(h=>{
      const amt=Number(h.amount)/(10**h.decimals);
      top5Sum+=amt/totalSupply;
    });
  }
  const bundled=top5Sum>0.20;

  // 5) Market cap & ratio
  const marketCapRaw=coin.usd_market_cap??0;
  const marketCap=Number(marketCapRaw).toLocaleString();
  const tx24=pool.txns?.h24||{buys:0,sells:0};
  const tot24=tx24.buys+tx24.sells;
  const bsRatio=tot24>0?tx24.buys/tot24:0.5;

  // 6) Compute Buy Score
  const windowsBS=[
    {key:'price_change_5m', w:0.05},
    {key:'price_change_15m',w:0.10},
    {key:'price_change_1h', w:0.15},
    {key:'price_change_6h', w:0.25},
    {key:'price_change_24h',w:0.45}
  ];
  let scoreSum=0;
  windowsBS.forEach(({key,w})=>{
    const pct=pool[key]??0;
    // approximate ratio per window
    const tx=pool.txns?.[key.replace('price_change_','')]||{buys:0,sells:0};
    const t=tx.buys+tx.sells, r=t>0?tx.buys/t:0.5;
    scoreSum+=r*w*100;
  });
  const vol24=pool.volume_24h_usd||0, volF=Math.log10(1+vol24);
  let buyScore=scoreSum*(1+volF/10)*bsRatio;

  // volatility
  const changes=windowsBS.map(w=>pool[w.key]||0);
  const mean=changes.reduce((a,b)=>a+b,0)/changes.length;
  const stdDev=Math.sqrt(changes.reduce((a,v)=>a+(v-mean)**2,0)/changes.length);
  if(stdDev>10) buyScore-=10;

  // MA cross
  const shortMA=pool.price_change_5m||0, longMA=pool.price_change_1h||0;
  if(shortMA>longMA) buyScore+=5; else if(shortMA<longMA) buyScore-=5;

  // penalties & bonus
  if(singlePct>0.04) buyScore-=20;
  if(bundled)        buyScore-=20;
  if(topHolders.length>1) buyScore+=Math.min(10,Math.log10(topHolders.length)*2);

  // Reddit hype
  let redditCount=0, mentionBoost=1;
  try{
    const since=Math.floor(Date.now()/1000)-86400;
    const rd=await fetch(
      `https://api.pushshift.io/reddit/comment/search?size=500&after=${since}&query=${address}`
    ).then(r=>r.json());
    redditCount=rd.data?.length||0;
    mentionBoost=1+Math.min(10,redditCount/20)/100;
  }catch{}
  buyScore*=mentionBoost;

  buyScore=Math.round(Math.max(0,Math.min(100,buyScore)));

  // Predicted ROI
  let rawRoi=windowsBS.reduce((s,{key,w})=>s+((pool[key]||0)*w),0);
  rawRoi*=(1+volF/10);
  const liqUsd=pool.liquidity_usd||pool.liquidity?.usd||0;
  rawRoi*=(0.75+0.25*(Math.log10(1+liqUsd)/6));
  rawRoi*=bsRatio;
  if(shortMA>longMA) rawRoi*=1.05; else if(shortMA<longMA) rawRoi*=0.95;
  rawRoi*=mentionBoost;
  const predictedRoi=rawRoi.toFixed(2)+'%';

  // warnings
  const warnings=[];
  if(coin.nsfw) warnings.push('Marked NSFW');
  if(marketCapRaw<1000) warnings.push('Low market cap (<$1k)');
  if(!liqLocked) warnings.push('Liquidity unlocked');
  if(singlePct>0.04) warnings.push('Single wallet >4%');
  if(bundled) warnings.push('Bundled (top5 >20%)');
  if(stdDev>10) warnings.push('High volatility');
  if(shortMA>longMA) warnings.push('Golden cross');
  if(shortMA<longMA) warnings.push('Death cross');

  // final
  return res.status(200).json({
    success:       true,
    name,
    symbol,
    marketCap,
    tokenAgeDays:  tokenAgeDays?.toFixed(1)??'N/A',
    holders:       totalSupply?totalSupply.toLocaleString():'N/A',
    top5Pct:       (top5Sum*100).toFixed(2)+'%',
    buyScore:      buyScore.toString(),
    predictedRoi,
    warnings,
    redditCount
  });
}

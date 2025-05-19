// pages/api/dexscreener.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ success:false, error:'Token address is required.' });
  }

  // 1) Fetch pools
  let pools;
  try {
    const r = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`);
    if (!r.ok) throw new Error('Not found on DexScreener');
    const j = await r.json();
    pools = Array.isArray(j) ? j : j.pairs || [];
    if (!pools.length) throw new Error('No trading pairs');
  } catch (err) {
    return res.status(404).json({ success:false, error:err.message });
  }

  // 2) Pick most liquid
  pools.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
  const p = pools[0];

  // 3) Extract name & symbol
  const name   = p.baseToken?.name   || p.pair?.baseToken?.name   || 'Unknown';
  const symbol = p.baseToken?.symbol || p.pair?.baseToken?.symbol || '';

  // 4) Solscan meta
  let tokenAgeDays=null, totalSupply=null, topHolders=[];
  try{
    const m=await fetch(
      `https://public-api.solscan.io/token/meta?tokenAddress=${address}`
    ).then(r=>r.json());
    if(m.createTime) tokenAgeDays=(Date.now()/1000-m.createTime)/86400;
    if(m.tokenAmount?.amount) totalSupply=Number(m.tokenAmount.amount)/(10**m.tokenAmount.decimals);
    topHolders=(await fetch(
      `https://public-api.solscan.io/token/holders?tokenAddress=${address}&offset=0&limit=50`
    ).then(r=>r.json())).data||[];
  }catch{}

  // 5) Concentration & bundling
  let singlePct=0, top5Sum=0;
  if(totalSupply && topHolders.length){
    const f=topHolders[0];
    singlePct=Number(f.amount)/(10**f.decimals)/totalSupply;
    topHolders.slice(0,5).forEach(h=>top5Sum+=Number(h.amount)/(10**h.decimals)/totalSupply);
  }
  const bundled=top5Sum>0.20;

  // 6) Market cap
  const marketCap= p.fdv!=null
    ? Number(p.fdv).toLocaleString()
    : (p.liquidity?.usd||0).toLocaleString();

  // 7) Buy/sell ratio
  const tx24=p.txns?.h24||{buys:0,sells:0}, tot=tx24.buys+tx24.sells;
  const bsRatio=tot>0?tx24.buys/tot:0.5;

  // 8) Compute Buy Score
  const windowsBS=[{key:'m5',w:0.05},{key:'m15',w:0.10},{key:'h1',w:0.15},{key:'h6',w:0.25},{key:'h24',w:0.45}];
  let scoreSum=0;
  windowsBS.forEach(({key,w})=>{
    const tx=p.txns?.[key]||{buys:0,sells:0},t=tx.buys+tx.sells,r=t>0?tx.buys/t:0.5;
    scoreSum+=r*w*100;
  });
  const vol24=p.volume?.h24||0, volF=Math.log10(1+vol24);
  let buyScore=scoreSum*(1+volF/10)*bsRatio;

  // volatility
  const changes=windowsBS.map(w=>p.priceChange?.[w.key]||0);
  const mean=changes.reduce((a,b)=>a+b,0)/changes.length;
  const stdDev=Math.sqrt(changes.reduce((a,v)=>a+(v-mean)**2,0)/changes.length);
  if(stdDev>10) buyScore-=10;

  // MA
  const shortMA=p.priceChange?.m5||0,longMA=p.priceChange?.h1||0;
  if(shortMA>longMA) buyScore+=5; else if(shortMA<longMA) buyScore-=5;

  // bundling & single
  if(singlePct>0.04) buyScore-=20;
  if(bundled)        buyScore-=20;

  // holder bonus
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
  let rawRoi=windowsBS.reduce((s,{key,w})=>s+((p.priceChange?.[key]||0)*w),0);
  rawRoi*=(1+volF/10);
  const liqUsd=p.liquidity?.usd||0;
  rawRoi*=(0.75+0.25*(Math.log10(1+liqUsd)/6));
  rawRoi*=bsRatio;
  if(shortMA>longMA) rawRoi*=1.05; else if(shortMA<longMA) rawRoi*=0.95;
  if(topHolders.length>1) rawRoi*=(1+Math.log10(topHolders.length)/10);
  rawRoi*=mentionBoost;
  const predictedRoi=rawRoi.toFixed(2)+'%';

  // warnings
  const warnings=[];
  if(p.labels?.includes('mintable')) warnings.push('Mintable');
  if(p.labels?.includes('freezable')) warnings.push('Freezable');
  if(p.labels?.includes('honeypot'))  warnings.push('Honeypot');
  if(liqUsd<1000)                    warnings.push('Low liquidity (<$1k)');
  if(singlePct>0.04)                 warnings.push('Single wallet >4%');
  if(bundled)                        warnings.push('Bundled (top5 >20%)');
  if(stdDev>10)                      warnings.push('High volatility');
  if(shortMA>longMA)                 warnings.push('Golden cross');
  if(shortMA<longMA)                 warnings.push('Death cross');

  // final
  return res.status(200).json({
    success:      true,
    name,
    symbol,
    marketCap,
    tokenAgeDays: tokenAgeDays?.toFixed(1)??'N/A',
    holders:      totalSupply?totalSupply.toLocaleString():'N/A',
    top5Pct:      (top5Sum*100).toFixed(2)+'%',
    buyScore:     buyScore.toString(),
    predictedRoi,
    warnings,
    redditCount
  });
}

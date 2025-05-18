// pages/api/pumpfun.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res
      .status(400)
      .json({ success: false, error: 'Token address is required.' });
  }

  try {
    // 1) Fetch scraped data from your Railway scraper
    const apiUrl = `https://solana-pumpfun-scraper-production.up.railway.app/api/scrape?address=${address}`;
    const scraperRes = await fetch(apiUrl);
    const data = await scraperRes.json();

    if (!data.success) {
      throw new Error(data.error || 'Scraper returned an error');
    }

    // 2) Destructure the scraped fields
    const {
      totalSolRaised = 0,
      buyCount = 0,
      recentBuyVelocity = 0,
      liquidityLocked = false,
      mintEnabled = false,
      deployerBuying = false
    } = data;

    // 3) Compute a simple Buy Score (0–100)
    let buyScore = 100;
    if (!liquidityLocked)      buyScore -= 30;
    if (mintEnabled)           buyScore -= 25;
    if (!deployerBuying)       buyScore -= 15;
    if (buyCount < 10)         buyScore -= 10;
    if (recentBuyVelocity < 5) buyScore -= 10;
    if (totalSolRaised < 1)    buyScore -= 10;
    buyScore = Math.max(0, buyScore);

    // 4) Compute Predicted ROI (%) with a heuristic
    const predictedRoiVal = (recentBuyVelocity * totalSolRaised * 0.75);
    const predictedRoi = predictedRoiVal.toFixed(1) + '%';

    // 5) Build warnings array
    const warnings = [];
    if (!liquidityLocked)      warnings.push('Liquidity not locked');
    if (mintEnabled)           warnings.push('Mint still enabled');
    if (!deployerBuying)       warnings.push('Deployer not buying');

    // 6) Return the result
    return res.status(200).json({
      success: true,
      buyScore,
      predictedRoi,
      warnings,
      details: data
    });

  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: err.message });
  }
}

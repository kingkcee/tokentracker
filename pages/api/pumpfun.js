// pages/api/pumpfun.js
export default async function handler(req, res) {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ success:false, error:"Address is required." });
  }
  // Temporary placeholder implementation
  res.status(200).json({
    success: true,
    name:    "DemoToken",
    symbol:  "DEMO",
    price:   "0.0010",
    priceCurrency: "SOL",
    buyScore:      "50",       // 0–100
    predictedRoi:  "10.0%",    // always 10%
    warnings:      []          // no warnings
  });
}

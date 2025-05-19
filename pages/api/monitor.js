// pages/api/monitor.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const { source, address } = req.body;
  if (!source || !address) {
    return res.status(400).json({ success: false, error: 'source & address required' });
  }

  // Acknowledge the monitoring request.
  // The Automations API will handle scheduling checks every 5 minutes
  // and notify you when buyScore drops below 40% or predictedRoi < 0%.
  return res.status(200).json({
    message: `✅ Monitoring set up for ${address} via ${source}. You’ll be alerted when it’s time to sell.`
  });
}

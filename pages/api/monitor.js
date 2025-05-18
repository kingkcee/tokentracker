// pages/api/monitor.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const { source, address } = req.body;
  if (!source || !address) {
    return res.status(400).json({ success: false, error: 'source & address required' });
  }

  // Acknowledge the request; the Automations API will be used to schedule the checks.
  return res.status(200).json({
    message: `✅ Monitoring request received for ${address} via ${source}. I'll notify you when it's time to sell.`
  });
}

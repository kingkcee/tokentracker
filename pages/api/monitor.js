// pages/api/monitor.js
import { automations } from '@assistant/automations'; // pseudo-import

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success:false, error:'POST only' });
  }
  const { source, address } = req.body;
  if (!source || !address) {
    return res.status(400).json({ success:false, error:'source & address required' });
  }

  // 1) Title & Prompt for the recurring task
  const title  = `Monitor ${source} token ${address}`;
  const prompt = `Check ${source} token ${address} and notify me if buyScore < 40% or predictedRoi < 0%.`;

  // 2) Schedule every 5 minutes
  const schedule = `
BEGIN:VEVENT
RRULE:FREQ=MINUTELY;INTERVAL=5
END:VEVENT
`;

  // 3) Create the automation
  try {
    await automations.create({ title, prompt, schedule });
    return res
      .status(200)
      .json({ message:`✅ Monitoring set up for ${address} (every 5 min).` });
  } catch (err) {
    return res
      .status(500)
      .json({ success:false, error: err.message });
  }
}

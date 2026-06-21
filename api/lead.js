export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, email, source = 'crisis_pdf' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
  const ZOHO_CRM_ACCOUNT = process.env.ZOHO_CRM_CONNECTED_ACCOUNT;
  const PDF_URL = process.env.CRISIS_PDF_URL || 'https://hotcoffeewithdon.com/crisis-guide.pdf';

  try {
    // 1. Create lead in Zoho CRM via Composio
    if (COMPOSIO_API_KEY) {
      await fetch('https://backend.composio.dev/api/v1/actions/ZOHOCRM_CREATE_LEAD/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': COMPOSIO_API_KEY },
        body: JSON.stringify({
          connectedAccountId: ZOHO_CRM_ACCOUNT,
          input: {
            Last_Name: name || email.split('@')[0],
            Email: email,
            Lead_Source: 'Web Site',
            Description: `Crisis PDF download. Source: ${source}`,
            Tag: ['Crisis PDF Download']
          }
        })
      });

      // 2. Send PDF via Zoho Mail
      await fetch('https://backend.composio.dev/api/v1/actions/ZOHOMAIL_SEND_EMAIL/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': COMPOSIO_API_KEY },
        body: JSON.stringify({
          connectedAccountId: ZOHO_CRM_ACCOUNT,
          input: {
            toAddress: email,
            fromAddress: 'don@hotcoffeewithdon.com',
            subject: `Here's your guide, ${name || 'friend'} ☕`,
            content: `Hey ${name || 'there'},\n\nThanks for grabbing the guide. Here it is:\n\n${PDF_URL}\n\nIt's a short read — 5 minutes max. I wrote it at 2am when I needed it myself, so it's pretty honest.\n\nIf any of it resonates, feel free to book a free 10-minute call. No agenda, just a conversation.\n\nhttps://hotcoffeewithdon.com/#book\n\nTake care,\nDon\n\n---\nHot Coffee With Don\ndon@hotcoffeewithdon.com\nUnsubscribe: reply with "unsubscribe"`
          }
        })
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Lead error:', err);
    // Still return success to user — don't block on backend errors
    return res.status(200).json({ success: true });
  }
}

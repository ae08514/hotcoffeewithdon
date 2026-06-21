import { randomUUID } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, amount, planId, isSub, sourceId, note } = req.body;
  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const SQUARE_LOC   = process.env.SQUARE_LOCATION_ID;
  const COMPOSIO_KEY = process.env.COMPOSIO_API_KEY;
  const ZOHO_ACCT    = process.env.ZOHO_CRM_CONNECTED_ACCOUNT;

  try {
    let squareResult;

    if (isSub) {
      // Create subscription
      const planMap = {
        sub_coffee:   process.env.SQUARE_PLAN_COFFEE,
        plan_weekly:  process.env.SQUARE_PLAN_WEEKLY,
        plan_brew:    process.env.SQUARE_PLAN_BREW,
        plan_fullpot: process.env.SQUARE_PLAN_FULLPOT,
      };
      const planVariationId = planMap[planId] || planMap.sub_coffee;

      // First create/find customer
      const custRes = await fetch('https://connect.squareup.com/v2/customers/search', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SQUARE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { filter: { email_address: { exact: email } } } })
      });
      const custData = await custRes.json();
      let customerId;
      if (custData.customers?.length) {
        customerId = custData.customers[0].id;
      } else {
        const newCust = await fetch('https://connect.squareup.com/v2/customers', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SQUARE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ given_name: name.split(' ')[0], family_name: name.split(' ').slice(1).join(' ') || '', email_address: email, idempotency_key: randomUUID() })
        });
        const nc = await newCust.json();
        customerId = nc.customer.id;
      }

      // Add card to customer
      const cardRes = await fetch('https://connect.squareup.com/v2/cards', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SQUARE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: randomUUID(), source_id: sourceId, card: { customer_id: customerId } })
      });
      const cardData = await cardRes.json();

      // Create subscription
      const subRes = await fetch('https://connect.squareup.com/v2/subscriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SQUARE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: randomUUID(),
          location_id: SQUARE_LOC,
          plan_variation_id: planVariationId,
          customer_id: customerId,
          card_id: cardData.card?.id,
          start_date: new Date().toISOString().split('T')[0]
        })
      });
      squareResult = await subRes.json();
    } else {
      // One-time payment
      const payRes = await fetch('https://connect.squareup.com/v2/payments', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SQUARE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: randomUUID(),
          source_id: sourceId,
          amount_money: { amount: amount, currency: 'USD' },
          location_id: SQUARE_LOC,
          buyer_email_address: email,
          note: `${note} — ${name}`
        })
      });
      squareResult = await payRes.json();
    }

    if (squareResult.errors) {
      console.error('Square error:', squareResult.errors);
      return res.status(400).json({ error: squareResult.errors[0]?.detail || 'Payment failed' });
    }

    // Log to Zoho CRM
    if (COMPOSIO_KEY) {
      const tag = isSub ? `subscriber_${planId}` : planId;
      const isLegacy = planId?.startsWith('legacy_');
      const isTip    = planId === 'tip_jar';

      await fetch('https://backend.composio.dev/api/v1/actions/ZOHOCRM_CREATE_LEAD/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': COMPOSIO_KEY },
        body: JSON.stringify({
          connectedAccountId: ZOHO_ACCT,
          input: {
            Last_Name: name,
            Email: email,
            Lead_Source: 'Web Site',
            Annual_Revenue: amount / 100,
            Description: `${note} | $${amount/100} | ${isSub ? 'subscription' : 'one-time'} | planId: ${planId}`,
            Tag: [isLegacy ? 'Legacy Donor' : isTip ? 'Coffee Tip' : isSub ? 'Subscriber' : 'Session Purchase', tag]
          }
        })
      }).catch(console.error);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Charge error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

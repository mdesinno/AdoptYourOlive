// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GSHEET_ID;

// Auth Google
async function getSheets() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

// Upsert semplice in Archivio contatti (per email)
async function upsertContact(sheets, email, name, lang, role) {
  if (!email) return;
  const range = 'Archivio contatti!A:Z';
  const get = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = get.data.values || [];
  const header = rows[0] || [];
  const idx = {
    Email: header.indexOf('Email'),
    Nome: header.indexOf('Nome completo'),
    Lingua: header.indexOf('Lingua'),
    DataPrimo: header.indexOf('Data primo contatto'),
    DataUltimo: header.indexOf('Data ultimo ordine'),
    RuoloUltimo: header.indexOf('Ruolo ultimo ordine')
  };

  const now = new Date().toISOString();
  let foundRow = -1;
  for (let r = 1; r < rows.length; r++) {
    if ((rows[r][idx.Email] || '').toLowerCase() === email.toLowerCase()) { foundRow = r; break; }
  }
  if (foundRow === -1) {
    const newRow = [];
    newRow[idx.Email] = email;
    if (idx.Nome > -1) newRow[idx.Nome] = name || '';
    if (idx.Lingua > -1) newRow[idx.Lingua] = lang || '';
    if (idx.DataPrimo > -1) newRow[idx.DataPrimo] = now;
    if (idx.DataUltimo > -1) newRow[idx.DataUltimo] = now;
    if (idx.RuoloUltimo > -1) newRow[idx.RuoloUltimo] = role || '';
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [newRow] }
    });
  } else {
    const row = rows[foundRow];
    if (idx.Nome > -1) row[idx.Nome] = name || row[idx.Nome] || '';
    if (idx.Lingua > -1) row[idx.Lingua] = lang || row[idx.Lingua] || '';
    if (idx.DataUltimo > -1) row[idx.DataUltimo] = now;
    if (idx.RuoloUltimo > -1) row[idx.RuoloUltimo] = role || row[idx.RuoloUltimo] || '';
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Archivio contatti!A${foundRow+1}:Z${foundRow+1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  }
}

// Aggiunge riga in Storico ordini
async function appendOrder(sheets, order) {
  const range = 'Storico ordini!A:Z';
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[
      order.id, order.created, order.buyerEmail, order.buyerName,
      order.adopterEmail, order.adopterName,
      order.isGift ? 'Sì' : 'No',
      order.treeType, order.customMessage || '',
      order.shipAddress1 || '', order.shipAddress2 || '', order.shipCity || '',
      order.shipPostal || '', order.shipCountry || '',
      order.note || '',
      order.discountCode || '',
      (order.amountPaidCents/100).toFixed(2).replace('.', ','),
      order.lang || ''
    ]] }
  });
}

function pickShipping(o) {
  // Cerca spedizione sia su Session che su PaymentIntent
  const s = (o.shipping_details || o.shipping || {});
  const addr = s.address || {};
  return {
    name: s.name || '',
    line1: addr.line1 || '',
    line2: addr.line2 || '',
    city: addr.city || '',
    postal: addr.postal_code || '',
    country: addr.country || ''
  };
}

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    const type = stripeEvent.type;
    let session = null;
    let pi = null;

    if (type.startsWith('checkout.session')) {
      // per sicurezza, ricarico la sessione con expand
      session = await stripe.checkout.sessions.retrieve(
        stripeEvent.data.object.id,
        { expand: ['payment_intent', 'customer'] }
      );
      pi = session.payment_intent;
    } else if (type === 'payment_intent.succeeded') {
      pi = stripeEvent.data.object;
      // prova a risalire alla session se serve
      try {
        const list = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
        session = list.data?.[0] || null;
      } catch (_) {}
    } else {
      return { statusCode: 200, body: 'Ignored' };
    }

    // Metadati (dal PaymentIntent, che sono quelli “visibili” su pagamento)
    const md = (pi && pi.metadata) || {};
    const sessMd = (session && session.metadata) || {};
    const treeType = md.tree_type || (session && session.custom_fields?.tree_type) || '';

    // Email acquirente e adottante
    const buyerEmail = session?.customer_details?.email || pi?.receipt_email || '';
    const isGift = (md.is_gift === 'yes');
    const adopterEmail = isGift ? (md.recipient_email || '') : buyerEmail;

    // Nome (se disponibile)
    const buyerName = session?.customer_details?.name || '';
    const adopterName = md.certificate_name || '';

    // Spedizione (unifico)
    const ship = pickShipping(session || pi);

    const order = {
      id: session?.id || pi?.id,
      created: new Date(((session?.created || pi?.created) || Math.floor(Date.now()/1000)) * 1000).toISOString(),
      lang: md.language || 'it',
      treeType: md.tree_type || '',
      amountPaidCents: Number(md.final_amount || pi?.amount_received || pi?.amount || 0),
      discountCode: md.discount_code || '',
      isGift,
      buyerEmail, buyerName,
      adopterEmail, adopterName,
      customMessage: md.certificate_message || '',
      shipAddress1: ship.line1,
      shipAddress2: ship.line2,
      shipCity: ship.city,
      shipPostal: ship.postal,
      shipCountry: ship.country,
      note: md.order_note || ''
    };

    const sheets = await getSheets();
    await appendOrder(sheets, order);

    // Upsert acquirente
    await upsertContact(sheets, buyerEmail, buyerName, order.lang, isGift ? 'Acquirente Regalo' : 'Acquirente Personale');
    // Upsert adottante (se regalo)
    if (isGift && adopterEmail) {
      await upsertContact(sheets, adopterEmail, adopterName, order.lang, 'Adottante Regalo');
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('WEBHOOK ERROR', e);
    return { statusCode: 500, body: 'server error' };
  }
};

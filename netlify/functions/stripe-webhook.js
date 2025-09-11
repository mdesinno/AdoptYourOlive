// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

const GSHEET_ID = process.env.GSHEET_ID;

/* ---------- Stripe raw body helper (per verifica firma) ---------- */
function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

/* ---------- Google Sheets ---------- */
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

async function ensureHeaderIfMissing(sheetName, header) {
  const sheets = await getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: GSHEET_ID,
    range: `${sheetName}!A1:Z1`
  }).catch(() => ({ data: {} }));

  const firstRow = (resp.data && resp.data.values && resp.data.values[0]) || [];
  if (firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] }
    });
  }
}

async function appendRow(sheetName, values) {
  const sheets = await getSheets();
  return sheets.spreadsheets.values.append({
    spreadsheetId: GSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

/* ---------- Brevo: upsert contatto (aggiunge solo a Clienti) ---------- */
async function brevoUpsertClientAddOnly({ email, name, language }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY mancante');

  const listClienti = parseInt(process.env.BREVO_LIST_CLIENTI || '0', 10);

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      email,
      attributes: {
        NOME: name || '',
        LINGUA: (language || 'it').toUpperCase()
      },
      listIds: listClienti ? [listClienti] : [],
      updateEnabled: true
    })
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Brevo upsert ERR ${res.status}: ${t}`);
  }
}

/* ---------- Brevo: email conferma ordine al cliente (via TEMPLATE) ---------- */
async function brevoSendOrderEmailViaTemplate({ toEmail, toName, amountEUR, orderId }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'Adopt Your Olive';
  const templateId = parseInt(process.env.BREVO_TMPL_ORDER_CONFIRM_ID || '0', 10);

  if (!apiKey || !senderEmail) throw new Error('BREVO_API_KEY o BREVO_SENDER_EMAIL mancanti');
  if (!templateId) throw new Error('BREVO_TMPL_ORDER_CONFIRM_ID mancante o non valido');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: toEmail, name: toName || '' }],
      templateId,
      params: {
        NAME: toName || '',
        ORDER_ID: orderId,
        TOTAL_EUR: (amountEUR || 0).toFixed(2)
      }
    })
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Brevo email (template) ERR ${res.status}: ${t}`);
  }
}

/* ---------- Brevo: notifica interna a info@ (senza template) ---------- */
async function brevoNotifyInternal({ subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.INFO_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'Adopt Your Olive';
  const infoEmail = process.env.INFO_EMAIL;

  if (!apiKey || !senderEmail || !infoEmail) {
    console.warn('Notifica interna non inviata: manca BREVO_API_KEY/INFO_EMAIL/BREVO_SENDER_EMAIL');
    return;
  }

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: infoEmail }],
    subject,
    htmlContent: html
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn(`Brevo notify internal ERR ${res.status}: ${t}`);
  }
}

/* ---------- util ---------- */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  // 1) Verifica firma Stripe
  let stripeEvent;
  try {
    const sig = event.headers['stripe-signature'];
    const raw = getRawBody(event);
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature verify FAILED:', err.message);
    return { statusCode: 400, body: 'bad signature' };
  }

  try {
    if (stripeEvent.type !== 'checkout.session.completed') {
      return { statusCode: 200, body: 'ignored' };
    }

    const session = stripeEvent.data.object;

    // 2) Dettagli completi sessione
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['payment_intent', 'customer']
    });
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });

    // 3) Estrazioni dati utili
    const buyerEmail = fullSession.customer_details?.email || fullSession.customer_email || '';
    const buyerName  = fullSession.customer_details?.name || '';
    const amountEUR  = (fullSession.amount_total || 0) / 100;
    const currency   = fullSession.currency?.toUpperCase() || 'EUR';
    const meta       = fullSession.metadata || {};
    const lang       = (meta.language || 'it').toLowerCase();

    const addr = fullSession.customer_details?.address || {};
    const line1 = addr.line1 || '';
    const line2 = addr.line2 || '';
    const city  = addr.city || '';
    const cap   = addr.postal_code || '';
    const country = addr.country || '';

    const firstItem   = (lineItems.data && lineItems.data[0]) || {};
    const productDesc = firstItem.description || meta.product_name || '';
    const unitType    = meta.treeType || '';
    const discountCode = meta.discountCode || '';

    const ORDERS_SHEET = 'Storico ordini';
    const header = [
      'ID ordine','Data ordine','Email acquirente','Nome acquirente',
      'Email adottante','Nome adottante','Regalo?','Tipo adozione',
      'Messaggio personalizzato','Indirizzo spedizione 1','Indirizzo spedizione 2',
      'Città spedizione','CAP spedizione','Nazione spedizione','Note sull\'ordine',
      'Codice sconto usato','Importo pagato','Lingua'
    ];
    await ensureHeaderIfMissing(ORDERS_SHEET, header);

    const nowISO = new Date().toISOString();
    const isGift = meta.isGift === 'true' || meta.isGift === true;
    const adopterEmail = isGift ? (meta.recipientEmail || '') : buyerEmail;
    const adopterName  = isGift ? (meta.certificateName || '') : buyerName;
    const userNote     = meta.orderNote || '';

    // 4) Scrivi riga su Storico ordini
    await appendRow(ORDERS_SHEET, [
      fullSession.id,
      nowISO,
      buyerEmail,
      buyerName,
      adopterEmail,
      adopterName,
      isGift ? 'Sì' : 'No',
      unitType || productDesc,
      meta.certificateMessage || '',
      line1, line2, city, cap, country,
      userNote,
      discountCode,
      currency === 'EUR' ? amountEUR : `${amountEUR} ${currency}`,
      lang
    ]);

    // 5) Brevo: upsert cliente in lista Clienti
    if (buyerEmail) {
      await brevoUpsertClientAddOnly({ email: buyerEmail, name: buyerName, language: lang });
    }

    // 6) Email conferma al cliente (se hai impostato il template ID)
    if (buyerEmail && process.env.BREVO_TMPL_ORDER_CONFIRM_ID) {
      await brevoSendOrderEmailViaTemplate({
        toEmail: buyerEmail,
        toName: buyerName,
        amountEUR,
        orderId: fullSession.id
      });
    }

    // 7) **NUOVO**: notifica interna a info@
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${GSHEET_ID}/edit`;
    const html = `
      <p><strong>Nuovo ordine completato</strong></p>
      <p><strong>Order ID:</strong> ${escapeHtml(fullSession.id)}</p>
      <p><strong>Buyer:</strong> ${escapeHtml(buyerName)} &lt;${escapeHtml(buyerEmail)}&gt;</p>
      <p><strong>Adopter:</strong> ${escapeHtml(adopterName)} &lt;${escapeHtml(adopterEmail || '')}&gt;</p>
      <p><strong>Importo:</strong> ${escapeHtml((amountEUR || 0).toFixed(2))} ${escapeHtml(currency)}</p>
      <p><strong>Prodotto:</strong> ${escapeHtml(unitType || productDesc)}</p>
      <p><strong>Spedizione:</strong> ${escapeHtml(line1)} ${escapeHtml(line2)} — ${escapeHtml(city)} ${escapeHtml(cap)} (${escapeHtml(country)})</p>
      <p>Sheet: <a href="${sheetUrl}" target="_blank" rel="noopener">Apri Storico ordini</a></p>
    `;
    try {
      await brevoNotifyInternal({
        subject: 'AYO • Nuovo ordine completato',
        html
      });
    } catch (e) {
      console.warn('Notifica interna fallita:', e?.message || e);
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('WEBHOOK ERROR', e);
    return { statusCode: 500, body: 'server error' };
  }
};

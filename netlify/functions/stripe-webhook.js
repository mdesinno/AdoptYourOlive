'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');

const SHEET_ID = process.env.GSHEET_ID;

// ---------- Raw body helper (Stripe signature) ----------
function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

// ---------- Google Sheets helpers ----------
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
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1:Z1`
  }).catch(() => ({ data: {} }));
  const firstRow = (resp.data && resp.data.values && resp.data.values[0]) || [];
  if (firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] }
    });
  }
}

async function readAll(sheetName) {
  const sheets = await getSheets();
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`
  });
  return r.data.values || [];
}

async function appendRow(sheetName, values) {
  const sheets = await getSheets();
  return sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

async function updateRow(sheetName, rowIndex1, arr) {
  const sheets = await getSheets();
  const endCol = String.fromCharCode(64 + arr.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowIndex1}:${endCol}${rowIndex1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [arr] }
  });
}

// ---------- Brevo helpers ----------
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

async function brevoSendInfoNotification({ orderId, buyerEmail, buyerName, amountEUR }) {
  const apiKey = process.env.BREVO_API_KEY;
  const to = process.env.INFO_EMAIL;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || to;
  const senderName = process.env.BREVO_SENDER_NAME || 'Adopt Your Olive';
  if (!apiKey || !to) return;

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to }],
      subject: `AYO • New order ${orderId}`,
      htmlContent: `
        <p><strong>Order:</strong> ${orderId}</p>
        <p><strong>Buyer:</strong> ${buyerName || ''} &lt;${buyerEmail || ''}&gt;</p>
        <p><strong>Total:</strong> € ${(amountEUR || 0).toFixed(2)}</p>
        <p>Sheet: <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit" target="_blank" rel="noopener">open Google Sheet</a></p>
      `
    })
  }).catch(() => {});
}

// ---------- Archivio contatti: upsert dinamico ----------
async function upsertArchivioContatti({ email, name, language, role, addr }) {
  const sheet = 'Archivio contatti';
  const rows = await readAll(sheet);
  const wantedHeader = [
    'Email','Nome completo','Lingua','Data primo contatto','Data ultimo ordine','Ruolo ultimo ordine',
    'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
    'Stato adozione personale','Data scadenza adozione personale',
    'Ultimo indirizzo spedizione conosciuto 1','Ultimo indirizzo spedizione conosciuto 2',
    'Ultima città spedizione conosciuta','Ultimo CAP spedizione conosciuto','Ultima nazione spedizione conosciuta'
  ];

  if (rows.length === 0) {
    await ensureHeaderIfMissing(sheet, wantedHeader);
    rows.push(wantedHeader);
  }
  const header = rows[0];

  // mappa colonne per nome (case-insensitive, usa includes)
  const idx = (label) => header.findIndex(h => (h || '').toLowerCase().includes(label));
  const cEmail = idx('email');
  const cNome  = idx('nome completo');
  const cLang  = idx('lingua');
  const cPrimo = idx('data primo contatto');
  const cUlt   = idx('data ultimo ordine');
  const cRuolo = idx('ruolo ultimo ordine');
  const cL1    = idx('indirizzo spedizione conosciuto 1');
  const cL2    = idx('indirizzo spedizione conosciuto 2');
  const cCity  = idx('città');
  const cZip   = idx('cap');
  const cCtry  = idx('nazione');

  // trova riga esistente
  let rowIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    if (((rows[i][cEmail] || '').trim().toLowerCase()) === (email || '').toLowerCase()) {
      rowIdx = i; break;
    }
  }

  const nowISO = new Date().toISOString();

  // costruisci riga da aggiornare
  const makeRow = (existing = []) => {
    const out = existing.slice();
    const set = (i, val) => { if (i >= 0) out[i] = val; };

    set(cEmail, email);
    if (cNome  >= 0) set(cNome,  name || existing[cNome] || '');
    if (cLang  >= 0) set(cLang,  (language || existing[cLang] || 'it'));
    if (cPrimo >= 0) set(cPrimo, existing[cPrimo] || nowISO);
    if (cUlt   >= 0) set(cUlt,   nowISO);
    if (cRuolo >= 0) set(cRuolo, role || existing[cRuolo] || '');

    if (addr) {
      if (cL1   >= 0) set(cL1,   addr.line1 || existing[cL1] || '');
      if (cL2   >= 0) set(cL2,   addr.line2 || existing[cL2] || '');
      if (cCity >= 0) set(cCity, addr.city  || existing[cCity] || '');
      if (cZip  >= 0) set(cZip,  addr.postal_code || existing[cZip] || '');
      if (cCtry >= 0) set(cCtry, addr.country || existing[cCtry] || '');
    }

    // allunga alla larghezza header
    for (let i = 0; i < header.length; i++) if (typeof out[i] === 'undefined') out[i] = '';
    return out;
  };

  if (rowIdx === -1) {
    const newRow = makeRow([]);
    await appendRow(sheet, newRow);
  } else {
    const existing = rows[rowIdx] || [];
    const upd = makeRow(existing);
    await updateRow(sheet, rowIdx + 1, upd);
  }
}

// ---------- Handler ----------
exports.handler = async (event) => {
  // Verifica firma Stripe
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

    // Recupero dettagli completi + line items
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['payment_intent', 'customer']
    });
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });

    // Dati principali
    const meta = fullSession.metadata || {};
    const buyerEmail = fullSession.customer_details?.email || fullSession.customer_email || meta.buyer_email || '';
    const buyerName  = fullSession.customer_details?.name  || meta.shipping_name || '';
    const amountEUR  = (fullSession.amount_total || 0) / 100;
    const currency   = (fullSession.currency || 'eur').toUpperCase();
    const lang       = (meta.language || 'it').toLowerCase();

// Indirizzo: PRIMA i metadati del sito, poi fallback Stripe
const addrStripe = fullSession.customer_details?.address || {};
const addr = {
  line1:       meta.shipping_line1       || addrStripe.line1       || '',
  line2:       meta.shipping_line2       || addrStripe.line2       || '',
  city:        meta.shipping_city        || addrStripe.city        || '',
  postal_code: meta.shipping_postal_code || addrStripe.postal_code || '',
  country:     meta.shipping_country     || addrStripe.country     || ''
};


    // Product/type (se serve lo usi nello sheet)
    const firstItem = (lineItems.data && lineItems.data[0]) || {};
    const productDesc = firstItem.description || meta.tree_type || '';

    // 1) Scrivi su "Storico ordini"
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
    const adopterEmail = meta.recipient_email || buyerEmail;
    const adopterName  = meta.certificate_name || buyerName;
    const isGiftFlag   = (meta.is_gift || '').toString().toLowerCase().startsWith('y') ? 'Sì' : 'No';

    await appendRow(ORDERS_SHEET, [
      fullSession.id,
      nowISO,
      buyerEmail,
      buyerName,
      adopterEmail,
      adopterName,
      isGiftFlag,
      productDesc,
      meta.certificate_message || '',
      addr.line1, addr.line2, addr.city, addr.postal_code, addr.country,
      meta.order_note || '',
      meta.discount_code || '',
      currency === 'EUR' ? amountEUR : `${amountEUR} ${currency}`,
      lang
    ]);

    // 2) Aggiorna "Archivio contatti" (buyer)
    if (buyerEmail) {
      await upsertArchivioContatti({
        email: buyerEmail,
        name: buyerName,
        language: lang,
        role: 'Personale', // acquisto personale: se un domani rimetti il flag regalo, qui potrai mettere 'Regalo'
        addr
      });
    }

    // 3) Brevo: upsert buyer in "Clienti"
    if (buyerEmail) {
      await brevoUpsertClientAddOnly({ email: buyerEmail, name: buyerName, language: lang });
    }

    // 4) Notifica interna a info@
    await brevoSendInfoNotification({
      orderId: fullSession.id,
      buyerEmail,
      buyerName,
      amountEUR
    });

    // 5) Email conferma al cliente (se template ID presente)
    if (buyerEmail && process.env.BREVO_TMPL_ORDER_CONFIRM_ID) {
      await brevoSendOrderEmailViaTemplate({
        toEmail: buyerEmail,
        toName: buyerName,
        amountEUR,
        orderId: fullSession.id
      });
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('WEBHOOK ERROR', e);
    return { statusCode: 500, body: 'server error' };
  }
};

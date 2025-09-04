// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const { google } = require('googleapis');

// ---------- Helper: Google Sheets ----------
async function getSheets() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

async function appendRow(sheetName, values) {
  const sheets = await getSheets();
  return sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

// Upsert basato su email (case-insensitive) nella prima colonna del foglio
async function upsertByEmail(sheetName, header, email, rowValuesBuilder) {
  const sheets = await getSheets();
  const emailLower = (email || '').trim().toLowerCase();

  // Leggi l'intero foglio per cercare l'email
  const getResp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${sheetName}!A:Z`
  });

  const rows = getResp.data.values || [];
  if (rows.length === 0) {
    // Se il foglio fosse vuoto, prima riga = header
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] }
    });
    const values = rowValuesBuilder({});
    await appendRow(sheetName, values);
    return { action: 'created' };
  }

  // Cerca indice colonna Email nel header
  const headerRow = rows[0];
  const emailColIdx = headerRow.findIndex(h => (h || '').toLowerCase().includes('email'));
  const existingIndex = rows.findIndex((r, idx) =>
    idx > 0 && (r[emailColIdx] || '').trim().toLowerCase() === emailLower
  );

  if (existingIndex === -1) {
    const values = rowValuesBuilder({});
    await appendRow(sheetName, values);
    return { action: 'created' };
  } else {
    // Costruisci la riga aggiornata mantenendo header length
    const existingRow = rows[existingIndex] || [];
    const current = {};
    headerRow.forEach((h, i) => current[h] = existingRow[i] || '');

    const newRow = rowValuesBuilder(current);
    const range = `${sheetName}!A${existingIndex + 1}:` + String.fromCharCode(64 + headerRow.length) + (existingIndex + 1);

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] }
    });
    return { action: 'updated' };
  }
}

// ---------- Helper: Brevo ----------
const BREVO_API = 'https://api.brevo.com/v3';
const brevo = axios.create({
  baseURL: BREVO_API,
  headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' }
});

async function brevoUpsertContact({ email, attributes = {}, listIdsToAdd = [], listIdsToRemove = [] }) {
  if (!email) return;
  // create/update
  await brevo.post('/contacts', {
    email,
    attributes,
    listIds: listIdsToAdd,
    updateEnabled: true
  }).catch(e => {
    // se fallisce per qualsiasi motivo, logga ma non bloccare
    console.warn('Brevo upsert failed', e?.response?.data || e.message);
  });

  // remove from lists
  for (const listId of listIdsToRemove) {
    try {
      await brevo.post(`/contacts/lists/${listId}/contacts/remove`, { emails: [email] });
    } catch (e) {
      console.warn('Brevo remove failed', listId, e?.response?.data || e.message);
    }
  }
}

// ---------- MAIN HANDLER ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Netlify passa event.body come stringa; se base64, decodifica
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    try {
      const sessionId = stripeEvent.data.object.id;

      // Riprendo la sessione con alcune espansioni utili
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['customer_details', 'shipping_details', 'discounts.promotion_code', 'total_details.breakdown']
      });

      const md = session.metadata || {};
      const isGift = md.isGift === 'true';
      const customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email || '';
      const customerName  = (session.customer_details && session.customer_details.name) || '';

      // Shipping (raccolto nel checkout, come da tua config)
      const ship = session.shipping_details || {};
      const shipAddr = (ship.address || {});
      const addr1 = [shipAddr.line1 || ''].filter(Boolean).join(' ').trim();
      const addr2 = shipAddr.line2 || '';
      const city  = shipAddr.city || '';
      const cap   = shipAddr.postal_code || '';
      const country = shipAddr.country || '';

      // Discount code (se presente)
      let discountCode = '';
      if (Array.isArray(session.discounts) && session.discounts.length > 0) {
        const pc = session.discounts[0].promotion_code;
        discountCode = pc && pc.code ? pc.code : '';
      } else if (session.total_details?.breakdown?.discounts?.length) {
        // fallback, non sempre c'è il code, a volte solo coupon id
        discountCode = 'APPLICATO';
      }

      // Importo totale pagato
      const amountPaid = (session.amount_total || 0) / 100;

      // Dati “adottante”/destinatario
      const recipientEmail = md.recipientEmail || '';
      const certificateName = md.certificateName || '';
      const certificateMessage = md.certificateMessage || '';
      const treeType = md.treeType || '';
      const language = md.language || 'it';
      const orderNote = md.orderNote || '';

      // ---------- 1) STORICO ORDINI ----------
      // Colonne dichiarate da te:
      // (ID ordine, Data ordine, Email acquirente, Nome acquirente, Email adottante, Nome adottante,
      //  Regalo?, Tipo adozione, Messaggio personalizzato, Indirizzo1, Indirizzo2, Città, CAP, Nazione,
      //  Note ordine, Codice sconto usato, Importo pagato, Lingua)
      await appendRow('Storico ordini', [
        session.id,
        new Date(session.created * 1000).toISOString(),
        customerEmail,
        customerName,
        isGift ? (recipientEmail || customerEmail) : customerEmail,
        certificateName,
        isGift ? 'SI' : 'NO',
        treeType,
        certificateMessage,
        addr1,
        addr2,
        city,
        cap,
        country,
        orderNote,
        discountCode,
        amountPaid,
        language
      ]);

      // ---------- 2) ARCHIVIO CONTATTI (UPsert) ----------
      // Header atteso (come da tua lista): 
      const ARCH_HEADER = [
        'Email','Nome completo','Lingua','Data primo contatto','Data ultimo ordine','Ruolo ultimo ordine',
        'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
        'Stato adozione personale','Data scadenza adozione personale',
        'Ultimo indirizzo spedizione conosciuto 1','Ultimo indirizzo spedizione conosciuto 2',
        'Ultima città spedizione conosciuta','Ultimo CAP spedizione conosciuto','Ultima nazione spedizione conosciuta'
      ];

      // a) Acquirente
      await upsertByEmail('Archivio contatti', ARCH_HEADER, customerEmail, (current) => ([
        customerEmail,
        customerName || current['Nome completo'] || '',
        language || current['Lingua'] || 'it',
        current['Data primo contatto'] || new Date().toISOString(),      // se nuovo, setto ora
        new Date().toISOString(),                                         // Data ultimo ordine = ora
        isGift ? 'Acquirente Regalo' : 'Acquirente Personale',            // Ruolo ultimo ordine
        current['Numero ordini effettuati (colonna calcolata tramite arrayformula)'] || '',
        current['Stato adozione personale'] || '',
        current['Data scadenza adozione personale'] || '',
        addr1 || current['Ultimo indirizzo spedizione conosciuto 1'] || '',
        addr2 || current['Ultimo indirizzo spedizione conosciuto 2'] || '',
        city  || current['Ultima città spedizione conosciuta'] || '',
        cap   || current['Ultimo CAP spedizione conosciuto'] || '',
        country || current['Ultima nazione spedizione conosciuta'] || ''
      ]));

      // b) Destinatario (solo se regalo e se email presente)
      if (isGift && recipientEmail) {
        await upsertByEmail('Archivio contatti', ARCH_HEADER, recipientEmail, (current) => ([
          recipientEmail,
          (certificateName || current['Nome completo'] || ''),
          language || current['Lingua'] || 'it',
          current['Data primo contatto'] || new Date().toISOString(),
          new Date().toISOString(),
          'Adottante Regalo',
          current['Numero ordini effettuati (colonna calcolata tramite arrayformula)'] || '',
          current['Stato adozione personale'] || '',
          current['Data scadenza adozione personale'] || '',
          addr1 || current['Ultimo indirizzo spedizione conosciuto 1'] || '',
          addr2 || current['Ultimo indirizzo spedizione conosciuto 2'] || '',
          city  || current['Ultima città spedizione conosciuta'] || '',
          cap   || current['Ultimo CAP spedizione conosciuto'] || '',
          country || current['Ultima nazione spedizione conosciuta'] || ''
        ]));
      }

      // ---------- 3) BREVO (liste) ----------
      const L = {
        CLIENTI: Number(process.env.BREVO_LIST_CLIENTI),
        RECUPERO: Number(process.env.BREVO_LIST_RECUPERO_CARRELLO),
        REGALI: Number(process.env.BREVO_LIST_ACQUIRENTI_REGALI)
      };

      // a) Acquirente -> Clienti (e se era in Recupero Carrello, rimuovi)
      await brevoUpsertContact({
        email: customerEmail,
        attributes: { NOME: customerName || '', LINGUA: language.toUpperCase() },
        listIdsToAdd: [L.CLIENTI].filter(Boolean),
        listIdsToRemove: [L.RECUPERO].filter(Boolean)
      });

      // b) Se regalo: acquirente anche in "Acquirenti x regali"
      if (isGift && L.REGALI) {
        await brevoUpsertContact({
          email: customerEmail,
          attributes: { NOME: customerName || '', LINGUA: language.toUpperCase() },
          listIdsToAdd: [L.REGALI]
        });
      }

      // c) Destinatario (se c'è email): NON inviamo email, ma teniamo il contatto aggiornato (niente liste obbligatorie qui)
      if (isGift && recipientEmail) {
        await brevoUpsertContact({
          email: recipientEmail,
          attributes: { NOME: certificateName || '', LINGUA: language.toUpperCase() }
        });
      }

      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch (e) {
      console.error('❌ Handler error:', e);
      return { statusCode: 500, body: 'Server error' };
    }
  }

  // Ignora altri eventi, ma rispondi 200
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

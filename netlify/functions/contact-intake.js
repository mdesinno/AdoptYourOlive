// netlify/functions/contact-intake.js
const { google } = require('googleapis');

// ====== ENV richieste ======
// GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GSHEET_ID
// BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME (opzionale), INFO_EMAIL

const SHEET_ID = process.env.GSHEET_ID || process.env.SHEET_ID; // usiamo GSHEET_ID se presente
const MESSAGES_SHEET = 'Storico messaggi ricevuti';

// ---------- Google Sheets ----------
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

async function appendRow(sheetName, values) {
  const sheets = await getSheets();
  return sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

// ---------- Brevo (solo mail a info@) ----------
async function sendBrevoMail({ toEmail, toName, subject, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'AYO';

  if (!apiKey || !senderEmail) {
    throw new Error('BREVO_API_KEY o BREVO_SENDER_EMAIL mancano nelle variabili di ambiente');
  }

  const body = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name: toName || '' }],
    subject,
    htmlContent: html
  };
  if (replyTo && replyTo.email) body.replyTo = replyTo;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Brevo email ERR ${res.status}: ${txt}`);
  }
}

// ---------- Utils ----------
function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name = '', email = '', message = '', language = 'it' } = JSON.parse(event.body || '{}');
    if (!email || !message) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email e messaggio sono obbligatori' }) };
    }

    // 1) Scrivi solo su "Storico messaggi ricevuti"
    const header = ['Data', 'Nome', 'Email', 'Messaggio', 'Lingua', 'Submission ID']; // manteniamo la colonna "Submission ID" vuota
    await ensureHeaderIfMissing(MESSAGES_SHEET, header);

    const nowISO = new Date().toISOString();
    await appendRow(MESSAGES_SHEET, [ nowISO, name, email, message, language, '' ]);

    // 2) Invia email interna a info@ con reply-to dell'utente
    const toEmail = process.env.INFO_EMAIL;
    if (toEmail) {
      await sendBrevoMail({
        toEmail,
        toName: 'AYO',
        subject: `AYO - Nuovo messaggio ${email}`,
        html:
          `<p><b>Data:</b> ${nowISO}</p>` +
          `<p><b>Lingua:</b> ${language}</p>` +
          `<p><b>Nome:</b> ${escapeHtml_(name) || '-'}</p>` +
          `<p><b>Email:</b> ${escapeHtml_(email)}</p>` +
          `<p><b>Messaggio:</b><br>${escapeHtml_(message).replace(/\n/g,'<br>')}</p>`,
        replyTo: { email, name }
      });
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('contact-intake ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Errore server' }) };
  }
};

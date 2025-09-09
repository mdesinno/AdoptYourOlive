// netlify/functions/contact-intake.js
const { google } = require('googleapis');

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  SHEET_ID,
  BREVO_API_KEY,
  INFO_EMAIL,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME
} = process.env;

// --- Google Sheets client
function getSheets() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !SHEET_ID) {
    throw new Error('Manca una delle variabili: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID');
  }
  const jwt = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth: jwt });
}

// --- Scrive una riga sul foglio "Storico messaggi ricevuti"
async function appendContactRow({ name, email, message, language }) {
  const sheets = getSheets();
  const values = [[
    new Date().toISOString(), // Data (ISO)
    name || '',
    email || '',
    message || '',
    (language || 'it')
  ]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Storico messaggi ricevuti!A:E',
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

// --- Invia email a info@ via Brevo (con Reply-To dell’utente)
async function sendInfoEmail({ name, email, message, language }) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY mancante');
  const toEmail = INFO_EMAIL || 'info@adoptyourolive.com';
  const senderEmail = BREVO_SENDER_EMAIL || toEmail;
  const senderName = BREVO_SENDER_NAME || 'Adopt Your Olive';

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name: 'AYO – Inbox' }],
    replyTo: email ? { email, name: name || '' } : undefined,
    subject: `AYO - Nuovo messaggio ${email || ''}`,
    htmlContent: `
      <h3>ew message from adoptyourolive.com</h3>
      <p><b>Data:</b> ${new Date().toLocaleString('it-IT')}</p>
      <p><b>Lingua:</b> ${language || 'it'}</p>
      <p><b>Nome:</b> ${name || ''}</p>
      <p><b>Email:</b> ${email || ''}</p>
      <p><b>Messaggio:</b><br>${(message || '').replace(/\n/g,'<br>')}</p>
    `
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Brevo email error: ${res.status} ${txt}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email, message, language } = JSON.parse(event.body || '{}');

    if (!email || !message) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email e messaggio sono obbligatori' }) };
    }

    // 1) salva su Google Sheet
    await appendContactRow({ name, email, message, language });

    // 2) manda email a info@ con Reply-To dell’utente
    await sendInfoEmail({ name, email, message, language });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('CONTACT INTAKE ERROR', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

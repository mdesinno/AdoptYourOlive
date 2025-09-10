// netlify/functions/club-update-email.js
const { google } = require('googleapis');
const axios = require('axios');

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

async function readAll(sheetName) {
  const s = await getSheets();
  const r = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return r.data.values || [];
}

async function updateRow(sheetName, rowIndex1, arr) {
  const s = await getSheets();
  const endCol = String.fromCharCode(64 + arr.length);
  await s.spreadsheets.values.update({
    spreadsheetId: process.env.GSHEET_ID,
    range: `${sheetName}!A${rowIndex1}:${endCol}${rowIndex1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [arr] },
  });
}

async function appendRow(sheetName, arr) {
  const s = await getSheets();
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.GSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [arr] },
  });
}

// Upsert su "Mappature email (attive)"
async function upsertMapping({ type, oldEmail, newEmail, origin }) {
  const sheet = 'Mappature email (attive)';
  const rows = await readAll(sheet);
  const header = rows[0] || [];
  const wantedHeader = ['Tipo', 'Email vecchia', 'Email attuale', 'Attivo', 'Ultimo aggiornamento', 'Origine/Codice'];

  // se foglio vuoto, crealo con header
  if (rows.length === 0) {
    await appendRow(sheet, wantedHeader);
    rows.push(wantedHeader);
  } else {
    // se header differente, non fermarti: prova a usare le posizioni migliori
  }

  const h = rows[0];
  const colTipo   = h.findIndex(x => (x || '').toLowerCase().includes('tipo'));
  const colOld    = h.findIndex(x => (x || '').toLowerCase().includes('email vecchia'));
  const colNew    = h.findIndex(x => (x || '').toLowerCase().includes('email attuale'));
  const colAttivo = h.findIndex(x => (x || '').toLowerCase().includes('attivo'));
  const colWhen   = h.findIndex(x => (x || '').toLowerCase().includes('ultimo'));
  const colOrig   = h.findIndex(x => (x || '').toLowerCase().includes('origine'));

  let idx = -1;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if ((r[colTipo] || '') === type && (r[colOld] || '').toLowerCase() === oldEmail.toLowerCase()) {
      idx = i;
      break;
    }
  }

  const now = new Date().toISOString();
  const newRow = [];
  newRow[colTipo]   = type;
  newRow[colOld]    = oldEmail;
  newRow[colNew]    = newEmail;
  newRow[colAttivo] = 'TRUE';
  newRow[colWhen]   = now;
  newRow[colOrig]   = origin || 'Club';

  // riempi eventuali buchi fino a larghezza header
  for (let i = 0; i < wantedHeader.length; i++) {
    if (typeof newRow[i] === 'undefined') newRow[i] = '';
  }

  if (idx === -1) {
    await appendRow(sheet, newRow);
  } else {
    await updateRow(sheet, idx + 1, newRow);
  }
}

// ---------- Brevo email (no template) ----------
const brevo = axios.create({
  baseURL: 'https://api.brevo.com/v3',
  headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
});

async function sendEmail({ to, subject, html, replyTo }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.INFO_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'AdoptYourOlive';

  const payload = {
    sender: { email: senderEmail, name: senderName },
    to: Array.isArray(to) ? to.map(e => ({ email: e })) : [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (replyTo) payload.replyTo = { email: replyTo };

  try {
    await brevo.post('/smtp/email', payload);
  } catch (e) {
    console.warn('Brevo email error', e.response?.data || e.message);
  }
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { oldEmail = '', newEmail = '' } = JSON.parse(event.body || '{}');
    if (!oldEmail || !newEmail) return { statusCode: 400, body: JSON.stringify({ error: 'Parametri mancanti' }) };
    if (oldEmail.toLowerCase() === newEmail.toLowerCase()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Le email sono uguali' }) };
    }

    // 1) Archivio contatti: sostituisci old->new
    const rows = await readAll('Archivio contatti');
    if (rows.length < 1) return { statusCode: 500, body: JSON.stringify({ error: 'Archivio contatti vuoto' }) };
    const header = rows[0];
    const emailIdx = header.findIndex(h => (h || '').toLowerCase().includes('email'));
    const rowIdx = rows.findIndex((r, i) => i > 0 && (r[emailIdx] || '').trim().toLowerCase() === oldEmail.toLowerCase());
    if (rowIdx === -1) return { statusCode: 404, body: JSON.stringify({ error: 'Vecchia email non trovata in Archivio contatti' }) };

    const row = rows[rowIdx];
    row[emailIdx] = newEmail;
    await updateRow('Archivio contatti', rowIdx + 1, row);

    // 2) Log su "Storico cambi email"
    await appendRow('Storico cambi email', [
      new Date().toISOString(), 'UPDATE_EMAIL', oldEmail, newEmail, 'Club'
    ]);

    // 3) Mappature email (attive)
    await upsertMapping({ type: 'UPDATE_EMAIL', oldEmail, newEmail, origin: 'Club' });

    // 4) Brevo: prova update email su vecchio contatto; se non esiste, upsert sul nuovo
    try {
      await brevo.put(`/contacts/${encodeURIComponent(oldEmail)}`, { email: newEmail });
    } catch (e) {
      // se 404 o simile: crea/aggiorna il nuovo
      await brevo.post('/contacts', { email: newEmail, updateEnabled: true }).catch(() => {});
    }

    // 5) Email al cliente e notifica interna
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit`;

    await sendEmail({
      to: newEmail,
      subject: 'Your email was updated',
      html: `
        <p>Hi,</p>
        <p>We’ve updated the email associated with your adoption from <strong>${oldEmail}</strong> to <strong>${newEmail}</strong>.</p>
        <p>If you didn’t request this change, reply to this email.</p>
        <p>— Adopt Your Olive</p>
      `,
    });

    await sendEmail({
      to: process.env.INFO_EMAIL,
      subject: 'AYO • Email change recorded',
      html: `
        <p>Type: <strong>UPDATE_EMAIL</strong></p>
        <p>Old: <strong>${oldEmail}</strong><br/>New: <strong>${newEmail}</strong><br/>Origin: Club</p>
        <p>Sheet: <a href="${sheetUrl}" target="_blank" rel="noopener">open Google Sheet</a></p>
      `,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('club-update-email ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

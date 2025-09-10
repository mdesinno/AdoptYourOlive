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

// ---------- Brevo: simple email (no template) ----------
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

  await brevo.post('/smtp/email', payload);
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { oldEmail = '', newEmail = '' } = JSON.parse(event.body || '{}');
    if (!oldEmail || !newEmail) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parametri mancanti' }) };
    }
    if (oldEmail.toLowerCase() === newEmail.toLowerCase()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Le email sono uguali' }) };
    }

    // 1) Archivio contatti: trova riga per oldEmail e sostituisci con newEmail
    const rows = await readAll('Archivio contatti');
    if (rows.length < 1) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Archivio contatti vuoto' }) };
    }
    const header = rows[0];
    const emailIdx = header.findIndex(h => (h || '').toLowerCase().includes('email'));
    const rowIdx = rows.findIndex((r, i) => i > 0 && (r[emailIdx] || '').trim().toLowerCase() === oldEmail.toLowerCase());

    if (rowIdx === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Vecchia email non trovata in Archivio contatti' }) };
    }

    const row = rows[rowIdx];
    row[emailIdx] = newEmail;
    await updateRow('Archivio contatti', rowIdx + 1, row);

    // 2) Log su "Storico cambi email"
    await appendRow('Storico cambi email', [
      new Date().toISOString(),
      'UPDATE_EMAIL',
      oldEmail,
      newEmail,
      'Club'
    ]);

    // 3) Brevo: aggiorna contatto (identifier = oldEmail → set email=newEmail)
    try {
      await brevo.put(`/contacts/${encodeURIComponent(oldEmail)}`, { email: newEmail });
    } catch {
      // se non esiste il vecchio contatto, crea/aggiorna direttamente il nuovo
      await brevo.post('/contacts', { email: newEmail, updateEnabled: true })
        .catch(() => {});
    }

    // 4) Email al cliente (nuovo indirizzo) + notifica interna
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
        <p>Change type: <strong>UPDATE_EMAIL</strong></p>
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

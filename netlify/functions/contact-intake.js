// netlify/functions/contact-intake.js
const { google } = require('googleapis');

// ---------- Helper: Google Sheets ----------
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

async function appendRow(sheetName, values) {
  const sheets = await getSheets();
  return sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

async function upsertByEmail(sheetName, header, email, rowValuesBuilder) {
  const sheets = await getSheets();
  const emailLower = (email || '').trim().toLowerCase();

  const getResp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${sheetName}!A:Z`
  });

  const rows = getResp.data.values || [];
  if (rows.length === 0) {
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
    const existingRow = rows[existingIndex] || [];
    const current = {};
    headerRow.forEach((h, i) => current[h] = existingRow[i] || '');
    const newRow = rowValuesBuilder(current);
    const range = `${sheetName}!A${existingIndex + 1}:` + String.fromCharCode(64 + headerRow.length) + (existingIndex + 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] }
    });
    return { action: 'updated' };
  }
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

    const now = new Date().toISOString();

    // 1) Storico messaggi ricevuti (append)
    // Colonne: Data, Nome, Email, Messaggio, Lingua, Submission ID (inutile)
    await appendRow('Storico messaggi ricevuti', [
      now, name, email, message, language, ''
    ]);

    // 2) Archivio contatti (UPsert "soft": aggiorno solo dati base se mancanti)
    const ARCH_HEADER = [
      'Email','Nome completo','Lingua','Data primo contatto','Data ultimo ordine','Ruolo ultimo ordine',
      'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
      'Stato adozione personale','Data scadenza adozione personale',
      'Ultimo indirizzo spedizione conosciuto 1','Ultimo indirizzo spedizione conosciuto 2',
      'Ultima città spedizione conosciuta','Ultimo CAP spedizione conosciuto','Ultima nazione spedizione conosciuta'
    ];

    await upsertByEmail('Archivio contatti', ARCH_HEADER, email, (current) => ([
      email,
      name || current['Nome completo'] || '',
      language || current['Lingua'] || 'it',
      current['Data primo contatto'] || now,
      current['Data ultimo ordine'] || '',
      current['Ruolo ultimo ordine'] || '',
      current['Numero ordini effettuati (colonna calcolata tramite arrayformula)'] || '',
      current['Stato adozione personale'] || '',
      current['Data scadenza adozione personale'] || '',
      current['Ultimo indirizzo spedizione conosciuto 1'] || '',
      current['Ultimo indirizzo spedizione conosciuto 2'] || '',
      current['Ultima città spedizione conosciuta'] || '',
      current['Ultimo CAP spedizione conosciuto'] || '',
      current['Ultima nazione spedizione conosciuta'] || ''
    ]));

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('contact-intake ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Errore server' }) };
  }
};

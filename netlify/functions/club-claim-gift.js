// netlify/functions/club-claim-gift.js
const { google } = require('googleapis');
const axios = require('axios');

/* ==================== Google Sheets helpers ==================== */
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
function toA1Col(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
async function ensureSheetExists(sheetName, headerRow) {
  const s = await getSheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: process.env.GSHEET_ID });
  const exists = (meta.data.sheets || []).some(sh => sh.properties && sh.properties.title === sheetName);
  if (!exists) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
    });
    const endCol = toA1Col(headerRow.length);
    await s.spreadsheets.values.update({
      spreadsheetId: process.env.GSHEET_ID,
      range: `${sheetName}!A1:${endCol}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headerRow] }
    });
  }
}
async function readAll(sheetName) {
  const s = await getSheets();
  try {
    const r = await s.spreadsheets.values.get({
      spreadsheetId: process.env.GSHEET_ID,
      range: `${sheetName}!A:Z`,
    });
    return r.data.values || [];
  } catch (_) {
    return [];
  }
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
async function updateRow(sheetName, rowIndex1, arr) {
  const s = await getSheets();
  const endCol = toA1Col(arr.length);
  await s.spreadsheets.values.update({
    spreadsheetId: process.env.GSHEET_ID,
    range: `${sheetName}!A${rowIndex1}:${endCol}${rowIndex1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [arr] },
  });
}

/* === Upsert su "Archivio contatti" con indirizzo === */
async function upsertArchivioContatti({ email, name, lang='it', role='Adottante Regalo', addr1, addr2, city, cap, country }) {
  const sheet = 'Archivio contatti';
  const rows = await readAll(sheet);
  if (rows.length === 0) return; // se proprio non esiste, esco “soft”

  const header = rows[0].map(h => (h || '').toString());
  const ci = (needle) => header.findIndex(h => (h || '').toLowerCase().includes(needle));

  const emailIdx = ci('email');
  const nameIdx  = ci('nome completo');
  const langIdx  = ci('lingua');
  const firstIdx = ci('data primo contatto');
  const roleIdx  = ci('ruolo ultimo ordine');

  const a1Idx = ci('indirizzo spedizione conosciuto 1');
  const a2Idx = ci('indirizzo spedizione conosciuto 2');
  const ctyIdx= ci('città spedizione conosciuta');
  const capIdx= ci('cap spedizione conosciuto');
  const cty2Idx = ci('nazione spedizione conosciuta'); // country

  const nowIso = new Date().toISOString();

  // cerca riga
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (((r[emailIdx] || '') + '').trim().toLowerCase() === email.toLowerCase()) { found = i; break; }
  }

  if (found === -1) {
    // costruisci nuova riga con stessa lunghezza dell'header
    const newRow = new Array(header.length).fill('');
    if (emailIdx !== -1) newRow[emailIdx] = email;
    if (nameIdx  !== -1) newRow[nameIdx]  = name || '';
    if (langIdx  !== -1) newRow[langIdx]  = lang || 'it';
    if (firstIdx !== -1) newRow[firstIdx] = nowIso;
    if (roleIdx  !== -1) newRow[roleIdx]  = role || '';

    if (a1Idx   !== -1) newRow[a1Idx]   = addr1 || '';
    if (a2Idx   !== -1) newRow[a2Idx]   = addr2 || '';
    if (ctyIdx  !== -1) newRow[ctyIdx]  = city  || '';
    if (capIdx  !== -1) newRow[capIdx]  = cap   || '';
    if (cty2Idx !== -1) newRow[cty2Idx] = country || '';

    await appendRow(sheet, newRow);
  } else {
    const row = rows[found];
    if (nameIdx !== -1 && !row[nameIdx]) row[nameIdx] = name || row[nameIdx] || '';
    if (langIdx !== -1 && !row[langIdx]) row[langIdx] = lang || row[langIdx] || '';
    if (roleIdx !== -1 && !row[roleIdx]) row[roleIdx] = role || row[roleIdx] || '';

    // aggiorna SEMPRE indirizzo come “ultimo conosciuto”
    if (a1Idx   !== -1) row[a1Idx]   = addr1 || '';
    if (a2Idx   !== -1) row[a2Idx]   = addr2 || '';
    if (ctyIdx  !== -1) row[ctyIdx]  = city  || '';
    if (capIdx  !== -1) row[capIdx]  = cap   || '';
    if (cty2Idx !== -1) row[cty2Idx] = country || '';

    await updateRow(sheet, found + 1, row);
  }
}

/* ==================== Brevo (upsert + email semplice) ==================== */
const brevo = axios.create({
  baseURL: 'https://api.brevo.com/v3',
  headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
});
async function sendEmail({ to, subject, html }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.INFO_EMAIL;
  const senderName  = process.env.BREVO_SENDER_NAME  || 'AdoptYourOlive';
  try {
    await brevo.post('/smtp/email', {
      sender: { email: senderEmail, name: senderName },
      to: (Array.isArray(to) ? to : [to]).map(e => ({ email: e })),
      subject,
      htmlContent: html,
    });
  } catch (e) {
    console.warn('Brevo email error', e.response?.data || e.message);
  }
}
async function brevoUpsert(email, attributes = {}) {
  try {
    await brevo.post('/contacts', { email, attributes, updateEnabled: true });
  } catch (e) {
    console.warn('Brevo upsert warn', e.response?.data || e.message);
  }
}

/* ==================== Handler ==================== */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    const buyerEmail     = (body.buyerEmail || '').trim();
    const recipientEmail = (body.recipientEmail || '').trim();
    const recipientName  = (body.recipientName || '').trim();
    const shipping       = body.shipping || {};
    const shipAddr       = shipping.address || {};
    const addr1 = (shipAddr.line1 || '').trim();
    const addr2 = (shipAddr.line2 || '').trim(); // opzionale
    const city  = (shipAddr.city || '').trim();
    const cap   = (shipAddr.postal_code || '').trim();
    const country = (shipAddr.country || '').trim();

    if (!buyerEmail || !recipientEmail || !recipientName || !addr1 || !city || !cap || !country) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Campi obbligatori mancanti' }) };
    }

    const SHEET_ORDINI = 'Storico ordini';
    const rows = await readAll(SHEET_ORDINI);

    // logger generico su “Storico cambi email”
    const logClaim = async (note = '') => {
      await ensureSheetExists('Storico cambi email', ['Timestamp','Tipo','Vecchia email','Nuova email','Origine/Codice','Note']);
      await appendRow('Storico cambi email', [
        new Date().toISOString(), 'CLAIM_GIFT', buyerEmail, recipientEmail, 'Club', note
      ]);
    };

    // helper pending (ora upsert anche contatto+Brevo)
    const handlePending = async (candidates) => {
      // 1) upsert contatto con indirizzo
      await upsertArchivioContatti({
        email: recipientEmail, name: recipientName, lang: 'it', role: 'Adottante Regalo',
        addr1, addr2, city, cap, country
      });
      // 2) upsert brevo
      await brevoUpsert(recipientEmail, { NOME: recipientName });

      // 3) crea/append “Claim in attesa di pairing”
      const sheet = 'Claim in attesa di pairing';
      const header = ['Timestamp','BuyerEmail','RecipientEmail','RecipientName','Address1','Address2','City','Postal','Country','Candidati'];
      await ensureSheetExists(sheet, header);
      await appendRow(sheet, [
        new Date().toISOString(), buyerEmail, recipientEmail, recipientName,
        addr1, addr2, city, cap, country,
        JSON.stringify(candidates || [])
      ]);

      // 4) notifica interna
      await sendEmail({
        to: process.env.INFO_EMAIL,
        subject: (candidates && candidates.length)
          ? 'AYO • Claim regalo da abbinare (multipli)'
          : 'AYO • Claim regalo da abbinare (nessun ordine)',
        html: htmlPending({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates })
      });

      await logClaim(`pending: ${candidates ? candidates.length : 0} candidates`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, linked: false, pending: true }) };
    };

    // Se non ci sono ordini → pending
    if (rows.length < 2) {
      return await handlePending([]);
    }

    const header = rows[0].map(h => (h || '').toString());
    const findIdx = (needle) => header.findIndex(h => h.toLowerCase().includes(needle));

    const idIdx     = findIdx('id ordine');
    const buyerIdx  = findIdx('email acquirente');
    const adoptIdx  = findIdx('email adottante');
    const dateIdx   = findIdx('data ordine');

    const ship1Idx  = findIdx('indirizzo spedizione 1');
    const ship2Idx  = findIdx('indirizzo spedizione 2');
    const cityIdx   = findIdx('città spedizione');
    const capIdx    = findIdx('cap spedizione');
    const countryIdx= findIdx('nazione spedizione');

    const candidates = rows
      .map((r,i)=>({ r, i }))
      .filter(x => x.i>0 && ((x.r[buyerIdx] || '').toString().trim().toLowerCase() === buyerEmail.toLowerCase()))
      .sort((a,b)=>{
        const da = Date.parse(a.r[dateIdx] || '') || 0;
        const db = Date.parse(b.r[dateIdx] || '') || 0;
        return db - da;
      });

    if (candidates.length === 1) {
      // link automatico
      const targetIndex = candidates[0].i;
      const row = rows[targetIndex];

      if (adoptIdx  !== -1) row[adoptIdx]  = recipientEmail;
      // non toccare “Nome adottante”
      if (ship1Idx  !== -1) row[ship1Idx]  = addr1;
      if (ship2Idx  !== -1) row[ship2Idx]  = addr2;
      if (cityIdx   !== -1) row[cityIdx]   = city;
      if (capIdx    !== -1) row[capIdx]    = cap;
      if (countryIdx!== -1) row[countryIdx]= country;

      await updateRow(SHEET_ORDINI, targetIndex + 1, row);

      // upsert contatto (con indirizzo) + brevo
      await upsertArchivioContatti({
        email: recipientEmail, name: recipientName, lang: 'it', role: 'Adottante Regalo',
        addr1, addr2, city, cap, country
      });
      await brevoUpsert(recipientEmail, { NOME: recipientName });

      // conferma recipient
      await sendEmail({
        to: recipientEmail,
        subject: 'Your gift claim is confirmed',
        html: `
          <p>Hi ${recipientName || ''},</p>
          <p>We’ve linked the gift adoption to your email <b>${recipientEmail}</b> and saved your shipping address.</p>
          <p>We’ll keep you posted about your olive oil delivery.</p>
          <p>— Adopt Your Olive</p>
        `
      });

      // notifica interna
      await sendEmail({
        to: process.env.INFO_EMAIL,
        subject: 'AYO • Claim regalo collegato',
        html: `
          <p>Collegamento completato automaticamente (un solo ordine per buyer).</p>
          <p><b>Buyer:</b> ${buyerEmail}<br/>
             <b>Recipient:</b> ${recipientEmail} (${recipientName})</p>
          <p><b>Ship:</b> ${addr1}${addr2?(', '+addr2):''}, ${cap} ${city}, ${country}</p>
          <p>Apri Sheet: <a href="https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit" target="_blank" rel="noopener">Storico ordini</a></p>
        `
      });

      await logClaim('linked: single order match');
      return { statusCode: 200, body: JSON.stringify({ ok: true, linked: true, pending: false }) };
    }

    // zero o multipli → pending ma con upsert contatto + brevo
    const candidateSummaries = candidates.map(c => ({
      id: (idIdx !== -1 ? (c.r[idIdx] || '') : ''),
      date: (dateIdx !== -1 ? (c.r[dateIdx] || '') : ''),
      adopt: (adoptIdx !== -1 ? (c.r[adoptIdx] || '') : '')
    }));
    return await handlePending(candidateSummaries);

  } catch (e) {
    console.error('club-claim-gift ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

/* ==================== Email HTML pending ==================== */
function htmlPending({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates }) {
  const list = (candidates && candidates.length)
    ? `<ul>${candidates.map(c => `<li><b>ID:</b> ${c.id || '(n/d)'} — <b>Data:</b> ${c.date || '(n/d)'} — <b>Adottante:</b> ${c.adopt || '(vuoto)'}</li>`).join('')}</ul>`
    : '<p><i>Nessun candidato trovato.</i></p>';
  return `
    <p>Claim ricevuto (in attesa di pairing manuale).</p>
    <p><b>Buyer:</b> ${buyerEmail}</p>
    <p><b>Recipient:</b> ${recipientEmail} (${recipientName})</p>
    <p><b>Ship:</b> ${addr1}${addr2?(', '+addr2):''}, ${cap} ${city}, ${country}</p>
    <p><b>Candidati:</b></p>
    ${list}
    <p>Apri Sheet: <a href="https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit" target="_blank" rel="noopener">Storico ordini / Claim in attesa</a></p>
  `;
}

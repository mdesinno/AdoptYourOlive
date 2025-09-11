// netlify/functions/club-claim-gift.js
const { google } = require('googleapis');
const axios = require('axios');

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
async function readAll(sheetName) {
  const s = await getSheets();
  const r = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return r.data.values || [];
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
  const endCol = String.fromCharCode(64 + arr.length);
  await s.spreadsheets.values.update({
    spreadsheetId: process.env.GSHEET_ID,
    range: `${sheetName}!A${rowIndex1}:${endCol}${rowIndex1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [arr] },
  });
}

// ---------- Brevo (upsert + email semplice) ----------
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

// ---------- Handler ----------
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

    // Carica storici ordini
    const SHEET_ORDINI = 'Storico ordini';
    const rows = await readAll(SHEET_ORDINI);

    // Se il foglio è vuoto, niente match possibile → pending
    if (rows.length < 2) {
      await logPendingClaim({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates: [] });
      await notifyInfo({
        subject: 'AYO • Claim regalo da abbinare (nessun ordine)',
        html: htmlPending({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates: [] })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, linked: false, pending: true }) };
    }

    const header = rows[0].map(h => (h || '').toString());
    const findIdx = (needle) => header.findIndex(h => h.toLowerCase().includes(needle));

    const idIdx     = findIdx('id ordine');
    const buyerIdx  = findIdx('email acquirente');
    const adoptIdx  = findIdx('email adottante');
    const nameAdIdx = findIdx('nome adottante');
    const dateIdx   = findIdx('data ordine');
    const giftIdx   = findIdx('regalo'); // se non c’è, lo ignoriamo
    const ship1Idx  = findIdx('indirizzo spedizione 1');
    const ship2Idx  = findIdx('indirizzo spedizione 2');
    const cityIdx   = findIdx('città spedizione');
    const capIdx    = findIdx('cap spedizione');
    const countryIdx= findIdx('nazione spedizione');

    // Candidati = ordini di quell’acquirente.
    // Se esiste la colonna "Regalo?", lasciamo passare comunque (deciderai tu manualmente in caso di multipli).
    const candidates = rows
      .map((r,i)=>({ r, i }))
      .filter(x => {
        if (x.i === 0) return false;
        const buyerOk = ((x.r[buyerIdx] || '').toString().trim().toLowerCase() === buyerEmail.toLowerCase());
        return buyerOk;
      })
      .sort((a,b)=>{
        const da = Date.parse(a.r[dateIdx] || '') || 0;
        const db = Date.parse(b.r[dateIdx] || '') || 0;
        return db - da; // più recente per primo
      });

    if (candidates.length === 1) {
      // Un solo ordine → colleghiamo automaticamente
      const targetIndex = candidates[0].i;
      const row = rows[targetIndex];

      if (adoptIdx !== -1) row[adoptIdx] = recipientEmail;
      if (nameAdIdx !== -1 && !row[nameAdIdx]) row[nameAdIdx] = recipientName; // non sovrascrivo nomi certificato
      if (ship1Idx  !== -1) row[ship1Idx]  = addr1;
      if (ship2Idx  !== -1) row[ship2Idx]  = addr2;
      if (cityIdx   !== -1) row[cityIdx]   = city;
      if (capIdx    !== -1) row[capIdx]    = cap;
      if (countryIdx!== -1) row[countryIdx]= country;

      await updateRow(SHEET_ORDINI, targetIndex + 1, row);

      // Log richiesto
      await appendRow('Storico cambi email', [
        new Date().toISOString(), 'CLAIM_GIFT', buyerEmail, recipientEmail, ''
      ]);

      // Archivio contatti (soft upsert): se non esiste lo aggiungo con ruolo base
      const arch = await readAll('Archivio contatti');
      if (arch.length > 0) {
        const hA = arch[0];
        const emailIdx = hA.findIndex(x => (x || '').toLowerCase().includes('email'));
        const exists = emailIdx !== -1 && arch.findIndex((r,i)=> i>0 && (r[emailIdx] || '').trim().toLowerCase() === recipientEmail.toLowerCase()) !== -1;
        if (!exists) {
          await appendRow('Archivio contatti', [
            recipientEmail, recipientName, 'it', new Date().toISOString(), '', 'Adottante Regalo',
            '', '', '', '', '', '', '', ''
          ]);
        }
      }

      // Brevo upsert + email conferma a destinatario e notifica
      await brevoUpsert(recipientEmail, { NOME: recipientName });

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

      return { statusCode: 200, body: JSON.stringify({ ok: true, linked: true, pending: false }) };
    }

    // Zero o più di uno → non decidiamo noi: log + mail + 200
    const candidateSummaries = candidates.map(c => ({
      id: (idIdx !== -1 ? (c.r[idIdx] || '') : ''),
      date: (dateIdx !== -1 ? (c.r[dateIdx] || '') : ''),
      adopt: (adoptIdx !== -1 ? (c.r[adoptIdx] || '') : '')
    }));

    await logPendingClaim({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates: candidateSummaries });

    await notifyInfo({
      subject: 'AYO • Claim regalo da abbinare (multipli o nessuno)',
      html: htmlPending({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates: candidateSummaries })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, linked: false, pending: true }) };

  } catch (e) {
    console.error('club-claim-gift ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

// ---------- helpers locali ----------
async function logPendingClaim({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates }) {
  const sheet = 'Claim in attesa di pairing';
  const rows = await readAll(sheet);
  if (rows.length === 0) {
    await appendRow(sheet, [
      'Timestamp','BuyerEmail','RecipientEmail','RecipientName',
      'Address1','Address2','City','Postal','Country','Candidati'
    ]);
  }
  await appendRow(sheet, [
    new Date().toISOString(), buyerEmail, recipientEmail, recipientName,
    addr1, addr2, city, cap, country,
    JSON.stringify(candidates || [])
  ]);
}
async function notifyInfo({ subject, html }) {
  await sendEmail({ to: process.env.INFO_EMAIL, subject, html });
}
function htmlPending({ buyerEmail, recipientEmail, recipientName, addr1, addr2, city, cap, country, candidates }) {
  const list = (candidates && candidates.length)
    ? `<ul>${candidates.map(c => `<li><b>ID:</b> ${c.id || '(n/d)'} — <b>Data:</b> ${c.date || '(n/d)'} — <b>Adottante:</b> ${c.adopt || '(vuoto)'}</li>`).join('')}</ul>`
    : '<p><i>Nessun candidato trovato.</i></p>';
  return `
    <p>Claim ricevuto.</p>
    <p><b>Buyer:</b> ${buyerEmail}</p>
    <p><b>Recipient:</b> ${recipientEmail} (${recipientName})</p>
    <p><b>Ship:</b> ${addr1}${addr2?(', '+addr2):''}, ${cap} ${city}, ${country}</p>
    <p><b>Candidati:</b></p>
    ${list}
    <p>Apri Sheet: <a href="https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit" target="_blank" rel="noopener">Storico ordini / Claim in attesa</a></p>
  `;
}

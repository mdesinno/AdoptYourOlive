// netlify/functions/club-claim-gift.js
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

  if (rows.length === 0) {
    await appendRow(sheet, wantedHeader);
    rows.push(wantedHeader);
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

  for (let i = 0; i < wantedHeader.length; i++) {
    if (typeof newRow[i] === 'undefined') newRow[i] = '';
  }

  if (idx === -1) {
    await appendRow(sheet, newRow);
  } else {
    await updateRow(sheet, idx + 1, newRow);
  }
}

// ---------- Brevo email ----------
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

function isYes(v) {
  const s = String(v || '').trim().toLowerCase();
  return ['si', 'sì', 'yes', 'true', '1', 'y'].some(x => s.startsWith(x));
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const {
      buyerEmail = '',
      recipientEmail = '',
      recipientName = '',
      sid = '',
      // nuovi campi indirizzo (obbligatori nel form aggiornato)
      address1 = '',
      address2 = '',
      city = '',
      postal = '',
      country = ''
    } = JSON.parse(event.body || '{}');

    if (!buyerEmail || !recipientEmail) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parametri mancanti' }) };
    }

    // 1) Trova ordine regalo
    const rows = await readAll('Storico ordini');
    if (rows.length < 2) return { statusCode: 404, body: JSON.stringify({ error: 'Nessun ordine' }) };

    const h = rows[0];
    const idIdx     = h.findIndex(x => (x || '').toLowerCase().includes('id ordine'));
    const buyerIdx  = h.findIndex(x => (x || '').toLowerCase().includes('email acquirente'));
    const adoptIdx  = h.findIndex(x => (x || '').toLowerCase().includes('email adottante'));
    const nameAdIdx = h.findIndex(x => (x || '').toLowerCase().includes('nome adottante'));
    const giftIdx   = h.findIndex(x => (x || '').toLowerCase().includes('regalo'));
    const dateIdx   = h.findIndex(x => (x || '').toLowerCase().includes('data ordine'));
    const ship1Idx  = h.findIndex(x => (x || '').toLowerCase().includes('indirizzo spedizione 1'));
    const ship2Idx  = h.findIndex(x => (x || '').toLowerCase().includes('indirizzo spedizione 2'));
    const cityIdx   = h.findIndex(x => (x || '').toLowerCase().includes('città spedizione'));
    const capIdx    = h.findIndex(x => (x || '').toLowerCase().includes('cap spedizione'));
    const countryIdx= h.findIndex(x => (x || '').toLowerCase().includes('nazione spedizione'));

    let targetIndex = -1;

    if (sid && idIdx !== -1) {
      targetIndex = rows.findIndex((r, i) => i > 0 && String(r[idIdx] || '').trim() === sid.trim());
    }

    if (targetIndex === -1) {
      const candidates = rows
        .map((r, i) => ({ r, i }))
        .filter(x =>
          x.i > 0 &&
          isYes(x.r[giftIdx]) &&
          String(x.r[buyerIdx] || '').trim().toLowerCase() === buyerEmail.toLowerCase() &&
          (
            String(x.r[adoptIdx] || '').trim() === '' ||
            String(x.r[adoptIdx] || '').trim().toLowerCase() === buyerEmail.toLowerCase()
          )
        )
        .sort((a, b) => {
          const da = Date.parse(a.r[dateIdx] || '') || 0;
          const db = Date.parse(b.r[dateIdx] || '') || 0;
          return db - da;
        });
      if (candidates.length) targetIndex = candidates[0].i;
    }

    if (targetIndex === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Ordine regalo non trovato' }) };
    }

    // 2) Aggiorna riga ordine
    const orderRow = rows[targetIndex];
    if (adoptIdx !== -1) orderRow[adoptIdx] = recipientEmail;
    if (nameAdIdx !== -1) orderRow[nameAdIdx] = recipientName || orderRow[nameAdIdx] || '';

    // aggiorna indirizzo sull’ordine se i campi ci sono
    if (ship1Idx !== -1) orderRow[ship1Idx] = address1 || orderRow[ship1Idx] || '';
    if (ship2Idx !== -1) orderRow[ship2Idx] = address2 || orderRow[ship2Idx] || '';
    if (cityIdx  !== -1) orderRow[cityIdx]  = city     || orderRow[cityIdx]  || '';
    if (capIdx   !== -1) orderRow[capIdx]   = postal   || orderRow[capIdx]   || '';
    if (countryIdx!== -1)orderRow[countryIdx]= country || orderRow[countryIdx]|| '';

    await updateRow('Storico ordini', targetIndex + 1, orderRow);

    // 3) Upsert Archivio contatti (destinatario) con indirizzo
    const arch = await readAll('Archivio contatti');
    const ah = arch[0] || [
      'Email','Nome completo','Lingua','Data primo contatto','Data ultimo ordine','Ruolo ultimo ordine',
      'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
      'Stato adozione personale','Data scadenza adozione personale',
      'Ultimo indirizzo spedizione conosciuto 1','Ultimo indirizzo spedizione conosciuto 2',
      'Ultima città spedizione conosciuta','Ultimo CAP spedizione conosciuto','Ultima nazione spedizione conosciuta'
    ];
    const emailIdxA = ah.findIndex(x => (x || '').toLowerCase().includes('email'));

    let foundIdx = -1;
    if (arch.length > 1 && emailIdxA !== -1) {
      foundIdx = arch.findIndex((r, i) => i > 0 && String(r[emailIdxA] || '').trim().toLowerCase() === recipientEmail.toLowerCase());
    }

    const nowIso = new Date().toISOString();

    if (foundIdx === -1) {
      const toPush = [];
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('email'))] = recipientEmail;
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('nome completo'))] = recipientName || '';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('lingua'))] = 'it';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('data primo contatto'))] = nowIso;
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('ruolo ultimo ordine'))] = 'Adottante Regalo';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('ultimo indirizzo spedizione conosciuto 1'))] = address1 || '';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('ultimo indirizzo spedizione conosciuto 2'))] = address2 || '';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('ultima città spedizione conosciuta'))] = city || '';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('ultimo cap spedizione conosciuto'))] = postal || '';
      toPush[ah.findIndex(x => (x || '').toLowerCase().includes('ultima nazione spedizione conosciuta'))] = country || '';
      // riempi buchi
      for (let i = 0; i < ah.length; i++) if (typeof toPush[i] === 'undefined') toPush[i] = '';
      await appendRow('Archivio contatti', toPush);
    } else {
      const toUpd = arch[foundIdx];
      const idx1 = ah.findIndex(x => (x || '').toLowerCase().includes('ultimo indirizzo spedizione conosciuto 1'));
      const idx2 = ah.findIndex(x => (x || '').toLowerCase().includes('ultimo indirizzo spedizione conosciuto 2'));
      const idxC = ah.findIndex(x => (x || '').toLowerCase().includes('ultima città spedizione conosciuta'));
      const idxP = ah.findIndex(x => (x || '').toLowerCase().includes('ultimo cap spedizione conosciuto'));
      const idxN = ah.findIndex(x => (x || '').toLowerCase().includes('ultima nazione spedizione conosciuta'));
      if (idx1 !== -1) toUpd[idx1] = address1 || toUpd[idx1] || '';
      if (idx2 !== -1) toUpd[idx2] = address2 || toUpd[idx2] || '';
      if (idxC !== -1) toUpd[idxC] = city     || toUpd[idxC] || '';
      if (idxP !== -1) toUpd[idxP] = postal   || toUpd[idxP] || '';
      if (idxN !== -1) toUpd[idxN] = country  || toUpd[idxN] || '';
      await updateRow('Archivio contatti', foundIdx + 1, toUpd);
    }

    // 4) Brevo upsert contatto ricevente (no liste automatiche)
    await brevo.post('/contacts', {
      email: recipientEmail,
      attributes: { NOME: recipientName || '' },
      updateEnabled: true
    }).catch(() => {});

    // 5) Log cambi + Mappature attive (per collegare buyer -> recipient)
    await appendRow('Storico cambi email', [
      new Date().toISOString(), 'CLAIM_GIFT', buyerEmail, recipientEmail, sid || 'Club'
    ]);
    await upsertMapping({ type: 'CLAIM_GIFT', oldEmail: buyerEmail, newEmail: recipientEmail, origin: sid || 'Club' });

    // 6) Email al ricevente + notifica interna
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit`;

    await sendEmail({
      to: recipientEmail,
      subject: 'Your gift has been linked to you',
      html: `
        <p>Hi${recipientName ? ' ' + recipientName : ''},</p>
        <p>We’ve linked the gift adoption to your email: <strong>${recipientEmail}</strong>.</p>
        <p>If anything looks wrong, just reply to this email.</p>
        <p>— Adopt Your Olive</p>
      `,
    });

    await sendEmail({
      to: process.env.INFO_EMAIL,
      subject: 'AYO • Gift claim recorded',
      html: `
        <p>Type: <strong>CLAIM_GIFT</strong></p>
        <p>Buyer: <strong>${buyerEmail}</strong><br/>Recipient: <strong>${recipientEmail}</strong>${sid ? `<br/>Order ID: <strong>${sid}</strong>` : ''}</p>
        <p>Sheet: <a href="${sheetUrl}" target="_blank" rel="noopener">open Google Sheet</a></p>
      `,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('club-claim-gift ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

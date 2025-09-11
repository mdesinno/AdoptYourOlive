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

// ---------- Brevo email (no template) ----------
const brevo = axios.create({
  baseURL: 'https://api.brevo.com/v3',
  headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
});
async function sendEmail({ to, subject, html, replyTo }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.INFO_EMAIL;
  const senderName  = process.env.BREVO_SENDER_NAME  || 'AdoptYourOlive';

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
    const body = JSON.parse(event.body || '{}');
    const buyerEmail     = (body.buyerEmail || '').trim();
    const recipientEmail = (body.recipientEmail || '').trim();
    const recipientName  = (body.recipientName || '').trim();
    const sid            = (body.sid || '').trim();

    const shipping = body.shipping || {};
    const addr     = shipping.address || {};
    const line1    = (addr.line1 || '').trim();
    const line2    = (addr.line2 || '').trim();
    const city     = (addr.city || '').trim();
    const postal   = (addr.postal_code || '').trim();
    const country  = (addr.country || '').trim();

    // MINIMI richiesti (SID NON richiesto)
    if (!buyerEmail || !recipientEmail || !recipientName || !line1 || !city || !postal || !country) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parametri mancanti' }) };
    }

    // 1) Trova un ordine del buyer da collegare (ignoriamo "Regalo?")
    const rows = await readAll('Storico ordini');
    if (rows.length < 2) {
      // Nessun ordine: log "pending" + notifica + OK
      await logPendingClaim({ buyerEmail, recipientEmail, recipientName, sid, line1, line2, city, postal, country, reason: 'NO_ORDERS' });
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'pending' }) };
    }
    const header = rows[0];

    const col = (frag) => header.findIndex(h => (h || '').toLowerCase().includes(frag));
    const idIdx     = col('id ordine');
    const buyerIdx  = col('email acquirente');
    const adoptIdx  = col('email adottante');
    // const nameAdIdx = col('nome adottante'); // NON lo tocchiamo
    const dateIdx   = col('data ordine');

    const ship1Idx  = col('indirizzo spedizione 1');
    const ship2Idx  = col('indirizzo spedizione 2');
    const cityIdx   = col('città spedizione');
    const capIdx    = col('cap spedizione');
    const countryIdx= col('nazione spedizione');

    let targetIndex = -1;

    // a) match per SID se presente
    if (sid && idIdx !== -1) {
      targetIndex = rows.findIndex((r, i) => i > 0 && String(r[idIdx] || '').trim() === sid);
    }

    // b) fallback: ordine più recente del buyer con adottante vuoto o uguale al buyer
    if (targetIndex === -1 && buyerIdx !== -1) {
      const buyerL = buyerEmail.toLowerCase();
      const candidates = rows
        .map((r, i) => ({ r, i }))
        .filter(x =>
          x.i > 0 &&
          String(x.r[buyerIdx] || '').trim().toLowerCase() === buyerL &&
          (
            String(x.r[adoptIdx] || '').trim() === '' ||
            String(x.r[adoptIdx] || '').trim().toLowerCase() === buyerL
          )
        )
        .sort((a, b) => {
          const da = Date.parse(a.r[dateIdx] || '') || 0;
          const db = Date.parse(b.r[dateIdx] || '') || 0;
          return db - da; // più recente prima
        });

      if (candidates.length) targetIndex = candidates[0].i;
    }

    if (targetIndex === -1) {
      // Nessun match certo: log "pending" + notifica + OK
      await logPendingClaim({ buyerEmail, recipientEmail, recipientName, sid, line1, line2, city, postal, country, reason: 'NO_MATCH' });
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'pending' }) };
    }

    // 2) Aggiorna ordine (solo Email adottante + indirizzo, NON "Nome adottante")
    const row = rows[targetIndex];
    if (adoptIdx  !== -1) row[adoptIdx]  = recipientEmail;
    if (ship1Idx  !== -1) row[ship1Idx]  = line1;
    if (ship2Idx  !== -1) row[ship2Idx]  = line2;
    if (cityIdx   !== -1) row[cityIdx]   = city;
    if (capIdx    !== -1) row[capIdx]    = postal;
    if (countryIdx!== -1) row[countryIdx]= country;
    await updateRow('Storico ordini', targetIndex + 1, row);

    // 3) Upsert Archivio contatti del destinatario (aggiorna “ultimi indirizzi conosciuti”)
    const arch = await readAll('Archivio contatti');
    const archHeader = arch[0] || [
      'Email','Nome completo','Lingua','Data primo contatto','Data ultimo ordine','Ruolo ultimo ordine',
      'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
      'Stato adozione personale','Data scadenza adozione personale',
      'Ultimo indirizzo spedizione conosciuto 1','Ultimo indirizzo spedizione conosciuto 2',
      'Ultima città spedizione conosciuta','Ultimo CAP spedizione conosciuto','Ultima nazione spedizione conosciuta'
    ];
    const emailIdxA = archHeader.findIndex(h => (h || '').toLowerCase().includes('email'));
    let foundIdx = -1;
    if (arch.length > 1 && emailIdxA !== -1) {
      foundIdx = arch.findIndex((r, i) => i > 0 && String(r[emailIdxA] || '').trim().toLowerCase() === recipientEmail.toLowerCase());
    }
    const colA = (frag) => archHeader.findIndex(h => (h || '').toLowerCase().includes(frag));
    const u1 = colA('ultimo indirizzo spedizione conosciuto 1');
    const u2 = colA('ultimo indirizzo spedizione conosciuto 2');
    const uc = colA('ultima città spedizione conosciuta');
    const up = colA('ultimo cap spedizione conosciuto');
    const un = colA('ultima nazione spedizione conosciuta');

    const nowIso = new Date().toISOString();
    if (foundIdx === -1) {
      const newRow = [
        recipientEmail, recipientName || '', 'it', nowIso, '', 'Adottante Regalo',
        '', '', '',
        line1, line2, city, postal, country
      ];
      await appendRow('Archivio contatti', newRow);
    } else {
      const toUpd = arch[foundIdx];
      toUpd[emailIdxA] = recipientEmail;
      if (u1 !== -1) toUpd[u1] = line1;
      if (u2 !== -1) toUpd[u2] = line2;
      if (uc !== -1) toUpd[uc] = city;
      if (up !== -1) toUpd[up] = postal;
      if (un !== -1) toUpd[un] = country;
      await updateRow('Archivio contatti', foundIdx + 1, toUpd);
    }

    // 4) Brevo: upsert contatto (nessuna lista automatica)
    try {
      await brevo.post('/contacts', {
        email: recipientEmail,
        attributes: { NOME: recipientName || '', SOURCE: 'ClaimGift' },
        updateEnabled: true
      });
    } catch (e) {
      console.warn('Brevo upsert recipient warn', e.response?.data || e.message);
    }

    // 5) Log su “Storico cambi email” (tracciabilità claim)
    await appendRow('Storico cambi email', [
      new Date().toISOString(), 'CLAIM_GIFT', buyerEmail, recipientEmail, (sid || 'Club')
    ]);

    // 6) Email: conferma al ricevente + notifica interna
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit`;

    await sendEmail({
      to: recipientEmail,
      subject: 'Gift claimed — Adopt Your Olive',
      html: `
        <p>Hi ${recipientName || ''},</p>
        <p>We linked the gifted adoption to your email <strong>${recipientEmail}</strong>.</p>
        <p>Shipping address on file:</p>
        <p>${line1}${line2 ? ('<br>' + line2) : ''}<br>${postal} ${city}, ${country}</p>
        <p>If something is wrong, just reply to this email.</p>
        <p>— Adopt Your Olive</p>
      `
    });

    await sendEmail({
      to: process.env.INFO_EMAIL,
      subject: 'AYO • Gift claim recorded',
      html: `
        <p><strong>Gift claim</strong> (APPLICATO)</p>
        <p>Buyer: ${buyerEmail}<br>
           Recipient: ${recipientEmail} (${recipientName || '-'})<br>
           SID: ${sid || '-'}</p>
        <p>Address:<br>
           ${line1}${line2 ? ('<br>' + line2) : ''}<br>${postal} ${city}, ${country}</p>
        <p>Sheet: <a href="${sheetUrl}" target="_blank" rel="noopener">open Google Sheet</a></p>
      `
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'updated' }) };
  } catch (e) {
    console.error('club-claim-gift ERR', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

// ---------- helper: log pending + notifica ----------
async function logPendingClaim({ buyerEmail, recipientEmail, recipientName, sid, line1, line2, city, postal, country, reason }) {
  const detail = `${reason}|SID=${sid || ''}|NAME=${recipientName || ''}|ADDR=${line1} ${line2}, ${postal} ${city}, ${country}`;
  await appendRow('Storico cambi email', [
    new Date().toISOString(), 'CLAIM_GIFT_PENDING', buyerEmail, recipientEmail, detail
  ]);

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GSHEET_ID}/edit`;

  // mail a info@
  await sendEmail({
    to: process.env.INFO_EMAIL,
    subject: 'AYO • Gift claim PENDING (manual pairing)',
    html: `
      <p><strong>Gift claim</strong> (IN ATTESA • ${reason})</p>
      <p>Buyer: ${buyerEmail}<br>
         Recipient: ${recipientEmail} (${recipientName || '-'})<br>
         SID: ${sid || '-'}</p>
      <p>Address:<br>
         ${line1}${line2 ? ('<br>' + line2) : ''}<br>${postal} ${city}, ${country}</p>
      <p>Sheet: <a href="${sheetUrl}" target="_blank" rel="noopener">open Google Sheet</a></p>
    `
  });

  // mail al ricevente (ricezione richiesta)
  await sendEmail({
    to: recipientEmail,
    subject: 'We received your gift claim — Adopt Your Olive',
    html: `
      <p>Hi ${recipientName || ''},</p>
      <p>We received your request to link the gifted adoption to your email <strong>${recipientEmail}</strong>.</p>
      <p>We’ll finalize it shortly and confirm back. If something is wrong, just reply to this email.</p>
      <p>— Adopt Your Olive</p>
    `
  });
}

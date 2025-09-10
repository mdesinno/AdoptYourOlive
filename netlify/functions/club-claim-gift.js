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

// ---------- Brevo: simple email ----------
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
    const { buyerEmail = '', recipientEmail = '', recipientName = '', sid = '' } = JSON.parse(event.body || '{}');
    if (!buyerEmail || !recipientEmail) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parametri mancanti' }) };
    }

    // 1) Trova l'ordine REGALO da aggiornare
    const rows = await readAll('Storico ordini');
    if (rows.length < 2) return { statusCode: 404, body: JSON.stringify({ error: 'Nessun ordine' }) };

    const header = rows[0];
    const idIdx     = header.findIndex(h => (h || '').toLowerCase().includes('id ordine'));
    const buyerIdx  = header.findIndex(h => (h || '').toLowerCase().includes('email acquirente'));
    const adoptIdx  = header.findIndex(h => (h || '').toLowerCase().includes('email adottante'));
    const nameAdIdx = header.findIndex(h => (h || '').toLowerCase().includes('nome adottante'));
    const giftIdx   = header.findIndex(h => (h || '').toLowerCase().includes('regalo'));
    const dateIdx   = header.findIndex(h => (h || '').toLowerCase().includes('data ordine'));

    let targetIndex = -1;

    // Se c'è un SID specifico, prova match diretto
    if (sid && idIdx !== -1) {
      targetIndex = rows.findIndex((r, i) => i > 0 && (r[idIdx] || '').trim() === sid.trim());
    }

    // Altrimenti, prendi il più recente con Regalo = sì, buyer = buyerEmail,
    // e "Email adottante" vuota o uguale all'acquirente (non ancora rivendicato)
    if (targetIndex === -1) {
      const candidates = rows
        .map((r, i) => ({ r, i }))
        .filter(x =>
          x.i > 0 &&
          (x.r[giftIdx] || '').toString().trim().toLowerCase().startsWith('s') &&
          (x.r[buyerIdx] || '').trim().toLowerCase() === buyerEmail.toLowerCase() &&
          (
            (x.r[adoptIdx] || '').trim() === '' ||
            (x.r[adoptIdx] || '').trim().toLowerCase() === buyerEmail.toLowerCase()
          )
        )
        .sort((a, b) => {
          const da = Date.parse(a.r[dateIdx] || '') || 0;
          const db = Date.parse(b.r[dateIdx] || '') || 0;
          return db - da; // più recente primo
        });

      if (candidates.length) targetIndex = candidates[0].i;
    }

    if (targetIndex === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Ordine regalo non trovato' }) };
    }

    // 2) Aggiorna riga ordine con l'email (e nome) del ricevente
    const orderRow = rows[targetIndex];
    if (adoptIdx !== -1) orderRow[adoptIdx] = recipientEmail;
    if (nameAdIdx !== -1) orderRow[nameAdIdx] = recipientName || orderRow[nameAdIdx] || '';
    await updateRow('Storico ordini', targetIndex + 1, orderRow);

    // 3) Upsert Archivio contatti per il destinatario
    const arch = await readAll('Archivio contatti');
    const archHeader = arch[0] || [
      'Email', 'Nome completo', 'Lingua', 'Data primo contatto', 'Data ultimo ordine', 'Ruolo ultimo ordine',
      'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
      'Stato adozione personale', 'Data scadenza adozione personale',
      'Ultimo indirizzo spedizione conosciuto 1', 'Ultimo indirizzo spedizione conosciuto 2',
      'Ultima città spedizione conosciuta', 'Ultimo CAP spedizione conosciuto', 'Ultima nazione spedizione conosciuta'
    ];
    const emailIdxA = archHeader.findIndex(h => (h || '').toLowerCase().includes('email'));

    let foundIdx = -1;
    if (arch.length > 1 && emailIdxA !== -1) {
      foundIdx = arch.findIndex((r, i) => i > 0 && (r[emailIdxA] || '').trim().toLowerCase() === recipientEmail.toLowerCase());
    }

    const nowIso = new Date().toISOString();
    if (foundIdx === -1) {
      const newRow = [
        recipientEmail,
        recipientName || '',
        'it',
        nowIso,
        '',
        'Adottante Regalo',
        '', '', '', '', '', '', '', ''
      ];
      await appendRow('Archivio contatti', newRow);
    } else {
      const toUpd = arch[foundIdx];
      toUpd[emailIdxA] = recipientEmail; // no-op, ma garantisce coerenza
      await updateRow('Archivio contatti', foundIdx + 1, toUpd);
    }

    // 4) Brevo upsert (senza liste automatiche)
    await brevo.post('/contacts', {
      email: recipientEmail,
      attributes: { NOME: recipientName || '' },
      updateEnabled: true
    }).catch(() => {});

    // 5) Log su "Storico cambi email" (vecchia = acquirente; nuova = ricevente)
    await appendRow('Storico cambi email', [
      new Date().toISOString(),
      'CLAIM_GIFT',
      buyerEmail,
      recipientEmail,
      sid || 'Club'
    ]);

    // 6) Email conferma al ricevente + notifica interna
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

const { google } = require('googleapis');
const axios = require('axios');

async function getSheets(){
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
    (process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  return google.sheets({version:'v4', auth: jwt});
}
async function readAll(sheet){ 
  const s=await getSheets(); 
  const r=await s.spreadsheets.values.get({ spreadsheetId:process.env.SHEET_ID, range:`${sheet}!A:Z`});
  return r.data.values||[];
}
async function updateRow(sheet, rowIndex1, arr){
  const s=await getSheets();
  const cols = arr.length;
  const endCol = String.fromCharCode(64 + cols);
  await s.spreadsheets.values.update({
    spreadsheetId:process.env.SHEET_ID,
    range:`${sheet}!A${rowIndex1}:${endCol}${rowIndex1}`,
    valueInputOption:'USER_ENTERED',
    requestBody:{ values:[arr] }
  });
}
async function appendRow(sheet, arr){
  const s=await getSheets();
  await s.spreadsheets.values.append({
    spreadsheetId:process.env.SHEET_ID,
    range:`${sheet}!A:Z`,
    valueInputOption:'USER_ENTERED',
    requestBody:{ values:[arr] }
  });
}

const brevo = axios.create({
  baseURL:'https://api.brevo.com/v3',
  headers:{ 'api-key': process.env.BREVO_API_KEY, 'Content-Type':'application/json' }
});

exports.handler = async (event)=>{
  if(event.httpMethod!=='POST') return { statusCode:405, body:'Method Not Allowed' };
  try{
    const { buyerEmail, recipientEmail, recipientName = '', sid } = JSON.parse(event.body||'{}');
    if(!buyerEmail || !recipientEmail) return { statusCode:400, body: JSON.stringify({ error:'Parametri mancanti' })};

    // 1) Trova l'ordine regalo da aggiornare
    const rows = await readAll('Storico ordini');
    if(rows.length<2) return { statusCode:404, body: JSON.stringify({ error:'Nessun ordine' })};
    const header = rows[0];
    const idIdx     = header.findIndex(h => (h||'').toLowerCase().includes('id ordine'));
    const buyerIdx  = header.findIndex(h => (h||'').toLowerCase().includes('email acquirente'));
    const adoptIdx  = header.findIndex(h => (h||'').toLowerCase().includes('email adottante'));
    const nameAdIdx = header.findIndex(h => (h||'').toLowerCase().includes('nome adottante'));
    const giftIdx   = header.findIndex(h => (h||'').toLowerCase().includes('regalo'));
    const dateIdx   = header.findIndex(h => (h||'').toLowerCase().includes('data ordine'));

    let targetIndex = -1;

    if (sid && idIdx !== -1) {
      targetIndex = rows.findIndex((r,i)=> i>0 && (r[idIdx]||'').trim() === sid.trim());
    }

    if (targetIndex === -1) {
      // prendi il più recente: Regalo = sì, Email acquirente = buyerEmail, e Email adottante vuota O = buyerEmail
      const candidates = rows
        .map((r,i)=>({ r, i }))
        .filter(x => x.i>0 &&
          (x.r[giftIdx]||'').toString().trim().toLowerCase().startsWith('s') && // SI
          (x.r[buyerIdx]||'').trim().toLowerCase() === buyerEmail.toLowerCase() &&
          ((x.r[adoptIdx]||'').trim()==='' || (x.r[adoptIdx]||'').trim().toLowerCase()===buyerEmail.toLowerCase())
        )
        .sort((a,b)=> {
          const da = Date.parse(a.r[dateIdx]||'') || 0;
          const db = Date.parse(b.r[dateIdx]||'') || 0;
          return db - da; // più recente primo
        });
      if (candidates.length) targetIndex = candidates[0].i;
    }

    if (targetIndex === -1) {
      return { statusCode:404, body: JSON.stringify({ error:'Ordine regalo non trovato' })};
    }

    // 2) Aggiorna riga ordine
    const row = rows[targetIndex];
    if (adoptIdx !== -1) row[adoptIdx] = recipientEmail;
    if (nameAdIdx!== -1) row[nameAdIdx] = recipientName || row[nameAdIdx] || '';
    await updateRow('Storico ordini', targetIndex+1, row);

    // 3) Upsert Archivio contatti per il destinatario
    const arch = await readAll('Archivio contatti');
    const archHeader = arch[0] || [
      'Email','Nome completo','Lingua','Data primo contatto','Data ultimo ordine','Ruolo ultimo ordine',
      'Numero ordini effettuati (colonna calcolata tramite arrayformula)',
      'Stato adozione personale','Data scadenza adozione personale',
      'Ultimo indirizzo spedizione conosciuto 1','Ultimo indirizzo spedizione conosciuto 2',
      'Ultima città spedizione conosciuta','Ultimo CAP spedizione conosciuto','Ultima nazione spedizione conosciuta'
    ];
    const emailIdxA = archHeader.findIndex(h => (h||'').toLowerCase().includes('email'));
    let foundIdx = -1;
    if (arch.length>1 && emailIdxA !== -1) {
      foundIdx = arch.findIndex((r,i)=> i>0 && (r[emailIdxA]||'').trim().toLowerCase() === recipientEmail.toLowerCase());
    }
    const nowIso = new Date().toISOString();
    if (foundIdx === -1) {
      const newRow = [
        recipientEmail, recipientName || '', 'it', nowIso, '', 'Adottante Regalo',
        '', '', '', '', '', '', '', ''
      ];
      await appendRow('Archivio contatti', newRow);
    } else {
      const toUpd = arch[foundIdx];
      toUpd[emailIdxA] = recipientEmail;
      await updateRow('Archivio contatti', foundIdx+1, toUpd);
    }

    // 4) Brevo upsert (senza liste)
    await brevo.post('/contacts', {
      email: recipientEmail,
      attributes: { NOME: recipientName || '' },
      updateEnabled: true
    }).catch(e => console.warn('Brevo recipient upsert failed', e?.response?.data||e.message));

    // 5) Log
    await appendRow('Storico cambi email', [new Date().toISOString(), 'CLAIM_GIFT', buyerEmail, recipientEmail, (sid||'')]);

    return { statusCode:200, body: JSON.stringify({ ok:true }) };
  }catch(e){
    console.error('club-claim-gift ERR', e);
    return { statusCode:500, body: JSON.stringify({ error:'Server error' }) };
  }
};

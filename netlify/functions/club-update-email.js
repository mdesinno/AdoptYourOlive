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
    const { oldEmail, newEmail } = JSON.parse(event.body||'{}');
    if(!oldEmail || !newEmail) return { statusCode:400, body: JSON.stringify({ error:'Parametri mancanti' })};

    // 1) Archivio contatti: trova riga per oldEmail e sostituisci con newEmail
    const rows = await readAll('Archivio contatti');
    if(rows.length<1) return { statusCode:500, body: JSON.stringify({ error:'Archivio vuoto' })};
    const header = rows[0];
    const emailIdx = header.findIndex(h => (h||'').toLowerCase().includes('email'));
    const rowIdx = rows.findIndex((r,i)=> i>0 && (r[emailIdx]||'').trim().toLowerCase() === oldEmail.toLowerCase());
    if(rowIdx === -1) return { statusCode:404, body: JSON.stringify({ error:'Vecchia email non trovata' })};

    const row = rows[rowIdx];
    row[emailIdx] = newEmail;
    await updateRow('Archivio contatti', rowIdx+1, row);

    // 2) Log cambi
    await appendRow('Storico cambi email', [new Date().toISOString(), 'UPDATE_EMAIL', oldEmail, newEmail, 'Club']);

    // 3) Brevo: aggiorna email del contatto
    await brevo.put(`/contacts/${encodeURIComponent(oldEmail)}`, { email: newEmail })
      .catch(e => console.warn('Brevo update email failed', e?.response?.data||e.message));

    return { statusCode:200, body: JSON.stringify({ ok:true }) };
  }catch(e){
    console.error('club-update-email ERR', e);
    return { statusCode:500, body: JSON.stringify({ error:'Server error' }) };
  }
};

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// CONFIGURAZIONE NEWSLETTER (Indici base 0)
const NEWS_COL_EMAIL = 1; // Colonna B
const NEWS_COL_STATO = 3; // Colonna D (Stato_invio)

// CONFIGURAZIONE RUBRICA (Indici base 0)
const RUB_COL_EMAIL = 2;  // Colonna C
const RUB_COL_STATO = 8;  // Colonna I (Stato_iscrizione)

// UTILITY: Validazione Email
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// UTILITY: Pagina HTML di fallback
const htmlResponse = (title, message) => `
    <!DOCTYPE html>
    <html lang="it">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f5f5f5;margin:0}div{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center}h1{color:#333}p{color:#666}</style>
    </head>
    <body><div><h1>${title}</h1><p>${message}</p></div></body>
    </html>
`;

export const handler = async (event) => {
    let email = '';
    
    if (event.httpMethod === 'POST') {
        try {
            const data = JSON.parse(event.body);

            // CONTROLLO HONEYPOT
if (data.fax_number && data.fax_number.trim() !== "") {
    console.warn("🤖 Bot rilevato tramite Honeypot");
    // Rispondiamo con un 200 OK per far credere al bot di aver avuto successo, 
    // ma in realtà non facciamo nulla.
    return { 
        statusCode: 200, 
        body: JSON.stringify({ message: "Success (Honeypot skip)" }) 
    };
}
            email = data.email;
        } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }
    } else if (event.httpMethod === 'GET') {
        email = event.queryStringParameters?.email;
    } else {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const acceptsHtml = event.headers.accept && event.headers.accept.includes('text/html');

    if (!email || !isValidEmail(email)) {
        const msg = 'Email non valida o mancante.';
        return {
            statusCode: 400,
            headers: acceptsHtml ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json' },
            body: acceptsHtml ? htmlResponse('Errore', msg) : JSON.stringify({ error: msg })
        };
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decoded);
        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        // ==========================================
        // 1. GESTIONE TAB NEWSLETTER
        // ==========================================
        const sheetNews = doc.sheetsByTitle['Newsletter'];
        if (sheetNews) {
            await sheetNews.loadCells(`B2:B${sheetNews.rowCount}`);
            let foundInNews = false;
            for (let i = 1; i < sheetNews.rowCount; i++) {
                const cell = sheetNews.getCell(i, NEWS_COL_EMAIL);
                if (cell.value && cell.value.toString().trim().toLowerCase() === cleanEmail) {
                    // Carichiamo e modifichiamo la colonna D
                    await sheetNews.loadCells({
                        startRowIndex: i, endRowIndex: i + 1,
                        startColumnIndex: NEWS_COL_STATO, endColumnIndex: NEWS_COL_STATO + 1
                    });
                    const cellStato = sheetNews.getCell(i, NEWS_COL_STATO);
                    cellStato.value = 'DISISCRITTO';
                    await sheetNews.saveUpdatedCells();
                    foundInNews = true;
                    console.log(`✅ Newsletter: ${cleanEmail} disiscritto.`);
                    break;
                }
            }
            if (!foundInNews) console.log(`ℹ️ Newsletter: ${cleanEmail} non trovato.`);
        }

        // ==========================================
        // 2. GESTIONE TAB RUBRICA
        // ==========================================
        const sheetRub = doc.sheetsByTitle['Rubrica'];
        if (sheetRub) {
            await sheetRub.loadCells(`C2:C${sheetRub.rowCount}`);
            let foundInRub = false;
            for (let i = 1; i < sheetRub.rowCount; i++) {
                const cell = sheetRub.getCell(i, RUB_COL_EMAIL);
                if (cell.value && cell.value.toString().trim().toLowerCase() === cleanEmail) {
                    // Carichiamo e modifichiamo la colonna I
                    await sheetRub.loadCells({
                        startRowIndex: i, endRowIndex: i + 1,
                        startColumnIndex: RUB_COL_STATO, endColumnIndex: RUB_COL_STATO + 1
                    });
                    const cellStatoRub = sheetRub.getCell(i, RUB_COL_STATO);
                    cellStatoRub.value = 'DISISCRITTO';
                    await sheetRub.saveUpdatedCells();
                    foundInRub = true;
                    console.log(`✅ Rubrica: ${cleanEmail} disiscritto.`);
                    break;
                }
            }
            if (!foundInRub) console.log(`ℹ️ Rubrica: ${cleanEmail} non trovato.`);
        }

        // 3. RISPOSTA
        if (acceptsHtml) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/html' },
                body: htmlResponse('Disiscrizione Confermata', `L'indirizzo <strong>${cleanEmail}</strong> è stato rimosso con successo.`)
            };
        } else {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'OK', success: true })
            };
        }

    } catch (error) {
        console.error("❌ Errore Unsubscribe:", error);
        const msg = 'Errore interno del server durante la disiscrizione.';
        return {
            statusCode: 500,
            headers: acceptsHtml ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json' },
            body: acceptsHtml ? htmlResponse('Errore', msg) : JSON.stringify({ error: msg })
        };
    }
};
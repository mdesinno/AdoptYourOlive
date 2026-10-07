/* netlify/functions/unsubscribe-v2.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const htmlResponse = (title, message) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #fdfaf6; margin: 0; }
            div { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; max-width: 450px; border: 1px solid #eee; }
            h1 { color: #2c5e2e; margin-top: 0; font-size: 24px; }
            p { color: #555; font-size: 15px; line-height: 1.5; }
        </style>
    </head>
    <body>
        <div>
            <h1>${title}</h1>
            <p>${message}</p>
        </div>
    </body>
    </html>
`;

export const handler = async (event) => {
    let email = '';
    
    if (event.httpMethod === 'POST') {
        try {
            const data = JSON.parse(event.body);
            if (data.fax_number && data.fax_number.trim() !== "") {
                return { statusCode: 200, body: JSON.stringify({ message: "Success (Honeypot skip)" }) };
            }
            email = data.email;
        } catch (e) { 
            return { statusCode: 400, body: 'Invalid JSON' }; 
        }
    } else if (event.httpMethod === 'GET') {
        email = event.queryStringParameters?.email;
    } else {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const acceptsHtml = event.headers.accept && event.headers.accept.includes('text/html');

    if (!email || !isValidEmail(email)) {
        const msg = 'Invalid or missing email address.';
        return {
            statusCode: 400,
            headers: acceptsHtml ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json' },
            body: acceptsHtml ? htmlResponse('Error', msg) : JSON.stringify({ error: msg })
        };
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decoded);
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        // 1. Scrive esclusivamente nella tab Rubrica (Registro Centrale)
        // Scrive la disiscrizione e aggiorna la data evento
const sheetRubrica = doc.sheetsByTitle['Rubrica'];
if (sheetRubrica) {
    const rows = await sheetRubrica.getRows();
    const todayStr = new Date().toISOString().split('T')[0];
    for (const row of rows) {
        const rowEmail = (row.get('Email') || '').trim().toLowerCase();
        if (rowEmail === cleanEmail) {
            row.set('GDPR', 'DISISCRITTO');
            row.set('Data acquisizione', todayStr);
            await row.save();
            break;
        }
    }
}
        
        if (acceptsHtml) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/html' },
                body: htmlResponse(
                    'Unsubscribed / Disiscrizione Confermata', 
                    `The address <strong>${cleanEmail}</strong> has been successfully unsubscribed from our updates.`
                )
            };
        } else {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'OK', success: true })
            };
        }

    } catch (error) {
        console.error("❌ Errore Unsubscribe V2:", error);
        const msg = 'Internal error during unsubscribe process.';
        return {
            statusCode: 500,
            headers: acceptsHtml ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json' },
            body: acceptsHtml ? htmlResponse('Error', msg) : JSON.stringify({ error: msg })
        };
    }
};
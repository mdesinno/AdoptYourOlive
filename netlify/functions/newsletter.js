import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const data = JSON.parse(event.body); // Usiamo 'data' per coerenza con le altre funzioni

        // CONTROLLO HONEYPOT
        if (data.fax_number && data.fax_number.trim() !== "") {
            console.warn("🤖 Bot rilevato tramite Honeypot");
            return { 
                statusCode: 200, 
                body: JSON.stringify({ success: true }) // Risposta neutra
            };
        }

        // 1. Estrazione (usando data invece di body)
        const email = data.email?.trim().toLowerCase();
        const privacy = data.privacy;
        const lang = data.lang || 'en';
        const rawName = data.firstName || data.name || data.nome || ''; 
        const rawSurname = data.lastName || data.cognome || data.surname || '';
        
        // ... resto del codice
        
        if (!email || !privacy) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email e Privacy obbligatorie.' }) };
        }

        // 2. Setup Data
        const romeDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const todayISO = romeDate.toISOString().split('T')[0];

        // 3. Connessione Sheet
        const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decodedCreds);
        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        // LOG SU FOGLIO "NEWSLETTER"
        try {
            const logSheet = doc.sheetsByTitle['Newsletter'];
            if (logSheet) {
                await logSheet.addRow({
                    Data: romeDate.toLocaleString('sv-SE'),
                    Email: email,
                    Nome: (rawName + ' ' + rawSurname).trim(),
                    Lingua: lang
                });
            }
        } catch (e) { console.error('Sheet Log Error:', e); }

        // --- RESEND (SEMPLIFICATO) ---
        if (process.env.RESEND_AUDIENCE_ID) {
            try {
                await resend.contacts.create({
                    email: email,
                    audienceId: process.env.RESEND_AUDIENCE_ID,
                    firstName: rawName || undefined,
                    lastName: rawSurname || undefined,
                    unsubscribed: false
                    // NESSUNA property extra: usiamo Sheet come database
                });
                console.log('✅ Contatto Resend assicurato.');
            } catch (e) {
                // Se esiste già, ignoriamo l'errore.
                console.log('ℹ️ Resend skip:', e.message);
            }
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('❌ ERRORE:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
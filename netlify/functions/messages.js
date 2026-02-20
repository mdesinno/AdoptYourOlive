import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const normalizeLang = (l) => (l && l.toLowerCase().startsWith('it')) ? 'it' : 'en';
const escapeHtml = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

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

        if (!data.name || !data.message) return { statusCode: 400, body: JSON.stringify({ error: 'Dati mancanti' }) };
        if (!data.email || !isValidEmail(data.email)) return { statusCode: 400, body: JSON.stringify({ error: 'Email non valida' }) };

        const lang = normalizeLang(data.lang);
        const safeName = escapeHtml(data.name.trim());
        const safeEmail = data.email.trim().toLowerCase();
        const safeMessage = escapeHtml(data.message.trim());
        
        const romeDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const todayISO = romeDate.toISOString().split('T')[0];

        // Connessione Sheet
        const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decodedCreds);
        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        // LOG SU FOGLIO "MESSAGGI"
        try {
            const logSheet = doc.sheetsByTitle['Messaggi'];
            if (logSheet) {
                await logSheet.addRow({
                    Data: romeDate.toLocaleString('sv-SE'),
                    Nome: safeName,
                    Email: safeEmail,
                    Lingua: lang,
                    Messaggio: safeMessage
                });
            }
        } catch (e) { console.error('Sheet Log Error:', e); }

        // EMAIL ADMIN
        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: process.env.EMAIL_ADMIN,
                replyTo: safeEmail, // <--- Modificato da reply_to a replyTo
                subject: `💬 Nuovo Messaggio: ${safeName}`,
                html: `
    <p> Hai ricevuto un nuovo messaggio dal sito:</p>
    <hr>
    <p><strong>Nome:</strong> ${safeName}</p>
    <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
    <p><strong>Messaggio:</strong></p>
    <p style="background: #f4f4f4; padding: 10px; border-radius: 5px;">${safeMessage}</p>
`
            });
        } catch (e) { console.error('Email Admin Error:', e); }

        // RESEND CONTATTI (SEMPLIFICATO)
        if (process.env.RESEND_AUDIENCE_ID) {
            try {
                // Divisione Nome
                const parts = safeName.split(' ');
                const fName = parts[0];
                const lName = parts.slice(1).join(' ');

                await resend.contacts.create({
                    email: safeEmail,
                    audienceId: process.env.RESEND_AUDIENCE_ID,
                    firstName: fName,
                    lastName: lName,
                    unsubscribed: false
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
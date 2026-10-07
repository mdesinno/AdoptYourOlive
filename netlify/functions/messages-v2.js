/* netlify/functions/messages-v2.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const normalizeLang = (l) => (l && l.toLowerCase().startsWith('it')) ? 'it' : 'en';
const escapeHtml = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const data = JSON.parse(event.body);

        // Controllo Honeypot
        if (data.fax_number && data.fax_number.trim() !== "") {
            return { statusCode: 200, body: JSON.stringify({ message: "Success (Honeypot skip)" }) };
        }

        if (!data.name || !data.message) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Dati mancanti' }) };
        }
        if (!data.email || !isValidEmail(data.email)) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email non valida' }) };
        }

        const lang = normalizeLang(data.lang);
        const safeName = escapeHtml(data.name.trim());
        const safeEmail = data.email.trim().toLowerCase();
        const safeMessage = escapeHtml(data.message.trim());
        const marketingConsent = data.marketingConsent === true || data.marketingConsent === 'yes';

        // 1. Registrazione su Google Sheet (Tab 'Messaggi')
        try {
            const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
            const creds = JSON.parse(decodedCreds);
            const auth = new JWT({
                email: creds.client_email,
                key: creds.private_key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
            await doc.loadInfo();

            const logSheet = doc.sheetsByTitle['Messaggi'];
            if (logSheet) {
                await logSheet.addRow({
                    'Data': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                    'Nome': safeName,
                    'Email': safeEmail,
                    'Lingua': lang,
                    'Messaggio': safeMessage,
                    'GDPR': marketingConsent ? 'ISCRITTO' : 'SOLO CONTATTO'
                });
            }
        } catch (sheetErr) {
            console.error('⚠️ Sheet Log Error:', sheetErr.message);
        }

        // 2. Invio notifica email all'Admin
        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: process.env.EMAIL_ADMIN,
                replyTo: safeEmail,
                subject: `📬 Nuovo Messaggio dal Sito: ${safeName}`,
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
                        <h2 style="color: #2c5e2e;">Nuovo messaggio ricevuto</h2>
                        <p><strong>Nome:</strong> ${safeName}</p>
                        <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
                        <p><strong>Lingua:</strong> ${lang}</p>
                        <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            ${safeMessage}
                        </div>
                        <p style="font-size: 11px; color: #888;">Consenso Marketing: ${marketingConsent ? '🟢 ISCRITTO' : '🔴 SOLO CONTATTO'}</p>
                    </div>
                `
            });
        } catch (emailErr) {
            console.error('❌ Email Admin Error:', emailErr.message);
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('❌ Errore messages-v2:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
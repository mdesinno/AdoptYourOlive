/* netlify/functions/newsletter-v2.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const appendUnsubscribeFooter = (htmlContent, recipientEmail) => {
    const unsubLink = `https://adoptyourolive.com/unsubscribe.html?email=${encodeURIComponent(recipientEmail)}`;
    return htmlContent + `
        <hr style="border:0; border-top:1px solid #eee; margin-top:30px;">
        <p style="font-size:11px; color:#999; text-align:center;">
            Adopt Your Olive<br>
            <a href="${unsubLink}" style="color:#999;">Unsubscribe / Cancellami</a>
        </p>`;
};

function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const data = JSON.parse(event.body);

        // Controllo Honeypot
        if (data.fax_number && data.fax_number.trim() !== "") {
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }

        const email = data.email?.trim().toLowerCase();
        const privacy = data.privacy;
        const lang = (data.lang && data.lang.toLowerCase().startsWith('it')) ? 'it' : 'en';
        
        if (!email || !isValidEmail(email) || !privacy) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email valida e consenso Privacy obbligatori.' }) };
        }

        // 1. Log su Foglio 'Newsletter'
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

            const logSheet = doc.sheetsByTitle['Newsletter'];
            if (logSheet) {
                await logSheet.addRow({
                    'Data': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                    'Email': email,
                    'Lingua': lang,
                    'GDPR': 'ISCRITTO'
                });
            }
        } catch (sheetErr) {
            console.error('⚠️ Sheet Newsletter Error:', sheetErr.message);
        }

        // 2. Invio Email Automatica di Benvenuto con Codice Sconto
        try {
            const isIt = (lang === 'it');
            const subject = isIt 
                ? 'Benvenuto in famiglia! Ecco il tuo codice sconto 🫒' 
                : 'Welcome to the family! Here is your discount code 🫒';

            const htmlContent = isIt ? `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
                    <h2 style="color: #2c5e2e;">Benvenuto nella community di Adopt Your Olive!</h2>
                    <p>Siamo felici di averti a bordo. Come promesso, ecco il tuo codice sconto esclusivo del <strong>10%</strong> da utilizzare sulla tua prima adozione:</p>
                    <div style="background: #fdf6e3; border: 2px dashed #b58900; padding: 18px; text-align: center; font-size: 26px; font-weight: bold; color: #b58900; margin: 25px 0; border-radius: 6px;">
                        WELCOME10
                    </div>
                    <p>Inserisci questo codice direttamente al checkout per applicare lo sconto.</p>
                    <p>A presto,<br><em>Michele & la Famiglia de Sinno</em></p>
                </div>
            ` : `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
                    <h2 style="color: #2c5e2e;">Welcome to the Adopt Your Olive family!</h2>
                    <p>We are thrilled to have you with us. As promised, here is your exclusive <strong>10% discount code</strong> for your tree adoption:</p>
                    <div style="background: #fdf6e3; border: 2px dashed #b58900; padding: 18px; text-align: center; font-size: 26px; font-weight: bold; color: #b58900; margin: 25px 0; border-radius: 6px;">
                        WELCOME10
                    </div>
                    <p>Enter this code directly at checkout to apply your discount.</p>
                    <p>Best regards,<br><em>Michele & the de Sinno Family</em></p>
                </div>
            `;

            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: email,
                subject: subject,
                html: appendUnsubscribeFooter(htmlContent, email)
            });
        } catch (emailErr) {
            console.error('❌ Errore invio email benvenuto:', emailErr.message);
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('❌ Errore newsletter-v2:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
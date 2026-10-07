/* netlify/functions/send-guide-v2.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';

const resend = new Resend(process.env.RESEND_API_KEY);

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const appendUnsubscribeFooter = (htmlContent, recipientEmail) => {
    const unsubLink = `https://adoptyourolive.com/unsubscribe.html?email=${encodeURIComponent(recipientEmail)}`;
    return htmlContent + `
        <hr style="border:0; border-top:1px solid #eee; margin-top:30px;">
        <p style="font-size:11px; color:#999; text-align:center;">
            Adopt Your Olive<br>
            <a href="${unsubLink}" style="color:#999;">Unsubscribe / Cancellami</a>
        </p>`;
};

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

        const inputID = (data.memberId || '').trim().toUpperCase();
        const inputEmail = (data.email || '').trim().toLowerCase();
        const isIt = (data.lang || 'en').toLowerCase().startsWith('it');

        if (!inputEmail || !isValidEmail(inputEmail)) {
            return { statusCode: 400, body: JSON.stringify({ error: isIt ? 'Email non valida' : 'Invalid email address' }) };
        }
        if (!inputID) {
            return { statusCode: 400, body: JSON.stringify({ error: isIt ? 'Member ID richiesto' : 'Member ID required' }) };
        }

        // 1. Carica il PDF locale della Guida
        const guidePath = path.resolve(process.cwd(), 'netlify/functions/assets/AYO-Tasting-guide.pdf');

        let attachments = [];
        if (fs.existsSync(guidePath)) {
            attachments.push({
                filename: 'AYO-Tasting-guide.pdf',
                content: fs.readFileSync(guidePath)
            });
        } else {
            console.warn(`⚠️ File non trovato in: ${guidePath}`);
        }

        // 2. Connessione a Google Sheets e ricerca riga Ordine
        const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decodedCreds);
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        const sheet = doc.sheetsByTitle['Ordini'];
        if (!sheet) throw new Error("Tab 'Ordini' non trovata");

        const rows = await sheet.getRows();
        const row = rows.find(r => (r.get('Member ID') || '').trim().toUpperCase() === inputID);

        if (!row) {
            return { 
                statusCode: 404, 
                body: JSON.stringify({ 
                    error: isIt ? 'Member ID non trovato nei nostri archivi.' : 'Member ID not found in our records.' 
                }) 
            };
        }

        // 3. Invio Email con il PDF allegato
        const subject = isIt 
            ? "Ecco la tua Guida alla Degustazione 🌿 Adopt Your Olive" 
            : "Your EVOO Tasting Masterclass Guide 🌿 Adopt Your Olive";

        const htmlContent = isIt ? `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6; padding: 20px; margin: 0 auto;">
                <h1 style="color: #2c5e2e;">Adopt Your Olive Club</h1>
                <p>Ciao,</p>
                <p>Grazie per aver verificato il tuo certificato (Member ID: <strong>${inputID}</strong>).</p>
                <p>In allegato a questa email trovi la tua guida ufficiale: <strong>Masterclass sulla Degustazione dell'Olio Extra Vergine</strong> in formato PDF.</p>
                <div style="background: #fdf6e3; padding: 15px; border-left: 4px solid #b58900; margin: 20px 0;">
                    <p style="margin: 0;">📎 <strong>Documento allegato:</strong> Trovi il file PDF pronto da scaricare e consultare in fondo a questa email.</p>
                </div>
                <p>Buona degustazione e benvenuto nella nostra famiglia!<br><br>Dalla Puglia,<br><em>Michele & Team Adopt Your Olive</em></p>
            </div>
        ` : `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6; padding: 20px; margin: 0 auto;">
                <h1 style="color: #2c5e2e;">Adopt Your Olive Club</h1>
                <p>Hi,</p>
                <p>Thank you for verifying your certificate (Member ID: <strong>${inputID}</strong>).</p>
                <p>Attached to this email, you will find your official <strong>EVOO Tasting Masterclass Guide</strong> in PDF format.</p>
                <div style="background: #fdf6e3; padding: 15px; border-left: 4px solid #b58900; margin: 20px 0;">
                    <p style="margin: 0;">📎 <strong>Attached Document:</strong> The PDF file is ready to view and download at the bottom of this email.</p>
                </div>
                <p>Enjoy your tasting journey and welcome to our family!<br><br>From Puglia,<br><em>Michele & Adopt Your Olive Team</em></p>
            </div>
        `;

        await resend.emails.send({
            from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
            to: inputEmail,
            subject: subject,
            attachments: attachments,
            html: appendUnsubscribeFooter(htmlContent, inputEmail)
        });

        // 4. Aggiornamento della colonna 'Risorse Scaricate'
        try {
            const currentLog = (row.get('Risorse Scaricate') || '').trim();
            const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' });
            const newEntry = `Guida PDF [${inputEmail}] (${timestamp})`;
            
            const updatedLog = currentLog ? `${currentLog}, ${newEntry}` : newEntry;
            row.set('Risorse Scaricate', updatedLog);
            await row.save();
        } catch (sheetErr) {
            console.error("⚠️ Errore aggiornamento log Risorse Scaricate:", sheetErr.message);
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ success: true, message: "Guide sent successfully" }) 
        };

    } catch (error) {
        console.error('❌ Errore Send-Guide:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
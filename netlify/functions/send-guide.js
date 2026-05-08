import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function isValidEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

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
        const inputID = data.memberId ? data.memberId.trim().toUpperCase() : '';
        const inputEmail = data.email ? data.email.trim().toLowerCase() : '';
        const lang = data.lang || 'it'; // <--- TIENILA QUI
        
        // 1. Validazione Input
        if (!inputEmail || !isValidEmail(inputEmail)) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email non valida' }) };
        }
        if (!inputID) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Member ID richiesto' }) };
        }

        // --- 2. AGGIORNAMENTO GOOGLE SHEET (Tab Ordini) ---
        let sheetUpdated = false;
        try {
            const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
            const creds = JSON.parse(decodedCreds);
            const serviceAccountAuth = new JWT({
                email: creds.client_email,
                key: creds.private_key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
            await doc.loadInfo();
            const sheet = doc.sheetsByTitle['Ordini']; 
            if (sheet) {
                const rows = await sheet.getRows();
                const row = rows.find(r => {
                    const cellValue = r.get('Member ID') || r['Member ID'];
const sheetID = cellValue ? String(cellValue).trim().toUpperCase() : '';
return sheetID === inputID;
                });
                if (row) {
                    row.set('Email Ricevente', inputEmail);
                    await row.save();
                    sheetUpdated = true;
                    console.log(`✅ Sheet aggiornato per ID ${inputID}`); // Tienilo!
                } else {
                    console.warn(`⚠️ ID ${inputID} non trovato nel foglio Ordini.`); // Tienilo!
                    // NUOVO: Invia email di alert a te stesso
    await resend.emails.send({
        from: `Alert System <${process.env.EMAIL_MITTENTE}>`,
        to: process.env.EMAIL_MITTENTE, // O la tua email personale
        subject: `⚠️ ERRORE GOOGLE SHEET: ID ${inputID} non trovato`,
        html: `<p>L'utente con email <strong>${inputEmail}</strong> ha cercato di scaricare la guida con ID <strong>${inputID}</strong>, ma l'ID non è stato trovato nel foglio Ordini.</p>`
    });
                }
            }
        } catch (sheetError) {
            console.error('❌ Errore Google Sheet:', sheetError.message);
        }

        // --- 3. AGGIUNTA A RESEND AUDIENCE ---
        if (process.env.RESEND_AUDIENCE_ID) {
            try {
                await resend.contacts.create({
                    email: inputEmail,
                    audienceId: process.env.RESEND_AUDIENCE_ID,
                    firstName: "Member",
                    lastName: inputID,
                    unsubscribed: false
                });
            } catch (e) { console.log('ℹ️ Resend Contact Skip:', e.message); }
        }

       /* // === 4. CONFIGURAZIONE LINK TRACCIATI E INVIO ===
        const TRACK_URL = "https://adoptyourolive.com/.netlify/functions/track";
        const isIt = (lang === 'it');
        
        // 1. Generiamo un solo link dinamico in base alla lingua dell'utente
        const linkGuida = isIt 
            ? `${TRACK_URL}?dest=guida_it&email=${encodeURIComponent(inputEmail)}&lang=it`
            : `${TRACK_URL}?dest=guida_en&email=${encodeURIComponent(inputEmail)}&lang=en`;

        const subject = isIt ? "La tua Guida Esclusiva 🌿 Adopt Your Olive" : "Your Exclusive Guide 🌿 Adopt Your Olive";
        const btnStyle = "background-color: #2c5e2e; color: white; padding: 14px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; display: inline-block; margin: 20px 0;";

        const htmlContent = isIt ? `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6; border: 1px solid #eee; padding: 20px; margin: 0 auto;">
                <h1 style="color: #2c5e2e; text-align: center;">Adopt Your Olive Club</h1>
                <p>Ciao,</p>
                <p>Grazie per aver confermato il tuo certificato (ID: <strong>${inputID}</strong>). Benvenuto ufficialmente nel club! 🌿</p>
                <p>Clicca sul pulsante qui sotto per scaricare la tua <strong>Masterclass sulla Degustazione dell'Olio</strong> in formato PDF.</p>
                <div style="text-align: center;">
                    <a href="${linkGuida}" style="${btnStyle}">Scarica la Guida</a>
                </div>
                <hr style="border:0; border-top:1px solid #eee; margin:30px 0;">
                <p style="font-size: 11px; color: #999; text-align: center;">
                    Ricevi questa email perché hai registrato il tuo Member ID.<br>
                    Adopt Your Olive - Puglia, Italia
                </p>
            </div>
        ` : `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6; border: 1px solid #eee; padding: 20px; margin: 0 auto;">
                <h1 style="color: #2c5e2e; text-align: center;">Adopt Your Olive Club</h1>
                <p>Hi,</p>
                <p>Thank you for registering your certificate (ID: <strong>${inputID}</strong>). Welcome officially to the club! 🌿</p>
                <p>Click the button below to download your <strong>Olive Oil Tasting Masterclass</strong> in PDF format.</p>
                <div style="text-align: center;">
                    <a href="${linkGuida}" style="${btnStyle}">Download the Guide</a>
                </div>
                <hr style="border:0; border-top:1px solid #eee; margin:30px 0;">
                <p style="font-size: 11px; color: #999; text-align: center;">
                    You are receiving this because you registered your Member ID.<br>
                    Adopt Your Olive - Puglia, Italy
                </p>
            </div>
        `;
        // === FINE CONFIGURAZIONE LINK TRACCIATI E INVIO ===*/

        // === NUOVO CODICE TEMPORANEO: EMAIL "COMING SOON" ===
        const isIt = (lang === 'it');
        
        const subject = isIt ? "La tua Guida alla Degustazione 🌿 Adopt Your Olive" : "Your Tasting Guide 🌿 Adopt Your Olive";

        const htmlContent = isIt ? `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6; border: 1px solid #eee; padding: 20px;">
                <h1 style="color: #2c5e2e; text-align: center;">Adopt Your Olive Club</h1>
                <p>Ciao,</p>
                <p>Grazie per aver registrato il tuo certificato (ID: <strong>${inputID}</strong>) e aver richiesto la nostra Guida Ufficiale alla Degustazione! 🌿</p>
                <p>Stiamo ultimando una nuovissima versione della guida: non sarà un semplice foglio di istruzioni, ma una vera e propria <strong>Masterclass in PDF</strong> dedicata alla nostra preziosa oliva Peranzana.</p>
                <div style="background-color: #fdf6e3; padding: 20px; border-left: 4px solid #b58900; margin: 25px 0;">
                    <p style="margin: 0; font-weight: bold; color: #b58900;">Sei ufficialmente nella nostra lista prioritaria.</p>
                    <p style="margin: 5px 0 0 0;">Riceverai la guida direttamente in questa casella di posta non appena sarà pronta (questione di pochissimi giorni!).</p>
                </div>
                <p>A prestissimo,<br>
                <strong>Michele - Il Team di Adopt Your Olive</strong></p>
            </div>
        ` : `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6; border: 1px solid #eee; padding: 20px;">
                <h1 style="color: #2c5e2e; text-align: center;">Adopt Your Olive Club</h1>
                <p>Hi,</p>
                <p>Thank you for registering your certificate (ID: <strong>${inputID}</strong>) and requesting our Official Tasting Guide! 🌿</p>
                <p>We are currently putting the finishing touches on a brand new version. It won't be just a simple instruction sheet, but a real <strong>PDF Masterclass</strong> dedicated to our precious Peranzana olive.</p>
                <div style="background-color: #fdf6e3; padding: 20px; border-left: 4px solid #b58900; margin: 25px 0;">
                    <p style="margin: 0; font-weight: bold; color: #b58900;">You are officially on our priority list.</p>
                    <p style="margin: 5px 0 0 0;">You will receive the guide right here in your inbox as soon as it's ready (in just a few days!).</p>
                </div>
                <p>Talk soon,<br>
                <strong>Michele - The Adopt Your Olive Team</strong></p>
            </div>
        `;
        // === FINE NUOVO CODICE TEMPORANEO ===

        // INVIO EMAIL CON RESEND
        await resend.emails.send({
            from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
            to: inputEmail,
            subject: subject,
            html: htmlContent
        });

        // --- FINE MODIFICA ---

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'OK', sheetUpdated: sheetUpdated })
        };

    } catch (error) {
        console.error('❌ Errore Send-Guide:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
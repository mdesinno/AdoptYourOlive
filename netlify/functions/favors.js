/* netlify/functions/favors.js - VERSIONE CORRETTA */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// UTILITY: Normalizza lingua (come nel checkout)
function normalizeLang(rawLang) {
    if (!rawLang || typeof rawLang !== 'string') {
        return 'en';
    }
    const cleaned = rawLang.toLowerCase().trim();
    return cleaned.startsWith('it') ? 'it' : 'en';
}

// UTILITY: Sanitizza HTML per prevenire XSS
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// UTILITY: Valida email base
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

        // 🔧 FIX 1: VALIDAZIONE COMPLETA
        if (!data.name || data.name.trim() === '') {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: 'Nome obbligatorio' }) 
            };
        }

        if (!data.email || !isValidEmail(data.email)) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: 'Email non valida' }) 
            };
        }

        if (!data.event_type || data.event_type.trim() === '') {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: 'Tipo evento obbligatorio' }) 
            };
        }

        if (!data.quantity || isNaN(parseInt(data.quantity))) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: 'Quantità non valida' }) 
            };
        }

        // 🔧 FIX 2: Normalizza lingua
        const lang = normalizeLang(data.lang);

        // 🔧 FIX 3: Sanitizza input per prevenire XSS
        const safeName = escapeHtml(data.name.trim());
        const safeEmail = data.email.trim().toLowerCase();
        const safeEventType = escapeHtml(data.event_type.trim());
        const safeQuantity = parseInt(data.quantity);
        const safeMessage = escapeHtml(data.message || '');

        // --- 1. SALVATAGGIO SU GOOGLE SHEET ---
        try {
            const decodedCreds = Buffer.from(
                process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 
                'base64'
            ).toString('utf-8');
            const creds = JSON.parse(decodedCreds);
            
            const serviceAccountAuth = new JWT({
                email: creds.client_email,
                key: creds.private_key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            const doc = new GoogleSpreadsheet(
                process.env.GOOGLE_SHEET_ID, 
                serviceAccountAuth
            );
            await doc.loadInfo();

            const sheet = doc.sheetsByTitle['Favors'];
            
            if (!sheet) {
                console.warn("⚠️ Foglio 'Favors' non trovato");
            } else {
                await sheet.addRow({
                    Data: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                    Nome: safeName,
                    Email: safeEmail,
                    Lingua: lang,
                    Evento: safeEventType,
                    Qty: safeQuantity,
                    Note: safeMessage
                });
                console.log('✅ Richiesta salvata su Sheet');
            }
        } catch (sheetError) {
            console.error('❌ Errore Salvataggio Sheet:', sheetError);
            // Non blocchiamo il flusso
        }

        // --- 2. EMAIL ADMIN (SCHEDA LEAD) ---
        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: process.env.EMAIL_ADMIN,
                reply_to: safeEmail, 
                subject: `🎁 LEAD FAVORS: ${safeQuantity}pz - ${safeName} (${safeEventType})`,
                html: `
                    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; color: #333;">
                        <h2 style="background: #e6fffa; padding: 15px; border: 1px solid #2c5e2e; color: #2c5e2e; margin-top:0;">
                            🔔 Nuova Richiesta Preventivo
                        </h2>
                        
                        <div style="padding: 10px 0;">
                            <strong style="font-size: 18px;">${safeName}</strong><br>
                            <a href="mailto:${safeEmail}" style="color: #2c5e2e;">${safeEmail}</a>
                        </div>

                        <table style="width:100%; border-collapse: collapse; margin-top: 15px;">
                            <tr style="background-color: #f4f4f4;">
                                <td style="padding:10px; border-bottom:1px solid #ddd;"><strong>Tipo Evento:</strong></td>
                                <td style="padding:10px; border-bottom:1px solid #ddd;">${safeEventType}</td>
                            </tr>
                            <tr style="background-color: #fff;">
                                <td style="padding:10px; border-bottom:1px solid #ddd;"><strong>Quantità:</strong></td>
                                <td style="padding:10px; border-bottom:1px solid #ddd; font-weight:bold; color:#2c5e2e; font-size:16px;">${safeQuantity} pezzi</td>
                            </tr>
                            <tr style="background-color: #f4f4f4;">
                                <td style="padding:10px; border-bottom:1px solid #ddd;"><strong>Lingua:</strong></td>
                                <td style="padding:10px; border-bottom:1px solid #ddd;">${lang === 'it' ? '🇮🇹 Italiano' : '🇬🇧 English'}</td>
                            </tr>
                        </table>
                        
                        <div style="background:#fdf6e3; padding:15px; border: 1px dashed #b58900; border-radius: 4px; margin: 25px 0;">
                            <p style="margin:0 0 5px 0; font-weight:bold; color:#b58900; font-size:12px; text-transform:uppercase;">📝 Messaggio del Cliente:</p>
                            <p style="margin:0; font-style:italic;">"${safeMessage || 'Nessun messaggio aggiuntivo'}"</p>
                        </div>
                        
                        <div style="margin-top:30px; text-align:center;">
                            <a href="mailto:${safeEmail}?subject=Re:%20Preventivo%20Adopt%20Your%20Olive%20-%20${encodeURIComponent(safeEventType)}" 
                               style="display:inline-block; background:#2c5e2e; color:white; 
                                      padding:15px 30px; text-decoration:none; border-radius:50px; 
                                      font-weight:bold;">
                                ↩️ Rispondi al Cliente
                            </a>
                        </div>
                        
                        <p style="font-size: 11px; color: #999; text-align: center; margin-top: 20px;">
                            Form inviato dal sito web
                        </p>
                    </div>
                `
            });
            console.log('✅ Email admin inviata');
        } catch (emailAdminError) {
            console.error('❌ Errore invio email Admin:', emailAdminError);
        }

        // --- 3. AUTO-RISPOSTA CLIENTE (NEUTRA & ELEGANTE) ---
        const isIt = (lang === 'it');

        const emailContent = isIt ? {
            subj: "Richiesta ricevuta 🌿 Adopt Your Olive",
            html: `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6;">
                    <h1 style="color: #2c5e2e;">Ciao ${safeName},</h1>
                    <p>Grazie per aver pensato al nostro olio per il tuo prossimo evento! 🌿</p>
                    <p>Siamo felici di poter contribuire a renderlo unico con le nostre bomboniere gastronomiche.</p>
                    
                    <div style="background-color: #f4f4f4; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="margin-top:0; color:#2c5e2e;">Riepilogo Richiesta:</h3>
                        <p style="margin:5px 0;"><strong>Tipo Evento:</strong> ${safeEventType}</p>
                        <p style="margin:5px 0;"><strong>Quantità stimata:</strong> ${safeQuantity} pezzi</p>
                    </div>
                    
                    <p>Abbiamo preso in carico la tua richiesta. Il nostro team sta valutando la disponibilità e le opzioni di personalizzazione migliori per te.</p>
                    <p><strong>Ti invieremo un preventivo dettagliato entro 24-48 ore.</strong></p>
                    
                    <hr style="border:0; border-top:1px solid #eee; margin:30px 0;">
                    
                    <p>A presto,<br>
                    <strong>Il Team di Adopt Your Olive</strong></p>
                    
                    <p style="font-size:12px; color:#999; margin-top:30px;">
                        Puglia, Italia 🇮🇹
                    </p>
                </div>`
        } : {
            subj: "Request Received 🌿 Adopt Your Olive",
            html: `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6;">
                    <h1 style="color: #2c5e2e;">Hi ${safeName},</h1>
                    <p>Thank you for considering our olive oil for your upcoming event! 🌿</p>
                    <p>We are delighted to potentially contribute to making it unique with our favors.</p>
                    
                    <div style="background-color: #f4f4f4; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="margin-top:0; color:#2c5e2e;">Request Summary:</h3>
                        <p style="margin:5px 0;"><strong>Event Type:</strong> ${safeEventType}</p>
                        <p style="margin:5px 0;"><strong>Estimated Quantity:</strong> ${safeQuantity} pieces</p>
                    </div>
                    
                    <p>We have received your request. Our team is reviewing availability and the best customization options for you.</p>
                    <p><strong>We will get back to you with a detailed quote within 24-48 hours.</strong></p>
                    
                    <hr style="border:0; border-top:1px solid #eee; margin:30px 0;">
                    
                    <p>Talk soon,<br>
                    <strong>The Adopt Your Olive Team</strong></p>
                    
                    <p style="font-size:12px; color:#999; margin-top:30px;">
                        Puglia, Italy 🇮🇹
                    </p>
                </div>`
        };

        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: safeEmail,
                subject: emailContent.subj,
                html: emailContent.html
            });
            console.log('✅ Auto-risposta cliente inviata');
        } catch (emailClientError) {
            console.error('❌ Errore invio auto-risposta Cliente:', emailClientError);
        }

        // --- D. RESEND CONTATTI (CON PAUSA DI SICUREZZA) ---
        if (process.env.RESEND_AUDIENCE_ID) {
            try {
                // 🛑 RATE LIMIT FIX: Aspettiamo 1 secondo per non superare il limite di "2 req/sec" di Resend
                // (Avendo già inviato 2 email sopra, dobbiamo rallentare prima di creare il contatto)
                await new Promise(resolve => setTimeout(resolve, 1000));

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
                console.log('✅ Contatto Resend assicurato (dopo attesa).');

            } catch (e) {
                // Ignoriamo errori se esiste già
                console.log('ℹ️ Resend skip:', e.message);
            }
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: 'Richiesta inviata!', success: true }) 
        };

    } catch (error) {
        console.error('❌ Errore Favors Generale:', error);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: error.message }) 
        };
    }
};
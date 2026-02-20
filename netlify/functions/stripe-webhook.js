/* netlify/functions/stripe-webhook.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { PDFDocument, rgb } from 'pdf-lib'; // Per PDF
import fontkit from '@pdf-lib/fontkit';      // Per Font custom
import fs from 'fs';
import path from 'path';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// --- FUNZIONE GENERAZIONE PDF (Eseguita in memoria) ---
async function generaCertificatoPDF(nomeAdottante) {
    try {
        const pathToBase = path.resolve(__dirname, 'assets/certificato_base.png');
        const pathToFont = path.resolve(__dirname, 'assets/PlayfairDisplay-BoldItalic.ttf');
        
        const baseImageBytes = fs.readFileSync(pathToBase);
        const fontBytes = fs.readFileSync(pathToFont);

        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const customFont = await pdfDoc.embedFont(fontBytes);

        // Formato A4 Orizzontale in punti
        const page = pdfDoc.addPage([841.89, 595.28]); 
        const { width, height } = page.getSize();

        const embeddedImage = await pdfDoc.embedPng(baseImageBytes);
        page.drawImage(embeddedImage, { x: 0, y: 0, width, height });

        const fontSize = 42;
        const textWidth = customFont.widthOfTextAtSize(nomeAdottante, fontSize);
        
        // Nome Adottante centrato a 11.1cm dall'alto
        page.drawText(nomeAdottante, {
            x: (width - textWidth) / 2,
            y: 282, 
            size: fontSize,
            font: customFont,
            color: rgb(0, 0, 0),
        });

        return await pdfDoc.saveAsBase64();
    } catch (e) {
        console.error("❌ Errore Generazione PDF:", e);
        return null;
    }
}

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
        const payload = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;

        stripeEvent = stripe.webhooks.constructEvent(
            payload,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`⚠️ Webhook Error: ${err.message}`);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        console.log(`💰 Pagamento ricevuto: ${session.id}`);

        // --- ESTRAZIONE DATI ---
        const customerData = session.customer_details || {};
        const shippingData = session.shipping_details || {}; 
        
        const fullName = shippingData.name || customerData.name || '';
        const nameParts = fullName.split(' ');
        const cognome = nameParts.length > 1 ? nameParts.pop() : '';
        const nome = nameParts.join(' ');

        const address = shippingData.address || customerData.address || {};
        const unifiedStreet = [address.line1, address.line2].filter(Boolean).join(', ');
        
        const fullShippingAddress = `
            ${fullName}<br>
            ${address.line1 || ''} ${address.line2 || ''}<br>
            ${address.postal_code || ''} ${address.city || ''} (${address.state || ''})<br>
            ${address.country || ''}
        `;

        let productDesc = "Adozione";
        try {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
            if (lineItems.data.length > 0) {
                productDesc = lineItems.data.map(item => item.description).join(' + ');
            }
        } catch (e) { console.error("Errore recupero prodotti:", e); }

        let qtyDescIT = "";
        let qtyDescEN = "";
        const pName = (productDesc || "").toLowerCase();
        if (pName.includes('family')) {
            qtyDescIT = "Family Kit (5 Litri)"; qtyDescEN = "Family Kit (5 Liters)";
        } else if (pName.includes('reserve') || pName.includes('riserva')) {
            qtyDescIT = "Reserve Kit (2 Litri)"; qtyDescEN = "Reserve Kit (2 Liters)";
        } else {
            qtyDescIT = "Welcome Kit (1 Litro)"; qtyDescEN = "Welcome Kit (1 Liter)";
        }

        const certificatoNome = session.metadata?.cert_name || '';
        const etichettaMsg = session.metadata?.label_name || '';
        const isGift = session.metadata?.is_gift === 'YES';
        const referralId = session.metadata?.referral_id || ''; 
        
        let regaloString = isGift ? 'Si' : 'No';
        if (isGift && session.metadata?.gift_message) {
            regaloString += ` - ${session.metadata.gift_message}`;
        }

        let codiceSconto = '';
        if (session.total_details?.breakdown?.discounts) {
            codiceSconto = session.total_details.breakdown.discounts
                .map(d => {
                    if (d.discount?.coupon?.name) return d.discount.coupon.name;
                    if (d.discount?.coupon?.id) return d.discount.coupon.id;
                    if (d.discount?.promotion_code?.code) return d.discount.promotion_code.code;
                    return 'Sconto applicato';
                })
                .join(', ');
        }

        const lang = session.metadata?.lang || session.locale || 'en';
        const isIt = lang.startsWith('it');

        // --- GENERAZIONE PDF ---
        const pdfBase64 = await generaCertificatoPDF(certificatoNome);
        const pdfAttachment = pdfBase64 ? [{
            filename: `Certificato_Adozione_${certificatoNome.replace(/\s+/g, '_')}.pdf`,
            content: pdfBase64,
        }] : [];

        // --- 1. GOOGLE SHEET ---
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
                await sheet.addRow({
                    Data: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                    Nome: nome,
                    Cognome: cognome,
                    Email: session.customer_details.email,
                    Telefono: session.customer_details.phone || '',
                    Via: unifiedStreet || '',
                    Citta: address.city || '',
                    CAP: address.postal_code || '',
                    Paese: address.country || '',
                    Lingua: lang,
                    Certificato: certificatoNome,
                    Etichetta: etichettaMsg.toLowerCase().startsWith('olio') ? etichettaMsg : `Olio ${etichettaMsg}`,
                    Prodotto: productDesc,
                    Regalo: regaloString,
                    Codice: codiceSconto,
                    Prezzo: (session.amount_total / 100).toFixed(2),
                    ID_Carrello: session.metadata?.cart_id || '',
                    ID_Transazione_Stripe: session.payment_intent || session.id,
                    "Referral ID": referralId 
                });
                console.log("✅ Ordine salvato su Sheet");
            }
        } catch (sheetError) { console.error('❌ Errore salvataggio Sheet:', sheetError); }

        // --- 2. RESEND AUDIENCE ---
        if (process.env.RESEND_AUDIENCE_ID) {
            try {
                await resend.contacts.create({
                    email: session.customer_details.email,
                    audienceId: process.env.RESEND_AUDIENCE_ID,
                    firstName: nome,
                    lastName: cognome,
                    unsubscribed: false
                });
                console.log('✅ Cliente Resend assicurato.');
            } catch (e) { console.log('ℹ️ Resend skip:', e.message); }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // --- 3. EMAIL CLIENTE ---
        const giftSection = isGift && session.metadata?.gift_message ? (isIt ? `
            <div style="background-color: #fdf6e3; padding: 15px; border: 1px dashed #b58900; border-radius: 4px; margin-bottom: 20px;">
                <p style="margin:0; color:#b58900; font-weight:bold; font-size:12px; text-transform:uppercase;">💌 Messaggio Incluso:</p>
                <p style="margin:5px 0 0 0; font-style:italic; color:#333;">"${session.metadata.gift_message}"</p>
            </div>
        ` : `
            <div style="background-color: #fdf6e3; padding: 15px; border: 1px dashed #b58900; border-radius: 4px; margin-bottom: 20px;">
                <p style="margin:0; color:#b58900; font-weight:bold; font-size:12px; text-transform:uppercase;">💌 Gift Message Included:</p>
                <p style="margin:5px 0 0 0; font-style:italic; color:#333;">"${session.metadata.gift_message}"</p>
            </div>
        `) : '';

        const emailContent = isIt ? {
            subj: `Benvenuto in Famiglia! 🌿 Ordine #${session.payment_intent ? session.payment_intent.slice(-4) : 'WEB'}`,
            html: `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6;">
                    <h1 style="color: #2c5e2e;">Grazie, ${nome}!</h1>
                    <p>Siamo felici di darti il benvenuto nella nostra famiglia di custodi degli ulivi in Puglia.</p>
                    <p>Abbiamo ricevuto correttamente la tua adozione. <strong>In allegato a questa email trovi la copia digitale del tuo Certificato.</strong></p>
                    
                    <p style="background: #fdf6e3; padding: 15px; border-left: 4px solid #b58900; margin: 20px 0;">
                        <strong>Nota importante:</strong> La versione fisica ufficiale arriverà a casa tua insieme alla <strong>Club Card</strong>. 
                        Sulla card troverai il tuo <strong>Member ID</strong> e un QR Code per accedere all'area riservata e scaricare guide e ricettari.
                    </p>

                    <div style="background:#f4f4f4; padding:15px; border-radius:8px; margin: 20px 0; color:#333;">
                        <p style="margin:0;"><strong>📦 Kit Scelto:</strong> ${qtyDescIT}</p>
                        <p style="margin:5px 0 0 0;"><strong>💳 Totale:</strong> € ${(session.amount_total / 100).toFixed(2)}</p>
                    </div>
                    ${giftSection}
                    <h3 style="color: #2c5e2e; border-bottom: 1px solid #eee; padding-bottom: 10px;">Cosa succede ora?</h3>
                    <ol style="padding-left: 20px; color: #555;">
                        <li style="margin-bottom: 10px;"><strong>Personalizzazione:</strong> Stiamo preparando i tuoi documenti e l'etichetta personalizzata.</li>
                        <li style="margin-bottom: 10px;"><strong>Spedizione:</strong> Il tuo pacco partirà entro <strong>5 giorni lavorativi</strong>.</li>
                        <li style="margin-bottom: 10px;"><strong>Member ID:</strong> Appena riceverai il pacco, usa il QR code sulla card per sbloccare i contenuti digitali.</li>
                    </ol>
                    <hr style="border:0; border-top:1px solid #eee; margin: 30px 0;">
                    <p style="font-size:12px; color:#999; text-align: center;">Adopt Your Olive - Puglia, Italia</p>
                </div>`
        } : {
            subj: `Welcome to the Family! 🌿 Order #${session.payment_intent ? session.payment_intent.slice(-4) : 'WEB'}`,
            html: `
                <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6;">
                    <h1 style="color: #2c5e2e;">Thank you, ${nome}!</h1>
                    <p>We successfully received your adoption. <strong>Your digital Adoption Certificate is attached to this email.</strong></p>
                    
                    <p style="background: #fdf6e3; padding: 15px; border-left: 4px solid #b58900; margin: 20px 0;">
                        <strong>Important:</strong> Your official physical certificate will arrive with your <strong>Club Card</strong>. 
                        The card features your <strong>Member ID</strong> and a QR Code to access your private area and download the guides and recipes.
                    </p>

                    <div style="background:#f4f4f4; padding:15px; border-radius:8px; margin: 20px 0; color:#333;">
                        <p style="margin:0;"><strong>📦 Selected Kit:</strong> ${qtyDescEN}</p>
                        <p style="margin:5px 0 0 0;"><strong>💳 Total:</strong> € ${(session.amount_total / 100).toFixed(2)}</p>
                    </div>
                    ${giftSection}
                    <h3 style="color: #2c5e2e; border-bottom: 1px solid #eee; padding-bottom: 10px;">What happens next?</h3>
                    <ol style="padding-left: 20px; color: #555;">
                        <li style="margin-bottom: 10px;"><strong>Preparation:</strong> We are customizing your certificate and bottle labels.</li>
                        <li style="margin-bottom: 10px;"><strong>Shipping:</strong> Your package will be shipped within <strong>5 business days</strong>.</li>
                        <li style="margin-bottom: 10px;"><strong>Member ID:</strong> Once you receive your kit, use the QR code on the card to unlock digital content.</li>
                    </ol>
                    <hr style="border:0; border-top:1px solid #eee; margin: 30px 0;">
                    <p style="font-size:12px; color:#999; text-align: center;">Adopt Your Olive - Puglia, Italy</p>
                </div>`
        };

        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: session.customer_details.email,
                subject: emailContent.subj,
                html: emailContent.html,
                attachments: pdfAttachment
            });
            console.log('✅ Email Cliente inviata');
        } catch (e) { console.error('❌ Errore Email Cliente:', e); }

        // --- 4. NOTIFICA ADMIN ---
        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: process.env.EMAIL_ADMIN,
                subject: `💰 [ORDINE] ${nome} ${cognome} - €${(session.amount_total / 100).toFixed(0)}`,
                attachments: pdfAttachment, // Allegato anche per l'admin
                html: `
                    <div style="font-family: monospace; color: #333; max-width: 600px;">
                        <h2 style="background: #e6fffa; padding: 10px; border: 1px solid #2c5e2e; color: #2c5e2e;">✅ Pagamento Ricevuto: € ${(session.amount_total / 100).toFixed(2)}</h2>
                        <h3>1. LOGISTICA 📦</h3>
                        <ul><li><strong>PRODOTTO:</strong> ${qtyDescIT}</li><li><strong>REGALO?</strong> ${isGift ? 'SÌ 🎁' : 'NO'}</li></ul>
                        <h3>2. SPEDIZIONE 🚚</h3>
                        <div style="background: #f9f9f9; padding: 15px; border: 1px solid #ddd;"><strong>${fullShippingAddress}</strong><br><em>Email:</em> ${session.customer_details.email}</div>
                        <h3>3. STAMPA 🖨️</h3>
                        <table border="1" cellpadding="10" cellspacing="0" style="width: 100%; border-collapse: collapse;">
                            <tr><td bgcolor="#eee">Certificato:</td><td>${certificatoNome}</td></tr>
                            <tr><td bgcolor="#eee">Etichetta:</td><td>${etichettaMsg}</td></tr>
                            ${session.metadata?.gift_message ? `<tr><td bgcolor="#fdf6e3">Messaggio:</td><td>${session.metadata.gift_message}</td></tr>` : ''}
                            <tr><td bgcolor="#eee"><strong>Referral ID:</strong></td><td><strong>${referralId || 'Nessuno'}</strong></td></tr>
                        </table>
                        <br>
                        <hr>
                        <p style="font-size: 11px; color: #777;">
                            ID Ordine: #${session.payment_intent ? session.payment_intent.slice(-4) : 'N/A'}<br>
                            ID Transazione: ${session.payment_intent || session.id}<br>
                            Lingua Cliente: ${lang}
                        </p>
                    </div>`
            });
            console.log('✅ Email Admin inviata');
        } catch (e) { console.error('❌ Errore Email Admin:', e); }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
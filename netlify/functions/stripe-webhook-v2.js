/* netlify/functions/stripe-webhook-v2.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';
import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

async function getDoc() {
    const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
    const creds = JSON.parse(decodedCreds);
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
    await doc.loadInfo();
    return doc;
}

// Generatore Sequenziale ultra-rapido: ORD-YYYYMMDD-XXXX (legge solo l'ultima riga)
async function generateFastOrderId(sheet) {
    const d = new Date();
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const todayPrefix = `ORD-${yyyy}${mm}${dd}-`;

    let nextNum = 1;
    const rowCount = sheet.rowCount;

    if (rowCount > 1) {
        const lastRows = await sheet.getRows({ offset: rowCount - 2, limit: 1 });
        if (lastRows.length > 0) {
            const lastId = (lastRows[0].get('ID Ordine') || '').trim();
            if (lastId.startsWith(todayPrefix) && !lastId.includes('.')) {
                const currentSeq = parseInt(lastId.replace(todayPrefix, ''), 10);
                if (!isNaN(currentSeq)) {
                    nextNum = currentSeq + 1;
                }
            }
        }
    }

    return `${todayPrefix}${String(nextNum).padStart(4, '0')}`;
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
        const payload = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
        stripeEvent = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`⚠️ Webhook Error: ${err.message}`);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    // =========================================================
    // 1. GESTIONE CARRELLO SCADUTO: AGGIORNA VALUTA E PREZZO
    // =========================================================
    if (stripeEvent.type === 'checkout.session.expired') {
        const session = stripeEvent.data.object;
        console.log(`⏰ Carrello Scaduto su Stripe: ${session.id}`);

        try {
            const doc = await getDoc();
            const sheetCarrelli = doc.sheetsByTitle['Carrelli'];
            if (sheetCarrelli) {
                const rows = await sheetCarrelli.getRows();
                const cartIdMeta = session.metadata?.cart_id;
                
                const row = rows.find(r => 
                    r.get('ID Sessione Stripe') === session.id || 
                    (cartIdMeta && r.get('ID Carrello') === cartIdMeta)
                );

                if (row) {
                    const detectedCurrency = session.currency ? session.currency.toUpperCase() : 'EUR';
                    row.set('Valuta', detectedCurrency);

                    if (session.amount_total) {
                        row.set('Prezzo in Valuta', (session.amount_total / 100).toFixed(2));
                    }

                    await row.save();
                    console.log(`✅ Carrello aggiornato con Valuta: ${detectedCurrency} e Prezzo.`);
                }
            }
        } catch (e) {
            console.error("❌ Errore aggiornamento Carrello Scaduto:", e.message);
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    // =========================================================
    // 2. PAGAMENTO COMPLETATO: ELIMINA CARRELLO E CREA ORDINE
    // =========================================================
    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        console.log(`💰 Pagamento completato: ${session.id}`);

        const doc = await getDoc();

        // 2. ESTRAZIONE DATI E NORMALIZZAZIONE
        const customerData = session.customer_details || {};
        const shippingData = session.shipping_details || session.collected_information?.shipping_details || {};

        let nome = session.metadata?.buyer_first_name || '';
        let cognome = session.metadata?.buyer_last_name || '';

        if (!nome && !cognome) {
            const stripeName = shippingData.name || customerData.name || '';
            const nameParts = stripeName.trim().split(/\s+/);
            cognome = nameParts.length > 1 ? nameParts.pop() : '';
            nome = nameParts.join(' ');
        }

        const fullName = `${nome} ${cognome}`.trim();
        const address = shippingData.address || customerData.address || {};
        const unifiedStreet = [address.line1, address.line2].filter(Boolean).join(', ');

        const productDesc = session.metadata?.order_summary || "1x welcome-kit";
        const certificatoNome = session.metadata?.cert_name || '';
        const etichettaMsg = session.metadata?.label_name || '';
        const isGift = session.metadata?.is_gift === 'YES';
        const gdprConsent = session.metadata?.marketing_consent === 'YES' ? 'ISCRITTO' : 'SOLO LOGISTICA';
        
        const rawShippingChoice = session.metadata?.shipping_choice || 'immediate';
        const isDelayed = rawShippingChoice === 'delayed';
        const sceltaSpedizione = isDelayed ? 'Pre-ordine (Gennaio)' : 'Olio Subito';
        const statoOrdineIniziale = isDelayed ? 'Prenotato (Gennaio)' : 'Nuovo';

        let regaloString = isGift ? 'Si' : 'No';
        if (isGift && session.metadata?.gift_message) {
            regaloString += ` - ${session.metadata.gift_message}`;
        }

        // 3. RECUPERO TESTUALE CODICE SCONTO
        let codiceSconto = '';
        if (session.discounts && session.discounts.length > 0) {
            try {
                const sconto = session.discounts[0];
                if (sconto.promotion_code) {
                    const promoId = typeof sconto.promotion_code === 'string' ? sconto.promotion_code : sconto.promotion_code.id;
                    const promoInfo = await stripe.promotionCodes.retrieve(promoId);
                    codiceSconto = promoInfo.code;
                } else if (sconto.coupon) {
                    const couponId = typeof sconto.coupon === 'string' ? sconto.coupon : sconto.coupon.id;
                    const couponInfo = await stripe.coupons.retrieve(couponId);
                    codiceSconto = couponInfo.name || couponInfo.id;
                }
            } catch (e) {
                codiceSconto = 'SCONTO APPLICATO';
            }
        }

        // 4. SCRITTURA RIGA NELLA TAB ORDINI (Nuova Struttura)
        const sheetOrdini = doc.sheetsByTitle['Ordini'];
        if (!sheetOrdini) throw new Error("Tab 'Ordini' non trovata nel foglio.");

        const newOrderId = await generateFastOrderId(sheetOrdini);
        const currency = session.currency ? session.currency.toUpperCase() : 'EUR';
        const totalPaid = (session.amount_total / 100).toFixed(2);

        await sheetOrdini.addRow({
            'ID Ordine': newOrderId,
            'Data Ricezione': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
            'ID Transazione Stripe': session.payment_intent || session.id,
            'ID Sessione Stripe': session.id,
            'Nome Acquirente': fullName,
            'Email Acquirente': session.customer_details.email,
            'Telefono Acquirente': session.customer_details.phone || '',
            'Indirizzo Via': unifiedStreet || '',
            'Indirizzo Città': address.city || '',
            'Indirizzo CAP': address.postal_code || '',
            'Indirizzo Paese': address.country || '',
            'Lingua': session.metadata?.lang || 'en',
            'Email Destinatario': '',
            'Prodotto': productDesc,
            'Personalizzazione Certificato': certificatoNome,
            'Personalizzazione Etichetta': etichettaMsg.toLowerCase().startsWith('olio') ? etichettaMsg : `Olio ${etichettaMsg}`,
            'Scelta Riscatto Olio': sceltaSpedizione,
            'Regalo e Messaggio': regaloString,
            'Member ID': '',
            'Albero': '',
'Stato Ordine': '',
            'Data Spedizione': '',
            'Tracking Nr': '',
            'Valuta': currency,
            'Prezzo in Valuta': totalPaid,
            'Codice Sconto': codiceSconto,
            'Importo €': '',
            'Commissioni': '',
            'Spese di spedizione': '',
            'Costo Prodotto': '',
            'Bonus / Extra': '',
            'Rimborsi': '',
            'Link Ricevuta PDF': '',
            'Risorse Scaricate': '',
            'GDPR': gdprConsent,
            'Note': ''
        });

        console.log(`✅ Ordine ${newOrderId} inserito correttamente.`);

        // 5. EMAIL AL CLIENTE (Con allegato se Delayed)
        let customerAttachments = [];
        if (isDelayed) {
            const certPath = path.resolve(process.cwd(), 'netlify/functions/assets/reservation-certificate.pdf');
            if (fs.existsSync(certPath)) {
                customerAttachments.push({
                    filename: `Reservation_Certificate_${newOrderId}.pdf`,
                    content: fs.readFileSync(certPath)
                });
            }
        }

        const currencySymbol = session.currency === 'usd' ? '$' : session.currency === 'gbp' ? '£' : '€';
        
        const delayedInstructions = isDelayed ? `
          <div style="background: #fdf6e3; padding: 18px; border: 1px dashed #b58900; border-radius: 8px; margin: 20px 0;">
              <p style="margin:0 0 8px 0; color:#b58900; font-weight:bold; font-size:15px;">📦 Pre-order Confirmed for January Harvest:</p>
              <span style="font-size: 20px; font-weight: bold; color: #2c5e2e; letter-spacing: 1px;">Order Ref: ${newOrderId}</span>
              <p style="margin:12px 0 0 0; font-size:13px; color:#555; line-height:1.5;">
                  Your <strong>Digital Reservation Certificate</strong> is attached to this email (ready to print or forward as a gift!).<br>
                  Your physical package with the freshly cold-pressed extra virgin olive oil will ship directly to your delivery address in <strong>January</strong>. We will send an address verification reminder before dispatch.
              </p>
          </div>` : '';

        const customerHtml = `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6;">
                <h1 style="color: #2c5e2e;">Thank you, ${nome}!</h1>
                <p>${isDelayed 
                    ? "We have successfully confirmed your adoption booking. Your centuries-old tree is waiting for you in Puglia!" 
                    : "We have successfully received your adoption. We are currently preparing your package with care."}</p>
                
                ${delayedInstructions}

                <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin: 20px 0; border:1px solid #eee;">
                    <p style="margin:0;"><strong>📦 Selected Kit:</strong> ${productDesc}</p>
                    <p style="margin:5px 0 0 0;"><strong>💳 Total Paid:</strong> ${currencySymbol} ${totalPaid}</p>
                    <p style="margin:5px 0 0 0;"><strong>📜 Certificate Name:</strong> ${certificatoNome}</p>
                    <p style="margin:5px 0 0 0;"><strong>🏷️ Bottle Label:</strong> Olio ${etichettaMsg}</p>
                </div>

                ${isGift && session.metadata?.gift_message ? `
                    <div style="background-color: #fdf6e3; padding: 12px; border-left: 3px solid #b58900; margin-bottom: 20px;">
                        <strong>Gift Note:</strong> "${session.metadata.gift_message}"
                    </div>` : ''}

                <h3 style="color: #2c5e2e;">What happens next?</h3>
              <ol style="padding-left: 20px; color: #555;">
                  ${isDelayed ? `
                      <li>Save or gift the attached Digital Reservation Certificate.</li>
                      <li>We take care of your tree during the upcoming autumn harvest and cold-press your reserve.</li>
                      <li>In early January, you will receive an address check notification, followed by tracking as soon as your box departs!</li>
                  ` : `
                      <li>We are handcrafting your personalized certificate and labels.</li>
                      <li>Your package will be shipped within 5 business days.</li>
                      <li>You will receive your tracking code as soon as it departs.</li>
                  `}
              </ol>

                <hr style="border:0; border-top:1px solid #eee; margin: 30px 0;">
                <p style="font-size:12px; color:#999; text-align: center;">Adopt Your Olive - San Severo, Puglia, Italy</p>
            </div>`;

        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: session.customer_details.email,
                subject: `Welcome to the Family! 🌿 Order ${newOrderId}`,
                attachments: customerAttachments,
                html: appendUnsubscribeFooter(customerHtml, session.customer_details.email),
            });
        } catch (e) {
            console.error("⚠️ Errore invio email cliente:", e.message);
        }

        // 6. NOTIFICA COMPATTA ALL'ADMIN
        try {
            await resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: process.env.EMAIL_ADMIN,
                subject: `💰 [NUOVO ORDINE ${newOrderId}] ${fullName} - ${currencySymbol}${totalPaid}`,
                html: `
                    <div style="font-family: monospace; color: #333; max-width: 600px;">
                        <h2 style="background: #e6fffa; padding: 10px; border: 1px solid #2c5e2e; color: #2c5e2e;">
                            ✅ Ordine Ricevuto: ${currencySymbol}${totalPaid}
                        </h2>
                        <p><strong>ID Ordine:</strong> ${newOrderId}</p>
                        <p><strong>Prodotto:</strong> ${productDesc}</p>
                        <p><strong>Tipo Ordine:</strong> ${sceltaSpedizione} (Stato: ${statoOrdineIniziale})</p>
                        <p><strong>Certificato:</strong> ${certificatoNome}</p>
                        <p><strong>Etichetta:</strong> Olio ${etichettaMsg}</p>
                        <p><strong>Cliente:</strong> ${fullName} (${session.customer_details.email})</p>
                        <p><strong>Destinazione:</strong> ${unifiedStreet}, ${address.postal_code} ${address.city} (${address.country})</p>
                        ${session.metadata?.gift_message ? `<p><strong>Messaggio Regalo:</strong> "${session.metadata.gift_message}"</p>` : ''}
                    </div>`
            });
        } catch (e) {
            console.error("⚠️ Errore notifica admin:", e.message);
        }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
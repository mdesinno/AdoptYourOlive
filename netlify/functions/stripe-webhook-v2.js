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

// =========================================================
// HELPER
// =========================================================

const formatMoney = (amount, cur) => {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(amount));
    } catch (e) {
        return `${amount} ${cur}`;
    }
};

// Indice 0-based -> lettera di colonna (0 = A, 26 = AA)
const colLetter = (i) => {
    let s = '';
    let n = i + 1;
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
};

// Legge UNA colonna (identificata dall'intestazione) in una sola chiamata leggera.
// Richiede che sheet.loadHeaderRow() sia già stato chiamato.
// L'elemento i dell'array corrisponde alla i-esima riga di DATI (0 = prima riga sotto l'intestazione).
async function readColumn(sheet, headerName) {
    const idx = sheet.headerValues.indexOf(headerName);
    if (idx < 0) throw new Error(`Colonna '${headerName}' non trovata nella tab '${sheet.title}'.`);
    const L = colLetter(idx);
    const vals = (await sheet.getCellsInRange(`${L}2:${L}`)) || [];
    return vals.map(r => String((r && r[0]) || '').trim());
}

// Sequenziale ORD-YYYYMMDD-XXXX: massimo di oggi (ora di Roma) + 1.
// Se la lettura fallisce l'errore sale: meglio un retry di Stripe che un numero duplicato.
function nextOrderId(idColumn) {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).replace(/-/g, '');
    const todayPrefix = `ORD-${today}-`;
    let maxSeq = 0;
    for (const id of idColumn) {
        if (id.startsWith(todayPrefix)) {
            const n = parseInt(id.slice(todayPrefix.length), 10); // "0003.1" -> 3
            if (!isNaN(n) && n > maxSeq) maxSeq = n;
        }
    }
    return `${todayPrefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

// Valuta e importo visti dal cliente (Adaptive Pricing).
// session.currency / amount_total restano nella valuta di listino (EUR).
function getPresentment(session) {
    const pd = session.presentment_details;
    const hasPd = pd && pd.presentment_currency && pd.presentment_amount;
    return {
        currency: (hasPd ? pd.presentment_currency : (session.currency || 'eur')).toUpperCase(),
        amount: ((hasPd ? pd.presentment_amount : (session.amount_total || 0)) / 100).toFixed(2)
    };
}

// Commissioni (IVA 22% per tutti tranne PayPal) e importo EUR di riserva dal PaymentIntent.
// Non lancia mai errori: in caso di problemi restituisce un oggetto vuoto.
async function getFeeInfo(session) {
    try {
        if (!session.payment_intent) return {};
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {
            expand: ['latest_charge.balance_transaction']
        });
        const out = { piEur: pi.currency === 'eur' ? (pi.amount / 100).toFixed(2) : '' };
        const charge = pi.latest_charge;
        const bt = charge && typeof charge === 'object' ? charge.balance_transaction : null;
        if (bt && typeof bt === 'object' && bt.currency === 'eur') {
            const fee = bt.fee / 100;
            const isPaypal = charge.payment_method_details?.type === 'paypal';
            out.commissioni = (isPaypal ? fee : fee * 1.22).toFixed(2);
        }
        return out;
    } catch (e) {
        console.error('⚠️ Commissioni non calcolate:', e.message);
        return {};
    }
}

// =========================================================
// HANDLER
// =========================================================
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
                await sheetCarrelli.loadHeaderRow();
                const cartIdMeta = session.metadata?.cart_id;

                // Cerca prima per ID sessione, poi per ID carrello. Legge solo due colonne.
                const [sessCol, cartCol] = await Promise.all([
                    readColumn(sheetCarrelli, 'ID Sessione Stripe'),
                    readColumn(sheetCarrelli, 'ID Carrello')
                ]);
                let idx = sessCol.lastIndexOf(session.id);
                if (idx < 0 && cartIdMeta) idx = cartCol.lastIndexOf(cartIdMeta);

                if (idx >= 0) {
                    const [row] = await sheetCarrelli.getRows({ offset: idx, limit: 1 });
                    if (row) {
                        const p = getPresentment(session);
                        row.set('Valuta', p.currency);
                        row.set('Prezzo in Valuta', p.amount);
                        await row.save();
                        console.log(`✅ Carrello aggiornato: Valuta=${p.currency}, Prezzo=${p.amount}`);
                    }
                } else {
                    console.log(`ℹ️ Carrello non trovato per sessione ${session.id}`);
                }
            }
        } catch (e) {
            console.error("❌ Errore aggiornamento Carrello Scaduto:", e.message);
        }

        return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    // =========================================================
    // 2. PAGAMENTO COMPLETATO: CREA ORDINE
    // =========================================================
    if (stripeEvent.type === 'checkout.session.completed') {
        const session = stripeEvent.data.object;
        console.log(`💰 Pagamento completato: ${session.id}`);

        const doc = await getDoc();
        const sheetOrdini = doc.sheetsByTitle['Ordini'];
        if (!sheetOrdini) throw new Error("Tab 'Ordini' non trovata nel foglio.");
        await sheetOrdini.loadHeaderRow();

        // Letture in parallelo (foglio + Stripe) per stare lontani dal timeout
        const [idColumn, sessionColumn, feeInfo] = await Promise.all([
            readColumn(sheetOrdini, 'ID Ordine'),
            readColumn(sheetOrdini, 'ID Sessione Stripe'),
            getFeeInfo(session)
        ]);

        // Idempotenza: se Stripe ritenta l'evento, non creare un secondo ordine
        if (sessionColumn.includes(session.id)) {
            console.log(`⚠️ Webhook duplicato ignorato per sessione ${session.id}`);
            return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
        }

        const newOrderId = nextOrderId(idColumn);

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

        // 4. VALUTA, PREZZO IN VALUTA, IMPORTO € E COMMISSIONI
        const { currency, amount: totalPaid } = getPresentment(session);
        const importoEuro = session.currency === 'eur'
            ? ((session.amount_total || 0) / 100).toFixed(2)
            : (feeInfo.piEur || '');
        const commissioni = feeInfo.commissioni || '';

        // 5. SCRITTURA RIGA NELLA TAB ORDINI
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
            'Importo €': importoEuro,
            'Commissioni': commissioni,
            'Spese di spedizione': '',
            'Costo Prodotto': '',
            'Bonus / Extra': '',
            'Rimborsi': '',
            'Link Ricevuta PDF': '',
            'Risorse Scaricate': '',
            'GDPR': gdprConsent,
            'Note': ''
        });

        console.log(`✅ Ordine ${newOrderId} inserito: ${currency} ${totalPaid} | € ${importoEuro} | commissioni ${commissioni}`);

        // 6. EMAIL AL CLIENTE (Con allegato se Delayed)
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

        const paid = formatMoney(totalPaid, currency);
        const adminEuro = (importoEuro && currency !== 'EUR') ? ` (€${importoEuro})` : '';

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
                    <p style="margin:5px 0 0 0;"><strong>💳 Total Paid:</strong> ${paid}</p>
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

        // 7. INVIO EMAIL (cliente + admin in parallelo; un errore non blocca l'altra)
        const emailResults = await Promise.allSettled([
            resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: session.customer_details.email,
                subject: `Welcome to the Family! 🌿 Order ${newOrderId}`,
                attachments: customerAttachments,
                html: appendUnsubscribeFooter(customerHtml, session.customer_details.email),
            }),
            resend.emails.send({
                from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                to: process.env.EMAIL_ADMIN,
                subject: `💰 [NUOVO ORDINE ${newOrderId}] ${fullName} - ${paid}`,
                html: `
                    <div style="font-family: monospace; color: #333; max-width: 600px;">
                        <h2 style="background: #e6fffa; padding: 10px; border: 1px solid #2c5e2e; color: #2c5e2e;">
                            ✅ Ordine Ricevuto: ${paid}${adminEuro}
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
            })
        ]);

        if (emailResults[0].status === 'rejected') console.error("⚠️ Errore invio email cliente:", emailResults[0].reason?.message);
        if (emailResults[1].status === 'rejected') console.error("⚠️ Errore notifica admin:", emailResults[1].reason?.message);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
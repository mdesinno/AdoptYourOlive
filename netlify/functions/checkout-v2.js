/* netlify/functions/checkout-v2.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// ========== CONFIGURAZIONE CATALOGO ADOZIONI ==========
const INVENTORY = {
    'welcome-kit': { price: 7900, name: 'Welcome Kit (1 Liter)' },
    'reserve-kit': { price: 12900, name: 'Reserve Kit (2 Liters)' },
    'family-kit': { price: 21900, name: 'Family Kit (5 Liters)' }
};

// Dimensioni reali (cm) e pesi (kg) aggiornati
const ADOPTION_BOXES = {
    'welcome-kit': { width: 40.6, length: 14.1, height: 31.7, weight: 2.5 },
    'reserve-kit': { width: 40.6, length: 27.7, height: 31.7, weight: 5.0 },
    'family-kit': { width: 53.8, length: 40.6, height: 31.7, weight: 11.5 }
};

// Nuovo:
const FIXED_SHIPPING_EXTRA_EU = {
    'US': { 'welcome-kit': 5000, 'reserve-kit': 7000, 'family-kit': 9500 },
    'CA': { 'welcome-kit': 5000, 'reserve-kit': 7000, 'family-kit': 9500 }
};

// Paesi con spedizione inclusa nel prezzo (UE + Regno Unito + Svizzera)
const COUNTRIES_SHIPPING_INCLUDED = [
    'IT', 'FR', 'DE', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'LU', 
    'FI', 'DK', 'SE', 'GR', 'BG', 'HR', 'CY', 'CZ', 'EE', 'HU', 
    'LV', 'LT', 'MT', 'PL', 'RO', 'SK', 'SI', 'GB', 'CH'
];

// Paesi con quotazione dinamica / extra tariffa
const COUNTRIES_EXTRA_SHIPPING = ['US', 'CA'];

// Tutti i paesi serviti direttamente da Stripe
const ALL_SUPPORTED_ISO = [...COUNTRIES_SHIPPING_INCLUDED, ...COUNTRIES_EXTRA_SHIPPING];

const FREE_EU_SHIPPING_ID = 'shr_1UD4QMGWLKkvVi98iA0alBM3'; 

// Mappatura Nazione -> Codice ISO-2
const COUNTRY_TO_ISO = {
    "italy": "IT", "italia": "IT", "united states": "US", "stati uniti": "US", "usa": "US", "canada": "CA",
    "united kingdom": "GB", "regno unito": "GB", "uk": "GB", "great britain": "GB",
    "switzerland": "CH", "svizzera": "CH",
    "france": "FR", "francia": "FR", "germany": "DE", "germania": "DE", "spain": "ES", "spagna": "ES", 
    "netherlands": "NL", "paesi bassi": "NL", "belgium": "BE", "belgio": "BE", "austria": "AT",
    "ireland": "IE", "irlanda": "IE", "portugal": "PT", "portogallo": "PT", "luxembourg": "LU", "lussemburgo": "LU",
    "finland": "FI", "finlandia": "FI", "denmark": "DK", "danimarca": "DK", "sweden": "SE", "svezia": "SE",
    "greece": "GR", "grecia": "GR", "bulgaria": "BG", "croatia": "HR", "croazia": "HR", "cyprus": "CY", "cipro": "CY",
    "czech republic": "CZ", "czechia": "CZ", "repubblica ceca": "CZ", "estonia": "EE", "hungary": "HU", "ungheria": "HU",
    "latvia": "LV", "lettonia": "LV", "lithuania": "LT", "lituania": "LT", "malta": "MT", "poland": "PL", "polonia": "PL",
    "romania": "RO", "slovakia": "SK", "slovacchia": "SK", "slovenia": "SI"
};

function getIsoCode(countryName) {
    if (!countryName) return 'XX';
    const cleanName = countryName.toLowerCase().trim();
    return COUNTRY_TO_ISO[cleanName] || 'XX';
}

function generateCartId() {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const randomNum = Math.floor(1000 + Math.random() * 9000); 
    return `CRT-${yy}${mm}${dd}-${randomNum}`;
}

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

// ========== HANDLER PRINCIPALE ==========
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let data;
    let cartId;

    try {
        data = JSON.parse(event.body);

        // 1. Muro Honeypot Anti-Bot
        if (data.fax_number && data.fax_number.trim() !== "") {
            return { statusCode: 200, body: JSON.stringify({ message: "Success" }) };
        }

        // 2. Validazione Dati
        const required = [
            'kitId', 
            'email', 
            'buyerFirstName', 
            'buyerLastName', 
            'certName', 
            'labelName', 
            'shippingCountry', 
            'zipCode',
            'shippingChoice'
        ];

        for (const field of required) {
            if (!data[field] || data[field].trim() === '') {
                return { 
                    statusCode: 400, 
                    body: JSON.stringify({ error: `Campo obbligatorio mancante: ${field}` }) 
                };
            }
        }

        if (data.shippingChoice !== 'immediate' && data.shippingChoice !== 'delayed') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Scelta di spedizione non valida (deve essere 'immediate' o 'delayed')" })
            };
        }

        const product = INVENTORY[data.kitId];
        if (!product) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Kit di adozione non valido' }) };
        }

        cartId = data.cartId || generateCartId();

        const shippingCountryRaw = (data.shippingCountry || '').trim();
        const destinationIso = getIsoCode(shippingCountryRaw);
        const destinationZip = (data.zipCode || '').trim();
        const lang = (data.lang || 'en').toLowerCase().startsWith('it') ? 'it' : 'en';

        let giftString = data.isGift ? 'Si' : 'No';
        if (data.isGift && data.giftMessage) {
            giftString += ` - ${data.giftMessage.substring(0, 100)}`;
        }
        const labelFormatted = data.labelName.toLowerCase().startsWith('olio') ? data.labelName : `Olio ${data.labelName}`;

        // =========================================================
        // SCENARIO B: PAESE NON COPERTO AUTOMATICAMENTE (LEAD)
        // =========================================================
        if (!ALL_SUPPORTED_ISO.includes(destinationIso)) {
            try {
                const doc = await getDoc();
                const sheet = doc.sheetsByTitle['Carrelli'];
                
                if (sheet) {
                    await sheet.addRow({
                        'ID Carrello': cartId,
                        'Data': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                        'Stato Carrello': 'NAZIONE NON SUPPORTATA',
                        'ID Sessione Stripe': 'N/D (Lead)',
                        'Nome Acquirente': `${data.buyerFirstName} ${data.buyerLastName}`.trim(),
                        'Email Acquirente': data.email,
                        'Lingua': lang,
                        'Prodotto': `1x ${data.kitId}`,
                        'Personalizzazione Certificato': data.certName,
                        'Personalizzazione Etichetta': labelFormatted,
                        'Paese Spedizione': shippingCountryRaw,
                        'CAP Spedizione': destinationZip,
                        'Scelta Riscatto Olio': data.shippingChoice,
                        'Regalo e Messaggio': giftString,
                        'Importo €': (product.price / 100).toFixed(2),
                        'Valuta': 'EUR',
                        'Prezzo in Valuta': '',
                        'Codice Sconto': '',
                        'GDPR': data.marketingConsent ? 'ISCRITTO' : 'SOLO CARRELLO'
                    });
                }

                await resend.emails.send({
                    from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
                    to: process.env.EMAIL_ADMIN,
                    replyTo: data.email,
                    subject: `⚠️ Richiesta Spedizione Fuori Servizio Automatico: ${shippingCountryRaw}`,
                    html: `
                        <h2>Nuovo Lead Internazionale</h2>
                        <p><strong>Cliente:</strong> ${data.buyerFirstName} ${data.buyerLastName}</p>
                        <p><strong>Email:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
                        <p><strong>Paese:</strong> ${shippingCountryRaw} (CAP: ${destinationZip})</p>
                        <p><strong>Kit Scelto:</strong> ${product.name}</p>
                        <p style="font-size: 11px; color: #777;">ID Carrello: ${cartId}</p>
                    `
                });
            } catch (err) {
                console.error("Errore salvataggio lead:", err);
            }

            return { 
                statusCode: 200, 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    leadSaved: true,
                    message: "Country not served automatically. Lead saved." 
                }) 
            };
        }

        // =========================================================
        // SCENARIO A: PAESE SUPPORTATO -> CALCOLO E STRIPE
        // =========================================================
        let lineItems = [{
            price_data: {
                currency: 'eur',
                product_data: {
                    name: product.name,
                    description: `Adoption Certificate for: ${data.certName}`
                },
                unit_amount: product.price
            },
            quantity: 1
        }];

        let shippingOptions = [];
        let totalAmountCents = product.price;

        // USA e Canada: Spedizione forfettaria immediata (70€, 90€, 120€)
        if (COUNTRIES_EXTRA_SHIPPING.includes(destinationIso)) {
            const shippingCostCents = FIXED_SHIPPING_EXTRA_EU[destinationIso][data.kitId];

            lineItems.push({
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'International Tracked Shipping (DAP)',
                        description: `Tracked delivery to ${destinationIso}`
                    },
                    unit_amount: shippingCostCents
                },
                quantity: 1
            });
            totalAmountCents += shippingCostCents;

        } else {
            // UE, Regno Unito e Svizzera: Spedizione gratuita inclusa
            shippingOptions.push({ shipping_rate: FREE_EU_SHIPPING_ID });
        }

        const SITE_URL = process.env.SITE_URL || 'https://adoptyourolive.com';

        // Creazione Sessione Stripe
        const sessionParams = {
            payment_method_types: ['card', 'paypal', 'klarna', 'revolut_pay'],
            phone_number_collection: { enabled: true },
            shipping_address_collection: { allowed_countries: [destinationIso] },
            line_items: lineItems,
            mode: 'payment',
            locale: lang,
            customer_email: data.email,
            allow_promotion_codes: true,
            success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&amount=${(totalAmountCents / 100).toFixed(2)}&flow=adoption`,
            cancel_url: `${SITE_URL}/index.html`,
            metadata: {
                cart_id: cartId,
                lang: lang,
                buyer_first_name: data.buyerFirstName,
                buyer_last_name: data.buyerLastName,
                buyer_name: `${data.buyerFirstName} ${data.buyerLastName}`.trim(),
                buyer_email: data.email,
                cert_name: data.certName,
                label_name: data.labelName,
                is_gift: data.isGift ? 'YES' : 'NO',
                gift_message: data.giftMessage || '',
                shipping_choice: data.shippingChoice,
                order_summary: `1x ${data.kitId}`,
                marketing_consent: data.marketingConsent ? 'YES' : 'NO',
                shipping_country: destinationIso,
                zip_code: destinationZip
            }
        };

        if (shippingOptions.length > 0) {
            sessionParams.shipping_options = shippingOptions;
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        // Scrittura riga tab Carrelli
        try {
            const doc = await getDoc();
            const sheet = doc.sheetsByTitle['Carrelli'];
            if (sheet) {
                await sheet.addRow({
                    'ID Carrello': cartId,
                    'Data': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                    'Stato Carrello': 'IN CORSO',
                    'ID Sessione Stripe': session.id,
                    'Nome Acquirente': `${data.buyerFirstName} ${data.buyerLastName}`.trim(),
                    'Email Acquirente': data.email,
                    'Lingua': lang,
                    'Prodotto': `1x ${data.kitId}`,
                    'Personalizzazione Certificato': data.certName,
                    'Personalizzazione Etichetta': labelFormatted,
                    'Paese Spedizione': shippingCountryRaw,
                    'CAP Spedizione': destinationZip,
                    'Scelta Riscatto Olio': data.shippingChoice,
                    'Regalo e Messaggio': giftString,
                    'Importo €': (totalAmountCents / 100).toFixed(2),
                    'Valuta': 'EUR',
                    'Prezzo in Valuta': '',
                    'Codice Sconto': '',
                    'GDPR': data.marketingConsent ? 'ISCRITTO' : 'SOLO CARRELLO'
                });
            }
        } catch (sheetErr) {
            console.error("Errore log su tab Carrelli (non bloccante):", sheetErr);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('❌ Errore irreversibile Checkout:', error);

        try {
            if (data && data.email) {
                const doc = await getDoc();
                const sheet = doc.sheetsByTitle['Carrelli'];
                if (sheet) {
                    await sheet.addRow({
                        'ID Carrello': cartId || 'CRT-ERROR',
                        'Data': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                        'Stato Carrello': 'ERRORE STRIPE',
                        'ID Sessione Stripe': 'N/D (Errore)',
                        'Nome Acquirente': `${data.buyerFirstName || ''} ${data.buyerLastName || ''}`.trim(),
                        'Email Acquirente': data.email,
                        'Lingua': data.lang || 'en',
                        'Prodotto': data.kitId || 'Adozione',
                        'Personalizzazione Certificato': data.certName || '',
                        'Personalizzazione Etichetta': data.labelName || '',
                        'Paese Spedizione': data.shippingCountry || '',
                        'CAP Spedizione': data.zipCode || '',
                        'Scelta Riscatto Olio': data.shippingChoice || 'immediate',
                        'Regalo e Messaggio': data.isGift ? 'Si' : 'No',
                        'Importo €': '',
                        'Valuta': 'EUR',
                        'Prezzo in Valuta': '',
                        'Codice Sconto': '',
                        'GDPR': data.marketingConsent ? 'ISCRITTO' : 'SOLO CARRELLO'
                    });
                }
            }
        } catch (emergencyErr) {}

        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore durante la creazione del checkout' })
        };
    }
};
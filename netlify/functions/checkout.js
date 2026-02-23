/* netlify/functions/checkout.js - VERSIONE 3 OTTIMIZZATA */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ========== CONFIGURAZIONE ==========
const INVENTORY = {
    'welcome-kit': { 
        prices: { en: 7900, it: 4900 }, 
        name: 'Welcome Kit (1 Liter)' // Era 2 Bottles
    },
    'reserve-kit': { 
        prices: { en: 12900, it: 7900 }, 
        name: 'Reserve Kit (2 Liters)' // Era 4 Bottles
    },
    'family-kit': { 
        prices: { en: 21900, it: 12900 }, 
        name: 'Family Kit (5 Liters)' // Era 4 Bottles + 1 tin
    }
};

const COUNTRIES_EU_ALL = [
    'IT', 'FR', 'DE', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'LU', 
    'FI', 'DK', 'SE', 'GR', 'BG', 'HR', 'CY', 'CZ', 'EE', 'HU', 
    'LV', 'LT', 'MT', 'PL', 'RO', 'SK', 'SI'
];

const COUNTRIES_IT_ONLY = ['IT'];

// ========== UTILITY FUNCTIONS ==========

/**
 * Normalizza il codice lingua in modo robusto
 * @param {string} rawLang - Lingua grezza (es. "it-IT", "en-US", "IT")
 * @returns {string} - Lingua normalizzata ("it" o "en")
 */
function normalizeLang(rawLang) {
    if (!rawLang || typeof rawLang !== 'string') {
        return 'en'; // Fallback sicuro
    }
    
    const cleaned = rawLang.toLowerCase().trim();
    return cleaned.startsWith('it') ? 'it' : 'en';
}

/**
 * Valida i dati obbligatori del form
 * @param {Object} data - Dati dal frontend
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateCheckoutData(data) {
    const required = [
        'kitId', 'email', 'buyerFirstName', 'buyerLastName', 
        'certName', 'labelName'
    ];
    
    for (const field of required) {
        if (!data[field] || data[field].trim() === '') {
            return { 
                valid: false, 
                error: `Campo obbligatorio mancante: ${field}` 
            };
        }
    }
    
    // Valida email base
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
        return { valid: false, error: 'Email non valida' };
    }
    
    return { valid: true };
}

/**
 * Genera un ID carrello unico
 * @returns {string}
 */
function generateCartId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `cart_${timestamp}_${random}`;
}


/**
 * Recupera i dati di un carrello esistente dallo Sheet
 */
async function getExistingCart(cartId) {
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
        const sheet = doc.sheetsByTitle['Carrelli'];
        const rows = await sheet.getRows();
        
        const row = rows.find(r => r.get('ID_Carrello') === cartId);
        if (!row) return null;

        // Mappatura inversa Nome Prodotto -> kitId
        const prodName = row.get('Prodotto').toLowerCase();
        let kitId = 'welcome-kit';
        if (prodName.includes('family')) kitId = 'family-kit';
        if (prodName.includes('reserve')) kitId = 'reserve-kit';

        return {
            kitId: kitId,
            email: row.get('Email'),
            buyerFirstName: row.get('Nome'),
            buyerLastName: row.get('Cognome'),
            certName: row.get('Certificato'),
            labelName: row.get('Etichetta').replace('Olio ', ''),
            lang: row.get('Lingua'),
            isGift: row.get('Regalo').startsWith('Si'),
            giftMessage: row.get('Regalo').includes(' - ') ? row.get('Regalo').split(' - ')[1] : '',
            memberId: row.get('Referral_ID'),
            // Aggiungi questa riga qui sotto:
            discountCode: row.get('Codice') || ''
        };
    } catch (e) {
        console.error("❌ Errore recupero carrello:", e);
        return null;
    }
}

/**
 * Log sicuro su Google Sheets (non blocca il checkout se fallisce)
 * @param {Object} params - Parametri per il log
 */
async function logToSheet(params) {
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
        const sheet = doc.sheetsByTitle['Carrelli'];
        
        if (!sheet) {
            console.warn('Sheet "Carrelli" non trovato');
            return;
        }
        
        // Formatta dati regalo
        let giftString = params.isGift ? 'Si' : 'No';
        if (params.isGift && params.giftMessage) {
            giftString += ` - ${params.giftMessage.substring(0, 100)}`; // Limita lunghezza
        }
        
        await sheet.addRow({
            'Data': new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
            'Stato': 'IN_CORSO',
            'Nome': params.buyerFirstName,
            'Cognome': params.buyerLastName,
            'Email': params.email,
            'Lingua': params.lang,
            'Certificato': params.certName,
            'Etichetta': params.labelName.toLowerCase().startsWith('olio') 
                 ? params.labelName 
                 : `Olio ${params.labelName}`,
            'Prodotto': params.productName,
            'Regalo': giftString,
            'Codice': params.discountCode || '',
            'Referral_ID': params.memberId || '', // <--- NUOVA RIGA: Salva il Member ID
            'Prezzo': params.price,
            'ID_Carrello': params.cartId
        });
        
    } catch (error) {
        console.error('❌ Errore logging Google Sheets:', error.message);
        // NON bloccare il checkout - il log è secondario
    }
}

/**
 * Gestione intelligente degli sconti Stripe
 * @param {string} discountCode - Codice sconto inserito dall'utente
 * @returns {Promise<Object>} - { discounts: [], allowPromo: boolean }
 */
async function handleDiscountCode(discountCode) {
    const result = { discounts: [], allowPromo: true };
    
    if (!discountCode || discountCode.trim() === "") {
        return result;
    }
    
    const cleanCode = discountCode.trim();
    
    try {
        // TENTATIVO 1: Cerca come Promotion Code
        const promoList = await stripe.promotionCodes.list({
            code: cleanCode, 
            active: true, 
            limit: 1
        });
        
        if (promoList.data.length > 0) {
            result.discounts.push({ 
                promotion_code: promoList.data[0].id 
            });
            result.allowPromo = false;
            console.log(`✅ Promotion Code applicato: ${cleanCode}`);
            return result;
        }
        
        // TENTATIVO 2: Cerca come Coupon ID diretto
        try {
            const coupon = await stripe.coupons.retrieve(
                cleanCode.toUpperCase()
            );
            
            if (coupon && coupon.valid) {
                result.discounts.push({ coupon: coupon.id });
                result.allowPromo = false;
                console.log(`✅ Coupon applicato: ${cleanCode}`);
                return result;
            }
        } catch (couponError) {
            console.log(`ℹ️ Codice '${cleanCode}' non trovato come coupon`);
        }
        
    } catch (error) {
        console.error('⚠️ Errore gestione sconto:', error.message);
    }
    
    return result;
}

// ========== HANDLER PRINCIPALE ==========
export const handler = async (event, context) => {
    // 1. METODO HTTP
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }
    
    try {
        // 2. PARSING E LOGICA DI RECUPERO
        let data = JSON.parse(event.body);

        // --- MURO HONEYPOT: PROTEZIONE BOT ---
        if (data.fax_number && data.fax_number.trim() !== "") {
            console.warn("🤖 Bot rilevato nel Checkout tramite Honeypot");
            // Rispondiamo con un 200 finto. Il bot crederà di aver vinto, 
            // ma noi non abbiamo aperto sessioni Stripe né scritto su Sheet.
            return { 
                statusCode: 200, 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: "Success" }) 
            };
        }
        let cartId = data.cartId; 
        let isRecovery = false;

        if (cartId) {
            const existingData = await getExistingCart(cartId);
            if (existingData) {
                console.log(`🔄 Recupero carrello rilevato: ${cartId}`);
                data = { ...existingData, ...data }; 
                isRecovery = true;
            }
        }

        if (!cartId) cartId = generateCartId();

        // VALIDAZIONE (Mantieni questa parte!)
        const validation = validateCheckoutData(data);
        if (!validation.valid) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: validation.error }) 
            };
        }
        
        // 3. VERIFICA PRODOTTO
        const product = INVENTORY[data.kitId];
        if (!product) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: 'Prodotto non valido' }) 
            };
        }
        
        // 4. NORMALIZZAZIONE LINGUA E PRICING
        const lang = normalizeLang(data.lang);
        const finalPrice = product.prices[lang];
        const allowedCountries = lang === 'it' ? COUNTRIES_IT_ONLY : COUNTRIES_EU_ALL;
        
        // 5. URL CONFIGURAZIONE
        const SITE_URL = process.env.SITE_URL || 'https://adoptyourolive.com';
        const cancelBaseUrl = lang === 'it' ? `${SITE_URL}/it` : SITE_URL;
        
        // 6. ID CARRELLO (Già gestito sopra nella logica di recupero)
        // Non serve ri-dichiararlo, usiamo il valore di cartId definito all'inizio
        
        // 7. LOG ASINCRONO (Ma atteso, per evitare che Netlify chiuda il processo)
        // Nota: logToSheet ha il suo try/catch interno, quindi se fallisce 
        // non blocca lo script, ma dobbiamo aspettare che finisca.
        if (!isRecovery) {
        await logToSheet({
            cartId,
            buyerFirstName: data.buyerFirstName,
            buyerLastName: data.buyerLastName,
            email: data.email,
            lang,
            certName: data.certName,
            labelName: data.labelName,
            productName: product.name,
            isGift: data.isGift,
            giftMessage: data.giftMessage,
            discountCode: data.discountCode,
            memberId: data.memberId, // <--- NUOVO: Passiamo il Member ID al log
            price: (finalPrice / 100).toFixed(2)
        });
    }
        // LOGICA REFERRAL vs SCONTI
        let sessionDiscounts = [];
        let enablePromoCodes = true; // Default: permetti codici

        // 1. Se c'è un Member ID valido, blocchiamo i codici sconto
        if (data.memberId && data.memberId.length > 2) {
            enablePromoCodes = false; 
            // Non cerchiamo nemmeno sconti se c'è un referral
        } else {
            // 2. Se NON c'è Referral, gestiamo gli sconti normalmente
            const discResult = await handleDiscountCode(data.discountCode);
            sessionDiscounts = discResult.discounts;
            // Se abbiamo applicato uno sconto manuale, disabilitiamo il campo promo di Stripe
            if (sessionDiscounts.length > 0) {
                enablePromoCodes = false;
            } else if (discResult.allowPromo === false) {
                 enablePromoCodes = false;
            }
        }
        
        // 9. CREAZIONE SESSIONE STRIPE
        const sessionParams = {
            payment_method_types: ['card', 'paypal', 'klarna', 'revolut_pay'],
            customer_email: data.email,
            
            phone_number_collection: { enabled: true },
            shipping_address_collection: {
                allowed_countries: allowedCountries,
            },
            
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: product.name,
                        description: `Adoption for: ${data.certName}`,
                    },
                    unit_amount: finalPrice,
                },
                quantity: 1,
            }],
            
            mode: 'payment',
            
            metadata: {
                cart_id: cartId,
                kit_id: data.kitId,
                lang: lang,
                buyer_first_name: data.buyerFirstName, // <--- INVIAMO IL NOME ESATTO
    buyer_last_name: data.buyerLastName,   // <--- INVIAMO IL COGNOME ESATTO
                buyer_name: `${data.buyerFirstName} ${data.buyerLastName}`,
                buyer_email: data.email,
                cert_name: data.certName,
                label_name: data.labelName,
                is_gift: data.isGift ? 'YES' : 'NO',
                gift_message: data.giftMessage || '',
                referral_id: data.memberId || '', // <--- NUOVO: Salvato nei metadati Stripe
                discount_code: data.discountCode || '',
                // Dati extra per analytics
                timestamp: new Date().toISOString(),
                price_tier: lang // Utile per report
            },
            
            success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&amount=${(finalPrice / 100).toFixed(2)}`,
            cancel_url: `${cancelBaseUrl}/index.html?recover_cart=${cartId}#adoption-kits`,

            // Tracking Referral nativo di Stripe (opzionale ma utile)
            client_reference_id: data.memberId || undefined
        };
        
        // Aggiungi sconti solo se presenti (usando i nomi corretti delle tue variabili)
if (sessionDiscounts.length > 0) {
    sessionParams.discounts = sessionDiscounts;
} else if (enablePromoCodes) {
    sessionParams.allow_promotion_codes = true;
}
        
        const session = await stripe.checkout.sessions.create(sessionParams);
        
        // 10. RISPOSTA SUCCESS
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                id: session.id, 
                url: session.url 
            })
        };
        
    } catch (error) {
        console.error('❌ ERRORE CHECKOUT:', error);
        
        // Gestione errori dettagliata
        let errorMessage = 'Errore durante la creazione del checkout';
        let statusCode = 500;
        
        if (error.type === 'StripeInvalidRequestError') {
            errorMessage = 'Errore nella configurazione del pagamento';
            statusCode = 400;
        } else if (error.type === 'StripeAPIError') {
            errorMessage = 'Servizio di pagamento temporaneamente non disponibile';
            statusCode = 503;
        }
        
        return { 
            statusCode, 
            body: JSON.stringify({ 
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            }) 
        };
    }
};
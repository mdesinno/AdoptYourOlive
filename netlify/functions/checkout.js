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
    },
    // La Bottega - Linea A (Prezzi Normal / VIP)
    'bundle-base': { 
        prices: { normal: { en: 6900, it: 3900 }, vip: { en: 5400, it: 3400 } }, 
        name: 'The Tasting Box (6 pcs)' 
    },
    'bundle-intermedio': { 
        prices: { normal: { en: 9400, it: 5400 }, vip: { en: 7400, it: 4400 } }, 
        name: 'The Pantry Box (9 pcs)' 
    },
    'bundle-completo': { 
        prices: { normal: { en: 12900, it: 7900 }, vip: { en: 9900, it: 6400 } }, 
        name: 'The Grand Harvest (15 pcs)' 
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
    // SE ESISTE IL CARRELLO, SALTA IL CONTROLLO DEL kitId SINGOLO
    if (data.cart && Array.isArray(data.cart)) return { valid: true };
    
    const isBundle = data.kitId && data.kitId.startsWith('bundle-');
    let required = ['kitId'];
    
    if (!isBundle) {
        required.push('email', 'buyerFirstName', 'buyerLastName', 'certName', 'labelName');
    }
    
    for (const field of required) {
        if (!data[field] || data[field].trim() === '') {
            return { valid: false, error: `Campo obbligatorio mancante: ${field}` };
        }
    }
    
    if (!isBundle) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
            return { valid: false, error: 'Email non valida' };
        }
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
        let kitId = 'welcome-kit'; // Fallback predefinito
        
        if (prodName.includes('family')) kitId = 'family-kit';
        else if (prodName.includes('reserve')) kitId = 'reserve-kit';
        else if (prodName.includes('tasting')) kitId = 'bundle-base';
        else if (prodName.includes('pantry')) kitId = 'bundle-intermedio';
        else if (prodName.includes('harvest')) kitId = 'bundle-completo';

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

/**
 * Verifica in tempo reale se il Member ID è valido nel database Google Sheet
 */
async function verifyVipOnBackend(memberId) {
    try {
        const scriptUrl = process.env.GOOGLE_SCRIPT_URL; // La nuova variabile su Netlify!
        if (!scriptUrl) return false;
        
        const response = await fetch(scriptUrl, {
            method: 'POST',
            body: JSON.stringify({ memberId: memberId }),
            headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        
        if (result.valid) {
            const now = new Date().getTime();
            const exp = new Date(result.expiration).getTime();
            return now < exp; // Ritorna true solo se non è scaduto
        }
        return false;
    } catch (e) {
        console.error("Errore verifica VIP backend:", e);
        return false; // In caso di errore di rete, nega lo sconto per sicurezza
    }
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
        
        // 3 e 4. BIVIO LOGICO (CARRELLO VS ADOZIONE) E CALCOLO PREZZI
        const lang = normalizeLang(data.lang);
        const isItalian = lang === 'it';
        const allowedCountries = isItalian ? COUNTRIES_IT_ONLY : COUNTRIES_EU_ALL;
        
        let lineItems = [];
        let orderSummary = [];
        let totalAmount = 0;
        let isVip = false;
        let isBottega = false;

        // Controllo VIP
        if (data.memberId && data.memberId.length > 2) {
            isVip = await verifyVipOnBackend(data.memberId);
        }

        if (data.cart && Array.isArray(data.cart)) {
            // È IL CARRELLO DELLA BOTTEGA
            isBottega = true;
            for (const item of data.cart) {
                const product = INVENTORY[item.id];
                if (!product) continue;
                const amount = isVip ? product.prices.vip[lang] : product.prices.normal[lang];
                
                lineItems.push({
                    price_data: { currency: 'eur', product_data: { name: product.name }, unit_amount: amount },
                    quantity: parseInt(item.qty, 10) || 1
                });
                orderSummary.push(`${item.qty}x ${item.id}`);
                totalAmount += amount * item.qty;
            }
        } else {
            // È UN'ADOZIONE SINGOLA
            const product = INVENTORY[data.kitId];
            if (!product) return { statusCode: 400, body: JSON.stringify({ error: 'Prodotto non valido' }) };
            isBottega = data.kitId.startsWith('bundle-');
            let amount = isBottega ? (isVip ? product.prices.vip[lang] : product.prices.normal[lang]) : product.prices[lang];
            const qty = data.quantity ? parseInt(data.quantity) : 1;

            const productData = { name: product.name };
            if (!isBottega && data.certName) {
                productData.description = `Adoption for: ${data.certName}`;
            }

            lineItems.push({
                price_data: {
                    currency: 'eur',
                    product_data: productData,
                    unit_amount: amount,
                },
                quantity: qty
            });
            orderSummary.push(`${qty}x ${data.kitId}`);
            totalAmount = amount * qty;
        }
        
        if (lineItems.length === 0) return { statusCode: 400, body: JSON.stringify({ error: 'Carrello vuoto' }) };

        // 5. URL CONFIGURAZIONE
        const SITE_URL = process.env.SITE_URL || 'https://adoptyourolive.com';
        const cancelBaseUrl = lang === 'it' ? `${SITE_URL}/it` : SITE_URL;
        
        // 7. LOG ASINCRONO SU SHEET
        if (!isRecovery) {
            await logToSheet({
                cartId,
                buyerFirstName: data.buyerFirstName,
                buyerLastName: data.buyerLastName,
                email: data.email,
                lang,
                certName: data.certName || '', // Evita errori se è un bundle
                labelName: data.labelName || '',
                productName: orderSummary.join(', '), // INVIA LA STRINGA DEL CARRELLO
                isGift: data.isGift || false,
                giftMessage: data.giftMessage || '',
                discountCode: data.discountCode || '',
                memberId: data.memberId || '', 
                price: (totalAmount / 100).toFixed(2) // USA IL NUOVO TOTALE
            });
        }

        // 8. LOGICA REFERRAL VS SCONTI
        let sessionDiscounts = [];
        let enablePromoCodes = true;

        if (data.memberId && data.memberId.length > 2 && !isBundle) {
            // BIVIO A: Adozione + Member ID -> Niente sconti (Logica Regalo Bonus Club)
            enablePromoCodes = false; 
        } else if (isBundle && isVip) {
            // BIVIO B: Box Bottega + VIP Approvato -> Niente sconti extra, ha già il listino riservato
            enablePromoCodes = false;
        } else {
            // Nessun conflitto: cerchiamo codici promozionali normalmente
            const discResult = await handleDiscountCode(data.discountCode);
            sessionDiscounts = discResult.discounts;
            if (sessionDiscounts.length > 0 || discResult.allowPromo === false) {
                enablePromoCodes = false;
            }
        }
        
        // 9. CREAZIONE SESSIONE STRIPE
        const successPath = isItalian ? '/it/success.html' : '/success.html';

        const sessionParams = {
            payment_method_types: ['card', 'paypal', 'klarna', 'revolut_pay'],
            phone_number_collection: { enabled: true },
            shipping_address_collection: { allowed_countries: allowedCountries },
            line_items: lineItems, // USA L'ARRAY DINAMICO
            mode: 'payment',
            locale: lang,
            metadata: {
                cart_id: cartId,
                lang: lang,
                buyer_first_name: data.buyerFirstName || '',
                buyer_last_name: data.buyerLastName || '',
                buyer_name: data.buyerFirstName ? `${data.buyerFirstName} ${data.buyerLastName}` : 'Da Stripe',
                buyer_email: data.email || '',
                cert_name: data.certName || '',
                label_name: data.labelName || '',
                is_gift: data.isGift ? 'YES' : 'NO',
                gift_message: data.giftMessage || '',
                referral_id: data.memberId || '', 
                discount_code: data.discountCode || '',
                timestamp: new Date().toISOString(),
                price_tier: lang,
                order_summary: orderSummary.join(', ') // <-- IL TUO CRM LEGGE QUESTO CAMPO
            },
            success_url: `${SITE_URL}${successPath}?session_id={CHECKOUT_SESSION_ID}&amount=${(totalAmount / 100).toFixed(2)}&flow=${isBottega ? 'bottega' : 'adoption'}`,
            cancel_url: isBottega 
                ? `${cancelBaseUrl}/shop.html?payment=cancelled` 
                : `${cancelBaseUrl}/index.html?recover_cart=${cartId}#adoption-kits`,
            client_reference_id: data.memberId || undefined
        };

        // Aggiunge la customer_email solo se l'abbiamo raccolta sul sito (es. Adozioni)
        // Se è vuota (es. Bottega), Stripe chiederà l'email nella sua pagina
        if (data.email && data.email.trim() !== '') {
            sessionParams.customer_email = data.email;
        }
        
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
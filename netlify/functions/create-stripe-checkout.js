// netlify/functions/create-stripe-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const discounts = require('./_discounts.js');
const { google } = require('googleapis');

// ===== Helpers Google Sheets =====
async function getSheets() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

async function appendAttemptRow({
  spreadsheetId, sessionId, createdISO, buyerEmail,
  isGift, treeType, finalAmount, discountCode, language
}) {
  const sheets = await getSheets();
  // Colonne attese in "Log tentativi":
  // ID ordine | Data ordine | Email acquirente | Nome acquirente | Email adottante | Nome adottante |
  // Regalo? | Tipo adozione | Messaggio personalizzato | Indirizzo 1 | Indirizzo 2 | Città | CAP | Nazione |
  // Note | Codice sconto usato | Importo ordine | Lingua | Stato (calcolata da formula)
  const values = [[
    sessionId,
    createdISO,
    buyerEmail || '',
    '',
    '', // email adottante (se regalo la mettiamo dopo)
    '',
    isGift ? 'Sì' : 'No',
    treeType || '',
    '',
    '', '', '', '', '',
    '', // Note
    discountCode || '',
    (finalAmount / 100).toFixed(2).replace('.', ','), // Importo ordine in € con virgola
    language || ''
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Log tentativi!A:Z',
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

// =================================

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const data = JSON.parse(event.body || '{}');
    const {
      treeType,
      customerEmail,
      discountCode,
      certificateName = '',
      certificateMessage = '',
      language = 'it',
      isGift = false,
      recipientEmail = '',
      orderNote = ''
    } = data;

    // Listino fisso (centesimi)
    const PRICE_CENTS = {
      young:    4900,
      mature:  29900,
      ancient: 49900,
      historic:64900
    };
    const PRODUCT_NAME = {
      young:    "Adozione Ulivo Giovane",
      mature:   "Adozione Ulivo Maturo",
      ancient:  "Adozione Ulivo Antico",
      historic: "Adozione Ulivo Secolare"
    };
    const unitAmount = PRICE_CENTS[treeType];
    if (!unitAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di albero non valido' }) };
    }

    // Applica sconto lato server
    const code = (discountCode || '').trim().toUpperCase();
    const rule = code && discounts[code] ? discounts[code] : null;
    const finalAmount = (() => {
      if (!rule) return unitAmount;
      if (rule.type === 'percentage') {
        return Math.max(Math.round(unitAmount * (100 - Number(rule.value)) / 100), 0);
      }
      if (rule.type === 'fixed') {
        return Math.max(unitAmount - Number(rule.value), 0);
      }
      return unitAmount;
    })();

    const siteUrl = process.env.URL || `https://${event.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',

      // 👇 Lasciamo a Stripe la scelta dei metodi (PayPal incluso se abilitato in Dashboard)
      automatic_payment_methods: { enabled: true },

      // Raccogliamo indirizzo di spedizione e fatturazione
      shipping_address_collection: {
        allowed_countries: ['IT','DE','FR','NL','NO','BE','ES','PT','AT','CH','DK','SE','FI','IE','LU','GB']
      },
      billing_address_collection: 'required',

      // Email precompilata
      customer_email: customerEmail || undefined,

      // Aggiorna indirizzi sul Customer
      customer_update: { address: 'auto', shipping: 'auto' },

      // ✅ Metadati SUL PAYMENT INTENT (visibili sul pagamento)
      payment_intent_data: {
        metadata: {
          language,
          tree_type: treeType,
          base_price: String(unitAmount),
          discount_code: code,
          discount_type: rule ? rule.type : '',
          discount_value: rule ? String(rule.value) : '',
          final_amount: String(finalAmount),

          is_gift: isGift ? 'yes' : 'no',
          recipient_email: recipientEmail,
          certificate_name: certificateName,
          certificate_message: certificateMessage,
          order_note: orderNote
        }
      },

      // Prezzo già scontato
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: finalAmount,
          product_data: {
            name: PRODUCT_NAME[treeType],
            metadata: { treeType }
          }
        }
      }],

      // Niente campo "codice" in Stripe: lo abbiamo già applicato
      allow_promotion_codes: false,

      success_url: `${siteUrl}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${siteUrl}/cancel.html`,

      // Etichetta generica
      metadata: { order_source: 'AYO_Site' }
    });

    // --- LOG TENTATIVI: scriviamo subito la riga ---
    try {
      await appendAttemptRow({
        spreadsheetId: process.env.GSHEET_ID || process.env.SHEET_ID,
        sessionId: session.id,
        createdISO: new Date().toISOString(),
        buyerEmail: customerEmail || '',
        isGift,
        treeType,
        finalAmount,
        discountCode: code,
        language
      });
    } catch (e) {
      console.warn('Append Log tentativi failed:', e?.response?.data || e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ checkoutUrl: session.url }) };
  } catch (error) {
    console.error('ERRORE create-stripe-checkout:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create payment session.' }) };
  }
};

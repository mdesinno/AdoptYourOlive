// netlify/functions/create-stripe-checkout.js
'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');
const discounts = require('./_discounts.js');

// ===== Google Sheets helpers (per Log tentativi) =====
const GSHEET_ID = process.env.GSHEET_ID;

async function gsheetAuth() {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

async function ensureHeaderIfMissing(sheetName, header) {
  const s = await gsheetAuth();
  const r = await s.spreadsheets.values.get({
    spreadsheetId: GSHEET_ID,
    range: `${sheetName}!A1:Z1`
  }).catch(() => ({ data: {} }));
  const first = (r.data && r.data.values && r.data.values[0]) || [];
  if (first.length === 0) {
    await s.spreadsheets.values.update({
      spreadsheetId: GSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header] }
    });
  }
}

async function appendRow(sheetName, values) {
  const s = await gsheetAuth();
  await s.spreadsheets.values.append({
    spreadsheetId: GSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}
// =====================================================

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      treeType,
      customerEmail = '',
      discountCode = '',
      shippingDetails = {},
      certificateName = '',
      certificateMessage = '',
      language = 'it',
      isGift = false,
      recipientEmail = '',
      orderNote = ''
    } = body;

    // Listino fisso (centesimi)
    const PRICE_CENTS = {
      young:    4900,
      mature:  29900,
      ancient: 49900,
      historic:64900
    };
    const PRODUCT_NAME = {
      young:   'Adozione Ulivo Giovane',
      mature:  'Adozione Ulivo Maturo',
      ancient: 'Adozione Ulivo Antico',
      historic:'Adozione Ulivo Secolare'
    };

    const unitAmount = PRICE_CENTS[treeType];
    if (!unitAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di albero non valido' }) };
    }

    // Calcolo sconto lato server
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

    // Sequenza metodi con fallback
    const methodSets = [
      ['card','paypal','klarna','revolut_pay','link'],
      ['card','paypal','link'],
      ['card','link'],
      ['card']
    ];

    // Metadata completi sul PaymentIntent (tutto dal form)
    const md = {
      order_source: 'AYO_Site',
      language,
      tree_type: treeType,
      base_price: String(unitAmount),
      discount_code: code,
      discount_type: rule ? rule.type : '',
      discount_value: rule ? String(rule.value) : '',
      final_amount: String(finalAmount),
      is_gift: isGift ? 'yes' : 'no',
      recipient_email: recipientEmail || '',
      certificate_name: certificateName || '',
      certificate_message: certificateMessage || '',
      order_note: orderNote || '',
      // Spedizione dal form (no raccolta in Checkout)
      shipping_name: shippingDetails?.name || '',
      shipping_line1: shippingDetails?.address?.line1 || '',
      shipping_line2: shippingDetails?.address?.line2 || '',
      shipping_city: shippingDetails?.address?.city || '',
      shipping_postal_code: shippingDetails?.address?.postal_code || '',
      shipping_country: shippingDetails?.address?.country || '',
      buyer_email: customerEmail || ''
    };

    let session, lastErr;
    for (const payment_method_types of methodSets) {
      try {
        session = await stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types,

          // NON chiediamo indirizzo in Checkout
          billing_address_collection: 'auto',
          customer_email: customerEmail || undefined,

          // Prezzo già scontato (finalAmount)
          line_items: [{
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: finalAmount,
              product_data: { name: PRODUCT_NAME[treeType], metadata: { treeType } }
            }
          }],

          // Nessun codice promo in Stripe (già gestito sul sito)
          allow_promotion_codes: false,

          // Metadata sul PaymentIntent
          payment_intent_data: {
            metadata: md,
            // Shipping anche sul PaymentIntent (utile in dashboard)
            shipping: {
              name: shippingDetails?.name || (customerEmail || 'AYO Customer'),
              address: {
                line1: shippingDetails?.address?.line1 || '',
                line2: shippingDetails?.address?.line2 || '',
                city: shippingDetails?.address?.city || '',
                postal_code: shippingDetails?.address?.postal_code || '',
                country: shippingDetails?.address?.country || 'IT'
              }
            }
          },

          metadata: { order_source: 'AYO_Site' },
          success_url: `${siteUrl}/success.html?sid={CHECKOUT_SESSION_ID}`,
          cancel_url:  `${siteUrl}/cancel.html`
        });
        lastErr = null;
        break; // creata!
      } catch (err) {
        lastErr = err; // prova la prossima combinazione
      }
    }

    if (!session) {
      console.error('Create session failed:', lastErr?.message || lastErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Create session failed' }) };
    }

    // ===== LOG TENTATIVI: scrivi riga completa (NON blocca mai il checkout) =====
    try {
      const SHEET = 'Log tentativi';
      const header = [
        'ID ordine','Data ordine','Email acquirente','Nome acquirente',
        'Email adottante','Nome adottante','Regalo?','Tipo adozione',
        'Messaggio personalizzato','Indirizzo spedizione 1','Indirizzo spedizione 2',
        'Città spedizione','CAP spedizione','Nazione spedizione','Note sull\'ordine',
        'Codice sconto usato','Importo ordine','Lingua'
      ];
      await ensureHeaderIfMissing(SHEET, header);

      const nowISO = new Date().toISOString();

      // Buyer/adopter
      const buyerEmail   = customerEmail || '';
      const buyerName    = shippingDetails?.name || '';              // dal form
      const adopterEmail = isGift ? (recipientEmail || '') : buyerEmail;
      const adopterName  = isGift ? (certificateName || '') : buyerName;

      // Flag 'Sì'/'No'
      const regaloFlag = isGift ? 'Sì' : 'No';

      // Tipo adozione leggibile (coerente con lo store attuale)
      const tipoAdozione = PRODUCT_NAME[treeType] || treeType || '';

      // Importo in euro (numero)
      const importoEuro = (finalAmount || 0) / 100;

      await appendRow(SHEET, [
        session.id,
        nowISO,
        buyerEmail,
        buyerName,
        adopterEmail,
        adopterName,
        regaloFlag,
        tipoAdozione,
        certificateMessage || '',
        shippingDetails?.address?.line1 || '',
        shippingDetails?.address?.line2 || '',
        shippingDetails?.address?.city || '',
        shippingDetails?.address?.postal_code || '',
        shippingDetails?.address?.country || '',
        orderNote || '',
        code || '',
        importoEuro,
        (language || 'it')
      ]);
    } catch (e) {
      console.warn('Log tentativi (append) fallito:', e?.message || e);
      // NON rilancio: il checkout deve comunque andare avanti
    }

    // Risposta al client
    return { statusCode: 200, body: JSON.stringify({ checkoutUrl: session.url, sessionId: session.id }) };
  } catch (error) {
    console.error('ERRORE create-stripe-checkout:', error?.message || error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Create session failed' }) };
  }
};

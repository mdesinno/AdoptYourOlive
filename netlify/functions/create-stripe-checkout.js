// netlify/functions/create-stripe-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Opzione A:
 * - Prezzi calcolati SOLO qui (server).
 * - Codici sconto: l’utente li inserisce in Checkout (allow_promotion_codes: true).
 * - Indirizzo: lo chiede Stripe (shipping_address_collection).
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body || '{}');

    const {
      treeType,                // 'young' | 'mature' | 'ancient' | 'historic'
      customerEmail,           // email acquirente
      certificateName,         // per certificato (solo metadati)
      certificateMessage,      // per certificato (solo metadati)
      language,                // lingua
      isGift,                  // boolean
      recipientEmail,          // opzionale
      orderNote                // opzionale
    } = data;

    // 1) PREZZI UFFICIALI (CENTESIMI)
    const PRICE_CENTS = {
      young:    4900,   // 49,00 €
      mature:  29900,   // 299,00 €
      ancient: 49900,   // 499,00 €
      historic:64900    // 649,00 €
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

    // 2) Metadati utili per post-vendita / fogli / email
    const metadata = {
      treeType,
      certificateName: certificateName || '',
      certificateMessage: certificateMessage || '',
      language: language || 'it',
      isGift: String(!!isGift),
      recipientEmail: recipientEmail || '',
      orderNote: orderNote || ''
    };

    // 3) Config Checkout
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888';

    const sessionConfig = {
      mode: 'payment',
      payment_method_types: ['card', 'klarna', 'paypal', 'revolut_pay'],
      customer_email: customerEmail,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: PRODUCT_NAME[treeType] },
          unit_amount: unitAmount
        },
        quantity: 1
      }],
      allow_promotion_codes: true, // sconti gestiti in checkout
      shipping_address_collection: {
        allowed_countries: ['IT','DE','NL','NO','FR','ES','GB','CH','AT']
      },
      success_url: `${siteUrl}/success.html`,
      cancel_url:  `${siteUrl}/cancel.html`,
      metadata
    };

    const session = await stripe.checkout.sessions.create(sessionConfig);
    return { statusCode: 200, body: JSON.stringify({ checkoutUrl: session.url }) };

  } catch (err) {
    console.error('Errore create-stripe-checkout:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Impossibile creare la sessione di pagamento' }) };
  }
};

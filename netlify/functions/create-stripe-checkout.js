// netlify/functions/create-stripe-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const discounts = require('./_discounts.js');

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

      // Lasciamo a Stripe la scelta dei metodi (PayPal apparirà se abilitato nel tuo account)
      automatic_payment_methods: { enabled: true },

      // Raccogliamo indirizzo spedizione + fatturazione
      shipping_address_collection: {
        allowed_countries: ['IT','DE','FR','NL','NO','BE','ES','PT','AT','CH','DK','SE','FI','IE','LU','GB']
      },
      billing_address_collection: 'required',
      customer_email: customerEmail || undefined,
      customer_update: { address: 'auto', shipping: 'auto' },

      // ✅ Metadati sul PaymentIntent (visibili nel pagamento)
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

      allow_promotion_codes: false,
      success_url: `${siteUrl}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${siteUrl}/cancel.html`,
      metadata: { order_source: 'AYO_Site' }
    });

    return { statusCode: 200, body: JSON.stringify({ checkoutUrl: session.url }) };
  } catch (error) {
    console.error('ERRORE create-stripe-checkout:', error?.message || error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Create session failed' }) };
  }
};

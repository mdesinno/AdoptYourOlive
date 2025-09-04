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
      // ignoriamo qualsiasi price lato client
      customerEmail,
      discountCode,
      certificateName = '',
      certificateMessage = '',
      language = 'it',
      isGift = false,
      recipientEmail = '',
      orderNote = ''
    } = data;

    // 1) Listino prezzi fisso (in centesimi)
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

    // 2) Applica eventuale sconto
    let applied = null;
    const code = (discountCode || '').trim().toUpperCase();
    if (code && discounts[code]) {
      applied = discounts[code];
    }
    const finalAmount = (() => {
      if (!applied) return unitAmount;
      if (applied.type === 'percentage') {
        const scontato = Math.round(unitAmount * (100 - Number(applied.value)) / 100);
        return Math.max(scontato, 0);
      }
      if (applied.type === 'fixed') {
        return Math.max(unitAmount - Number(applied.value), 0);
      }
      return unitAmount;
    })();

    // 3) Crea la sessione Stripe con il PREZZO GIÀ SCONTATO
    const siteUrl = process.env.URL || `https://${event.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,

      // NIENTE "allow_promotion_codes": il cliente non vedrà un campo codice in Stripe
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

      // Stripe raccoglie l'indirizzo di spedizione
      shipping_address_collection: {
        allowed_countries: ['IT','DE','FR','NL','NO','BE','ES','PT','AT','CH','DK','SE','FI','IE','LU','GB']
      },

      // Torno alle tue pagine
      success_url: `${siteUrl}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${siteUrl}/cancel.html`,

      // Salviamo TUTTO nelle metadata (le useremo nel webhook)
      metadata: {
        language,
        tree_type: treeType,
        base_price: String(unitAmount),
        discount_code: code,
        discount_type: applied ? applied.type : '',
        discount_value: applied ? String(applied.value) : '',
        final_amount: String(finalAmount),

        is_gift: isGift ? 'yes' : 'no',
        recipient_email: recipientEmail,
        certificate_name: certificateName,
        certificate_message: certificateMessage,
        order_note: orderNote
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: session.url })
    };
  } catch (error) {
    console.error('ERRORE create-stripe-checkout:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create payment session.' }) };
  }
};

// netlify/functions/create-stripe-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const discounts = require('./_discounts.js');

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
      young:   4900,
      mature: 29900,
      ancient:49900,
      historic:64900
    };
    const PRODUCT_NAME = {
      young:   "Adozione Ulivo Giovane",
      mature:  "Adozione Ulivo Maturo",
      ancient: "Adozione Ulivo Antico",
      historic:"Adozione Ulivo Secolare"
    };

    const unitAmount = PRICE_CENTS[treeType];
    if (!unitAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Tipo di albero non valido' }) };
    }

    // Calcolo sconto lato server (non ci fidiamo del prezzo del client)
    const code = (discountCode || '').trim().toUpperCase();
    const rule = code && discounts[code] ? discounts[code] : null;

    const finalAmount = (() => {
      if (!rule) return unitAmount;
      if (rule.type === 'percentage') {
        // arrotondiamo ai centesimi e non scendiamo sotto 0
        return Math.max(Math.round(unitAmount * (100 - Number(rule.value)) / 100), 0);
      }
      if (rule.type === 'fixed') {
        return Math.max(unitAmount - Number(rule.value), 0);
      }
      return unitAmount;
    })();

    const siteUrl = process.env.URL || `https://${event.headers.host}`;

    // Sequenza metodi con fallback (se qualcuno non è abilitato)
    const methodSets = [
      ['card','paypal','klarna','revolut_pay','link'],
      ['card','paypal','link'],
      ['card','link'],
      ['card']
    ];

    // Metadata completi sul PaymentIntent
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
      // Spedizione (dal tuo form; non chiediamo nulla in Checkout)
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

          // Niente campo “codice” in Stripe
          allow_promotion_codes: false,

          // Attach metadata al PaymentIntent
          payment_intent_data: {
            metadata: md,
            // scrivo anche la shipping sul PaymentIntent, utile in Dashboard
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

    return { statusCode: 200, body: JSON.stringify({ checkoutUrl: session.url, sessionId: session.id }) };
  } catch (error) {
    console.error('ERRORE create-stripe-checkout:', error?.message || error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Create session failed' }) };
  }
};

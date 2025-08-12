// File: netlify/functions/create-stripe-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const data = JSON.parse(event.body);
        // Ora riceviamo anche i dettagli di spedizione dal frontend
        const { treeType, price, customerEmail, discountCode, shippingDetails } = data;

        const productNames = {
            young: "Adozione Ulivo Giovane",
            mature: "Adozione Ulivo Maturo",
            ancient: "Adozione Ulivo Antico",
            historic: "Adozione Ulivo Secolare"
        };
        const productName = productNames[treeType] || "Adozione Ulivo";

        let sessionConfig = {
            payment_method_types: ['card', 'klarna', 'paypal'],
            
            // Inseriamo i dati del cliente, incluso l'indirizzo che abbiamo già
            customer_details: {
              email: customerEmail,
              name: shippingDetails.name,
              address: shippingDetails.address
            },

            // Abilitiamo il calcolo automatico dell'IVA
            automatic_tax: {
                enabled: true,
            },

            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: productName
                    },
                    unit_amount: Math.round(price * 100),
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.URL}/success.html`,
            cancel_url: `${process.env.URL}/cancel.html`,
        };
        
        if (discountCode) {
            const promotionCodes = await stripe.promotionCodes.list({
                code: discountCode.toUpperCase(),
                active: true,
                limit: 1
            });
            if (promotionCodes.data.length > 0) {
                sessionConfig.discounts = [{
                    coupon: promotionCodes.data[0].coupon.id
                }];
            }
        }
        
        const session = await stripe.checkout.sessions.create(sessionConfig);

        return {
            statusCode: 200,
            body: JSON.stringify({ checkoutUrl: session.url }),
        };

    } catch (error) {
        console.error("Stripe error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create payment session.' }) };
    }
};
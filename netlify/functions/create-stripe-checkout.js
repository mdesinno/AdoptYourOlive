// File: netlify/functions/create-stripe-checkout.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const data = JSON.parse(event.body);
        const { treeType, price, customerEmail, discountCode, shippingDetails } = data;

        const productNames = {
            young: "Adozione Ulivo Giovane",
            mature: "Adozione Ulivo Maturo",
            ancient: "Adozione Ulivo Antico",
            historic: "Adozione Ulivo Secolare"
        };
        const productName = productNames[treeType] || "Adozione Ulivo";

        // Creiamo prima il cliente su Stripe
        const customer = await stripe.customers.create({
            email: customerEmail,
            name: shippingDetails.name,
            address: shippingDetails.address
        });

        let sessionConfig = {
            payment_method_types: ['card', 'klarna', 'paypal'],
            
            // Usiamo l'ID del cliente appena creato
            customer: customer.id,

            // Abilitiamo il calcolo automatico dell'IVA
            automatic_tax: {
                enabled: true,
            },

            // Specifichiamo che la spedizione va allo stesso indirizzo del cliente
            shipping_address_collection: {
                allowed_countries: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'GB'],
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
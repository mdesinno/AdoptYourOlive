const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const data = JSON.parse(event.body);
        const { 
            treeType, price, customerEmail, discountCode, shippingDetails, 
            certificateName, certificateMessage, language, 
            isGift, recipientEmail, orderNote 
        } = data;

        const productNames = {
            young: "Adozione Ulivo Giovane",
            mature: "Adozione Ulivo Maturo",
            ancient: "Adozione Ulivo Antico",
            historic: "Adozione Ulivo Secolare"
        };
        const productName = productNames[treeType] || "Adozione Ulivo";

        const customer = await stripe.customers.create({
            email: customerEmail,
            name: shippingDetails.name,
            address: shippingDetails.address
        });

        let sessionConfig = {
            payment_method_types: ['card', 'klarna', 'paypal', 'revolut_pay'],
            customer: customer.id,
            automatic_tax: {
                enabled: true,
            },
            
            // ===== BLOCCO METADATI AGGIUNTO QUI =====
            payment_intent_data: {
                metadata: {
                    treeType: treeType,
                    certificateName: certificateName,
                    certificateMessage: certificateMessage,
                    language: language,
                    isGift: isGift,
                    recipientEmail: recipientEmail,
                    orderNote: orderNote,
                    discountCodeUsed: discountCode 
                }
            },
            // =======================================

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
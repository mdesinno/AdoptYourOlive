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

        const metadata = {
            tree_type: treeType,
            certificate_name: certificateName,
            certificate_message: certificateMessage,
            language: language,
            is_gift: isGift.toString(),
            recipient_email: recipientEmail,
            order_note: orderNote,
            discount_code_used: discountCode
        };

        let sessionConfig = {
            payment_method_types: ['card', 'klarna', 'paypal', 'revolut_pay'],
            customer: customer.id,
            automatic_tax: {
                enabled: true,
            },
            
            // Metadati per la SESSIONE (corretto per Make.com e webhook)
            metadata: metadata,
            
            // --- AGGIUNTA CHIAVE CHE RISOLVE LA VISUALIZZAZIONE ---
            // Diciamo a Stripe di copiare gli stessi metadati anche sul PAGAMENTO
            payment_intent_data: {
                metadata: metadata
            },
            // ---------------------------------------------------------

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
        console.error("ERRORE NELLA FUNZIONE NETLIFY:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create payment session.' }) };
    }
};
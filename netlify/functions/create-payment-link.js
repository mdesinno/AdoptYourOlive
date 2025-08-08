// File: /netlify/functions/create-payment-link.js

const REFERRAL_CODES = {
    'FOODANATOMIST': 0.10,
    'BLONDEELIVING': 0.10,
    'DENISEKORTLEVER': 0.10,
    'TRAVELTOGETHER': 0.10,
    'INGEPUTKER': 0.10,
    'STUKORECEPTJES': 0.10
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);
         // ==> INSERISCI QUESTO BLOCCO DI CONTROLLO QUI <==
        if (data['bot-field']) {
            // Se questo campo ha un valore, è un bot.
            console.log('Honeypot field filled, likely a bot.');
            return { statusCode: 400, body: 'Spam detected' };
        }
        // ===============================================
        let finalPrice = parseFloat(data.price);
        const referralCode = data['referral-code'] ? data['referral-code'].toUpperCase() : null;

        if (referralCode && REFERRAL_CODES[referralCode]) {
            const discountRate = REFERRAL_CODES[referralCode];
            finalPrice = finalPrice * (1 - discountRate);
        }

        const REVOLUT_API_KEY = process.env.REVOLUT_API_KEY;
        const REVOLUT_API_URL = 'https://merchant.revolut.com/api/1.0/orders';

        const orderDetails = {
            amount: Math.round(finalPrice * 100),
            currency: 'EUR',
            description: `Adozione ${data['tree-type']} - ${data.email}`
        };

        const revolutResponse = await fetch(REVOLUT_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REVOLUT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderDetails)
        });

        if (!revolutResponse.ok) {
            const errorBody = await revolutResponse.text();
            throw new Error(`Errore dall'API di Revolut: ${errorBody}`);
        }

        const revolutOrder = await revolutResponse.json();

        const paymentUrl = `https://revolut.me/pay/${revolutOrder.public_id}`;

        return {
            statusCode: 200,
            body: JSON.stringify({ paymentUrl: paymentUrl })
        };

    } catch (error) {
        console.error('Errore nella funzione create-payment-link:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Impossibile processare il pagamento.' })
        };
    }
};
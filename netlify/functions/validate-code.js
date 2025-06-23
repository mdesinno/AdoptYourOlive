// File: /netlify/functions/validate-code.js
const REFERRAL_CODES = {
    'INFLUENCERFOODDE': 0.15,
    'AYOMEMBER237': 0.10,
    'WELCOME10': 0.10
};

exports.handler = async (event) => {
    try {
        const { code } = JSON.parse(event.body);
        const upperCaseCode = code.toUpperCase();

        if (upperCaseCode && REFERRAL_CODES[upperCaseCode]) {
            return {
                statusCode: 200,
                body: JSON.stringify({ valid: true, rate: REFERRAL_CODES[upperCaseCode] })
            };
        } else {
            return {
                statusCode: 200,
                body: JSON.stringify({ valid: false })
            };
        }
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Errore di validazione' }) };
    }
};
// File: netlify/functions/validate-code.js

// PRIMA c'era un oggetto "discounts = {...}" qui. ELIMINALO e metti:
const discounts = require('./_discounts.js');


exports.handler = async (event) => {
    try {
        const { code } = JSON.parse(event.body);
        const upperCaseCode = code.toUpperCase();

        if (discounts[upperCaseCode]) {
            // Se il codice esiste, restituisci l'intero oggetto sconto
            return {
                statusCode: 200,
                body: JSON.stringify({
                    valid: true,
                    discount: discounts[upperCaseCode]
                })
            };
        } else {
            // Codice non trovato
            return {
                statusCode: 200,
                body: JSON.stringify({ valid: false })
            };
        }
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
    }
};
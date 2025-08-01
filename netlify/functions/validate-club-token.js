// File: /netlify/functions/validate-club-token.js

// Questo è il tuo token segreto per il club.
// Puoi cambiarlo con qualsiasi stringa complessa che preferisci.
const CLUB_TOKEN = 'axr-p8a-tq2-n9k';

exports.handler = async (event) => {
    try {
        const { token } = JSON.parse(event.body);

        // Controlla se il token inviato dalla pagina è identico al nostro token segreto.
        if (token && token === CLUB_TOKEN) {
            return {
                statusCode: 200,
                body: JSON.stringify({ valid: true })
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
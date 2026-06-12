exports.handler = async function(event, context) {
    // Accetta solo richieste POST
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Inserisci qui l'URL dell'App Web di Google Apps Script (oppure salvalo nelle variabili d'ambiente di Netlify)
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
    
    try {
        const payload = JSON.parse(event.body);
        const memberId = payload.memberId;

        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ memberId: memberId }),
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore di comunicazione col database' })
        };
    }
};
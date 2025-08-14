// File: netlify/functions/validate-code.js

const discounts = {
    // Esempio sconto percentuale
    'BENVENUTO10': { type: 'percentage', value: 10 }, 
    
    // Esempio sconto a importo fisso (1500 = 15,00€)
    'SPECIALE15': { type: 'fixed', value: 1500 },     
    
    // I tuoi codici esistenti, ora nel nuovo formato
    'FOODANATOMIST': { type: 'percentage', value: 10 },
    'BLONDEELIVING': { type: 'percentage', value: 10 },
    'DENISEKORTLEVER': { type: 'percentage', value: 10 },
    'TRAVELTOGETHER': { type: 'percentage', value: 10 },
    'INGEPUTKER': { type: 'percentage', value: 10 },
    'STUKORECEPTJES': { type: 'percentage', value: 10 },
    'MYFOODBLOG': { type: 'percentage', value: 10 },
    'KEUKENMEID': { type: 'percentage', value: 10 },
    'SCONTOPROVA': { type: 'fixed', value: 4700 },
    'SCONTOPROVA2': { type: 'fixed', value: 4700 },
    'PROVA3': { type: 'fixed', value: 4700 }  


    // Aggiungi qui altri codici...
};

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
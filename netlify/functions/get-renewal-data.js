/* netlify/functions/get-renewal-data.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { memberId } = JSON.parse(event.body);
        if (!memberId) return { statusCode: 400, body: JSON.stringify({ error: 'Member ID missing' }) };

        const cleanMemberId = memberId.trim().toLowerCase();

        const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decodedCreds);
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        const shUliveto = doc.sheetsByTitle['Uliveto'];
        const shOrdini = doc.sheetsByTitle['Ordini'];
        
        if (!shUliveto || !shOrdini) throw new Error("Tabs missing.");

        // 1. Validazione del Member ID e recupero del codice albero in Uliveto
        const ulivetoRows = await shUliveto.getRows();
        const treeRow = ulivetoRows.find(r => (r.get('Member ID') || '').trim().toLowerCase() === cleanMemberId);
        
        if (!treeRow) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Member ID not found in olive grove.' }) };
        }
        
        const treeCode = (treeRow.get('Codice') || '').trim();

        // 2. Recupero configurazione dall'ultimo ordine nella tab Ordini
        const ordiniRows = await shOrdini.getRows();
        let lastOrderData = {
            treeCode: treeCode,
            buyerFirstName: '',
            buyerLastName: '',
            email: '',
            certName: '',
            labelName: '',
            kitId: 'reserve-kit'
        };

        for (let i = ordiniRows.length - 1; i >= 0; i--) {
            const r = ordiniRows[i];
            const orderTree = (r.get('Albero') || '').trim();
            const orderMember = (r.get('Member ID') || '').trim().toLowerCase();
            
            if (orderTree === treeCode || orderMember === cleanMemberId) {
                const prod = (r.get('Prodotto') || '').toLowerCase();
                let matchedKit = 'reserve-kit';
                if (prod.includes('welcome')) matchedKit = 'welcome-kit';
                else if (prod.includes('family')) matchedKit = 'family-kit';

                lastOrderData = {
                    treeCode: treeCode,
                    buyerFirstName: '', // Campi lasciati vuoti per inserimento pulito da parte dell'utente
                    buyerLastName: '',
                    email: (r.get('Email Destinatario') || r.get('Email Acquirente') || '').trim().toLowerCase(),
                    certName: (r.get('Personalizzazione Certificato') || '').trim(),
                    labelName: (r.get('Personalizzazione Etichetta') || '').replace(/Olio /i, '').trim(),
                    kitId: matchedKit
                };
                break;
            }
        }

        return { statusCode: 200, body: JSON.stringify(lastOrderData) };

    } catch (error) {
        console.error('Error get-renewal-data:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};
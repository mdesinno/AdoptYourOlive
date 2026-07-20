/* netlify/functions/check-claim.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { memberId, certName, lang } = JSON.parse(event.body);

        if (!memberId || !certName) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ valid: false, error: 'Dati mancanti / Missing data' }) 
            };
        }

        // Normalizziamo le stringhe per evitare errori di battitura
        const cleanMemberId = memberId.trim().toLowerCase();
        const cleanCertName = certName.trim().toLowerCase();

        // 1. Autenticazione Google Sheets
        const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decodedCreds);
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();
        
        const sheet = doc.sheetsByTitle['Ordini'];
        if (!sheet) throw new Error("Foglio Ordini non trovato");
        
        const rows = await sheet.getRows();
        let foundRow = null;

        // 2. Ricerca e Match di Sicurezza
        for (const row of rows) {
            const rowMemberId = (row.get('Member ID') || row.get('Member_ID') || '').trim().toLowerCase();
            
            if (rowMemberId === cleanMemberId) {
                const rowCertName = (row.get('Certificato') || '').trim().toLowerCase();
                
                // Controllo di sicurezza incrociato (Member ID + Nome Certificato)
                if (rowCertName === cleanCertName) {
                    foundRow = row;
                    break;
                } else {
                    return { 
                        statusCode: 403, 
                        body: JSON.stringify({ valid: false, error: lang === 'it' ? 'Il Nome sul Certificato non corrisponde ai nostri archivi.' : 'Name on Certificate does not match our records.' }) 
                    };
                }
            }
        }

        // Se non troviamo il Member ID
        if (!foundRow) {
            return { 
                statusCode: 404, 
                body: JSON.stringify({ valid: false, error: lang === 'it' ? 'Member ID non trovato.' : 'Member ID not found.' }) 
            };
        }

        // 3. Analisi della Scelta Spedizione (Fatta ieri) e dello Stato Riscatto
        const sceltaSpedizione = (foundRow.get('Scelta_Spedizione') || '').trim().toLowerCase();
        let statoRiscatto = (foundRow.get('Stato_Riscatto') || '').trim().toUpperCase();
        
        // Se la cella è vuota ed è un riscatto in seguito, la consideriamo "DA RISCATTARE"
        if (statoRiscatto === '') {
            if (sceltaSpedizione.includes('seguito') || sceltaSpedizione.includes('differito')) {
                statoRiscatto = 'DA RISCATTARE';
            } else {
                return { 
                    statusCode: 400, 
                    body: JSON.stringify({ valid: false, error: lang === 'it' ? 'Questo ordine ha già previsto l\'invio immediato dell\'olio.' : 'This order already included immediate oil shipping.' }) 
                };
            }
        }

        // Blocco di sicurezza: se l'olio è già stato spedito o gestito, fermiamo l'utente
        if (statoRiscatto !== 'DA RISCATTARE' && statoRiscatto !== 'RISCATTO A GENNAIO') {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ valid: false, error: lang === 'it' ? 'L\'olio associato a questo Member ID risulta già spedito o riscattato.' : 'The oil for this Member ID has already been claimed or shipped.' }) 
            };
        }

        // 4. Prepara i dati per pre-compilare la modale sul frontend
        const responseData = {
            valid: true,
            status: statoRiscatto, // Restituisce "DA RISCATTARE" o "RISCATTO A GENNAIO" (Silenzio-Assenso)
            data: {
                name: `${foundRow.get('Nome') || ''} ${foundRow.get('Cognome') || ''}`.trim(),
                address: foundRow.get('Via') || '',
                city: foundRow.get('Citta') || '',
                zip: foundRow.get('CAP') || '',
                country: foundRow.get('Paese') || '',
                phone: foundRow.get('Telefono') || ''
            }
        };

        return { 
            statusCode: 200, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData) 
        };

    } catch (error) {
        console.error("Errore check-claim:", error);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ valid: false, error: 'Errore interno del server / Internal Server Error' }) 
        };
    }
};
/* netlify/functions/track.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const handler = async (event) => {
    // Recuperiamo i parametri dal link: ?dest=...&email=...&lang=...
    const { dest, email, lang } = event.queryStringParameters;
    
    // --- CONFIGURAZIONE LINK ---
    // Sostituisci i placeholder con i tuoi link reali di Google Drive
    const destinations = {
        'guida_it': 'https://drive.google.com/file/d/1JtgL8hSUGjuWiSi06XI-UF9PYoU1ygbc/view?usp=drive_link',
        'guida_en': 'https://drive.google.com/file/d/1wH2h0vL_kqbrwFVFI1_mIob-_tYDl3m4/view?usp=drive_link',
        'ricette_it': 'https://drive.google.com/file/d/1HTWiSpS8iq0InjpzpRIC5jGNx5UU2eio/view?usp=drive_link',
        'ricette_en': 'https://drive.google.com/file/d/1kxumxa3L2jdq41eDFTjU6KaUAzAcKPcc/view?usp=drive_link',
        'folder': 'https://drive.google.com/drive/folders/10Ht0naoEt1maogDr2QBiGSAgfg17K4Bw?usp=sharing'
    };

    const targetUrl = destinations[dest] || 'https://adoptyourolive.com';

    // --- LOG SU GOOGLE SHEET ---
    try {
        const decodedCreds = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_ENCODED, 'base64').toString('utf-8');
        const creds = JSON.parse(decodedCreds);
        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Analytics'];

        if (sheet) {
            await sheet.addRow({
                Data: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }),
                Email: email || 'Anonimo',
                Evento: `Download ${dest}`,
                Lingua: lang || 'n/a',
                Dettagli: event.headers['user-agent'] || 'n/a'
            });
        }
    } catch (e) {
        console.error("❌ Errore Tracking Analytics:", e);
    }

    // --- REDIRECT ---
    return {
        statusCode: 302,
        headers: { 
            'Location': targetUrl,
            'Cache-Control': 'no-cache'
        },
        body: ''
    };
};
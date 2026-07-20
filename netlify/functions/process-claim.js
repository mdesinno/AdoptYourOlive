/* netlify/functions/process-claim.js */
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const data = JSON.parse(event.body);
        const { memberId, claimTiming, shipName, shipAddress, shipCity, shipZip, shipCountry, shipPhone, lang } = data;

        if (!memberId) {
            return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Member ID mancante' }) };
        }

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
        
        const rows = await sheet.getRows();
        const cleanMemberId = memberId.trim().toLowerCase();
        let foundRow = null;

        for (const row of rows) {
            const rowMemberId = (row.get('Member ID') || row.get('Member_ID') || '').trim().toLowerCase();
            if (rowMemberId === cleanMemberId) {
                foundRow = row;
                break;
            }
        }

        if (!foundRow) {
            return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Ordine non trovato' }) };
        }

        // 2. Determina il nuovo stato logistico
        let nuovoStato = foundRow.get('Stato_Riscatto');
        let tempisticaScelta = 'N/A (Solo aggiornamento indirizzo)';

        // Se claimTiming è valorizzato (l'utente ha fatto una scelta nella modale)
        if (claimTiming === 'immediate') {
            nuovoStato = 'DA SPEDIRE (RISCATTO)';
            tempisticaScelta = 'Olio Subito (Riserva Attuale)';
        } else if (claimTiming === 'january') {
            nuovoStato = 'RISCATTO A GENNAIO';
            tempisticaScelta = 'Attesa Nuovo Raccolto (Gennaio)';
        }

        // 3. Aggiorna i dati logistici nel foglio (Sovrascrittura silenziosa)
        const nameParts = (shipName || '').trim().split(' ');
        const newNome = nameParts[0] || '';
        const newCognome = nameParts.slice(1).join(' ') || '';

        foundRow.set('Stato_Riscatto', nuovoStato);
        if (newNome) foundRow.set('Nome', newNome);
        if (newCognome) foundRow.set('Cognome', newCognome);
        foundRow.set('Via', shipAddress || '');
        foundRow.set('Citta', shipCity || '');
        foundRow.set('CAP', shipZip || '');
        foundRow.set('Paese', shipCountry || '');
        foundRow.set('Telefono', shipPhone || '');

        await foundRow.save();

        // 4. Notifica Email ad Admin (Michele)
        const adminEmailHtml = `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px;">
                <h2 style="background: #fdf6e3; padding: 15px; border-left: 4px solid #b58900; color: #b58900;">🔔 Nuovo Riscatto Olio!</h2>
                <p>L'utente ha confermato il riscatto dell'olio per l'adozione associata.</p>
                <ul>
                    <li><strong>Member ID:</strong> ${memberId}</li>
                    <li><strong>Certificato:</strong> ${foundRow.get('Certificato') || ''}</li>
                    <li><strong>Scelta Temporale:</strong> ${tempisticaScelta}</li>
                </ul>
                <h3>Indirizzo di Spedizione Conferito/Aggiornato:</h3>
                <div style="background: #f9f9f9; padding: 15px; border: 1px solid #ddd;">
                    <strong>${shipName}</strong><br>
                    ${shipAddress}<br>
                    ${shipZip} ${shipCity}<br>
                    ${shipCountry}<br>
                    Tel: ${shipPhone}
                </div>
                <p style="font-size: 12px; color: #999; margin-top: 20px;">Aggiornamento applicato automaticamente nella tab 'Ordini'.</p>
            </div>
        `;

        await resend.emails.send({
            from: `Adopt Your Olive <${process.env.EMAIL_MITTENTE}>`,
            to: process.env.EMAIL_ADMIN,
            subject: `🔔 Riscatto Olio - ${memberId} (${claimTiming === 'immediate' ? 'SUBITO' : 'GENNAIO'})`,
            html: adminEmailHtml,
        });

        return { statusCode: 200, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error("Errore process-claim:", error);
        return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Errore interno del server' }) };
    }
};
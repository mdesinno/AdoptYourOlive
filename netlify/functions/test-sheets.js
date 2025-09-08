const { google } = require('googleapis');

exports.handler = async () => {
  try {
    const jwt = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    await jwt.authorize();

    const sheets = google.sheets({ version: 'v4', auth: jwt });
    // Legge la riga intestazioni da "Archivio contatti"
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GSHEET_ID,
      range: 'Archivio contatti!A1:Z1'
    });

    return {
      statusCode: 200,
      body: 'Google auth OK. Header: ' + JSON.stringify(resp.data.values?.[0] || [])
    };
  } catch (e) {
    return { statusCode: 500, body: 'Google auth FAIL: ' + e.message };
  }
};

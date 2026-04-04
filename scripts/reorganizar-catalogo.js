'use strict';
require('dotenv').config();
const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');

const SA = {
  client_email: process.env.SA_EMAIL,
  private_key: (process.env.SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
};
const SHEET_ID    = process.env.SHEET_ID;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const cls = Buffer.from(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
  })).toString('base64url');
  const input  = `${hdr}.${cls}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const jwt = `${input}.${signer.sign(SA.private_key).toString('base64url')}`;
  const r = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return r.data.access_token;
}

(async () => {
  const raw  = JSON.parse(fs.readFileSync('C:/Users/Usuario/.claude/projects/c--Users-Usuario-Desktop-PROGRAMADOR-N8N-BICICLETERIA/c0b89003-0c7e-487b-afbb-aa589b1d27d8/tool-results/mcp-google-sheets-get_sheet_data-1775143698164.txt'));
  const rows = JSON.parse(raw[0].text).valueRanges[0].values;

  const header   = rows[0];
  const dalSanto = rows.slice(1, 1535);    // 1534 filas
  const stark    = rows.slice(1535, 1593); // 58 filas
  const aries    = rows.slice(1593);       // 1075 filas
  const buffer   = Array(100).fill(['', '', '', '']);

  const newRows = [header, ...dalSanto, ...buffer, ...stark, ...buffer, ...aries];

  console.log(`Total filas: ${newRows.length}`);
  console.log(`Dal Santo:  filas 2 - ${1 + dalSanto.length + 1}`);
  console.log(`Buffer:     filas ${1 + dalSanto.length + 2} - ${1 + dalSanto.length + 100 + 1}`);
  console.log(`Stark:      filas ${1 + dalSanto.length + 100 + 2} - ${1 + dalSanto.length + 100 + stark.length + 1}`);
  console.log(`Buffer:     filas ${1 + dalSanto.length + 100 + stark.length + 2} - ${1 + dalSanto.length + 100 + stark.length + 100 + 1}`);
  console.log(`Aries:      filas ${1 + dalSanto.length + 100 + stark.length + 100 + 2} - ${newRows.length}`);

  const token = await getToken();
  const r = await axios.put(
    `${SHEETS_BASE}/${SHEET_ID}/values/CATALOGO_PROVEEDORES!A1:D${newRows.length}?valueInputOption=RAW`,
    { values: newRows },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  console.log('OK - filas actualizadas:', r.data.updatedRows);
})().catch(e => console.error('ERROR:', e.response?.data || e.message));

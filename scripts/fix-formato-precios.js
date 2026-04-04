/**
 * fix-formato-precios.js — re-aplica formato argentino a columnas de precio en STOCK
 */
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');

const SHEET_ID = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';
const SA = { client_email: process.env.SA_EMAIL, private_key: (process.env.SA_PRIVATE_KEY||'').replace(/\\n/g,'\n') };
let _tok = { token: null, exp: 0 };

async function getToken() {
  if (_tok.token && _tok.exp > Date.now() + 60000) return _tok.token;
  const now = Math.floor(Date.now()/1000);
  const hdr = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const cls = Buffer.from(JSON.stringify({iss:SA.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const sg = crypto.createSign('RSA-SHA256'); sg.update(`${hdr}.${cls}`);
  const sig = sg.sign(SA.private_key).toString('base64url');
  const jwt = `${hdr}.${cls}.${sig}`;
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  return new Promise((res,rej) => {
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);_tok={token:j.access_token,exp:Date.now()+3500000};res(j.access_token);});});
    req.on('error',rej);req.write(body);req.end();
  });
}

function api(method, path, data, token) {
  return new Promise((res,rej) => {
    const body = data ? JSON.stringify(data) : null;
    const req = https.request({hostname:'sheets.googleapis.com',path,method,
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json',...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));});
    req.on('error',rej); if(body) req.write(body); req.end();
  });
}

async function main() {
  const token = await getToken();

  // Obtener sheetId de STOCK
  const meta = await api('GET', `/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, null, token);
  const stockSheet = meta.sheets.find(s => s.properties.title === 'STOCK');
  const sheetId = stockSheet.properties.sheetId;

  // Aplicar formato argentino sin decimales a P.Costo(J=9), P.Máximo(K=10), P.Mínimo(L=11)
  const requests = [9, 10, 11].map(col => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: col, endColumnIndex: col + 1 },
      cell: { userEnteredFormat: {
        numberFormat: { type: 'NUMBER', pattern: '$ #,##0' },
        horizontalAlignment: 'RIGHT'
      }},
      fields: 'userEnteredFormat(numberFormat,horizontalAlignment)'
    }
  }));

  const result = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { requests }, token);
  if (result.error) console.error('Error:', result.error.message);
  else console.log('✅ Formato de precios actualizado en STOCK (locale es_AR → puntos como miles)');
}

main().catch(console.error);

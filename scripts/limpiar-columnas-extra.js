/**
 * limpiar-columnas-extra.js — limpia formato de columnas fuera del rango usado en cada hoja
 */
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');
const SA = { client_email: process.env.SA_EMAIL, private_key: (process.env.SA_PRIVATE_KEY||'').replace(/\\n/g,'\n') };
let _tok = { token: null, exp: 0 };
async function getToken() {
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

const SHEETS = {
  'COMPRAS': 13, 'FACTURAS': 13, 'MOVIMIENTOS_PENDIENTES': 19,
  'HISTORIAL': 16, 'USUARIOS': 5, 'VENTAS_BICICLETAS': 5,
  'VENTAS_ACCESORIOS': 5, 'SESIONES': 6, 'CATALOGO_PROVEEDORES': 4,
  'STOCK': 20,
};

async function main() {
  const token = await getToken();
  const meta = await api('GET', `/v4/spreadsheets/1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps?fields=sheets(properties,bandedRanges)`, null, token);

  for (const sheet of meta.sheets) {
    const name      = sheet.properties.title;
    const sheetId   = sheet.properties.sheetId;
    const ncols     = SHEETS[name];
    const gridCols  = sheet.properties.gridProperties?.columnCount || 0;
    if (!ncols) continue;

    // Solo limpiar si hay columnas extra más allá de las usadas
    if (gridCols <= ncols) { console.log(`${name}: sin columnas extra (${gridCols} cols)`); continue; }

    const endCol = gridCols;
    const requests = [
      { repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: ncols, endColumnIndex: endCol },
        cell: { userEnteredFormat: { backgroundColor: {} } },
        fields: 'userEnteredFormat.backgroundColor'
      }},
      { updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: ncols, endColumnIndex: endCol },
        top: { style:'NONE' }, bottom: { style:'NONE' },
        left: { style:'NONE' }, right: { style:'NONE' },
        innerHorizontal: { style:'NONE' }, innerVertical: { style:'NONE' },
      }},
    ];

    const r = await api('POST', `/v4/spreadsheets/1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps:batchUpdate`, { requests }, token);
    if (r.error) console.error(`❌ ${name}:`, r.error.message);
    else console.log(`✅ ${name}: columnas ${ncols+1}-${endCol} limpiadas`);
  }
}

main().catch(console.error);

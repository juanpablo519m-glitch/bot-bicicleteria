/**
 * colores-vista-bicis.js — un color distinto por marca en VISTA_BICIS
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

// Color por marca — uno distinto para cada una
// Paleta unificada: gama azul-índigo-petróleo oscuro
const MARCA_COLORS = {
  'BATTLE':     { red: 0.102, green: 0.137, blue: 0.494 }, // índigo profundo   #1A237E
  'COLNER':     { red: 0.082, green: 0.259, blue: 0.631 }, // azul rey          #1542A1
  'FIAT':       { red: 0.051, green: 0.341, blue: 0.631 }, // azul clásico      #0D57A1
  'FIRE BIRD':  { red: 0.004, green: 0.435, blue: 0.671 }, // azul cielo oscuro #017AAB
  'KELINBIKE':  { red: 0.000, green: 0.376, blue: 0.561 }, // azul petróleo     #005F8F
  'OLMO':       { red: 0.000, green: 0.357, blue: 0.451 }, // azul teal         #005B73
  'RALEIGH':    { red: 0.000, green: 0.329, blue: 0.392 }, // teal profundo     #005464
  'RANDERS':    { red: 0.035, green: 0.302, blue: 0.337 }, // teal oscuro       #094D56
  'REMBRANDT':  { red: 0.067, green: 0.275, blue: 0.278 }, // teal medio        #114647
  'STARK':      { red: 0.114, green: 0.251, blue: 0.278 }, // teal grisáceo     #1D4047
  'TERU':       { red: 0.157, green: 0.227, blue: 0.255 }, // gris azulado      #283A41
  'VARIOS':     { red: 0.188, green: 0.204, blue: 0.235 }, // gris pizarra      #30343C
  'VENZO':      { red: 0.157, green: 0.176, blue: 0.235 }, // azul gris oscuro  #282D3C
};
const WHITE = { red: 1, green: 1, blue: 1 };
const DEFAULT_COLOR = { red: 0.114, green: 0.165, blue: 0.259 };

async function main() {
  const token = await getToken();

  // Obtener sheetId de VISTA_BICIS
  const meta = await api('GET', `/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, null, token);
  const sheet = meta.sheets.find(s => s.properties.title === 'VISTA_BICIS');
  const sheetId = sheet.properties.sheetId;

  // Leer todas las filas
  const dataResp = await api('GET', `/v4/spreadsheets/${SHEET_ID}/values/VISTA_BICIS!A1:A300`, null, token);
  const rows = dataResp.values || [];

  const requests = [];

  for (let i = 0; i < rows.length; i++) {
    const cell = (rows[i][0] || '').trim();
    if (!cell.includes('🚲')) continue;

    // Extraer nombre de marca del encabezado "  🚲  BATTLE  ·  1 unidad(es)"
    const match = cell.match(/🚲\s+(.+?)\s+·/);
    const marca = match ? match[1].trim().toUpperCase() : '';
    const color = MARCA_COLORS[marca] || DEFAULT_COLOR;

    console.log(`Fila ${i+1}: ${marca} → color aplicado`);

    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: {
          backgroundColor: color,
          textFormat: { foregroundColor: WHITE, bold: true, fontSize: 12 },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
      }
    });
  }

  if (!requests.length) { console.log('No se encontraron encabezados de marca'); return; }

  const result = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { requests }, token);
  if (result.error) console.error('Error:', result.error.message);
  else console.log(`✅ Colores aplicados a ${requests.length} encabezados de marca`);
}

main().catch(console.error);

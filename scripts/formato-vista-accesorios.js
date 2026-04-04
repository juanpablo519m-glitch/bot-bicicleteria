/**
 * formato-vista-accesorios.js — aplica diseño a VISTA_ACCESORIOS (misma lógica que VISTA_BICIS)
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

const HDR_BG  = { red: 0.114, green: 0.165, blue: 0.259 };
const HDR_FG  = { red: 1, green: 1, blue: 1 };
const COL_BG  = { red: 0.196, green: 0.275, blue: 0.431 };
const COL_FG  = { red: 0.878, green: 0.918, blue: 1.0 };
const ODD     = { red: 0.929, green: 0.953, blue: 0.996 };
const EVEN    = { red: 1, green: 1, blue: 1 };
const BORDER  = { red: 0.776, green: 0.808, blue: 0.871 };
const NCOLS   = 9;

async function main() {
  const token = await getToken();

  const meta = await api('GET', `/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, null, token);
  const sheet = meta.sheets.find(s => s.properties.title === 'VISTA_ACCESORIOS');
  const sheetId = sheet.properties.sheetId;
  console.log('Sheet ID VISTA_ACCESORIOS:', sheetId);

  const dataResp = await api('GET',
    `/v4/spreadsheets/${SHEET_ID}/values/VISTA_ACCESORIOS!A1:I500`, null, token);
  const rows = dataResp.values || [];
  console.log('Filas:', rows.length);

  const requests = [];

  // Anchos de columna
  [100, 130, 60, 160, 80, 55, 90, 100, 100].forEach((px, i) => {
    requests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i+1 },
      properties: { pixelSize: px }, fields: 'pixelSize'
    }});
  });

  // Bordes generales
  requests.push({ updateBorders: {
    range: { sheetId, startRowIndex: 0, endRowIndex: rows.length+2, startColumnIndex: 0, endColumnIndex: NCOLS },
    innerHorizontal: { style: 'SOLID', color: BORDER },
    innerVertical:   { style: 'SOLID', color: BORDER },
    top: { style: 'SOLID_MEDIUM', color: HDR_BG }, left:   { style: 'SOLID_MEDIUM', color: HDR_BG },
    bottom: { style: 'SOLID_MEDIUM', color: HDR_BG }, right: { style: 'SOLID_MEDIUM', color: HDR_BG },
  }});

  let dataIdx = 0;

  for (let i = 0; i < rows.length; i++) {
    const cell0 = (rows[i][0] || '').trim();

    if (cell0.includes('🔧') || cell0.includes('🚲')) {
      // Encabezado de sección
      requests.push({ unmergeCells: { range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS }}});
      requests.push({ mergeCells: { range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS }, mergeType: 'MERGE_ALL' }});
      requests.push({ repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS },
        cell: { userEnteredFormat: { backgroundColor: HDR_BG, textFormat: { foregroundColor: HDR_FG, bold: true, fontSize: 12 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
      }});
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' }});
      dataIdx = 0;

    } else if (['Marca','Código','codigo','marca'].includes(cell0)) {
      // Sub-encabezado de columnas
      requests.push({ repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS },
        cell: { userEnteredFormat: { backgroundColor: COL_BG, textFormat: { foregroundColor: COL_FG, bold: true, fontSize: 9 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
      }});
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' }});

    } else if (rows[i].length === 0 || cell0 === '') {
      // Fila vacía separadora
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 6 }, fields: 'pixelSize' }});

    } else {
      // Fila de datos
      const color = dataIdx++ % 2 === 0 ? ODD : EVEN;
      requests.push({ repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS },
        cell: { userEnteredFormat: { backgroundColor: color }},
        fields: 'userEnteredFormat.backgroundColor'
      }});
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 22 }, fields: 'pixelSize' }});
    }
  }

  console.log('Requests:', requests.length);
  const BATCH = 200;
  for (let s = 0; s < requests.length; s += BATCH) {
    const r = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      { requests: requests.slice(s, s + BATCH) }, token);
    if (r.error) { console.error('❌ Error:', r.error.message); return; }
    console.log(`Lote ${Math.floor(s/BATCH)+1} OK — ${requests.slice(s, s+BATCH).length} ops`);
  }
  console.log('✅ VISTA_ACCESORIOS formateada');
}

main().catch(console.error);

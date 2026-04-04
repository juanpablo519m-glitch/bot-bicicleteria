/**
 * fix-headers.js — diagnostica y limpia todo el formato de headers en todas las hojas
 * Elimina bandings duplicados y re-aplica el formato correcto
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

const HDR_BG = { red: 0.114, green: 0.165, blue: 0.259 };
const HDR_FG = { red: 1, green: 1, blue: 1 };
const ODD    = { red: 0.929, green: 0.953, blue: 0.996 };
const EVEN   = { red: 1, green: 1, blue: 1 };
const BORDER = { red: 0.776, green: 0.808, blue: 0.871 };

const FLAT_SHEETS = {
  'COMPRAS': 13, 'FACTURAS': 13, 'MOVIMIENTOS_PENDIENTES': 17,
  'HISTORIAL': 16, 'USUARIOS': 5, 'VENTAS_BICICLETAS': 5,
  'VENTAS_ACCESORIOS': 5, 'SESIONES': 4, 'CATALOGO_PROVEEDORES': 4,
  'STOCK': 20,
};

async function main() {
  const token = await getToken();

  // Obtener metadata completa con bandedRanges
  const meta = await api('GET',
    `/v4/spreadsheets/${SHEET_ID}?fields=sheets(properties,bandedRanges)`, null, token);

  const requests = [];

  for (const sheet of meta.sheets) {
    const name     = sheet.properties.title;
    const sheetId  = sheet.properties.sheetId;
    const ncols    = FLAT_SHEETS[name];
    const bands    = sheet.bandedRanges || [];

    if (!ncols) continue; // saltar hojas no incluidas (VISTA_BICIS, etc.)

    console.log(`${name}: ${bands.length} banding(s) existente(s)`);

    // 1. Eliminar TODOS los bandings existentes
    bands.forEach(b => {
      requests.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
    });

    // 2. Limpiar cualquier color de fondo residual en filas de datos
    requests.push({ repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: ncols },
      cell: { userEnteredFormat: { backgroundColor: EVEN } },
      fields: 'userEnteredFormat.backgroundColor'
    }});

    // 3. Re-aplicar header
    requests.push({ repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: ncols },
      cell: { userEnteredFormat: {
        backgroundColor: HDR_BG,
        textFormat: { foregroundColor: HDR_FG, bold: true, fontSize: 10 },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
    }});

    // 4. Freeze fila 1
    requests.push({ updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount'
    }});

    // 5. Re-aplicar banding limpio
    requests.push({ addBanding: { bandedRange: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: ncols },
      rowProperties: { firstBandColor: ODD, secondBandColor: EVEN }
    }}});

    // 6. Bordes
    requests.push({ updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: ncols },
      innerHorizontal: { style: 'SOLID', color: BORDER },
      innerVertical:   { style: 'SOLID', color: BORDER },
      top:    { style: 'SOLID_MEDIUM', color: HDR_BG },
      left:   { style: 'SOLID_MEDIUM', color: HDR_BG },
      bottom: { style: 'SOLID_MEDIUM', color: HDR_BG },
      right:  { style: 'SOLID_MEDIUM', color: HDR_BG },
    }});

    // 7. Altura header y filas
    requests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 36 }, fields: 'pixelSize'
    }});
    requests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 500 },
      properties: { pixelSize: 22 }, fields: 'pixelSize'
    }});

    // 8. Ancho columnas
    const colWidth = ncols <= 5 ? 140 : ncols <= 13 ? 110 : 95;
    requests.push({ updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: ncols },
      properties: { pixelSize: colWidth }, fields: 'pixelSize'
    }});
  }

  console.log(`\nTotal requests: ${requests.length}`);

  // Enviar en lotes de 200
  const BATCH = 200;
  for (let s = 0; s < requests.length; s += BATCH) {
    const r = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      { requests: requests.slice(s, s + BATCH) }, token);
    if (r.error) { console.error('❌ Error:', r.error.message); return; }
    console.log(`Lote ${Math.floor(s/BATCH)+1} OK`);
  }

  console.log('✅ Todos los headers corregidos y bandings limpiados');
}

main().catch(console.error);

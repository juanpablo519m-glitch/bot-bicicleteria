/**
 * formato-todas-hojas.js — aplica diseño a todas las hojas del spreadsheet
 * Uso: node scripts/formato-todas-hojas.js
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

// Colores base (misma gama que STOCK)
const HDR_BG  = { red: 0.114, green: 0.165, blue: 0.259 }; // azul marino #1D2A42
const HDR_FG  = { red: 1,     green: 1,     blue: 1     };
const ODD     = { red: 0.929, green: 0.953, blue: 0.996 }; // celeste suave
const EVEN    = { red: 1,     green: 1,     blue: 1     };
const BORDER  = { red: 0.776, green: 0.808, blue: 0.871 };

// Hojas planas: nombre → número de columnas
const FLAT_SHEETS = {
  'COMPRAS':               13,
  'FACTURAS':              13,
  'MOVIMIENTOS_PENDIENTES':17,
  'HISTORIAL':             16,
  'USUARIOS':               5,
  'VENTAS_BICICLETAS':      5,
  'VENTAS_ACCESORIOS':      5,
  'SESIONES':               4,
  'CATALOGO_PROVEEDORES':   4,
};

// Hojas agrupadas (misma estructura que VISTA_BICIS)
const GROUPED_SHEETS = ['VISTA_ACCESORIOS'];

function flatSheetRequests(sheetId, ncols) {
  const reqs = [];

  // Congelar fila 1
  reqs.push({ updateSheetProperties: {
    properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
    fields: 'gridProperties.frozenRowCount'
  }});

  // Header: azul marino, negrita, blanco
  reqs.push({ repeatCell: {
    range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: ncols },
    cell: { userEnteredFormat: {
      backgroundColor: HDR_BG,
      textFormat: { foregroundColor: HDR_FG, bold: true, fontSize: 10 },
      horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
    }},
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
  }});

  // Altura header
  reqs.push({ updateDimensionProperties: {
    range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
    properties: { pixelSize: 36 }, fields: 'pixelSize'
  }});

  // Altura filas de datos
  reqs.push({ updateDimensionProperties: {
    range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 500 },
    properties: { pixelSize: 22 }, fields: 'pixelSize'
  }});

  // Ancho columnas (proporcional al número de columnas)
  const colWidth = ncols <= 5 ? 140 : ncols <= 13 ? 110 : 95;
  reqs.push({ updateDimensionProperties: {
    range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: ncols },
    properties: { pixelSize: colWidth }, fields: 'pixelSize'
  }});

  // Banding filas alternas (intentar eliminar primero si existe)
  reqs.push({ addBanding: { bandedRange: {
    range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: ncols },
    rowProperties: { firstBandColor: ODD, secondBandColor: EVEN }
  }}});

  // Bordes
  reqs.push({ updateBorders: {
    range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: ncols },
    innerHorizontal: { style: 'SOLID', color: BORDER },
    innerVertical:   { style: 'SOLID', color: BORDER },
    top:    { style: 'SOLID_MEDIUM', color: HDR_BG },
    left:   { style: 'SOLID_MEDIUM', color: HDR_BG },
    bottom: { style: 'SOLID_MEDIUM', color: HDR_BG },
    right:  { style: 'SOLID_MEDIUM', color: HDR_BG },
  }});

  return reqs;
}

async function formatGroupedSheet(sheetId, sheetName, token) {
  const dataResp = await api('GET',
    `/v4/spreadsheets/${SHEET_ID}/values/${sheetName}!A1:L300`, null, token);
  const rows = dataResp.values || [];
  const NCOLS = 9;

  const COL_BG = { red: 0.196, green: 0.275, blue: 0.431 };
  const COL_FG = { red: 0.878, green: 0.918, blue: 1.0 };

  const reqs = [];
  let dataIdx = 0;

  // Anchos
  [70, 130, 60, 160, 80, 55, 90, 100, 100].forEach((px, i) => {
    reqs.push({ updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i+1 },
      properties: { pixelSize: px }, fields: 'pixelSize'
    }});
  });

  // Bordes
  reqs.push({ updateBorders: {
    range: { sheetId, startRowIndex: 0, endRowIndex: rows.length+2, startColumnIndex: 0, endColumnIndex: NCOLS },
    innerHorizontal: { style: 'SOLID', color: BORDER },
    innerVertical:   { style: 'SOLID', color: BORDER },
    bottom: { style: 'SOLID_MEDIUM', color: HDR_BG }, right: { style: 'SOLID_MEDIUM', color: HDR_BG },
    top:    { style: 'SOLID_MEDIUM', color: HDR_BG }, left:  { style: 'SOLID_MEDIUM', color: HDR_BG },
  }});

  for (let i = 0; i < rows.length; i++) {
    const cell0 = (rows[i][0]||'').trim();

    if (cell0.includes('🚲') || cell0.includes('🔧')) {
      reqs.push({ unmergeCells: { range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS }}});
      reqs.push({ mergeCells: { range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS }, mergeType: 'MERGE_ALL' }});
      reqs.push({ repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS },
        cell: { userEnteredFormat: { backgroundColor: HDR_BG, textFormat: { foregroundColor: HDR_FG, bold: true, fontSize: 12 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
      }});
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' }});
      dataIdx = 0;
    } else if (rows[i].length > 1 && (rows[i][0]||'') === (rows[i+1] ? rows[i][0] : rows[i][0]) && cell0 !== '' && !cell0.includes('🚲') && !cell0.includes('🔧') && rows[i].length >= 3) {
      // Detectar sub-header por contenido (primera fila de cada grupo con varias columnas no-data)
      const isSubHeader = ['Marca','Código','marca','codigo'].includes(cell0);
      if (isSubHeader) {
        reqs.push({ repeatCell: {
          range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS },
          cell: { userEnteredFormat: { backgroundColor: COL_BG, textFormat: { foregroundColor: COL_FG, bold: true, fontSize: 9 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
        }});
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' }});
      } else {
        const color = dataIdx++ % 2 === 0 ? ODD : EVEN;
        reqs.push({ repeatCell: { range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS }, cell: { userEnteredFormat: { backgroundColor: color }}, fields: 'userEnteredFormat.backgroundColor' }});
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 22 }, fields: 'pixelSize' }});
      }
    } else if (rows[i].length === 0 || cell0 === '') {
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 6 }, fields: 'pixelSize' }});
    } else {
      const color = dataIdx++ % 2 === 0 ? ODD : EVEN;
      reqs.push({ repeatCell: { range: { sheetId, startRowIndex: i, endRowIndex: i+1, startColumnIndex: 0, endColumnIndex: NCOLS }, cell: { userEnteredFormat: { backgroundColor: color }}, fields: 'userEnteredFormat.backgroundColor' }});
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i+1 }, properties: { pixelSize: 22 }, fields: 'pixelSize' }});
    }
  }

  // Enviar en lotes
  const BATCH = 200;
  for (let s = 0; s < reqs.length; s += BATCH) {
    const chunk = reqs.slice(s, s + BATCH);
    const r = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { requests: chunk }, token);
    if (r.error) { console.error(`  ❌ Error en lote:`, r.error.message); return; }
  }
  console.log(`  ✅ ${sheetName} — ${reqs.length} operaciones`);
}

async function main() {
  const token = await getToken();

  // Obtener todos los sheet IDs
  const meta = await api('GET', `/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, null, token);
  const sheetMap = {};
  for (const s of meta.sheets) sheetMap[s.properties.title] = s.properties.sheetId;

  // ── Hojas planas ──────────────────────────────────────────────────────────
  for (const [name, ncols] of Object.entries(FLAT_SHEETS)) {
    const sheetId = sheetMap[name];
    if (sheetId === undefined) { console.log(`Salteo ${name} (no encontrada)`); continue; }
    console.log(`Formateando ${name} (${ncols} cols)...`);

    // Eliminar banding existente si hay
    const bandInfo = await api('GET',
      `/v4/spreadsheets/${SHEET_ID}?ranges=${name}!A1:A1&fields=sheets.bandedRanges`, null, token);
    const existingBands = bandInfo.sheets?.[0]?.bandedRanges || [];
    const preReqs = existingBands.map(b => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } }));

    const allReqs = [...preReqs, ...flatSheetRequests(sheetId, ncols)];

    const BATCH = 200;
    for (let s = 0; s < allReqs.length; s += BATCH) {
      const r = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
        { requests: allReqs.slice(s, s + BATCH) }, token);
      if (r.error) { console.error(`  ❌ ${name} error:`, r.error.message); break; }
    }
    console.log(`  ✅ ${name} — listo`);
  }

  // ── Hojas agrupadas ───────────────────────────────────────────────────────
  for (const name of GROUPED_SHEETS) {
    const sheetId = sheetMap[name];
    if (sheetId === undefined) { console.log(`Salteo ${name}`); continue; }
    console.log(`Formateando ${name} (agrupada)...`);
    await formatGroupedSheet(sheetId, name, token);
  }

  console.log('\n✅ Todas las hojas formateadas');
}

main().catch(console.error);

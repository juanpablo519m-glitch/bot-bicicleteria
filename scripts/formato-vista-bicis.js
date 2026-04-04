/**
 * formato-vista-bicis.js — aplica diseño visual a la hoja VISTA_BICIS
 * Uso: node scripts/formato-vista-bicis.js
 */
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');

const SHEET_ID = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';
const SA = {
  client_email: process.env.SA_EMAIL,
  private_key:  (process.env.SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};
let _tok = { token: null, exp: 0 };

async function getToken() {
  if (_tok.token && _tok.exp > Date.now() + 60000) return _tok.token;
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const cls = Buffer.from(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${hdr}.${cls}`);
  const sig = signer.sign(SA.private_key).toString('base64url');
  const jwt = `${hdr}.${cls}.${sig}`;
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { const j = JSON.parse(d); _tok = { token: j.access_token, exp: Date.now() + 3500000 }; res(j.access_token); }); });
    req.on('error', rej); req.write(body); req.end();
  });
}

function api(method, path, data, token) {
  return new Promise((res, rej) => {
    const body = data ? JSON.stringify(data) : null;
    const req = https.request({
      hostname: 'sheets.googleapis.com', path, method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); });
    req.on('error', rej);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const token = await getToken();

  // Obtener sheet ID numérico de VISTA_BICIS
  const meta = await api('GET', `/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, null, token);
  const sheet = meta.sheets.find(s => s.properties.title === 'VISTA_BICIS');
  if (!sheet) { console.error('Hoja VISTA_BICIS no encontrada'); return; }
  const sheetId = sheet.properties.sheetId;
  console.log('Sheet ID:', sheetId);

  // Leer todas las filas
  const dataResp = await api('GET',
    `/v4/spreadsheets/${SHEET_ID}/values/VISTA_BICIS!A1:L300`,
    null, token);
  const rows = dataResp.values || [];
  console.log('Filas detectadas:', rows.length);

  // Colores
  const GRP_BG  = { red: 0.114, green: 0.165, blue: 0.259 }; // azul marino #1D2A42
  const GRP_FG  = { red: 1,     green: 1,     blue: 1     };
  const COL_BG  = { red: 0.196, green: 0.275, blue: 0.431 }; // azul medio #324670
  const COL_FG  = { red: 0.878, green: 0.918, blue: 1.0   }; // celeste claro
  const ODD     = { red: 0.929, green: 0.953, blue: 0.996 }; // #EDF3FE
  const EVEN    = { red: 1,     green: 1,     blue: 1     };
  const BORDER  = { red: 0.776, green: 0.808, blue: 0.871 };

  const NCOLS = 12;
  const requests = [];

  // Anchos de columna
  [70, 80, 100, 130, 70, 60, 160, 80, 55, 90, 100, 100].forEach((px, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px }, fields: 'pixelSize'
      }
    });
  });

  // Bordes en toda la tabla usada
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 2, startColumnIndex: 0, endColumnIndex: NCOLS },
      innerHorizontal: { style: 'SOLID', color: BORDER },
      innerVertical:   { style: 'SOLID', color: BORDER },
      bottom: { style: 'SOLID_MEDIUM', color: GRP_BG },
      right:  { style: 'SOLID_MEDIUM', color: GRP_BG },
      top:    { style: 'SOLID_MEDIUM', color: GRP_BG },
      left:   { style: 'SOLID_MEDIUM', color: GRP_BG },
    }
  });

  // Helpers
  const rowHeight = (i, px) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px }, fields: 'pixelSize'
    }
  });
  const rowFormat = (i, fmt, fields) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: NCOLS },
      cell: { userEnteredFormat: fmt },
      fields
    }
  });

  let dataIdx = 0;

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i];
    const cell0 = (row[0] || '').trim();

    if (cell0.includes('🚲')) {
      // ── Encabezado de marca ──
      // Primero deshacer merges existentes si los hay, luego re-mergear
      requests.push({
        unmergeCells: {
          range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: NCOLS }
        }
      });
      requests.push({
        mergeCells: {
          range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: NCOLS },
          mergeType: 'MERGE_ALL'
        }
      });
      requests.push(rowFormat(i, {
        backgroundColor: GRP_BG,
        textFormat: { foregroundColor: GRP_FG, bold: true, fontSize: 12 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'CLIP',
      }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'));
      requests.push(rowHeight(i, 34));
      dataIdx = 0; // reiniciar alternancia por sección

    } else if (cell0 === 'Código') {
      // ── Sub-encabezado de columnas ──
      requests.push(rowFormat(i, {
        backgroundColor: COL_BG,
        textFormat: { foregroundColor: COL_FG, bold: true, fontSize: 9 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'CLIP',
      }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'));
      requests.push(rowHeight(i, 24));

    } else if (row.length > 0 && cell0 !== '') {
      // ── Fila de datos ──
      const color = dataIdx % 2 === 0 ? ODD : EVEN;
      requests.push(rowFormat(i, { backgroundColor: color },
        'userEnteredFormat.backgroundColor'));
      // Centrar Stock (col 8), Rodado (4), Talle (5)
      [4, 5, 8].forEach(col => {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
            fields: 'userEnteredFormat.horizontalAlignment'
          }
        });
      });
      // Formato de precio (cols 10 y 11)
      [10, 11].forEach(col => {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: { userEnteredFormat: {
              numberFormat: { type: 'NUMBER', pattern: '$ #,##0' },
              horizontalAlignment: 'RIGHT'
            }},
            fields: 'userEnteredFormat(numberFormat,horizontalAlignment)'
          }
        });
      });
      requests.push(rowHeight(i, 22));
      dataIdx++;

    } else {
      // ── Fila vacía separadora ── (altura mínima)
      requests.push(rowHeight(i, 6));
    }
  }

  console.log('Requests generados:', requests.length);

  // Enviar en lotes de 200 para no superar límites
  const BATCH = 200;
  for (let start = 0; start < requests.length; start += BATCH) {
    const chunk = requests.slice(start, start + BATCH);
    const result = await api('POST',
      `/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      { requests: chunk }, token);
    if (result.error) {
      console.error('Error en lote', Math.floor(start / BATCH) + 1, ':', JSON.stringify(result.error, null, 2));
      return;
    }
    console.log(`Lote ${Math.floor(start / BATCH) + 1} OK — ${chunk.length} operaciones`);
  }

  console.log('✅ Diseño aplicado a VISTA_BICIS');
}

main().catch(console.error);

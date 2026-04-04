/**
 * formato-stock.js — aplica diseño visual a la hoja STOCK
 * Uso: node scripts/formato-stock.js
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

  // Obtener sheet ID numérico de STOCK
  const meta = await api('GET', `/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, null, token);
  const stockSheet = meta.sheets.find(s => s.properties.title === 'STOCK');
  if (!stockSheet) { console.error('Hoja STOCK no encontrada'); return; }
  const sheetId = stockSheet.properties.sheetId;
  console.log('Sheet ID numérico de STOCK:', sheetId);

  // NOTA: los headers de STOCK NO se modifican — el bot los usa como claves (numero_serie, precio_max, etc.)
  // Cambiarlos rompe toda la lectura del cache. Solo aplicar formato visual.

  // Colores
  const HDR_BG  = { red: 0.114, green: 0.165, blue: 0.259 }; // azul marino oscuro #1D2A42
  const HDR_FG  = { red: 1,     green: 1,     blue: 1     }; // blanco
  const ROW_ODD = { red: 0.929, green: 0.953, blue: 0.996 }; // celeste muy suave #EDF3FE
  const ROW_EVN = { red: 1,     green: 1,     blue: 1     }; // blanco
  const BORDER  = { red: 0.776, green: 0.808, blue: 0.871 }; // gris azulado

  // Anchos de columna (px): A-T
  const WIDTHS = [90, 100, 120, 80, 160, 90, 60, 60, 100, 100, 100, 100, 70, 60, 100, 110, 220, 120, 80, 120];

  const requests = [
    // Congelar fila 1
    { updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount' } },

    // Estilo encabezado
    { repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 20 },
        cell: { userEnteredFormat: {
          backgroundColor: HDR_BG,
          textFormat: { foregroundColor: HDR_FG, bold: true, fontSize: 10 },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },

    // Filas alternas (datos)
    { addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 20 },
          rowProperties: { firstBandColor: ROW_ODD, secondBandColor: ROW_EVN }
        } } },

    // Altura encabezado
    { updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 }, fields: 'pixelSize' } },

    // Altura filas de datos
    { updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 500 },
        properties: { pixelSize: 22 }, fields: 'pixelSize' } },

    // Anchos de columna
    ...WIDTHS.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px }, fields: 'pixelSize' } })),

    // Centrar columnas: Stock(6), Mínimo(7), Rodado(12), Talle(13)
    ...[6, 7, 12, 13].map(col => ({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment' } })),

    // Precios a la derecha con formato número: P.Costo(9), P.Máx(10), P.Mín(11)
    ...[9, 10, 11].map(col => ({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: {
          numberFormat: { type: 'NUMBER', pattern: '$ #,##0' },
          horizontalAlignment: 'RIGHT'
        }},
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),

    // Bordes internos
    { updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 20 },
        innerHorizontal: { style: 'SOLID', color: BORDER },
        innerVertical:   { style: 'SOLID', color: BORDER },
        bottom: { style: 'SOLID', color: BORDER },
        right:  { style: 'SOLID', color: BORDER } } },

    // Borde exterior más grueso
    { updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 20 },
        top:    { style: 'SOLID_MEDIUM', color: HDR_BG },
        left:   { style: 'SOLID_MEDIUM', color: HDR_BG },
        bottom: { style: 'SOLID_MEDIUM', color: HDR_BG },
        right:  { style: 'SOLID_MEDIUM', color: HDR_BG } } },
  ];

  const result = await api('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { requests }, token);

  if (result.error) {
    console.error('Error:', JSON.stringify(result.error, null, 2));
  } else {
    console.log('✅ Diseño aplicado correctamente —', result.replies?.length, 'operaciones');
  }
}

main().catch(console.error);

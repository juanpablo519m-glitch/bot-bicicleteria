'use strict';
const https = require('https');
const crypto = require('crypto');

const SHEET_ID = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';
const SA_EMAIL = 'bot-bicicleteria@n8n-bicicleteria.iam.gserviceaccount.com';
const SA_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDKSu4lhbVeHpZX
akycBHWHC0X+cuVuLV1fuPP03n/drRgKTLGXEHB+GcC3Q6wOUjXrI3RoWbjTpyDj
ArIW0gUEGfs7/ljbwM6Dx8/oJS4Z+oq2Sf1hnYTZaQ2Xqz03ARbUagyu5LgJw0qR
BCDm9RaUtTqa6d/2dk/13lCLmvGb1R6eMduXX2StNoATWfZjJZxu77WiJHVuuhx/
pTsNlZO2XfDIGeEXBSRG0c4CoBIKea9H2C6CTluMz7MxGzyk6rITZVH/cK6ngb0q
dXwN6YViXC2cA4ajf0oGO4IX58VOKNEPEbnYdBlAz5Nqpk8Q3FihF/EqpIVCA6hD
/DhHQpHLAgMBAAECggEANmRmWy10Ak4cI34AAlVKmpiD5fJT0UeeWy4aXmVzIRI5
LA/KEnHHpYhcIoquGR2uxL5APwyc30AJXjCr3On0klFAFbYCg3f4r0NLGkLg/fg5
UuFbIWOexGx0TKss5vzCfDPVnDMAbxOVGZ/wDtmojCyciOnIn/bY8iWoJ5luTHVL
GjsS+mOTzCYbNTIIoqhcs0Fmws3Val/Yd2q8u4ucqa6Cve1KMjTnXSrEAapL+W3B
gSEcQc/eK36jES9t0a2FPY/dry4A06LvKZGdAlu/ptoyVzoggzH7Jr57TaPMkE8b
R+6iWZQG+ZwuE0Bv/As5xyegLaWZzta0kCdxvrR09QKBgQD3hvGvdGJWV65UUg3E
QX50tENx19tBjIA6XwfyK+9DFD+6FwcbKDKPfv6t7BptHHUFaJbEoR3Woq72yHZe
j9R8ILwy/5RqmGshCEH+5O2fatzU9Qwf2xHvPysab3eecSELNRU7m6MeCWfykkW9
T3tWGed2XowwyqOCoYWG2GtTxQKBgQDRN5nvovZXa3LH7G1I/sszU+51xuvheOV8
pcW8I+I9HkioTnkrgOAc2nKFVSOq2LXB3cPHlaENE9b4e8FZWTHqj/rI9ziRSyCm
xmzzvi/itC998E2A9QjaqWdhsUxq/yzeOJ77PtKsSuunRlR6l1rAQv2OIw3IkpfR
kJguUXhYTwKBgGOjeXRkSBVzlCQzJ4GBz7KQwbl457SaJx/YEy3Dy7tX0lNJY73l
z3x95W0DZpvXYa+8qzwZkxZMRFvo0+U6xpD06G0q/oZuNmmElnRRmOmcLaq3vZqx
J6YD6ojop+Eqrt+BDbwB6YZ0yNgXU2ViMka1hLvcUVhuqaUy+boPMhz1AoGAXfKe
0GoYPpdEWpxDUtT/gFP/L6ocwAne20NBcMOYUyOnMtTSOoPLn4lEhbT+qDhaHe0s
fhIl2M6A6OIBp9KSxKbU0auaHjxjNCDESgusSxvoe6AN3Yuq5y3M+6R3EVD23+8D
DQVf6vhVq668PrR6jv1GCK6bAOc6/2Lzw1DYPqcCgYAk3YiUnRTDWd1/HzUZk736
rbqbg6cjUueXpUD6xptM8y+XGAxaCEvY0OK39RzovIGdXpbUj0zB1bWY7xmJRk2P
IdLiZEzjRv3mMIkQq0JBL6NM8hH90K10tN1pHoBm7MKJjt0ZatP40Z4xliV/XHL/
LepE03P0AeXncVlp7qjhyQ==
-----END PRIVATE KEY-----`;

async function getToken() {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const cls = Buffer.from(JSON.stringify({
      iss: SA_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
    })).toString('base64url');
    const input = hdr + '.' + cls;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(input);
    const sig = signer.sign(SA_KEY).toString('base64url');
    const bodyStr = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + sig }).toString();
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyStr) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).access_token); } catch { reject(d); } });
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'sheets.googleapis.com', path, method: 'GET', headers: { Authorization: 'Bearer ' + token } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.end();
  });
}

function apiPost(path, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({ hostname: 'sheets.googleapis.com', path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + token } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function apiPut(path, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({ hostname: 'sheets.googleapis.com', path, method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + token } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function parsePrecio(val) {
  if (!val) return 0;
  const s = String(val).replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').trim();
  return parseFloat(s) || 0;
}

async function main() {
  const token = await getToken();

  // 1. Leer STOCK completo
  const r = await apiGet('/v4/spreadsheets/' + SHEET_ID + '/values/STOCK!A:P', token);
  const rows = r.values || [];
  const headers = rows[0];
  console.log('Headers actuales:', headers);

  const colCosto = headers.indexOf('precio_costo');
  const colVenta = headers.indexOf('precio_venta');
  console.log('precio_costo en col:', colCosto, '| precio_venta en col:', colVenta);

  // 2. Obtener sheetId de STOCK
  const meta = await apiGet('/v4/spreadsheets/' + SHEET_ID + '?fields=sheets.properties', token);
  const stockSheet = (meta.sheets || []).find(s => s.properties.title === 'STOCK');
  const sheetId = stockSheet.properties.sheetId;

  // 3. Insertar columna nueva en posición L (índice 11) para precio_min
  //    precio_venta está en K (índice 10), insertamos después → índice 11
  console.log('Insertando columna precio_min en posición L...');
  await apiPost('/v4/spreadsheets/' + SHEET_ID + ':batchUpdate', {
    requests: [{
      insertDimension: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 },
        inheritFromBefore: false
      }
    }]
  }, token);

  // 4. Renombrar K1: precio_venta → precio_max
  await apiPut(
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!K1?valueInputOption=RAW`,
    { values: [['precio_max']] },
    token
  );

  // 5. Escribir header precio_min en L1
  await apiPut(
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!L1?valueInputOption=RAW`,
    { values: [['precio_min']] },
    token
  );

  // 6. Calcular y escribir precios para todas las filas existentes
  const updates = [];
  for (let i = 1; i < rows.length; i++) {
    const costo = parsePrecio(rows[i][colCosto]);
    if (!costo) continue;
    const precioMax = Math.round(costo * 1.60);
    const precioMin = Math.round(costo * 1.35);
    const rowNum = i + 1;
    updates.push({ range: `STOCK!K${rowNum}:L${rowNum}`, values: [[precioMax, precioMin]] });
  }

  if (updates.length > 0) {
    await apiPost(
      `/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
      { valueInputOption: 'RAW', data: updates },
      token
    );
    console.log(`✅ Precios calculados para ${updates.length} filas.`);
  }

  // 7. Agregar fila de ejemplo: bici Raleigh con costo conocido del catálogo
  const today = new Date().toLocaleDateString('es-AR');
  const costoEjemplo = 850000;
  const ejemplo = [
    'bicicleta', 'Raleigh', 'Mojave 2.0', 'EJ001',
    'MTB R27.5 - 21V - NEGRO - 2026', 'local',
    2, 1, 'disponible',
    costoEjemplo,
    Math.round(costoEjemplo * 1.60),
    Math.round(costoEjemplo * 1.35),
    '27.5', 'n/a', today, today
  ];
  await apiPost(
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!A:P:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [ejemplo] },
    token
  );

  console.log('\n✅ Ejemplo cargado:');
  console.log(`  Bici: Raleigh Mojave 2.0`);
  console.log(`  Costo:      $${costoEjemplo.toLocaleString('es-AR')}`);
  console.log(`  Precio máx: $${Math.round(costoEjemplo * 1.60).toLocaleString('es-AR')} (+60%)`);
  console.log(`  Precio mín: $${Math.round(costoEjemplo * 1.35).toLocaleString('es-AR')} (+35%)`);
  console.log('\n✅ STOCK actualizado. Ahora actualizá el Apps Script.');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

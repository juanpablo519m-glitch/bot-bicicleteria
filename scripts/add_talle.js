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

async function getSheetInfo(token) {
  const r = await apiGet('/v4/spreadsheets/' + SHEET_ID + '?fields=sheets.properties', token);
  return r.sheets || [];
}

function colLetter(n) {
  let s = '';
  while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function addTalleToSheet(token, sheetName, sheets) {
  // Leer encabezados
  const r = await apiGet('/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(sheetName) + '!1:1', token);
  const headers = (r.values && r.values[0]) || [];

  if (headers.includes('talle')) {
    console.log(`[${sheetName}] "talle" ya existe. Saltando.`);
    return;
  }

  // Buscar posición de "rodado" para insertar después
  const rodadoIdx = headers.indexOf('rodado'); // 0-based
  const insertAt = rodadoIdx >= 0 ? rodadoIdx + 1 : headers.length; // 0-based

  // Obtener sheetId
  const sheetMeta = sheets.find(s => s.properties.title === sheetName);
  const sheetId = sheetMeta ? sheetMeta.properties.sheetId : null;

  // Insertar columna vacía en insertAt
  console.log(`[${sheetName}] Insertando columna en índice ${insertAt} (después de "${rodadoIdx >= 0 ? 'rodado' : 'último'}") ...`);
  const r2 = await apiPost('/v4/spreadsheets/' + SHEET_ID + ':batchUpdate', {
    requests: [{
      insertDimension: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: insertAt, endIndex: insertAt + 1 },
        inheritFromBefore: false
      }
    }]
  }, token);
  if (!r2.replies) { console.error('Error insertando columna:', JSON.stringify(r2)); return; }

  // Escribir header "talle"
  const colRef = colLetter(insertAt + 1); // 1-based letter
  await apiPut('/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(sheetName) + '!' + colRef + '1?valueInputOption=RAW',
    { values: [['talle']] }, token);
  console.log(`[${sheetName}] Header "talle" escrito en ${colRef}1`);

  // Contar filas existentes y rellenar con "n/a"
  const r3 = await apiGet('/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(sheetName) + '!A:A', token);
  const totalRows = (r3.values || []).length;
  if (totalRows > 1) {
    const naValues = Array(totalRows - 1).fill(['n/a']);
    await apiPut('/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(sheetName) + '!' + colRef + '2:' + colRef + totalRows + '?valueInputOption=RAW',
      { values: naValues }, token);
    console.log(`[${sheetName}] ${totalRows - 1} filas rellenadas con "n/a"`);
  }
  console.log(`[${sheetName}] ✅ Columna "talle" lista.`);
}

async function main() {
  console.log('Obteniendo token...');
  const token = await getToken();

  const sheets = await getSheetInfo(token);

  await addTalleToSheet(token, 'STOCK', sheets);
  await addTalleToSheet(token, 'COMPRAS', sheets);

  console.log('\n✅ Todo listo. STOCK y COMPRAS tienen columna "talle".');
  console.log('Ahora actualizá el Apps Script con las funciones nuevas.');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

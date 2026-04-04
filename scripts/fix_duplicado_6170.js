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

async function getSheetId(token) {
  const r = await apiGet('/v4/spreadsheets/' + SHEET_ID + '?fields=sheets.properties', token);
  const s = (r.sheets || []).find(s => s.properties.title === 'STOCK');
  return s ? s.properties.sheetId : null;
}

async function main() {
  const token = await getToken();

  // Leer STOCK
  const r = await apiGet('/v4/spreadsheets/' + SHEET_ID + '/values/STOCK!A:P', token);
  const rows = r.values || [];
  const headers = rows[0];
  const colId = headers.indexOf('id_producto');
  const colStock = headers.indexOf('stock_actual');

  // Encontrar todas las filas con id_producto = 6170
  const filas6170 = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][colId] || '').trim() === '6170') {
      filas6170.push({ rowIdx: i, rowNum: i + 1, stock: Number(rows[i][colStock]) || 0 });
    }
  }

  console.log('Filas 6170 encontradas:', filas6170);

  if (filas6170.length < 2) {
    console.log('No hay duplicados. Nada que hacer.');
    return;
  }

  // Sumar todos los stocks
  const totalStock = filas6170.reduce((sum, f) => sum + f.stock, 0);
  console.log('Stock total combinado:', totalStock);

  // Actualizar la primera fila con el stock total
  const primeraFila = filas6170[0].rowNum;
  await apiPut(
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!H${primeraFila}?valueInputOption=RAW`,
    { values: [[totalStock]] },
    token
  );
  console.log(`Fila ${primeraFila}: stock actualizado a ${totalStock}`);

  // Eliminar las filas duplicadas (de mayor a menor para no desfasar índices)
  const sheetId = await getSheetId(token);
  const filasABorrar = filas6170.slice(1).reverse();

  for (const f of filasABorrar) {
    const res = await apiPost('/v4/spreadsheets/' + SHEET_ID + ':batchUpdate', {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: f.rowIdx, endIndex: f.rowIdx + 1 }
        }
      }]
    }, token);
    console.log(`Fila ${f.rowNum} (stock=${f.stock}) eliminada`);
  }

  console.log('\n✅ Listo. 6170 queda con stock_actual =', totalStock);
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

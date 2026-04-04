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

function httpsRequest(method, url, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const cls = Buffer.from(JSON.stringify({
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const input = hdr + '.' + cls;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const sig = signer.sign(SA_KEY).toString('base64url');
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: input + '.' + sig
  });
  const r = await httpsRequest('POST', 'https://oauth2.googleapis.com/token', Object.fromEntries(body));
  return r.access_token;
}

async function getSheetId(token, sheetName) {
  const r = await httpsRequest('GET',
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '?fields=sheets.properties',
    null, token);
  const sheet = (r.sheets || []).find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

async function main() {
  console.log('Obteniendo token...');
  const token = await getToken();

  console.log('Obteniendo sheetId de CATALOGO_PROVEEDORES...');
  const sheetId = await getSheetId(token, 'CATALOGO_PROVEEDORES');
  if (!sheetId && sheetId !== 0) {
    console.error('No se encontró la hoja CATALOGO_PROVEEDORES');
    process.exit(1);
  }
  console.log('sheetId:', sheetId);

  // Paso 1: Renombrar encabezado D1 de "tipo" a "costo"
  console.log('Renombrando columna D "tipo" -> "costo"...');
  const r1 = await httpsRequest('PUT',
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/CATALOGO_PROVEEDORES!D1?valueInputOption=RAW',
    { values: [['costo']] }, token);
  console.log('D1 actualizado:', r1.updatedCells, 'celda(s)');

  // Paso 2: Eliminar columnas E-J (índices 4 a 9, de derecha a izquierda para no desfasar índices)
  // Hay que eliminar de mayor a menor índice
  console.log('Eliminando columnas E a J...');
  const deleteRequests = [];
  for (let i = 9; i >= 4; i--) {
    deleteRequests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: i,
          endIndex: i + 1
        }
      }
    });
  }
  const r2 = await httpsRequest('POST',
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + ':batchUpdate',
    { requests: deleteRequests }, token);
  if (r2.replies) {
    console.log('Columnas E-J eliminadas OK');
  } else {
    console.error('Error eliminando columnas:', JSON.stringify(r2));
    process.exit(1);
  }

  // Paso 3: Poner "dal santo" en A2:A1535
  console.log('Rellenando columna A con "dal santo" (1534 filas)...');
  const values = Array(1534).fill(['dal santo']);
  const r3 = await httpsRequest('PUT',
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/CATALOGO_PROVEEDORES!A2:A1535?valueInputOption=RAW',
    { values }, token);
  console.log('Columna A actualizada:', r3.updatedCells, 'celda(s)');

  console.log('\n✅ CATALOGO_PROVEEDORES corregido exitosamente.');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

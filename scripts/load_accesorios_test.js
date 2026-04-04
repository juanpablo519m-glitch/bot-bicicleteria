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

async function main() {
  const token = await getToken();
  const today = new Date().toLocaleDateString('es-AR');

  // Columnas STOCK:
  // tipo | marca | modelo | numero_serie | descripcion | ubicacion | stock_actual | stock_minimo
  // estado_unidad | precio_costo | precio_venta | rodado | talle | fecha_ingreso | ultima_actualizacion

  const accesorios = [
    // CASCOS
    ['casco', 'Abus', 'Smiley 2.0', 'A001', 'Casco infantil con diseño', 'local', 3, 1, 'disponible', '8500', '', 'n/a', 'S/M', today, today],
    ['casco', 'Abus', 'Urban-I 3.0', 'A002', 'Casco urbano adulto', 'local', 5, 1, 'disponible', '15200', '', 'n/a', 'M/L', today, today],

    // CANDADOS
    ['candado', 'Abus', '440 U-Lock', 'A003', 'Candado U acero templado', 'local', 4, 1, 'disponible', '12000', '', 'n/a', 'n/a', today, today],
    ['candado', 'Abus', 'Bordo 6000', 'A004', 'Candado plegable 90cm', 'local', 2, 1, 'disponible', '22000', '', 'n/a', 'n/a', today, today],

    // LUCES
    ['luz', 'Genérica', 'LED Delantera USB', 'A005', 'Luz delantera recargable USB', 'local', 8, 2, 'disponible', '3500', '', 'n/a', 'n/a', today, today],
    ['luz', 'Genérica', 'LED Trasera USB', 'A006', 'Luz trasera recargable USB', 'local', 8, 2, 'disponible', '2800', '', 'n/a', 'n/a', today, today],

    // CAMARAS
    ['camara', 'Stark', 'R26 Valvula Presta', 'A007', 'Camara de aire R26 valvula presta', 'local', 10, 3, 'disponible', '1800', '', '26', 'n/a', today, today],
    ['camara', 'Stark', 'R29 Valvula Presta', 'A008', 'Camara de aire R29 valvula presta', 'local', 10, 3, 'disponible', '2000', '', '29', 'n/a', today, today],

    // GUANTES
    ['guantes', 'Genérica', 'MTB Pro', 'A009', 'Guantes MTB dedos cortos', 'local', 6, 1, 'disponible', '4200', '', 'n/a', 'M', today, today],
    ['guantes', 'Genérica', 'MTB Pro', 'A010', 'Guantes MTB dedos cortos', 'local', 4, 1, 'disponible', '4200', '', 'n/a', 'L', today, today],
  ];

  const res = await apiPost(
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!A:O:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: accesorios },
    token
  );

  if (res.updates) {
    console.log(`✅ ${res.updates.updatedRows} accesorios cargados en STOCK.`);
  } else {
    console.error('Error:', JSON.stringify(res));
  }
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

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

function apiRequest(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const headers = { Authorization: 'Bearer ' + token };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request({ hostname: 'sheets.googleapis.com', path, method, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Columnas: tipo | marca | modelo | numero_serie | descripcion | ubicacion | stock_actual | stock_minimo | estado_unidad | precio_costo | precio_max | precio_min | rodado | talle | fecha_ingreso | ultima_actualizacion | ficha_tecnica
const HOY = '27/03/2026';
const LOC = 'local';

const PRODUCTOS = [
  // ===== RODADO 12 =====
  ['bicicleta','Raleigh','MXR','BIC-001','Rojo/Azul/blanco',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  ['bicicleta','Rembrandt','','BIC-002','Rosa',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  ['bicicleta','Helley','','BIC-003','Bordo/Morado',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  ['bicicleta','Stark','Vulcano','BIC-004','Rojo/amarillo',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  ['bicicleta','Stark','Vulcano','BIC-005','Amarillo/negro',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  ['bicicleta','Kelinbike','','BIC-006','Rosa',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  ['bicicleta','Kelinbike','','BIC-007','Negro',LOC,1,1,'disponible','','','','12','',HOY,HOY,''],
  // ===== RODADO 16 =====
  ['bicicleta','Raleigh','MXR','BIC-008','Azul/rojo/blanco',LOC,1,1,'disponible','','','','16','',HOY,HOY,''],
  ['bicicleta','Fire Bird','','BIC-009','Negro/naranja',LOC,1,1,'disponible','','','','16','',HOY,HOY,''],
  ['bicicleta','Stark','Crohome','BIC-010','Cromado/negro BMX',LOC,1,1,'disponible','','','','16','',HOY,HOY,''],
  ['bicicleta','Team','','BIC-011','Amarillo',LOC,1,1,'disponible','','','','16','',HOY,HOY,''],
  ['bicicleta','Fire Bird','Rocky','BIC-012','Azul/rojo',LOC,1,1,'disponible','','','','16','',HOY,HOY,''],
  ['bicicleta','Fire Bird','Winner','BIC-013','Rojo',LOC,1,1,'disponible','','','','16','',HOY,HOY,''],
  // ===== RODADO 20 =====
  ['bicicleta','Raleigh','MXR','BIC-014','Negro/verde',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Raleigh','Rowdy','BIC-015','Negro/azul',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Rento','','BIC-016','Negro',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Raleigh','Straight','BIC-017','Plegable Negro/naranja',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Fire Bird','Folding','BIC-018','Plegable Gris/rojo',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Fire Bird','Winner','BIC-019','Rojo',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Rembrandt','','BIC-020','Plegable rojo',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Teru','','BIC-021','Plegable rojo',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Stark','','BIC-022','Rosa',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Venzo','','BIC-023','Lila',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Fire Bird','Winner','BIC-024','Naranja',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  ['bicicleta','Fire Bird','','BIC-025','Celeste',LOC,1,1,'disponible','','','','20','',HOY,HOY,''],
  // ===== RODADO 24 =====
  ['bicicleta','Stark','Vulcano','BIC-026','Naranja',LOC,1,1,'disponible','','','','24','',HOY,HOY,''],
  ['bicicleta','Raleigh','Scout Girl','BIC-027','Negro/rose/blanco',LOC,1,1,'disponible','','','','24','',HOY,HOY,''],
  ['bicicleta','Raleigh','Scout Junior','BIC-028','Negro/amarillo/azul',LOC,1,1,'disponible','','','','24','',HOY,HOY,''],
  // ===== RODADO 26 =====
  ['bicicleta','Stark','Rise','BIC-029','Gris/negro',LOC,1,1,'disponible','','','','26','',HOY,HOY,''],
  // ===== RODADO 27.5 =====
  ['bicicleta','Fire Bird','Winner','BIC-030','Rojo',LOC,1,1,'disponible','','','','27.5','18"',HOY,HOY,''],
  // ===== RODADO 28 =====
  ['bicicleta','Fire Bird','She-2021','BIC-031','Blanco/lila',LOC,1,1,'disponible','','','','28','M',HOY,HOY,''],
  ['bicicleta','Stark','Amsterdam','BIC-032','Blanco',LOC,1,1,'disponible','','','','28','M',HOY,HOY,''],
  ['bicicleta','Raleigh','Classic Deluxe','BIC-033','Negro',LOC,1,1,'disponible','','','','28','M',HOY,HOY,''],
  ['bicicleta','Stark','Antoniette','BIC-034','Gris/verde',LOC,1,1,'disponible','','','','28','M',HOY,HOY,''],
  ['bicicleta','FIAT','500','BIC-035','Gris - Manubrio rulero',LOC,1,1,'disponible','','','','28','M',HOY,HOY,''],
  ['bicicleta','FIAT','500','BIC-036','Gris - Manubrio recto',LOC,1,1,'disponible','','','','28','M',HOY,HOY,''],
  ['bicicleta','Raleigh','Urban 1.1','BIC-037','Negro/azul',LOC,1,1,'disponible','','','','28','21"',HOY,HOY,''],
  ['bicicleta','Raleigh','Strada 1.0','BIC-038','Rojo (rutera)',LOC,1,1,'disponible','','','','28','',HOY,HOY,''],
  // ===== RODADO 29 =====
  ['bicicleta','Bowie','','BIC-039','Azul/celeste',LOC,1,1,'disponible','','','','29','M',HOY,HOY,''],
  ['bicicleta','Colner','Forest','BIC-040','Gris/verde',LOC,1,1,'disponible','','','','29','16"',HOY,HOY,''],
  ['bicicleta','Stark','Rise','BIC-041','Morada/violeta',LOC,1,1,'disponible','','','','29','16"',HOY,HOY,''],
  ['bicicleta','Raleigh','M2.0','BIC-042','Negro/rojo',LOC,1,1,'disponible','','','','29','19"',HOY,HOY,''],
  ['bicicleta','Raleigh','M7.0','BIC-043','Negro/gris',LOC,1,1,'disponible','','','','29','M',HOY,HOY,''],
  ['bicicleta','Raleigh','M4.0','BIC-044','Gris/azul',LOC,1,1,'disponible','','','','29','17"',HOY,HOY,''],
  ['bicicleta','Colner','Cruiser','BIC-045','Gris/blanco',LOC,1,1,'disponible','','','','29','',HOY,HOY,''],
  ['bicicleta','Battle','210/211','BIC-046','Naranja',LOC,1,1,'disponible','','','','29','',HOY,HOY,''],
  ['bicicleta','Raleigh','M4.5','BIC-047','Azul/negro',LOC,1,1,'disponible','','','','29','',HOY,HOY,''],
  ['bicicleta','Venzo','Primal','BIC-048','Negra/blanco',LOC,1,1,'disponible','','','','29','',HOY,HOY,''],
  ['bicicleta','Colner','Forest','BIC-049','Salmon',LOC,1,1,'disponible','','','','29','18"',HOY,HOY,''],
  // ===== SIN RODADO ESPECIFICADO =====
  ['bicicleta','Stark','Vittoria','BIC-050','Verde',LOC,1,1,'disponible','','','','','',HOY,HOY,''],
  ['bicicleta','Fire Bird','','BIC-051','Rojo',LOC,1,1,'disponible','','','','','',HOY,HOY,''],
  ['bicicleta','Olmo','Freetime','BIC-052','Azul/blanco',LOC,1,1,'disponible','','','','','',HOY,HOY,''],
  ['bicicleta','Stark','Olivia','BIC-053','Turquesa',LOC,1,1,'disponible','','','','','',HOY,HOY,''],
];

async function main() {
  console.log('Obteniendo token...');
  const token = await getToken();

  // 1. Limpiar datos existentes (mantener header en fila 1)
  console.log('Limpiando STOCK existente...');
  await apiRequest('PUT',
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!A2:Q1000?valueInputOption=RAW`,
    { values: Array(999).fill(Array(17).fill('')) },
    token
  );
  console.log('✅ Stock limpiado.');

  // 2. Cargar todos los productos
  console.log(`Cargando ${PRODUCTOS.length} productos...`);
  const result = await apiRequest('PUT',
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!A2:Q${1 + PRODUCTOS.length}?valueInputOption=RAW`,
    { values: PRODUCTOS },
    token
  );
  console.log('Resultado:', JSON.stringify(result).substring(0, 200));

  if (result.updatedRows) {
    console.log(`\n✅ ${result.updatedRows} filas cargadas en STOCK.`);
  } else {
    console.log('\n✅ Carga completada.');
  }

  // Verificar: leer primeras 3 filas
  const check = await apiRequest('GET',
    `/v4/spreadsheets/${SHEET_ID}/values/STOCK!A1:D5`,
    null,
    token
  );
  console.log('\nVerificación (primeras filas):');
  (check.values || []).forEach((r, i) => console.log(`  Fila ${i+1}:`, r.slice(0,4).join(' | ')));
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

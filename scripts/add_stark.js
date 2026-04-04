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

// [proveedor, codigo_proveedor, detalle_original, costo]
const PRODUCTOS = [
  // ── KIDS · PASEO R12 ──────────────────────────────────────────────
  ['stark','6010','BICICLETA R12 - RISE - NENA - Pintura Mate, Accesorios en Colores Fluor','59917,36'],
  ['stark','6011','BICICLETA R12 - RISE - VARON - Pintura Mate, Accesorios en Colores Fluor','59917,36'],
  ['stark','6008','BICICLETA R12 - LOVE - NENA - Guardabarros, protector y frente decorativo','93388,43'],
  ['stark','6016','BICICLETA R12 - SPACE - VARON - Guardabarros y frente decorativo','93388,43'],
  ['stark','6047','BICICLETA R12 - SMILE - NENA - Cubre enterizo, guardabarros, mochila y canasto','99173,55'],
  ['stark','6056','BICICLETA R12 - TOP RACE - VARON - Guardabarros y frente PVC','99173,55'],
  ['stark','6067','BICICLETA R12 - CHIKYS - NENA - Manija direccional, flecos y baulera','101652,89'],
  ['stark','6066','BICICLETA R12 - CHIKYS - VARON - Manija direccional, flecos y baulera','101652,89'],
  ['stark','6187','BICICLETA R12 - ZOMBIES - VARON - Guardabarros, Carenado plastico','97520,66'],
  ['stark','6129','BICICLETA R12 - VULCANO - VARON - Ruedas de acero, Frenos Herr, camara y cubierta','123966,94'],
  ['stark','6130','BICICLETA R12 - PINK - NENA - Llantas de Aluminio, P. Muneca, Canasto','128099,17'],
  ['stark','6173','BICICLETA R12 - HYPER XR - NENA - Ruedas de Aluminio, Frenos v-brake','157024,79'],
  ['stark','6174','BICICLETA R12 - HYPER XR - VARON - Ruedas de Aluminio, Frenos v-brake','157024,79'],
  // ── KIDS · PASEO R14/R16/R20 ─────────────────────────────────────
  ['stark','6094','BICICLETA R14 - PINK - NENA - Canasto, guardabarros y Porta Muneca','171900,83'],
  ['stark','6043','BICICLETA R16 - SMILE MAKER - NENA - Canasto, guardabarros','180165,29'],
  ['stark','6095','BICICLETA R16 - PINK - NENA - Canasto, guardabarros y Porta Muneca','185950,41'],
  ['stark','6007','BICICLETA R16 - LOVE - NENA - Canasto, guardabarros','214876,03'],
  ['stark','6033','BICICLETA R20 - SMILE MAKER - NENA - Canasto, guardabarros','194214,88'],
  ['stark','6096','BICICLETA R20 - PINK - NENA - Canasto, Guardabarros','198347,11'],
  ['stark','6006','BICICLETA R20 - LOVE - NENA - Canasto, guardabarros','223140,50'],
  // ── KIDS · BMX R14/R16 ───────────────────────────────────────────
  ['stark','6062','BICICLETA BMX R14 - TEAM JUNIOR - VARON - Freno V-Brake, Llantas de Aluminio','167768,60'],
  ['stark','6064','BICICLETA BMX R16 - TEAM JUNIOR - VARON - Freno V-Brake, Llantas de Aluminio','171900,83'],
  ['stark','6098','BICICLETA BMX R16 - FUSION CHROME - VARON - Llanta aluminio, V-Brake','202479,34'],
  ['stark','6178','BICICLETA BMX R16 - RISE - VARON - Aluminio, J.Direccion AHEAD, V-Brake Alloy','210743,80'],
  // ── ADULTOS · MTB/FREESTYLE R20/R24 ──────────────────────────────
  ['stark','6194','BICICLETA MTB R20 - VULCANO - VARON - Stem Ahead, Frenos V-Brake, Colores Fluor','194214,88'],
  ['stark','6078','BICICLETA BMX R20 - BLACK - VARON - Maza 48 agujeros, Rotor y Frenos V-Brake','206611,57'],
  ['stark','6100','BICICLETA BMX R20 - STREET X - VARON - Crome, Tyres 2x2125, Pal 3 pcs','252066,12'],
  ['stark','6179','BICICLETA MTB R20 - RISE - VARON - Aluminio, J Direccion AHEAD, V-Brake Alloy','243801,65'],
  ['stark','6182','BICICLETA MTB R24 - VULCANO - VARON - Stem Ahead, Frenos V-Brake, Colores Fluor','198347,11'],
  // ── ADULTOS · MTB R24/R26/R29 ────────────────────────────────────
  ['stark','6037','BICICLETA MTB R24 - DUSTER - NENA - Freno V-Brake, Cambio 21 vel Shimano','219008,26'],
  ['stark','6035','BICICLETA MTB R24 - DUSTER - VARON - Freno V-Brake, Cambio 21 vel Shimano','219008,26'],
  ['stark','6191','BICICLETA MTB R26 - DUSTER PRO 2.0 - NENA - Susp. Delantera, 21 Vel Shimano','243801,65'],
  ['stark','6044','BICICLETA MTB R26 - DUSTER PRO 2.0 - VARON - Susp. Delantera, 21 Vel Shimano','243801,65'],
  ['stark','6199','BICICLETA MTB R26 - RISE - NENA - Susp. Delantera, 21 Vel Shimano TZ-50','293388,43'],
  ['stark','6166','BICICLETA MTB R29 - RISE - NENA 21" - Aluminio, 21 Vel Shimano TZ-50','276859,50'],
  ['stark','6164','BICICLETA MTB R29 - RISE - VARON 21" - Aluminio, 21 Vel Shimano TZ-50','276859,50'],
  ['stark','6195','BICICLETA MTB R29 - THUNDER - NENA - Aluminio, Shimano 21V Tourney, T 16"/18"/20"','371900,83'],
  ['stark','6192','BICICLETA MTB R29 - THUNDER - VARON - Aluminio, Shimano 21V Tourney, T 16"/18"/20"','371900,83'],
  ['stark','6189','BICICLETA MTB R29 - FUSION PRO XR - VARON - Shimano Tourney 24V, Talle 18"/20"','392561,98'],
  ['stark','6197','BICICLETA MTB R29 - STRIVE 2.0 - VARON - Altus 24V, Fr H-Logan, T 18"/20"','661157,02'],
  ['stark','6170','BICICLETA MTB R29 - STRIVE 2.0 ADVANCE - VARON - DEORE 12V, Mono Promax, T 18"/20"','909090,91'],
  // ── ADULTOS · URBANO R24/R26/R28 ─────────────────────────────────
  ['stark','6059','BICICLETA URBANA R24 - ALBA - NENA - Bicolor, Canasto, Guardabarros','210743,80'],
  ['stark','6058','BICICLETA URBANA R26 - ALBA - NENA - Bicolor, Canasto, Guardabarros','227272,73'],
  ['stark','6080','BICICLETA URBANA R26 - LADY - NENA - Canasto, Guardabarros, V-Brake Alloy','243801,65'],
  ['stark','6150','BICICLETA URBANA R28 - ANTONIETTE FX - NENA - Canasto, 7 Vel Shimano TX-50','272727,27'],
  ['stark','6088','BICICLETA URBANA R28 - AMSTERDAN - VARON - Shimano 7 Speed, V-Brake Alloy','256198,35'],
  ['stark','6167','BICICLETA URBANA R26 - OLIVIA - NENA - Susp., 21 Vel Shimano TZ-50','342975,21'],
  ['stark','6172','BICICLETA URBANA R28 - VITTORIA - NENA - Susp., 21 Vel Shimano TZ-50','314049,59'],
  // ── ACCESORIOS · INFLADORES ──────────────────────────────────────
  ['stark','5297','INFLADOR DE MANO ALUMINIO - AIR PUMP RC50','13016,53'],
  ['stark','5298','INFLADOR DE PIE ALUMINIO - AIR PUMP RC100','20661,16'],
  ['stark','5299','INFLADOR DE PIE ALUMINIO CON MANOMETRO - AIR PUMP RC150','27685,95'],
  // ── ACCESORIOS · LINGAS/CANDADOS ─────────────────────────────────
  ['stark','5303','LINGA CADENA DE ACERO 1.00 mts x 25 mm CR-100','22727,27'],
  ['stark','5304','LINGA CADENA FORRADA 1.00 mts x 8 mm CR-150','25619,83'],
  // ── ACCESORIOS · LUCES ───────────────────────────────────────────
  ['stark','5319','LUZ LED TRASERA 4 TIPOS DE DESTELLOS RECARGA USB FLASH L100','17933,88'],
  ['stark','5320','LUZ LED TRASERA 4 TIPOS DE DESTELLOS RECARGA USB FLASH L200','15702,48'],
  ['stark','5321','LUZ LED TRASERA 4 TIPOS DE DESTELLOS RECARGA USB FLASH L300','17190,08'],
  ['stark','5322','LUZ LED DELANTERA 6 TIPOS DE DESTELLOS RECARGA USB FLASH L400','19710,74'],
  ['stark','5323','SETS DE LUCES LED 3 TIPOS DE DESTELLOS FLASH L500','6115,70'],
];

async function main() {
  console.log('Obteniendo token...');
  const token = await getToken();

  console.log(`Agregando ${PRODUCTOS.length} productos de Stark a CATALOGO_PROVEEDORES...`);

  const r = await apiPost(
    '/v4/spreadsheets/' + SHEET_ID + '/values/CATALOGO_PROVEEDORES!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { values: PRODUCTOS },
    token
  );

  if (r.updates) {
    console.log(`✅ ${r.updates.updatedRows} filas agregadas. (${r.updates.updatedCells} celdas)`);
  } else {
    console.error('Error:', JSON.stringify(r));
  }
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });

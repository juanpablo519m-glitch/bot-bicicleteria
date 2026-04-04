/**
 * cargar-fichas.js — escribe solo la columna ficha_tecnica (Q) en STOCK
 * Uso: node scripts/cargar-fichas.js
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
function put(url, data, hdrs) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PUT',
      headers: { ...hdrs, 'Content-Length': Buffer.byteLength(body) }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); });
    req.on('error', rej); req.write(body); req.end();
  });
}

// Fichas en el mismo orden que cargar-stock-nuevo.js (106 filas, B01-B106)
const F = {
  RALCLASD: 'ASIENTO PLAYERO CON ELASTOMERO - VADER, JUEGO DE DIRECCION 8 PIEZAS NEGRO - NECO, CARTRIDGE 34.7mm DER/IZQ - 123mm - CHINA, PLATO Y PAL. 42D x 170mm - NEGRO - RALEIGH CLASSIC 700C, PEDALES CITY PVC Y GOMA 9/16 - FEIMIN, STEM DE ALUMINIO CORTO COLOR NATURAL, PUÑOS COCIDOS A MANO MTB, CUAD.Y HORQ.700C RALEIGH CLASSIC DAMA, PAR MANIJAS DE FRENO FULL ALUM. - C-STAR, SET DE FRENOS V-BRAKE 4 PIEZAS - ALUMINIO - LOGAN, PAR DE RUEDAS R28 - RALEIGH CLASSIC, CAMARA 700 x 32-35 VALVULA AMERICANA LARGA - KYOWA, CUBIERTA 700C38 HARDTEX 60 TPI BLANCA, SHIFTER NEXUS 3v - NEGRO, CADENA 1/2x1/8 - P-410 CROMADA - TAIWAN, PIÑON SHIMANO NEXUS 3v.',
  LILHON:   'CADENA 1/2x1/8x80 - X-410, PIÑON 18T FULL BALL - SHUN FENG, JUEGO DE DIRECCION 8 PIEZAS NEGRO - NECO, PLATO SOLO 36D RALEIGH LILHON, BIELA PLAYERA R16 - 127mm - CROMADA, PEDALES NENA 1/2 S/BOLILLAS - FEIMIN, FORMA BMX R16 C/TRAVESAÑO BLANCA - TIPO BMX, STEM PLAYERO ACERO/ALUMINIO 22.2mm - POWER, PUÑOS RALEIGH KIDS, CUA. Y HORQ. RALEIGH LILHON, SET FRENO V-BRAKE BLANCO P/RALEIGH KIDS NENA, PAR DE RUEDAS LILHONEY 16 C/CYC, ASIENTO RALEIGH LILHON, DISCO DE RUEDA R16 RALEIGH - LILHON, CANASTO RALEIGH R16 - LILHON, PORTAMUÑECA R16 - RALEIGH, RUEDAS ESTABILIZADORAS R16.',
  MXR:      'Cuadro de aluminio, guardabarros plásticos, ruedas estabilizadoras, asiento de gel, cubiertas 2.3 anchas, frenos V-Brake.',
  MXR20:    'Cuadro de aluminio, guardabarros plásticos, asiento de gel, cubiertas 2.3 anchas, frenos V-Brake.',
  BIN55:    'Cuadro 5.5 R29 aluminio, horquilla Suntour XCM, transmisión Shimano Deore 10v, frenos hidráulicos Shimano MT-200, cambio RD-M5120SGS, piñón CS-M4100 11/46, disco 160mm Center Lock, cubierta Jiluer 29x2.10, plato Ltwoo 38T integrado.',
  SCOUT24:  'Cuadro MTB R24 aluminio, horquilla con suspensión oversize, transmisión Shimano 21v, freno disco mecánico 160mm C-Star BX-350, cambio RD-TZ400, plato FC-TY301 42/34/24 175mm, piñón MF-TZ21 7v 14/28.',
  SCOUT24D: 'Cuadro MTB R24 aluminio dama, horquilla con suspensión oversize, transmisión Shimano 21v, freno disco mecánico 160mm C-Star BX-350, cambio RD-TZ400, plato FC-TY301 42/34/24 175mm, piñón MF-TZ21 7v 14/28.',
  BIN40:    'Cuadro aluminio R29, horquilla Suntour XCT, transmisión 9v Shimano Altus, frenos hidráulicos Shimano MT-200, plato doble 38-24 Suntour 170mm, cambio RD-M2000SGS, piñón CS-HG200 11/34, cubierta Hartex Xtra Action 29x2.10.',
  VNT19105: 'Cuadro y horquilla R26 vintage acero sin cambios, transmisión 1v, plato 36D 165mm cromado, ruedas doble pared R26, cubierta 26x1.95 playera, frenos V-Brake 4 piezas, pedales city PVC.',
  KENTO:    'Cuadro de acero, doble suspensión, 18v, freno V-Brake, ruedas de aluminio, asiento de gel.',
  ST6150:   'Cuadro acero hidroformado ultra liviano caños 35mm, frenos V-Brake Stark VB-978DK, caja movimiento Stark ZYB-2, plato 46T 170mm, Shimano Tourney 7v, ruedas doble pared 700C 36H, descarrilador Shimano RD-TY21, talle 16.',
  PLEGCUR:  'Cuadro Fire Bird acero R20 plegable, plato FAST 52T 170mm, cambio Shimano RD-FT35 6/7v, frenos disco mecánico 160mm, cubiertas Poneñy 20x1.75, pedales rebatibles, stem rebatible con cierre rápido, asiento City con elastómeros.',
  FB19052:  'Cuadro Fire Bird acero R16 Cross dama, transmisión 1v plato FAST 32D, frenos V-Brake 4 piezas, cubierta DSH 16x1.90 diseño paseo, forma BMX, asiento acolchado paseo.',
  FB19069:  'Cuadro Fire Bird R20 con portapaquete, transmisión 1v plato Shunfeng 40D piñón 18T, ruedas aluminio, frenos Power V-Brake, forma playera acero, asiento dama con flores, incluye timbre y canasto.',
  FB19050:  'Cuadro Fire Bird acero R16 Cross dama, plato FAST 32D, piñón Shunfeng, frenos V-Brake resina, cubierta DSH 16x1.90, forma BMX blanca, asiento acolchado combinado.',
  FB19052B: 'Cuadro Fire Bird acero R16 Cross dama (honey), plato FAST 32D, piñón Shunfeng, frenos V-Brake resina, cubierta DSH 16x1.90, forma BMX blanca, asiento acolchado combinado.',
  ST6172:   'Cuadro Stark Alloy 6061 frente integrado, frenos V-Brake VB-978DK, Shimano Tourney 21v, ruedas doble pared 700C, descarriladores Shimano RD-TY21/FD-TZ50, stem Promax MQ-527.',
  ST6182:   'Cuadro acero reforzado caños 35mm cromo, frenos V-Brake Stark PVC, caja ZYB-09, plato acero 36T 155mm, ruedas aluminio rectificado 24x2.25, horquilla acero 225mm, piñón 18T.',
  ST6058:   'Cuadro acero hidroformado con portapaquete/guardabarros, frenos V-Brake Stark PVC, plato 46T 170mm, ruedas aluminio 26x1.95, talle 16.',
  URB11H:   'Cuadro y horquilla aluminio Raleigh Urban 1.1, transmisión Shimano Altus 8v+3v, frenos hidráulicos Shimano MT-200, piñón CS-HG200 8v 12/32 cassette, disco Center Lock 160mm, ruedas 700C.',
  URB11G:   'Cuadro y horquilla aluminio Raleigh Urban 1.1, transmisión Shimano Altus 8v+3v, frenos hidráulicos Shimano MT-200, piñón CS-HG200 8v 12/32 cassette, disco Center Lock 160mm, ruedas 700C.',
  DAL20:    'Cuadro aluminio, suspensión delantera con bloqueo, transmisión 21v full Shimano, ruedas doble pared, freno disco mecánico, asiento de gel, componentes full aluminio.',
  ST6006:   'Cuadro acero reforzado caños 35mm esmalte, frenos V-Brake blanco, plato acero 36T 125mm, piñón 18T, ruedas aluminio 16x3/4, manillar cromado 680mm.',
  ST6199:   'Cuadro Stark 2.0 Alloy 6061 frente integrado, frenos V-Brake VB-968SK, plato 42-34-24 160mm, ruedas doble pared 20x1.75, horquilla suspensión acero, piñón 18T.',
  FB19067:  'Cuadro Fire Bird BMX R20 nena con pivot, transmisión 1v plato FAST 40D piñón Shunfeng 18D, ruedas aluminio 20x1.75, frenos V-Brake, forma BMX blanca con travesaño.',
  VEN3:     'Cuadro Venture 3.0 R27.5, horquilla Raleigh Venture, transmisión Shimano 21v, freno disco mecánico 160mm C-Star BX-350, cambio RD-TZ400, plato FC-TY301 42/34/24 175mm, talles 16-18.',
  JAZZI:    'Cuadro y horquilla R20 aluminio Raleigh Jazzi, transmisión 1v plato 40D, pedales nena flor rosa, forma BMX con travesaño, canasto y portamuñeca incluidos.',
  FB16V:    'Cuadro y horquilla BMX R16 varón con pivot, plato 36D playero negro, piñón 16T, ruedas 48 rayos llanta aluminio, frenos V-Brake plástico, forma BMX con travesaño negra.',
  FBWIN:    'Cuadro Fire Bird R16 Cross varón caños oversize con guardabarros, plato FAST 36D, piñón Shunfeng 16D, ruedas aluminio multirayos 48H, frenos V-Brake resina, cubierta BMX 16x1.90 negra.',
  ST6088:   'Cuadro acero hidroformado ultra liviano caños 35mm, Shimano Tourney 7v, ruedas doble pared 700C, frenos V-Brake Stark, piñón Shimano 14-28T, manillar Promax JB-6833.',
  COL49:    'Cuadro aluminio 6061 frente cónico cableado interno, horquilla con regulación y bloqueo, Shimano Tourney 21v, frenos disco mecánico 160mm, ruedas doble pared, mazas a rulemán, cubiertas Kenda 29.',
  COL14:    'Cuadro aluminio 6061 frente cónico, horquilla Suntour XC30 con bloqueo, Shimano Altus 27v, frenos disco hidráulico Shimano 160mm, mazas Center Lock, cubiertas 29x2.10.',
  ST6165:   'Cuadro Stark 2.0 Alloy 6061 frente integrado, frenos disco mecánico 160mm, Shimano 21v, ruedas doble pared 29x1.75, horquilla acero.',
  ST6165B:  'Cuadro aluminio reforzado, ruedas doble pared aluminio, transmisión 21v full Shimano, manubrio doble altura, asiento de gel, cubierta asfalto, suspensión delantera fija.',
  BIN20:    'Cuadro aluminio, suspensión delantera con bloqueo, transmisión 21v full Shimano, ruedas doble pared, freno disco mecánico, asiento de gel.',
  M70:      'Cuadro aluminio 3 Butted Boost, horquilla Suntour X1 32 con aire y bloqueo remoto, Shimano Deore 1x12v, frenos hidráulicos Shimano MT-200, discos 180/160mm Center Lock, piñón CS-M6100 10/51, plato FC-MT5101 34T, llantas doble pared perfil aero.',
  VENZO:    'Cuadro Venzo Primal EX aluminio 6061, horquilla RST Gila ML / Suntour XCT, Shimano 24v full, frenos disco hidráulico Shimano, ruedas doble pared, cubiertas Chaoyang 29x2.00.',
  STRADA:   'Cuadro aluminio liviano, horquilla carbono, transmisión Claris 2x8, manubrio aluminio curvo, ruedas triple pared, cubiertas 700x20.',
  REM305:   'Cuadro aluminio R20, ruedas doble pared, frenos V-Brake, Shimano 1x7v plato 52D, pedales plegables, asiento gel ajustable.',
  ST6098:   'Cuadro acero cromado con color, ruedas estabilizadoras, asiento de gel, cubiertas 16x1.175.',
  ST6129:   'Cuadro acero hidroformado caños 50mm fluor, frenos V-Brake Stark PVC, plato acero 32T 130mm, ruedas aluminio rectificado 12x2.25, horquilla acero 195mm, piñón 18T.',
  ST6167:   'Cuadro Stark Alloy 6061 frente integrado, Shimano Tourney 21v, ruedas doble pared 26x1.75, frenos V-Brake, stem Promax MQ-527, manillar Promax JB-6833.',
  ROWDY:    'Cuadro MTB R20 aluminio Rowdy, horquilla suspensión R20, transmisión Shimano 21v, freno disco mecánico 160mm FAST, cambio RD-TZ400, piñón MF-TZ21 7v.',
  RALSTR:   'Cuadro y horquilla aluminio plegable Raleigh Straight, plato 52T 170mm, pedal plegable VP-F55, Shimano RD-FT35 6/7v, frenos disco mecánico 160mm, ruedas R20 con disco.',
};

// 106 fichas en orden B01-B106
const FICHAS = [
  F.RALCLASD, F.LILHON,   F.MXR,      F.MXR20,    F.BIN55,    F.SCOUT24,
  F.MXR20,    F.MXR,      F.MXR20,    F.LILHON,   F.BIN40,    'n/n',
  F.MXR,      F.MXR,      F.KENTO,    F.VNT19105, F.VNT19105, 'n/n',
  F.KENTO,    F.ST6150,   F.PLEGCUR,  'n/n',      F.FB19052,  F.FB19069,
  'n/n',      'n/n',      F.FB19050,  'n/n',      F.FB19050,  F.SCOUT24D,
  F.ST6172,   F.ST6182,   'n/n',      F.ST6058,   F.URB11H,   F.DAL20,
  'n/n',      F.PLEGCUR,  'n/n',      'n/n',      F.ST6006,   F.ST6172,
  'n/n',      F.ST6199,   'n/n',      F.FB19067,  'n/n',      F.ST6182,
  F.VEN3,     F.JAZZI,    'n/n',      F.FB19052B, F.FB19050,
  // local
  F.FB16V,    F.FBWIN,    F.FBWIN,    'n/n',      F.ST6088,   F.RALCLASD,
  F.ST6150,   'n/n',      'n/n',      'n/n',      F.COL49,    F.URB11G,
  F.ST6165,   F.BIN20,    F.M70,      F.BIN40,    F.COL14,    'n/n',
  'n/n',      F.VENZO,    F.COL49,    F.STRADA,   F.REM305,   'n/n',
  'n/n',      F.PLEGCUR,  'n/n',      'n/n',      'n/n',      F.MXR,
  'n/n',      F.ST6098,   'n/n',      F.MXR,      'n/n',      'n/n',
  F.ST6129,   F.ST6129,   'n/n',      'n/n',      F.ST6172,   'n/n',
  'n/n',      F.ST6167,   F.ST6165B,  F.ST6182,   F.SCOUT24D, F.SCOUT24,
  F.MXR20,    F.ROWDY,    'n/n',      F.RALSTR,   F.PLEGCUR,
];

async function main() {
  const token = await getToken();
  const values = FICHAS.map(f => [f]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/STOCK!Q2:Q${1 + values.length}?valueInputOption=RAW`;
  const r = await put(url, { values }, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  console.log(`✅ Fichas cargadas: ${r.updatedCells} celdas`);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });

/**
 * cargar-stock-nuevo.js
 * Borra todo el stock existente y carga el nuevo inventario.
 * Uso: node scripts/cargar-stock-nuevo.js
 */
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');

// Minimal axios-like helper
function post(url, data, headers) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ data: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function put(url, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'PUT', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ data: JSON.parse(d) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
const axios = { post, put };

const SHEET_ID = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';
const TODAY    = '2026-04-03';

// ── Auth (igual que server.js) ────────────────────────────────────────────────
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
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${hdr}.${cls}`);
  const sig = signer.sign(SA.private_key).toString('base64url');
  const jwt = `${hdr}.${cls}.${sig}`;
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const r = await axios.post('https://oauth2.googleapis.com/token', body,
    { 'Content-Type': 'application/x-www-form-urlencoded' });
  _tok = { token: r.data.access_token, exp: Date.now() + 3500000 };
  return _tok.token;
}

// ── Fichas técnicas reutilizadas ──────────────────────────────────────────────
const F = {
  RALCLASD: 'ASIENTO PLAYERO CON ELASTOMERO - VADER, JUEGO DE DIRECCION 8 PIEZAS NEGRO - NECO, CARTRIDGE 34.7mm DER/IZQ - 123mm - CHINA, PLATO Y PAL. 42D x 170mm - NEGRO - RALEIGH CLASSIC 700C, PEDALES CITY PVC Y GOMA 9/16 - FEIMIN, STEM DE ALUMINIO CORTO COLOR NATURAL, PUÑOS COCIDOS A MANO MTB, CUAD.Y HORQ.700C RALEIGH CLASSIC DAMA, PAR MANIJAS DE FRENO FULL ALUM. - C-STAR, SET DE FRENOS V-BRAKE 4 PIEZAS - ALUMINIO - LOGAN, PAR DE RUEDAS R28 - RALEIGH CLASSIC, CAMARA 700 x 32-35 VALVULA AMERICANA LARGA - KYOWA, CUBIERTA 700C38 HARDTEX 60 TPI BLANCA, SHIFTER NEXUS 3v - NEGRO, CADENA 1/2x1/8 - P-410 CROMADA - TAIWAN, PIÑON SHIMANO NEXUS 3v.',
  LILHON:   'CADENA 1/2x1/8x80 - X-410, PIÑON 18T FULL BALL - SHUN FENG, JUEGO DE DIRECCION 8 PIEZAS NEGRO - NECO, PLATO SOLO 36D RALEIGH LILHON, BIELA PLAYERA R16 - 127mm - CROMADA, PEDALES NENA 1/2 S/BOLILLAS - FEIMIN, FORMA BMX R16 C/TRAVESAÑO BLANCA - TIPO BMX, STEM PLAYERO ACERO/ALUMINIO 22.2mm - POWER, PUÑOS RALEIGH KIDS, CUA. Y HORQ. RALEIGH LILHON, SET FRENO V-BRAKE BLANCO P/RALEIGH KIDS NENA, PAR DE RUEDAS LILHONEY 16 C/CYC, ASIENTO RALEIGH LILHON, DISCO DE RUEDA R16 RALEIGH - LILHON, CANASTO RALEIGH R16 - LILHON, PORTAMUÑECA R16 - RALEIGH, RUEDAS ESTABILIZADORAS R16 - IMPORTADO (R15',
  MXR:      'cuadro de aluminio, guardabarros plásticos, ruedas estabilizadoras, asiento de gel, cubiertas 2.3 anchas, frenos v brake.',
  MXR20:    'cuadro de aluminio, guardabarros plásticos, asiento de gel, cubiertas 2.3 anchas, frenos v brake.',
  BIN55:    'JUEGO DE DIRECCION FRENTE INTEGRADO - NECO, PEDALES MTB ALUMINIO/ACERO - FEIMIN, CUADRO 5.5 R29 - ALUMINIO, HORQUILLA SUNTOUR XCM PARA RALEIGH 5.5, CAMARA 29 x 2.10 VALVULA AMERICANA LARGA - KYOWA, RUEDA ARMADA RALEIGH 5.5-29 SIN CAM.Y CUBIERTA, CAMBIO SHIMANO DEORE RD-M5120SGS - 10V, SHIFTER SHIMANO DEORE SL-M4100 - 10V, PIÑON SHIMANO DEORE CS-M4100 - 10V - 11/46, DISCO DE FRENO SHIMANO C/CENTER LOCK 160mm SM-RT10, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200 - DELANTERO, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200 - TRASERO, FORMA DE ALUMINIO 31.8 x 720mm - RALEIGH, ASIENTO RALEIGH 5.5, PLATO Y PALANCA LTWOO INTEGRADO ALUMINIO 38T x 175mm - C/MOV, CUBIERTA JILUER 29X2.10 60 TPI NEGRA-GUM J-1634, PAR DE PUÑOS RALEIGH, AHEAD 31.8 x 80mm - RALEIGH, CADENA SHIMANO DEORE - HG-54 - 10 V.',
  SCOUT24:  'JUEGO DE DIRECCION OVERSIZE S/ROSCA AHEAD - FEIMIN, PEDALES MTB DE ALUMINIO Y RESINA - NEGRO, CUADRO MTB R24 ALUMINIO, PAR DE RUEDAS R24, CAMBIO SHIMANO RD-TZ400 - 21V, DESCARRILADOR SHIMANO FD-TX50 APTO 42D, MANIJA INTEGRADA SHIMANO ST-EF500-L - 3V, MANIJA INTEGRADA SHIMANO ST-EF500-7R - 7V, PIÑON SHIMANO MF-TZ21 - 7V - 14/28 - A ROSCA, PLATO Y PALANCA SHIMANO FC-TY301 - C/CUBRECADENA - 42/34/24 - 175mm, FORMA DE ALUMINIO NEGRO 560mm, ASIENTO RALEIGH, SET DE FRENO A DISCO MECANICO - C/DISCOS 160mm - C-STAR BX-350, CADENA 1/2x3/32x116 - P7002 - 18/21V - RLH, AHEAD DE ALUMINIO NEGRO 90MM, CAJA PEDALERA SHIMANO BB-UN100 - 122.5mm - C/TORNILLOS, PUÑOS MTB GOMA - IMPORTADO, HORQUILLA C/SUSPENSION R24 - OVERSIZE - CABEZAL ALUMINIO - V-BRAKE/DISCO.',
  SCOUT24D: 'JUEGO DE DIRECCION OVERSIZE S/ROSCA AHEAD - FEIMIN, PEDALES MTB DE ALUMINIO Y RESINA - NEGRO, CUADRO MTB R24 ALUMINIO, PAR DE RUEDAS R24, CAMBIO SHIMANO RD-TZ400 - 21V, DESCARRILADOR SHIMANO FD-TX50 APTO 42D, MANIJA INTEGRADA SHIMANO ST-EF500-L - 3V, MANIJA INTEGRADA SHIMANO ST-EF500-7R - 7V, PIÑON SHIMANO MF-TZ21 - 7V - 14/28 - A ROSCA, PLATO Y PALANCA SHIMANO FC-TY301 - C/CUBRECADENA - 42/34/24 - 175mm, FORMA DE ALUMINIO NEGRO 560mm, ASIENTO RALEIGH, SET DE FRENO A DISCO MECANICO - C/DISCOS 160mm - C-STAR BX-350, CADENA 1/2x3/32x116 - P7002 - 18/21V - RLH, AHEAD DE ALUMINIO NEGRO 90MM, CAJA PEDALERA SHIMANO BB-UN100 - 122.5mm - C/TORNILLOS, PUÑOS MTB GOMA - IMPORTADO, HORQUILLA C/SUSPENSION R24 - OVERSIZE - CABEZAL ALUMINIO - V-BRAKE/DISCO.',
  BIN40:    'JUEGO DE DIRECCION FRENTE INTEGRADO - NECO, PLATO Y PALANCA DOBLE 38-24 - 170mm - 9V - ALUMINIO - SUNTOUR, PEDALES MTB ALUMINIO/ACERO - FEIMIN, PUÑOS MTB NEGROS CON ANILLO NEGRO - RALEIGH, HORQUILLA SUNTOUR XCT PARA RALEIGH 4.0, CAMARA 29 x 2.10 VALVULA AMERICANA LARGA - KYOWA, CUBIERTA HARTEX XTRA ACTION 29 x 2.10 SW, CAMBIO SHIMANO ALTUS RD-M2000SGS - 9V, DESCARRILADOR SHIMANO ALTUS FD-M371 - DOBLE TIRO, SHIFTER ALTUS ST-M2010 - 9V - 2V, PIÑON SHIMANO CS-HG200 - 9V - 11/34, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200, CAJA PEDALERA SHIMANO BB-UN100 - 122.5mm - C/TORNILLOS, CADENA SHIMANO DEORE - HG-53 - 9V, FORMA DE ALUMINIO 31.8 x 700mm - RALEIGH 4.0 R29, AHEAD 31.8 x 80mm - RALEIGH 4.0, ASIENTO RALEIGH.',
  VNT19105: 'ASIENTO PLAYERO, CADENA 1/2x1/8x108 - X-410 - RLH, PIÑON 16T FULL BALL - SHUN FENG, JUEGO DE DIRECCION 8 PIEZAS NEGRO - NECO, PLATO Y PAL. 36D x 165mm - CROMADO - PUNTA CUADRADA, PEDALES CITY PVC Y GOMA 9/16 - FEIMIN, FORMA PASEO R26/28 CROMADA - IMPORTADA, PUÑOS COCIDOS A MANO MTB, CUADRO Y HORQUILLA 26 VINTAGE SIN CAMBIOS DE ACERO, SET DE FRENOS V-BRAKE 4 PIEZAS - ALUMINIO CON MANIJAS Y CABLES - POWER, PAR DE RUEDAS R26 - 1 V -LLANTA DOBLE PARED BLANCA, CAMARA 26 x 1.95 VALVULA AMERICANA - KYOWA, CUBIERTA 26 x 1.95 PLAYERA, RODADO 26.',
  KENTO:    'cuadro de acero, doble suspensión, 18 v, freno v-brake, ruedas comunes de aluminio, asientos de gel.',
  ST6150:   'CUADRO: Cuadro Acero Hidroformado, Ultra Liviano - Caños Inferior 35 mm, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: ALLOY, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Alloy Black Cranck - 46 T, Lenght 170, SHIFTER: SHIMANO SHIFTER TOURNEY, 7 SPEED, Material ALLOY, W/SP Black Shifter, RUEDAS: Double Wall Alloy, 28" * 700C TYRES, W/36H Mazas Steel W/7S, Index Freewheel and Disc Spoke, STEM: Material: ALLOY, Sizes: 22.2*160 mm / EXT: 90 mm, HORQUILLA: STARK, Acero, Medida de Vela de 50 mm Ancho * 100 mm largo, PIÑON: Index FW-18T, SIZE: 14-28T, DESCARRILADOR TRASERO: SHIMANO Tourney Rear, MODEL: RD-TY21, 7S, INDEX, MANILLAR: Material: ALLOY, Altura 65 mm, Distancia 620 mm, TALLE: 16.',
  PLEGCUR:  'Cuadro FIRE BIRD de acero rodado 20 plegable, horquilla de acero, plato FAST 52T x 170 mm especial plegable, cambio Shimano RD-FT35 de 6/7 velocidades, piñón Shimano MF-TZ20 de 6 velocidades 14/28 a rosca, cadena RLH 1/2 x 3/32 x 116, caja KENLI cartridge de 118 mm, juego de dirección FEIMIN especial plegable sin rosca, ruedas FAST especiales plegables, frenos FAST a disco mecánico de 160 mm, cubiertas PONEÑY 20 x 1.75 city plegable, pedales FEIMIN 9/16 rebatibles, forma FAST de acero con stem rebatible y cierre rápido, caño de asiento FIRE BIRD 28.6 x 500 mm, asiento FAST acolchado modelo City con elastómeros y puños FIRE BIRD de gel negros con anillo gris.',
  FB19052:  'Cuadro FIRE BIRD de acero rodado 16 modelo Cross dama, con horquilla de acero, transmisión simple de 1 velocidad con plato FAST de 32 dientes, frenos FAST V-Brake de 4 piezas, ruedas de acero FIRE BIRD, cubiertas DSH 16 x 1.90 diseño paseo blancas, forma FIRE BIRD estilo BMX blanca, asiento acolchado paseo R16 y puños de goma blancos. En conjunto, es una bici infantil simple, resistente y cómoda, pensada para paseo y uso diario.',
  FB19069:  'Cuadro FIRE BIRD rodado 20 con portapaquete soldado, horquilla importada, transmisión de 1 velocidad con plato SHUNFENG de 40 dientes y piñón de 18T, ruedas de aluminio con cámaras y cubiertas blancas importadas, frenos POWER V-Brake, forma playera de acero, asiento dama blanco con flores, pedales color rosa y accesorios incluidos como timbre y canasto plástico. En conjunto, es una bici playera rodado 20 práctica, cómoda y vistosa, ideal para paseo y uso diario.',
  FB19050:  'CUADRO: FIRE BIRD Acero Rodado 16 - Modelo Cross Dama, HORQUILLA: FIRE BIRD Acero Rodado 16 - Cross, PLATO: FAST Monoplato 32 D, CAMBIO: 1 velocidad, PIÑON: SHUNFENG, CADENA: RLH 16 Dientes - FULL BALL, CAJA: SHUNFENG Mov. Central 50 mm, JUEGO DE DIRECCIÓN: FEIMIN Negro 8 piezas, RUEDAS: FIRE BIRD Acero Natural o Negra, MAZAS: SHUNFENG Mazas negras 20 AG, FRENOS: FAST V-Brake 4 piezas - resina, CUBIERTAS: DSH Modelo 16 x 1.90 - Diseño Paseo - Blancas, PEDALES: FEIMIN Plásticos 1/2 esp niños, FORMA: FIRE BIRD Diseño BMX - Blanca, CAÑO DE ASIENTO: FAST Acero 25.4 mm x 230 mm - Negro, ASIENTO: FIRE BIRD Paseo R16 - Acolchado - Combinado, PUÑOS: FIRE BIRD Blancos Goma - Cortos R16.',
  FB19052B: 'CUADRO: FIRE BIRD Acero Rodado 16 - Modelo Cross Dama, HORQUILLA: FIRE BIRD Acero Rodado 16 - Cross, PLATO: FAST Monoplato 32 D, CAMBIO: 1 velocidad, PIÑON: SHUNFENG, CADENA: RLH 16 Dientes - FULL BALL, CAJA: SHUNFENG Mov. Central 50 mm, JUEGO DE DIRECCIÓN: FEIMIN Negro 8 piezas, RUEDAS: FIRE BIRD Acero Natural o Negra, MAZAS: SHUNFENG Mazas negras 20 AG, FRENOS: FAST V-Brake 4 piezas - resina, CUBIERTAS: DSH Modelo 16 x 1.90 - Diseño Paseo - Blancas, PEDALES: FEIMIN Plásticos 1/2 esp niños, FORMA: FIRE BIRD Diseño BMX - Blanca, CAÑO DE ASIENTO: FAST Acero 25.4 mm x 230 mm - Negro, ASIENTO: FIRE BIRD Paseo R16 - Acolchado - Combinado, PUÑOS: FIRE BIRD Blancos Goma - Cortos R16.',
  ST6172:   'CUADRO: Cuadro STARK / Frente Integrado / Alloy 6061, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: ALLOY, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Alloy Black Cranck, 32* 2838 48*, Lenght 170, SHIFTER: SHIMANO SHIFTER TOURNEY, 21 SPEED, Material ALLOY, W/SP Black Shifter, RUEDAS: Double Wall Alloy, 28" * 700C TYRES, W/36H Mazas Steel W/7S, Index Freewheel and Disc Spoke, STEM: PROMAX MQ-527, Material: ALLOY ADJUSTABLE, Sizes: 25.4*180MM / EXT: 105MM, HORQUILLA: STARK, Suspensión Cabezal de Acero, PIÑON: Index FW-18T, SIZE: 14-28T, DESCARRILADOR TRASERO: SHIMANO Tourney Rear, MODEL: RD-TY21, 7S, INDEX, DESCARRILADOR DELANTERO: SHIMANO Tourney Front, MODEL: FD-TZ50, 3S, DOWN PULL.',
  ST6182:   'CUADRO: Cuadro Acero Reforzado, Caños Inferior 35 mm, Pintura liquida sobre base Chrome, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: PVC, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: B.B.SETS, Model: ZYB-09, SET OF 9PCS, Material: Steel, ENGRANAJE: Steel Cranck - Largo 155 mm, Chainwheel 36 T, RUEDAS: Llantas de Aluminio Rectificado, 24 * 2,25 (Tyre DRC), Mazas de Acero 28 H, STEM: STARK Material: ALLOY, SIZE: 28.6 X 31.8 X 60MM, 7 Degree, Matt Black, HORQUILLA: STARK, Acero, Medida de Vela de 225 mm largo, PIÑON: Acero, Size - 18 T.',
  ST6058:   'CUADRO: Cuadro Acero Hidroformado, Ultra Liviano - Caños Inferior 35 mm - Portapaquete / Guardabarros, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: PVC, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: B.B.SETS, Model: ZYB-09, SET OF 9PCS, Material: Steel, ENGRANAJE: Steel Cranck - Largo 170 mm, Chainwheel 46 T, RUEDAS: Llantas de Aluminio, 26 * 1,95 (Tyre DRC), Mazas de Acero 36 H, STEM: Material: Steel, Sizes: 22.2*160 mm / EXT: 90 mm, HORQUILLA: STARK, Acero, Medida de Vela de 225 mm largo, PIÑON: Acero, Size - 20 T, TALLE: 16.',
  URB11H:   'CADENA P8003 - 8V - 116 ESLABONES - TAYA, JUEGO DE DIRECCION FRENTE INTEGRADO - NECO, CARTRIDGE 34.7mm DER/IZQ - 123mm - NECO, PUÑOS MTB NEGROS CON ANILLO NEGRO - RALEIGH, CUADRO Y HORQ.ALUMINIO RALEIGH URBAN 1.1, PAR DE RUEDAS 700C PARA RALEIGH URBAN, SHIFTER SHIMANO ALTUS SL-M310 - 3V, SHIFTER SHIMANO ALTUS SL-M310 - 8V, PIÑON SHIMANO CS-HG200 - 8V - 12/32 A CASSETTE, PLATO Y PALANCA SHIMANO FC-TY301 - 48/38/28 - 170mm - S/CUBRECADENA, DISCO DE FRENO SHIMANO C/CENTER LOCK 160mm SM-RT10, FORMA ALUM.RALEIGH URBAN 1.0, STEM ALUMINIO PARA RALEIGH URBAN, PEDALES MTB ALUMINIO - NEGRO - C/BOLILLAS - 1 PIEZA, CAMBIO SHIMANO ALTUS RD-M310 - 7/8V, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200 - TRASERO, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200 - DELANTERO, ASIENTO MTB ANTIPROSTATICO NEGRO-GRIS - DDK, TALLES 17 - 19 - 21, COLORES GRIS ROJO NEGRO - GRIS AZUL NEGRO.',
  URB11G:   'CADENA P8003 - 8V - 116 ESLABONES - TAYA, JUEGO DE DIRECCION FRENTE INTEGRADO - NECO, CARTRIDGE 34.7mm DER/IZQ - 123mm - NECO, PUÑOS MTB NEGROS CON ANILLO NEGRO - RALEIGH, CUADRO Y HORQ.ALUMINIO RALEIGH URBAN 1.1, PAR DE RUEDAS 700C PARA RALEIGH URBAN, SHIFTER SHIMANO ALTUS SL-M310 - 3V, SHIFTER SHIMANO ALTUS SL-M310 - 8V, PIÑON SHIMANO CS-HG200 - 8V - 12/32 A CASSETTE, PLATO Y PALANCA SHIMANO FC-TY301 - 48/38/28 - 170mm - S/CUBRECADENA, DISCO DE FRENO SHIMANO C/CENTER LOCK 160mm SM-RT10, FORMA ALUM.RALEIGH URBAN 1.0, STEM ALUMINIO PARA RALEIGH URBAN, PEDALES MTB ALUMINIO - NEGRO - C/BOLILLAS - 1 PIEZA, CAMBIO SHIMANO ALTUS RD-M310 - 7/8V, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200 - TRASERO, FRENO HIDRAULICO ENSAMBLADO SHIMANO MT-200 - DELANTERO, ASIENTO MTB ANTIPROSTATICO NEGRO-GRIS - DDK, TALLES 17 - 19 - 21, COLORES GRIS ROJO NEGRO - GRIS AZUL NEGRO.',
  DAL20:    'cuadro de aluminio, suspensión delantera en aluminio con bloqueo y ajuste, transmisión 21 v full shimano, ruedas doble pared reforzadas, cubiertas importadas, freno a disco mecánico, asiento de gel, componentes full aluminio.',
  ST6006:   'CUADRO: Cuadro Acero Reforzado, Caños Inferior 35 mm, Pintura líquida sobre base esmalte, SISTEMA DE FRENOS: STARK F/R V-BRAKE, Material: ALLOY, Brake PAD 55MM, Sizes 110MM, Colour White, CAJA MOVIMIENTO CENTRAL: B.B.SETS, Model: ZYB-09, SET OF 9PCS, Material: Steel, ENGRANAJE: Steel Cranck - Largo 125 mm, Chainwheel 36 T, PIÑÓN: Acero, Size - 18 T, RUEDAS: Llantas de Aluminio, 16 * 3/4 (Tyre DRC), Mazas de Acero 20 H, STEM: Material: Aluminio, Sizes: 22 mm - 60 mm, MANILLAR: Material: Cromado, Altura 130 mm, Distancia 680 mm, Matt White.',
  ST6199:   'CUADRO: Cuadro STARK 2.0 / Frente Integrado / Alloy 6061, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-968SK, ALLOY, Lenght 110 mm, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Alloy Black Cranck, 42-34-24 x 160 mm, RUEDAS: Double Wall Alloy, 20"1.75 RIM, W/14G Steel Spoke, Mazas 36 H Alloy, STEM: STARK Model: MQ-527, Material: ALLOY, SIZE: 28.6 X 31.8 X 40 mm, HORQUILLA: STARK, Suspensión Cabezal de Acero, PIÑÓN: Acero, Size - 18 T, MANILLAR: STARK Handeblar, Model: MD-HB-04, ALLOY, SIZE: 22.225.4*580 mm.',
  FB19067:  'Cuadro FIRE BIRD BMX rodado 20 para nena con pivot, horquilla a juego, transmisión simple de 1 velocidad con plato FAST de 40 dientes y piñón SHUNFENG de 18 dientes, ruedas de aluminio FIRE BIRD 20 x 1.75, frenos FAST V-Brake, forma BMX blanca con travesaño, asiento Cross R20 negro y puños importados. En conjunto, es una bici rodado 20 resistente, liviana y práctica, pensada para paseo y uso recreativo.',
  VEN3:     'CADENA 1/2x3/32x116 - P7003 - 21V - RLH, JUEGO DE DIRECCION FRENTE INTEGRADO - NECO, CARTRIDGE 34.7mm DER/IZQ - 123mm - NECO, PEDALES MTB ALUMINIO - NEGRO - C/BOLILLAS - 1 PIEZA, FORMA MTB 25.4 x 680mm - ALUMINIO - PALOMITA, AHEAD STEM ANG.REG. PROMAX MA-525 ESP.VENTURE, PUÑOS DE GEL, CUADRO VENTURE 3.0 27.5, HORQUILLA RALEIGH VENTURE, CAMBIO SHIMANO RD-TZ400 - 21V, MANIJA INTEGRADA SHIMANO ST-EF41-L - 3V, MANIJA INTEGRADA SHIMANO ST-EF41-7R - 7V, PIÑON SHIMANO MF-TZ21 - 7V - 14/28 - A ROSCA, PLATO Y PALANCA SHIMANO FC-TY301 - S/CUBRECADENA - 42/34/24 - 175mm, ASIENTO RALEIGH VENTURE 3.0, SET DE FRENO A DISCO MECANICO - C/DISCOS 160mm - C-STAR BX-350, TALLES 16 - 18.',
  JAZZI:    'CADENA 1/2x1/8x90 - X-410, PIÑON 18T FULL BALL - SHUN FENG, JUEGO DE DIRECCION 8 PIEZAS NEGRO - NECO, PLATO SOLO 40D RALEIGH JAZZI, BIELA PLAYERA R20 - 152 mm, PEDALES NENA 1/2 S/BOLILLAS - FLOR ROSA - FEIMIN, FORMA BMX R20 C/TRAVESAÑO BLANCA - TIPO BMX, PUÑOS RALEIGH KIDS - NENA, CUADRO Y HORQUILLA R20 ALUMINIO - RALEIGH JAZZI, SET FRENO V-BRAKE BLANCO P/RALEIGH KIDS NENA, ASIENTO RALEIGH JAZZI, CANASTO RALEIGH R20 - JAZZI, PORTAMUÑECA R20 - RALEIGH.',
  FB16V:    'ASIENTO BMX 16 VADER ACOLCHADO NEGRO, CADENA 1/2x1/8x80 - X-410, PIÑON 16T FULL BALL - SHUN FENG, JUEGO DE DIRECCION 8 PIEZAS NEGRO - PO, PLATO SOLO 36D PLAYERO NEGRO, BIELA PLAYERA R16 - 127mm - NEGRA, PEDALES CHICO 1/2 - FEIMIN, STEM PLAYERO ACERO/ALUMINIO 22.2mm - POWER, PUÑOS R12/16 CORTO NEGRO - IMPORTADOS, CUADRO Y HORQUILLA BMX16 - VARON CON PIVOT, SET DE FRENOS V-BRAKE 4 PIEZAS CON MANIJAS Y CABLES - PLASTICO - POWER, PAR DE RUEDAS R16 48 RAYOS LLANTA ALUMINIO - CUBIERTA NEGRA, FORMA BMX R16 C/TRAVESAÑO NEGRA - TIPO BMX.',
  FBWIN:    'CUADRO: FIRE BIRD Acero Rodado 16 - Línea Cross varón, caños oversize, con guardabarros plásticos, HORQUILLA: FIRE BIRD Acero Rodado 16 - Cross Oversize, PLATO: FAST Monoplato 36 D, CAMBIO: 1 velocidad, PIÑÓN: SHUNFENG 16 Dientes - FULL BALL, CADENA: RLH X410 - 1/2 x 1/8 x 80, CAJA: NECO Mov. Central 50 mm, JUEGO DE DIRECCIÓN: NECO Negro 8 piezas a rosca, RUEDAS: FIRE BIRD Aros de aluminio - Mazas de acero - Multirayos, MAZAS: SHUNFENG Mazas negras 48 Agujeros, FRENOS: FAST V-Brake 4 piezas - RESINA, CUBIERTAS: IMPORTADAS Modelo 16 x 1.90 - Diseño BMX - Negras, PEDALES: FEIMIN Plásticos 1/2 esp niños, FORMA: FIRE BIRD Forma BMX R16 - Negra con travesaño, CAÑO DE ASIENTO: FAST Acero 25.4 mm x 190 mm - Negro, ASIENTO: FIRE BIRD BMX R16 - Acolchado - Diseño Cross, PUÑOS: FIRE BIRD BMX R16 - De goma negros.',
  ST6088:   'CUADRO: Cuadro Acero Hidroformado, Ultra Liviano - Caños Inferior 35 mm, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: ALLOY, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Alloy Black Cranck - 46 T, Lenght 170, SHIFTER: SHIMANO SHIFTER TOURNEY, 7 SPEED, Material ALLOY, W/SP Black Shifter, RUEDAS: Double Wall Alloy, 28" * 700C TYRES, W/36H Mazas Steel W/7S, Index Freewheel and Disc Spoke, STEM: Material: ALLOY, Sizes: 28.6180MM / EXT: 105MM, HORQUILLA: STARK, Acero, Medida de Vela de 50 mm Ancho * 230 mm largo, PIÑON: SHIMANO, Index FW-18T, SIZE: 14-28T, DESCARRILADOR TRASERO: SHIMANO Tourney Rear, MODEL: RD-TY21, 7S, INDEX, MANILLAR: PROMAX, Model: JB-6833, ALLOY, SIZE: 22.225.4610MM, Altura 66 mm, Distance 180 mm',
  COL49:    'CUADRO: aluminio 6061 con frente cónico y cableado interno, HORQUILLA: con regulación y bloqueo de suspensión, CAMBIO TRASERO: Shimano Tourney TZ 7v, CAMBIO DELANTERO: Shimano Tourney 3v, SHIFTERS: Shimano EF500, PALANCAS: Prowheel 44-34-24, CADENA: KMC, PIÑÓN: Shimano TZ500-7, FRENOS: a disco mecánico de 160 mm, JUEGO DE DIRECCIÓN: Colner, STEM: Colner de aluminio, FORMA: Colner de aluminio, PORTASILLA: Colner de aluminio, ASIENTO: Colner Forest, RUEDAS: de aluminio doble pared con rayos de 2 mm y mazas a ruleman Colner, CUBIERTAS Y CÁMARAS: Kenda 29, ACCESORIOS: incluye pie de apoyo y pedales de nylon.',
  COL14:    'CUADRO: Aluminio 6061 con frente cónico y cableado interno, RODADO: 29, TALLES: 16 / 18 / 20, HORQUILLA: Suntour XC30 con regulación y bloqueo, TRANSMISIÓN: Shimano Altus 27 velocidades, CAMBIO TRASERO: Shimano Altus Shadow, PIÑÓN: Shimano 9 velocidades, SHIFTERS: Shimano, CADENA: KMC, FRENOS: Discos hidráulicos Shimano, discos de 160 mm, RUEDAS: Aros de aluminio de doble pared, MAZAS: Shimano Center Lock, CUBIERTAS: 29 x 2.10.',
  ST6165:   'CUADRO: STARK 2.0 / Frente Integrado / Alloy 6061, SISTEMA DE FRENOS: Disco Mecánico 160 mm, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Steel Cranck, SHIFTER: Manija integrada STARK, RUEDAS: Double Wall Alloy 29"1.75 RIM, W/14G Steel Spoke - Mazas 36 H Alloy, STEM: STARK Model: MQ-527 / Material: ALLOY, SIZE: 28.6 X 31.8 X 60MM, 7 Degree, Matt Black, MANILLAR: STARK Handeblar, Model: MD-HB-04, ALLOY, SIZE: 22.225.4*610MM, HORQUILLA: STARK, Cabezal de Acero, DESCARRILADOR DELANTERO: STARK, PIÑÓN: Index FW-18T, SIZE: 14-28T, DESCARRILADOR TRASERO: SHIMANO.',
  ST6165B:  'Cuadro de aluminio reforzado, ruedas doble pared reforzado de aluminio, transmisión 21 v full shimano, manubrio doble altura de aluminio, asiento prostático de gel, cubierta para asfalto, suspensión de delantera fija.',
  BIN20:    'cuadro de aluminio, suspensión delantera en aluminio con bloqueo y ajuste, transmisión 21 v full shimano, ruedas doble pared reforzadas, cubiertas importadas, freno a disco mecánico, asiento de gel, componentes full aluminio.',
  M70:      'CUADRO: Aluminio, TECNOLOGÍA DEL CUADRO: 3 Butted, SISTEMA: Boost, COLOR: Gris/Negro, GÉNERO: Sin género, EDAD MÍNIMA RECOMENDADA: 14 años, PESO APROXIMADO: 14 kg, PESO MÁXIMO SOPORTADO: 100 kg, SUSPENSIÓN: Delantera, MATERIAL DE LA LLANTA: Aluminio, MATERIAL DE LOS PEDALES: Aluminio, REQUIERE ENSAMBLADO: Sí, INCLUYE MANUAL DE ENSAMBLADO: No, TRANSMISIÓN: Shimano Deore 1x12 velocidades, SHIFTER: Shimano Deore SL-M6100, CAMBIO TRASERO: Shimano Deore RD-M6100SGS, PIÑÓN: Shimano Deore CS-M6100 10/51, PLATO Y PALANCA: Shimano Deore FC-MT5101 34T 175 mm, CADENA: Shimano Deore CN-M6100 12V, CAJA PEDALERA: LTWOO compatible 9/10/11/12V, FRENOS: Hidráulicos Shimano MT-200, DISCO DELANTERO: Shimano Center Lock de 180 mm, DISCO TRASERO: Shimano Center Lock de 160 mm, HORQUILLA: Suntour X1 32 con aire, REGULACIÓN: Sí, BLOQUEO REMOTO: Sí, JUEGO DE DIRECCIÓN: Integrado especial Mojave 7.0, MANUBRIO: De aluminio 31.8 x 720 mm, STEM: Raleigh Ahead de aluminio de 80 mm, PUÑOS: Raleigh negros de goma con ajuste externo metálico, ASIENTO: MTB Raleigh anatómico ultraliviano, CAÑO DE ASIENTO: De aluminio 27.2 x 400 mm, COLLAR DE ASIENTO: De aluminio negro con cierre de 35 mm, PEDALES: MTB aluminio/acero Feimin, LLANTAS: Raleigh doble pared de aluminio con perfil aero reforzado, MAZAS: Raleigh de aluminio, 4 rulemanes, Micro Spline, 12V, CUBIERTAS: Raleigh by Innova 29 x 2.35 de 65 TPI, CÁMARAS: Kyowa válvula americana 29 x 2.35, ACCESORIOS: Tornillos cromados porta caramañola y reflectores.',
  VENZO:    'CUADRO: Venzo Primal EX aluminio 6061, HORQUILLA: RST Gila ML / SR Suntour XCT, TRANSMISIÓN: Full Shimano 24 velocidades, FRENOS: Shimano a disco hidráulico, RUEDAS: Venzo R29 con llantas doble pared y mazas a rulemanes, CUBIERTAS: Chaoyang 29 x 2.00 con tacos, ASIENTO: Venzo, FORMA, AHEAD Y PORTASILLAS: Venzo de aluminio, PEDALES: de aluminio.',
  STRADA:   'cuadro aluminio liviano, horquilla de carbono, transmisión claris 2 x 8, asiento de gel, manubrio de aluminio curvo, ruedas triple pared reforzadas, cubiertas 700 x 20.',
  REM305:   'bicicleta urbana r20, cuadro en aluminio, ruedas doble pared reforzadas, sistemas frenos v brake, transmisión shimano 1 x 7 con plato palanca de 52 dientes, pedales plegables, asiento de gel ajustable.',
  ST6098:   'cuadro acero cromado con color, ruedas estabilizadoras, asiento de gel, cubiertas 16x1.175',
  ST6129:   'CUADRO: Cuadro Acero Hidroformado, Caños Superior 50 mm, Pintura liquida sobre base Fluor, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: PVC, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Steel Cranck - Largo 130 mm, Chainwheel 32 T, RUEDAS: Llantas de Aluminio Rectificado, 12 * 2,25 (Tyre DRC), Mazas de Acero 28 H, STEM: STARK Material: ALLOY, SIZE: 28.6 X 31.8 X 60MM, 7 Degree, Matt Black, TALLE: 16, HORQUILLA: STARK, Acero, Medida de Vela de 195 mm largo, PIÑON: Acero, Size - 18 T, MANILLAR: STARK Handeblar ALLOY, SIZE: 22.225.4610MM.',
  ST6167:   'CUADRO: Cuadro STARK / Frente Integrado / Alloy 6061, SISTEMA DE FRENOS: STARK F/R V-BRAKE SET, Model VB-978DK, Material: ALLOY, Brake PAD 55MM, Sizes 110MM, Colour Black, CAJA MOVIMIENTO CENTRAL: STARK BB.SET, MODEL: ZYB-2, ENGRANAJE: Alloy Black Cranck, 32* 2838 48*, Lenght 170, SHIFTER: SHIMANO SHIFTER TOURNEY, 21 SPEED, Material ALLOY, W/SP Black Shifter, RUEDAS: Double Wall Alloy, 26"1.75 RIM, W/14G Steel Spoke, Mazas 36 H Alloy, STEM: PROMAX MQ-527, Material: ALLOY ADJUSTABLE, Sizes: 25.4180MM / EXT: 105MM, HORQUILLA: STARK, Suspensión Cabezal de Acero, PIÑON: Index FW-18T, SIZE: 14-28T, DESCARRILADOR TRASERO: SHIMANO Tourney Rear, MODEL: RD-TY21, 7S, INDEX, DESCARRILADOR DELANTERO: SHIMANO Tourney Front, MODEL: FD-TZ50, 3S, DOWN PULL, MANILLAR: PROMAX, Model: JB-6833, ALLOY, SIZE: 22.225.4610MM, Altura 66 mm, Distance 180 mm',
  ROWDY:    'CADENA 1/2x3/32x116 - P7003 - 21V - RLH, JUEGO DE DIRECCION OVERSIZE S/ROSCA AHEAD - NECO, SEMI-CARTRIDGE 34.7mm DER/IZQ - 123mm, PLATO Y PALANCA SIMPLE ESPECIAL ROWDY, PEDALES MTB ALUMINIO/ACERO - FEIMIN, PIE REGULABLE R20/24/26/28 AL CENTRO ALUMINIO, PUÑOS DE GEL CON ANILLO, CUADRO MTB R20 ALUMINIO - ROWDY - RALEIGH, HORQUILLA C/SUSPENSION R20 - ROWDY - RALEIGH, PAR MANIJAS DE FRENO FULL ALUM. - C-STAR, CAMBIO SHIMANO RD-TZ400 - 21V, REVO SHIFTER SHIMANO SL-RS41A-7R - 7V, FORMA DE ALUMINIO NEGRO 520mm - RALEIGH ROWDY, AHEAD DE ALUMINIO NEGRO 90MM - RALEIGH, ASIENTO RALEIGH MTB R20 - ROWDY, SET DE FRENO A DISCO MECANICO - C/DISCOS 160mm - FAST, PIÑON SHIMANO MF-TZ21 - 7V - 14/28 - A ROSCA.',
  RALSTR:   'ASIENTO RALEIGH PARA BIC.PLEGABLE, CADENA 1/2x3/32x116 - P7003 - 21V - RLH, JUEGO DE DIRECCION FRENTE INTEGRADO - NECO, CARTRIDGE A RULEMANES 34.7mm DER/IZQ - 118mm - NECO, PLATO Y PAL ALUM.ESP BIC.PLEGABLE 52tx 170mm, PEDAL PLEG.RALEIGH VP-F55, FORMA ALUM.ESP.RALEIGH PLEG., PUÑOS DE GEL, SET DE CUADRO Y HORQ.RALEIGH PLEG.STRAIGHT ALUM., PAR MANIJAS DE FRENO FULL ALUM. - C-STAR, PAR DE RUEDAS ARMADAS R20 - PLEGABLE RALEIGH CON DISCO, CAMBIO SHIMANO RD-FT35 - 6/7V - CORTA, REVO SHIFTER SHIMANO SL-RS35 - 6V, PIÑON SHIMANO MF-TZ20 - 6V - 14/28 - A ROSCA, STEM PLEGABLE RALEIGH FB-AL-249-8 ZOOM, SET DE FRENO A DISCO MECANICO - C/DISCOS 160mm - FAST, PORTAPAQUETE R20 ESPECIAL RALEIGH PLEGABLE.',
};

// ── Datos crudos del Excel ────────────────────────────────────────────────────
// [marca_raw, modelo_raw, color, rodado, talle, ubicacion, codigo_prov, ficha]
const RAW = [
  // ── GALPON ─────────────────────────────────────────────────────────────────
  ['raleigh',    '700 c classic nexus', 'blanca',                    '26',   'n/n', 'galpon', 'BINRALCLASD',  F.RALCLASD],
  ['raleigh',    'lilhon',              'rosa con blanco',            '16',   'n/n', 'galpon', 'BINLILHON',    F.LILHON],
  ['raleigh',    'mxr16',               'roja con blanco',            '16',   'n/n', 'galpon', 'binmxr16',     F.MXR],
  ['raleigh',    'mxr16',               'roja con blanco',            '16',   'n/n', 'galpon', 'binmxr16',     F.MXR],   // dup → stock 2
  ['raleigh',    'mxr20',               'roja con blanco',            '20',   'n/n', 'galpon', 'binmxr20',     F.MXR20],
  ['raleigh',    '5.5',                 'negro con verde',            '29',   '19',  'galpon', 'BIN5.5_29C',   F.BIN55],
  ['raleigh',    'scout',               'roja',                       '24',   'n/n', 'galpon', 'binscout24',   F.SCOUT24],
  ['raleigh',    'mxr20',               'azul y naranja',             '20',   'n/n', 'galpon', 'binmxr20',     F.MXR20],
  ['raleigh',    'mxr12',               'verde',                      '12',   'n/n', 'galpon', 'binmxr12',     F.MXR],
  ['raleigh',    'mxr20',               'verde',                      '20',   'n/n', 'galpon', 'binmxr20',     F.MXR20],
  ['raleigh',    'lilhon',              'violeta',                    '16',   'n/n', 'galpon', 'BINLILHON',    F.LILHON],
  ['raleigh',    '4.0',                 'gris con azul',              '29',   '19',  'galpon', 'BIN4.0-29F',   F.BIN40],
  ['raleigh',    'paseo?',              'crema amarillo',             'n/n',  'n/n', 'galpon', 'n/n',          'n/n'],
  ['raleigh',    'mxr12',               'rojo, negro, blanco',        '12',   'n/n', 'galpon', 'binmxr12',     F.MXR],
  ['raleigh',    'mxr12',               'verde',                      '12',   'n/n', 'galpon', 'binmxr12',     F.MXR],   // dup → stock 2
  ['raleigh',    'mxr12',               'rojo, negro, blanco',        '12',   'n/n', 'galpon', 'binmxr12',     F.MXR],   // dup → stock 2
  ['raleigh',    'mxr12',               'roja',                       '12',   'n/n', 'galpon', 'binmxr12',     F.MXR],
  ['varios',     'kento',               'negro doble suspensión',     '26',   'n/n', 'galpon', 'n/n',          F.KENTO],
  ['raleigh',    'dama vintage',        'negro con letras doradas',   '26',   'n/n', 'galpon', 'BIN19105IMP',  F.VNT19105],
  ['raleigh',    'dama vintage',        'rosa con letras doradas',    '26',   'n/n', 'galpon', 'BIN19105IMP',  F.VNT19105],
  ['varios',     'kento paseo',         'amarillo',                   'n/n',  'n/n', 'galpon', 'n/n',          'n/n'],
  ['varios',     'kento',               'azul doble suspensión',      '26',   'n/n', 'galpon', 'n/n',          F.KENTO],
  ['varios',     'kento',               'azul doble suspensión',      '26',   'n/n', 'galpon', 'n/n',          F.KENTO],  // dup → stock 2
  ['stark',      'antoniette',          'rosa con blanco',            '28',   '?',   'galpon', '6150',         F.ST6150],
  ['dal santos', 'firebird folding',    'negro',                      '20',   'n/n', 'galpon', 'BINPLEGCUR',   F.PLEGCUR],
  ['dal santos', 'firebird',            'rosa',                       '16',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dalsantos',  'firebird',            'rosa',                       '16',   'n/n', 'galpon', 'n/n',          'n/n'],   // dup → stock 2
  ['dal santos', 'fire bird',           'violeta claro',              '16',   'n/n', 'galpon', 'bin19052',     F.FB19052],
  ['dal santos', 'fire bird',           'rosa',                       '20',   'n/n', 'galpon', 'bin19069',     F.FB19069],
  ['dalsantos',  'firebird',            'violeta oscuro',             '16',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dalsantos',  'firebird',            'turquesa',                   '16',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dalsantos',  'fire bird honey',     'turquesa',                   '16',   'n/n', 'galpon', 'bin19050-1',   F.FB19050],
  ['firebird',   'firebird',            'turquesa',                   '20',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dal santos', 'fire bird',           'roja',                       '16',   'n/n', 'galpon', 'bin19050-1',   F.FB19050],
  ['dal santos', 'scout',               'negro con rosa',             '24',   'n/n', 'galpon', 'binscout24d',  F.SCOUT24D],
  ['stark',      'vittoria',            'verde militar',              '28',   'n/n', 'galpon', '6172',         F.ST6172],
  ['fire bird',  'fire bird',           'rosa',                       '20',   'n/n', 'galpon', 'n/n',          'n/n'],   // dup con fire bird rosa 20 → stock 2
  ['stark',      'vulcano',             'naranja',                    '24',   'n/n', 'galpon', '6182',         F.ST6182],
  ['randers',    'sc104',               'monopatin',                  'n/n',  'n/n', 'galpon', 'n/n',          'n/n'],
  ['stark',      'alba',                'rosa a violeta degrade',     '26',   '16',  'galpon', '6058',         F.ST6058],
  ['raleigh',    'urban 1.1',           'gris con rojo',              '27,5', '21',  'galpon', 'BINURBAN1.1H', F.URB11H],
  ['dal santos', '2.0',                 'negro con letras celeste',   '29',   'n/n', 'galpon', 'n/n',          F.DAL20],
  ['dal santos', 'firebird sweety',     'rosa',                       '20',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dal santos', 'firebird folding',    'gris con rojo',              '20',   'n/n', 'galpon', 'BINPLEGCUR',   F.PLEGCUR],
  ['venzo',      'loki',                'negro con letras rojas',     '29',   '?',   'galpon', 'n/n',          'n/n'],
  ['dal santos', 'urban',               'verde agua',                 '?',    '?',   'galpon', 'bin1905imp-1', 'n/n'],
  ['stark',      'love',                'blanca con letras violetas', '20',   '16',  'galpon', '6006',         F.ST6006],
  ['stark',      'vittoria',            'gris',                       '28',   'n/n', 'galpon', '6172',         F.ST6172],
  ['dal santos', 'firebird mtb',        'turquesa',                   '27,5', '18',  'galpon', 'n/n',          'n/n'],
  ['stark',      'rise',                'negro con gris con letras amarillo', '26', 'n/n', 'galpon', '6199',   F.ST6199],
  ['dal santos', 'Firebird',            'violeta',                    '20',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dal santos', 'firebird',            'rosa',                       '20',   'n/n', 'galpon', 'bin19067',     F.FB19067],
  ['pregunta r', 'bowie',               'celeste con azul',           'n/n',  'n/n', 'galpon', 'n/n',          'n/n'],
  ['stark',      'vulcano',             'amarillo',                   '24',   'n/n', 'galpon', '6182',         F.ST6182],
  ['dal santos', 'venture 3.0',         'turquesa',                   '27,5', '16',  'galpon', 'BINVEN3.0L',   F.VEN3],
  ['dal santos', 'jazzi',               'blanco detalles violeta',    '20',   'n/n', 'galpon', 'BINJAZZI',     F.JAZZI],
  ['raleigh',    'fire bird',           'turquesa',                   '16',   'n/n', 'galpon', 'n/n',          'n/n'],
  ['dal santos', 'firebird honey',      'rosa',                       '16',   'n/n', 'galpon', 'bin19052-1',   F.FB19052B],
  ['dal santos', 'firebird honey',      'azul con amarillo',          '16',   'n/n', 'galpon', 'bin19050-1',   F.FB19050],
  ['dal santos', 'firebird honey',      'azul con amarillo',          '16',   'n/n', 'galpon', 'bin19050-1',   F.FB19050],  // dup → stock 2
  // ── LOCAL ──────────────────────────────────────────────────────────────────
  ['dal santos', 'firebird rocky',      'azul/rojo',                  '16',   'n/n', 'local',  'BINFB16V',     F.FB16V],
  ['dal santos', 'firebird winner',     'rojo',                       '16',   'n/n', 'local',  'n/n',          F.FBWIN],
  ['dal santos', 'firebird winner',     'rojo',                       '20',   'n/n', 'local',  'n/n',          F.FBWIN],
  ['fire bird',  'she-2021',            'blanco/lila',                '27,5', '18',  'local',  'n/n',          'n/n'],
  ['stark',      'amsterdam',           'blanco',                     '28',   'm',   'local',  '6088',         F.ST6088],
  ['dal santos', '700 c classic nexus', 'negro',                      '28',   'm',   'local',  'BINRALCLASD',  F.RALCLASD],
  ['stark',      'antoniette',          'gris/verde',                 '28',   'm',   'local',  '6150',         F.ST6150],
  ['fiat',       '500',                 'gris manubrio rutero',       '28',   'm',   'local',  'n/n',          'n/n'],
  ['fiat',       '500',                 'gris manubrio recto',        '28',   'm',   'local',  'n/n',          'n/n'],
  ['varios',     'bowie',               'azul/celeste',               '29',   'm',   'local',  'n/n',          'n/n'],
  ['colner',     'forest',              'gris/verde',                 '29',   '16',  'local',  'col00049',     F.COL49],
  ['raleigh',    'urban 1.1',           'negro con celeste',          '28',   '21',  'local',  'BINURBAN1.1G', F.URB11G],
  ['stark',      'rise',                'morado',                     '29',   '16',  'local',  '6165',         F.ST6165],
  ['raleigh',    'm2.0',                'negro/rojo',                 '29',   '19',  'local',  'BIN2.0-29H',   F.BIN20],
  ['raleigh',    'm7.0',                'negro/gris',                 '29',   'm',   'local',  'BIN7.0-29C',   F.M70],
  ['raleigh',    'm4.0',                'gris/azul',                  '29',   '17',  'local',  'BIN4.0_29F',   F.BIN40],
  ['colner',     'cruiser',             'gris/blanco',                '29',   'n/n', 'local',  'col00014',     F.COL14],
  ['battle',     'mtb',                 'naranja',                    '29',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'm4.5',                'azul/negro',                 '29',   'n/n', 'local',  'n/n',          'n/n'],
  ['venzo',      'primal',              'negra/blanco',               '29',   'n/n', 'local',  'n/n',          F.VENZO],
  ['colner',     'forest',              'salmon',                     '29',   '18',  'local',  'col00049',     F.COL49],
  ['raleigh',    'strada 1.0',          'rojo (tutero)',              '28',   'n/n', 'local',  'binstrada1.0h', F.STRADA],
  ['rembrandt',  'nose',                'plegable rojo',              '20',   'n/n', 'local',  'rem305',       F.REM305],
  ['teru',       'nose',                'plegable rojo',              '20',   'n/n', 'local',  'n/n',          'n/n'],
  ['stark',      'nose',                'rosa',                       '20',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'firebird folding',    'gris/rojo plegable',         '20',   'n/n', 'local',  'BINPLEGCUR',   F.PLEGCUR],
  ['varios',     'venzo',               'lila',                       '20',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'fire bird winner',    'naranja',                    '20',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'fire bird',           'celeste',                    '20',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'mxr16',               'azu/roja/blanco',            '16',   'n/n', 'local',  'binmxr16',     F.MXR],
  ['dal santos', 'fire bird',           'negro/naranja',              '16',   'n/n', 'local',  'n/n',          'n/n'],
  ['stark',      'chrome',              'cromado/negro bmx',          '16',   'n/n', 'local',  '6098',         F.ST6098],
  ['varios',     'team',                'amarillo',                   '16',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'mxr12',               'rojo/azul/blanca',           '12',   'n/n', 'local',  'binmxr12',     F.MXR],
  ['rembrandt',  'n/n',                 'rosa',                       '12',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'halley',              'bordo morado',               '12',   'n/n', 'local',  'n/n',          'n/n'],
  ['stark',      'vulcano',             'rojo/amarillo',              '12',   'n/n', 'local',  '6129',         F.ST6129],
  ['stark',      'vulcano',             'amarillo/negro',             '12',   'n/n', 'local',  '6129',         F.ST6129],
  ['kelinbike',  'n/n',                 'rosa',                       '12',   'n/n', 'local',  'n/n',          'n/n'],
  ['kelinbike',  'n/n',                 'negro',                      '12',   'n/n', 'local',  'n/n',          'n/n'],
  ['stark',      'vittoria',            'verde',                      '28',   'n/n', 'local',  '6172',         F.ST6172],
  ['fire bird',  'nose',                'rojo',                       'n/n',  'n/n', 'local',  'n/n',          'n/n'],
  ['olmo',       'freetime',            'azul/blanco',                'n/n',  'n/n', 'local',  'n/n',          'n/n'],
  ['stark',      'olivia',              'turquesa',                   '26',   '18',  'local',  '6167',         F.ST6167],
  ['stark',      'rise',                'gris/negro',                 '29',   'n/n', 'local',  '6165',         F.ST6165B],
  ['stark',      'vulcano',             'naranja',                    '24',   'n/n', 'local',  '6182',         F.ST6182],
  ['dal santos', 'scout girl',          'negro/rosa/blanca',          '24',   'n/n', 'local',  'binscout24d',  F.SCOUT24D],
  ['dal santos', 'scout junior',        'negro/amarillo/azul',        '24',   'n/n', 'local',  'binscout24',   F.SCOUT24],
  ['dal santos', 'mxr 20',              'negro/verde',                '20',   'n/n', 'local',  'binmxr20',     F.MXR20],
  ['dal santos', 'rowdy',               'negro/azul',                 '20',   'n/n', 'local',  'BINROWDY20',   F.ROWDY],
  ['varios',     'kento frrestyle',     'negro',                      '20',   'n/n', 'local',  'n/n',          'n/n'],
  ['dal santos', 'straight',            'plegable negro/naranja',     '20',   'n/n', 'local',  'BINRALSTR',    F.RALSTR],
  ['dal santos', 'firebird folding',    'plegable gris/roja',         '20',   'n/n', 'local',  'BINPLEGCUR',   F.PLEGCUR],
];

// ── Normalización ─────────────────────────────────────────────────────────────
const FB_MODELS = /fire\s*bird|she-2021/i;

function getBrand(marcaRaw, modeloRaw) {
  const m   = marcaRaw.toLowerCase().trim().replace(/\s+/g, ' ');
  const mod = modeloRaw.toLowerCase().trim();
  const map = {
    stark: 'Stark', venzo: 'Venzo', fiat: 'Fiat', colner: 'Colner',
    battle: 'Battle', rembrandt: 'Rembrandt', teru: 'Teru',
    kelinbike: 'Kelinbike', olmo: 'Olmo', randers: 'Randers',
    varios: 'Varios', 'pregunta r': 'Varios',
    firebird: 'Fire Bird', 'fire bird': 'Fire Bird',
  };
  if (map[m]) return map[m];
  // raleigh o dal santos → marca según modelo
  if (m === 'raleigh' || m === 'dal santos' || m === 'dalsantos') {
    return FB_MODELS.test(mod) ? 'Fire Bird' : 'Raleigh';
  }
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function normModel(raw) {
  const m = raw.trim();
  if (!m || m === 'n/n') return 'n/n';
  if (/^mxr\s*(\d+)$/i.test(m))    return 'MXR' + m.replace(/^mxr\s*/i, '');
  if (/^m(\d+\.\d+)$/i.test(m))    return 'M' + m.slice(1);
  if (/^sc\d+$/i.test(m))           return m.toUpperCase();
  if (/^700\s*c\s+classic/i.test(m)) return '700C Classic Nexus';
  return m.replace(/\b\w/g, c => c.toUpperCase())
          .replace(/\bMtb\b/g, 'MTB')
          .replace(/\bBmx\b/g, 'BMX');
}

function normField(v) {
  const s = (v || '').toString().trim();
  if (!s || s === '?') return 'n/n';
  return s;
}
function normRodado(v) {
  const s = normField(v);
  return s === 'n/n' ? 'n/n' : s.replace(',', '.');
}
function normTalle(v) {
  const s = normField(v);
  return s.toLowerCase() === 'm' ? 'M' : s;
}

// ── Agrupar duplicados ────────────────────────────────────────────────────────
const groups  = {};
const order   = [];

for (const [mr, modr, colorRaw, rod, tal, ubi, cod, ficha] of RAW) {
  const marca   = getBrand(mr, modr);
  const modelo  = normModel(modr);
  const color   = normField(colorRaw);
  const rodado  = normRodado(rod);
  const talle   = normTalle(tal);
  const ubicacion = ubi.trim() || 'galpon';
  const codigo  = normField(cod);
  const ft      = (ficha || '').trim() || 'n/n';

  const key = `${marca}|${modelo}|${color}|${rodado}|${talle}|${ubicacion}`;
  if (!groups[key]) {
    groups[key] = { marca, modelo, color, rodado, talle, ubicacion, codigo, ficha: ft, stock: 0 };
    order.push(key);
  }
  groups[key].stock++;
  if (ft.length > groups[key].ficha.length) groups[key].ficha = ft;
  if (codigo !== 'n/n' && groups[key].codigo === 'n/n') groups[key].codigo = codigo;
}

// ── Ordenar por marca → modelo ────────────────────────────────────────────────
order.sort((a, b) => {
  const ga = groups[a], gb = groups[b];
  const marcaCmp = ga.marca.localeCompare(gb.marca, 'es');
  return marcaCmp !== 0 ? marcaCmp : ga.modelo.localeCompare(gb.modelo, 'es');
});

// ── Construir filas finales ───────────────────────────────────────────────────
let count = 0;
const rows = order.map(key => {
  const g = groups[key];
  count++;
  const serie = 'B' + String(count).padStart(2, '0');
  return [
    'bicicleta',      // tipo
    g.marca,          // marca
    g.modelo,         // modelo
    serie,            // numero_serie
    'n/n',            // descripcion
    g.ubicacion,      // ubicacion
    String(g.stock),  // stock_actual
    '1',              // stock_minimo
    'disponible',     // estado_unidad
    '0',              // precio_costo
    '0',              // precio_max
    '0',              // precio_min
    g.rodado,         // rodado
    g.talle,          // talle
    TODAY,            // fecha_ingreso
    TODAY,            // ultima_actualizacion
    g.ficha,          // ficha_tecnica
    'n/n',            // foto_url
    g.color,          // color
    g.codigo,         // codigo_proveedor
  ];
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Procesadas ${RAW.length} filas → ${rows.length} productos únicos`);
  const token = await getToken();
  const base  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

  // 1. Limpiar datos existentes
  console.log('Limpiando STOCK...');
  await post(`${base}/values/STOCK!A2:T500:clear`, {}, { Authorization: `Bearer ${token}` });

  // 2. Escribir nuevas filas
  console.log(`Escribiendo ${rows.length} filas...`);
  await put(
    `${base}/values/STOCK!A2:T${1 + rows.length}?valueInputOption=RAW`,
    { values: rows },
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  );

  console.log(`✅ Stock cargado: ${rows.length} bicis`);
  rows.forEach(r => console.log(`  ${r[3].padEnd(5)} ${r[1].padEnd(12)} ${r[2].padEnd(25)} ${r[18]} R${r[12]} T${r[13]} [${r[5]}] stock:${r[6]}`));
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });

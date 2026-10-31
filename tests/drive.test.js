'use strict';
// Subir fotos al Drive de Juan Pablo SIN n8n (31/10/2026). Antes pasaba por un webhook de n8n que
// estaba apagado y cuyo permiso llevaba meses vencido: desde abril de 2026 ninguna foto llegaba.
// Correr:  node tests/drive.test.js
const assert = require('assert');
const sim = require('./simulador');
const { uploadToDrive } = require('../lib/sheets');

const FOTOS = '1xfsZN_ihAFTkLVcaQlMWM5m0jwN-M7OD';     // "Fotos Bicis"
const FACTURAS = '1U-o_gMKtbxYDkWM_LWeZUTc2LdpxJuIP';  // "Bicicleteria-Bot"
const TG = 'https://api.telegram.org/file/botX/fotos/archivo.jpg';

// los datos del archivo viajan en la primera parte del multipart; de ahí sale a qué carpeta fue
const subida = () => sim.llamadas.filter((l) => String(l.url).includes('upload/drive')).pop();
const carpetaDe = (l) => {
  const m = String(l.body).match(/"parents":\["([^"]+)"\]/);
  return m && m[1];
};

sim.correr([
  ['una foto de producto va a la carpeta "Fotos Bicis"', async () => {
    sim.llamadas.length = 0;
    const url = await uploadToDrive(TG, 'producto_B84_123.jpg', 'image/jpeg');
    assert.strictEqual(url, 'https://drive.example.invalid/archivo', 'devuelve el link para ver el archivo');
    assert.strictEqual(carpetaDe(subida()), FOTOS);
  }],

  ['una factura va a la carpeta "Bicicleteria-Bot"', async () => {
    sim.llamadas.length = 0;
    await uploadToDrive(TG, 'factura_31-10-2026_101010.jpg', 'image/jpeg');
    assert.strictEqual(carpetaDe(subida()), FACTURAS);
  }],

  ['el archivo queda con link público, como lo dejaba n8n', async () => {
    sim.llamadas.length = 0;
    await uploadToDrive(TG, 'producto_B99_1.jpg', 'image/jpeg');
    const permiso = sim.llamadas.find((l) => /drive\/v3\/files\/[^/]+\/permissions/.test(String(l.url)));
    assert.ok(permiso, 'le pide a Google que se pueda ver con el link');
    assert.deepStrictEqual(permiso.body, { role: 'reader', type: 'anyone' });
  }],

  ['respeta el tipo de archivo que le pasan', async () => {
    sim.llamadas.length = 0;
    await uploadToDrive(TG, 'factura_x.pdf', 'application/pdf');
    assert.ok(String(subida().body).includes('application/pdf'));
  }],

  ['NO pasa más por n8n', async () => {
    sim.llamadas.length = 0;
    await uploadToDrive(TG, 'producto_B1_1.jpg', 'image/jpeg');
    assert.ok(!sim.llamadas.some((l) => /n8n|drive-upload/.test(String(l.url))), 'ni una llamada a n8n');
  }],

  ['si Google falla, AVISA por Telegram (esto falló 7 meses en silencio)', async () => {
    const axios = require('axios');
    const post = axios.post;
    axios.post = async (url, ...r) => {
      if (String(url).includes('upload/drive')) throw new Error('simulado: el permiso venció');
      return post(url, ...r);
    };
    try {
      await uploadToDrive(TG, 'producto_B9_1.jpg', 'image/jpeg');
      await sim.esperarRed();
      const m = sim.ultimo(1);                         // ADMIN_ID en las pruebas es 1
      assert.ok(m, 'le tiene que llegar un mensaje al admin');
      assert.ok(/no se guardó en Drive/.test(m.text), 'le avisa: ' + String(m.text).slice(0, 120));
      assert.ok(/venció/.test(m.text), 'y le dice el motivo');
      assert.ok(/queda la de Telegram/.test(m.text), 'y lo tranquiliza: la foto no se perdió');
    } finally { axios.post = post; }
  }],

  ['NO avisa dos veces el mismo día (un aviso por día, no molesta)', async () => {
    const axios = require('axios');
    const post = axios.post;
    axios.post = async (url, ...r) => {
      if (String(url).includes('upload/drive')) throw new Error('simulado: falla de nuevo');
      return post(url, ...r);
    };
    try {
      const antes = sim.mensajesA(1).length;
      await uploadToDrive(TG, 'producto_B10_1.jpg', 'image/jpeg');
      await uploadToDrive(TG, 'producto_B11_1.jpg', 'image/jpeg');
      await sim.esperarRed();
      assert.strictEqual(sim.mensajesA(1).length, antes, 'ya avisó hoy: no repite');
    } finally { axios.post = post; }
  }],

  ['si Google falla, devuelve null y NO rompe (la foto se guarda con la referencia de Telegram)', async () => {
    sim.llamadas.length = 0;
    const axios = require('axios');
    const post = axios.post;
    axios.post = async (url, ...r) => {
      if (String(url).includes('upload/drive')) throw new Error('simulado: Google dijo que no');
      return post(url, ...r);
    };
    try {
      const url = await uploadToDrive(TG, 'producto_B2_1.jpg', 'image/jpeg');
      assert.strictEqual(url, null);
    } finally { axios.post = post; }
  }],

  ['sin el permiso configurado avisa y devuelve null, no se cuelga', async () => {
    sim.llamadas.length = 0;
    const { GOOGLE_OAUTH } = require('../lib/config');
    const guardado = GOOGLE_OAUTH.refresh_token;
    GOOGLE_OAUTH.refresh_token = '';
    // el token de antes queda guardado en memoria: hay que vencerlo para que lo vuelva a pedir
    const errores = [];
    const err = console.error;
    console.error = (...a) => errores.push(a.join(' '));
    try {
      delete require.cache[require.resolve('../lib/sheets')];
      const { uploadToDrive: fresco } = require('../lib/sheets');
      const url = await fresco(TG, 'producto_B3_1.jpg', 'image/jpeg');
      assert.strictEqual(url, null);
      assert.ok(errores.join(' ').includes('GOOGLE_OAUTH'), 'dice qué variable falta: ' + errores.join(' '));
    } finally {
      console.error = err;
      GOOGLE_OAUTH.refresh_token = guardado;
      delete require.cache[require.resolve('../lib/sheets')];
    }
  }],
]);

'use strict';
// Simulador para los tests: una planilla de Google y un Telegram FALSOS, en memoria.
// Ningun test sale a internet: se reemplazan axios.get/post/put y se bloquea http/https.
// Todos los pedidos tardan lo mismo (DEMORA ms), asi dos pedidos simultaneos se pisan igual
// que en la realidad y las pruebas de carreras dan siempre el mismo resultado.
const crypto = require('crypto');

// 1) Entorno de mentira, ANTES de cargar lib/config.js (la clave RSA se genera aca y se tira).
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
Object.assign(process.env, {
  BOT_TOKEN: 'TOKEN-DE-PRUEBA', SHEET_ID: 'PLANILLA-DE-PRUEBA', SA_EMAIL: 'prueba@example.invalid',
  SA_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), GROQ_KEY: 'groq-de-prueba',
  ADMIN_ID: '1', WEBHOOK_URL: 'https://bot.example.invalid/webhook',
  // el permiso de Drive de Juan Pablo, de mentira (desde el 31/10/2026 el bot sube solo, sin n8n)
  GOOGLE_OAUTH_CLIENT_ID: 'cliente-de-prueba', GOOGLE_OAUTH_CLIENT_SECRET: 'secreto-de-prueba',
  GOOGLE_OAUTH_REFRESH: 'permiso-de-prueba',
});
for (const m of ['http', 'https']) {
  const mod = require(m);
  mod.request = mod.get = () => { throw new Error('test: red bloqueada'); };
}

const axios = require('axios');
const DEMORA = 5;
const demora = { lectura: DEMORA, escritura: DEMORA };   // un test puede hacer las escrituras mas lentas que las lecturas
const realSetTimeout = global.setTimeout;
const hojas = {};          // nombre -> filas; hojas.STOCK[0] = encabezados, hojas.STOCK[r-1] = fila r de la planilla
const llamadas = [];       // todo lo que se le pidio a la "red": { metodo, url, body }
const telegram = { enviados: [], webhook: null, transcripcion: '', ocr: '[]' };
const fallarLectura = new Set();   // hojas cuya proxima lectura falla (para simular a Google caido)
let enVuelo = 0;

const colNum = l => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;   // A -> 0
function rango(a1) {
  const m = decodeURIComponent(a1).match(/^([^!]+)!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  if (!m) throw new Error('rango que el simulador no entiende: ' + a1);
  const unaCelda = m[4] === undefined;
  return {
    hoja: m[1], c0: colNum(m[2]), f0: m[3] ? Number(m[3]) : 1,
    c1: colNum(unaCelda ? m[2] : m[4]),
    f1: unaCelda ? (m[3] ? Number(m[3]) : Infinity) : (m[5] ? Number(m[5]) : Infinity),
  };
}
const vacia = v => v === '' || v == null;
function leer(a1) {
  const r = rango(a1), filas = hojas[r.hoja] || [], out = [];
  for (let f = r.f0; f <= Math.min(filas.length, r.f1); f++) {
    const fila = filas[f - 1] || [], celdas = [];
    for (let c = r.c0; c <= r.c1 && c < 26; c++) celdas.push(vacia(fila[c]) ? '' : fila[c]);
    while (celdas.length && vacia(celdas[celdas.length - 1])) celdas.pop();
    out.push(celdas);
  }
  while (out.length && !out[out.length - 1].length) out.pop();   // Google no devuelve filas vacias al final
  return JSON.parse(JSON.stringify(out));
}
function escribir(a1, valores, modo) {
  const r = rango(a1), filas = hojas[r.hoja] || (hojas[r.hoja] = []);
  valores.forEach((vals, i) => {
    const f = r.f0 + i;
    while (filas.length < f) filas.push([]);
    vals.forEach((v, j) => {
      if (v === null || v === undefined) return;   // Google saltea los null
      filas[f - 1][r.c0 + j] = modo === 'USER_ENTERED' && typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
    });
  });
}
function borrar(a1) {
  const r = rango(a1), filas = hojas[r.hoja] || [];
  for (let f = r.f0; f <= Math.min(filas.length, r.f1); f++)
    for (let c = r.c0; c <= r.c1; c++) if (filas[f - 1]) filas[f - 1][c] = '';
}

function responder(fn, ms = DEMORA) {
  enVuelo++;
  return new Promise((ok, mal) => realSetTimeout(() => {
    enVuelo--;
    try { ok({ data: fn() }); } catch (e) { mal(e); }
  }, ms));
}
const modoDe = url => (url.match(/valueInputOption=([A-Z_]+)/) || [])[1];
const rangoDe = url => url.split('/values/')[1].split('?')[0];

function atender(metodo, url, body) {
  llamadas.push({ metodo, url, body });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return responder(() => ({ access_token: 'token-google-de-prueba', expires_in: 3600 }));
  if (url.startsWith('https://api.telegram.org/file/')) return responder(() => Buffer.from('archivo'));
  if (url.startsWith('https://api.telegram.org/bot')) {
    const api = url.split('/').pop();
    return responder(() => {
      if (api === 'sendMessage') { telegram.enviados.push(body); return { ok: true, result: { message_id: telegram.enviados.length } }; }
      if (api === 'getFile') return { ok: true, result: { file_path: 'fotos/archivo.jpg' } };
      if (api === 'getWebhookInfo') return { ok: true, result: telegram.webhook || {} };
      if (api === 'setWebhook') { telegram.webhook = { url: body.url, allowed_updates: body.allowed_updates }; return { ok: true, result: true }; }
      return { ok: true, result: true };   // answerCallbackQuery, sendPhoto
    });
  }
  if (url.includes('api.groq.com')) {
    if (url.includes('/audio/')) return responder(() => ({ text: telegram.transcripcion }));
    return responder(() => ({ choices: [{ message: { content: telegram.ocr } }] }));
  }
  // Drive: desde el 31/10/2026 el bot sube solo (antes pasaba por n8n, que estaba apagado y vencido)
  if (url.includes('googleapis.com/upload/drive')) return responder(() => ({ id: 'archivo-de-prueba', webViewLink: 'https://drive.example.invalid/archivo' }));
  if (/drive\/v3\/files\/[^/]+\/permissions/.test(url)) return responder(() => ({ id: 'permiso-de-prueba' }));
  if (url.includes('api.telegram.org/file/')) return responder(() => Buffer.from('foto de prueba'));
  if (url.includes('sheets.googleapis.com')) {
    if (url.includes('?fields=sheets.properties')) return responder(() => ({ sheets: Object.keys(hojas).map((title, sheetId) => ({ properties: { title, sheetId } })) }));
    if (/:batchUpdate$/.test(url) && !url.includes('/values')) return responder(() => ({}));   // formato (colores, merges)
    if (url.endsWith('/values:batchUpdate')) return responder(() => {
      for (const d of body.data) escribir(d.range, d.values, body.valueInputOption);
      return { totalUpdatedCells: body.data.reduce((n, d) => n + d.values.flat().length, 0) };
    }, demora.escritura);
    if (url.endsWith('/values:batchClear')) return responder(() => { body.ranges.forEach(borrar); return {}; }, demora.escritura);
    if (metodo === 'get') return responder(() => {
      const hoja = rangoDe(url).split('!')[0];
      if (fallarLectura.delete(hoja)) throw new Error(`simulador: fallo la lectura de ${hoja}`);
      const values = leer(rangoDe(url));
      return values.length ? { values } : {};
    }, demora.lectura);
    if (metodo === 'put') return responder(() => { escribir(rangoDe(url), body.values, modoDe(url)); return {}; }, demora.escritura);
  }
  throw new Error(`el simulador no sabe responder ${metodo} ${url}`);
}
axios.get = (url, opts) => atender('get', url, null, opts);
axios.post = (url, body, opts) => atender('post', url, body, opts);
axios.put = (url, body, opts) => atender('put', url, body, opts);

// Los setTimeout largos del bot (reordenar STOCK, rearmar VISTA_BICIS) no se disparan solos en los tests:
// quedan anotados y el test los corre cuando quiere con correrDiferidos().
const diferidos = [];
global.setTimeout = (fn, ms, ...args) => (ms >= 1000 ? diferidos.push(() => fn(...args)) : realSetTimeout(fn, ms, ...args));
async function correrDiferidos() { while (diferidos.length) await diferidos.shift()(); await esperarRed(); }

// Espera a que no quede ningun pedido "en la red" (las escrituras del bot van en segundo plano).
async function esperarRed() {
  for (let i = 0; i < 2000; i++) {
    await new Promise(r => realSetTimeout(r, 2));
    if (enVuelo === 0) {
      await new Promise(r => realSetTimeout(r, 4 * DEMORA));
      if (enVuelo === 0) return;
    }
  }
  throw new Error('quedaron pedidos colgados en el simulador');
}

const { HEADERS, cache, state, refreshCache } = require('../lib/sheets');

// Arma la planilla falsa con filas como objetos ({ marca: 'Raleigh', ... }) y carga el cache del bot.
async function planilla(datos) {
  for (const k of Object.keys(hojas)) delete hojas[k];
  for (const [nombre, filas] of Object.entries(datos)) {
    const enc = HEADERS[nombre] || Object.keys(filas[0] || {});
    hojas[nombre] = [enc.slice(), ...filas.map(o => (Array.isArray(o) ? o : enc.map(h => (o[h] === undefined ? '' : o[h]))))];
  }
  for (const n of [...Object.keys(HEADERS), 'CATALOGO_PROVEEDORES', 'VISTA_BICIS'])
    if (!hojas[n]) hojas[n] = [HEADERS[n] ? HEADERS[n].slice() : ['col']];
  telegram.enviados.length = 0;
  llamadas.length = 0;
  diferidos.length = 0;
  fallarLectura.clear();
  demora.lectura = demora.escritura = DEMORA;
  state.cacheReady = false;
  state.sesionesCargadas = false;
  cache.sesiones = [];
  await refreshCache();
  await esperarRed();
}
// Filas de una hoja como objetos, con el numero de fila real de la planilla en _fila.
function filas(nombre) {
  const [enc, ...resto] = hojas[nombre] || [[]];
  return resto.map((f, i) => ({ _fila: i + 2, ...Object.fromEntries(enc.map((h, j) => [h, f[j] === undefined ? '' : f[j]])) }))
    .filter(o => Object.keys(o).some(k => k !== '_fila' && !vacia(o[k])));
}

let nUpdate = 100;
const persona = uid => ({ id: Number(uid), first_name: 'Prueba' });
const texto = (uid, text) => ({ update_id: ++nUpdate, message: { message_id: nUpdate, from: persona(uid), chat: { id: Number(uid) }, text } });
const boton = (uid, data) => ({ update_id: ++nUpdate, callback_query: { id: 'cb' + nUpdate, from: persona(uid), message: { message_id: 1, chat: { id: Number(uid) } }, data } });
const mensaje = (uid, extra) => ({ update_id: ++nUpdate, message: { message_id: nUpdate, from: persona(uid), chat: { id: Number(uid) }, ...extra } });

const mensajesA = uid => telegram.enviados.filter(m => String(m.chat_id) === String(uid));
const ultimo = uid => { const m = mensajesA(uid); return m.length ? m[m.length - 1] : null; };
const botonesDe = m => ((m && m.reply_markup && m.reply_markup.inline_keyboard) || []).flat().map(b => b.callback_data);

// Corre pruebas async en orden; si alguna falla, al final el proceso termina con codigo 1.
function correr(pruebas) {
  (async () => {
    let ok = 0;
    const fallas = [];
    for (const [nombre, fn] of pruebas) {
      try { await fn(); ok++; console.log('  ok  ' + nombre); }
      catch (e) { fallas.push(nombre); console.error(`  FALLO  ${nombre}\n    ${(e && e.message || e).split('\n').join('\n    ')}`); }
      await esperarRed().catch(() => {});
    }
    console.log(`\n${ok} tests OK${fallas.length ? `, ${fallas.length} FALLARON` : ''}`);
    process.exit(fallas.length ? 1 : 0);
  })();
}

module.exports = {
  hojas, llamadas, telegram, fallarLectura, demora, planilla, filas, esperarRed, correrDiferidos,
  texto, boton, mensaje, mensajesA, ultimo, botonesDe, correr,
};

'use strict';
const express = require('express');
const axios   = require('axios');
const FormData = require('form-data');
const crypto  = require('crypto');

// ── Constantes ─────────────────────────────────────────────────────────────────
const PORT      = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN)  { console.error('FATAL: BOT_TOKEN no configurado'); process.exit(1); }
if (!process.env.SHEET_ID) { console.error('FATAL: SHEET_ID no configurado'); process.exit(1); }
if (!process.env.SA_EMAIL) { console.error('FATAL: SA_EMAIL no configurado'); process.exit(1); }
const TG        = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_ID  = process.env.ADMIN_ID || '5307233657';
const GROQ_KEY  = process.env.GROQ_KEY;
const SHEET_ID  = process.env.SHEET_ID;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const N8N_DRIVE_WEBHOOK = process.env.N8N_DRIVE_WEBHOOK || 'https://bicicleteria-n8n.fs5can.easypanel.host/webhook/drive-upload';

// Recargo por proveedor (sobre el costo antes de aplicar márgenes)
const RECARGO_PROVEEDOR = {
  'dal santo':       0.05,  // 5%
  'stark':           0.21,  // 21%
  'aries comercial': 0.21,  // 21%
};
const redondearCentenas = n => Math.round(n / 100) * 100;
const normCod = s => (s||'').trim().toLowerCase().replace(/_/g, '-');
const calcularPrecios = (codigoProv) => {
  if (!codigoProv) return null;
  const codLower = normCod(codigoProv);
  const catalogo = cache._catalogo || [];

  // 1. Exacto (normalizando separadores)
  let item = catalogo.find(r => normCod(r.codigo_proveedor) === codLower);

  // 2. Si no hay exacto, buscar variantes:
  //    - Si tiene guión: la base antes del primer '-' debe coincidir exactamente
  //    - Si no tiene guión: el código completo debe ser la base exacta (antes del '-') de algún código del catálogo
  if (!item) {
    const baseInput = codLower.includes('-') ? codLower.split('-')[0] : codLower;
    const candidatos = codLower.includes('-')
      ? catalogo.filter(r => {
          const cod = normCod(r.codigo_proveedor);
          return cod.startsWith(codLower) && cod !== codLower && cod.split('-')[0] === baseInput;
        })
      : catalogo.filter(r => {
          const cod = normCod(r.codigo_proveedor);
          return cod !== codLower && cod.includes('-') && cod.split('-')[0] === baseInput;
        });

    if (candidatos.length) {
      // Detectar si es variante "especial/premium": segmento que empieza con H seguido de letra o número
      // Ej: BIN2.0-29HA → extra después del prefijo es "ha" → H+letra = especial
      // Ej: BIN2.0-29H → extra es "h" solo = especial
      // Ej: 15625HF → no tiene guión en variante, la H está embebida = se trata igual
      const esEspecial = (cod) => {
        const extra = cod.slice(codLower.length);
        return /^h/i.test(extra) || /h[a-z\d]+$/i.test(cod.split('-').pop());
      };
      candidatos.sort((a, b) => {
        const aCod = (a.codigo_proveedor||'').toLowerCase();
        const bCod = (b.codigo_proveedor||'').toLowerCase();
        const aEsp = esEspecial(aCod) ? 1 : 0;
        const bEsp = esEspecial(bCod) ? 1 : 0;
        if (aEsp !== bEsp) return aEsp - bEsp; // no especial primero
        return aCod.length - bCod.length;       // menor longitud primero
      });
      item = candidatos[0];
    }
  }

  if (!item || !item.costo) return null;
  const costo = parseFloat((item.costo||'0').replace(',','.'));
  if (!costo) return null;
  // Buscar recargo con fuzzy por palabras: cada palabra del proveedor del catálogo
  // debe matchear con alguna palabra del input con distancia <= 1
  const provItem = norm(item.proveedor || '');
  const provKeys = Object.keys(RECARGO_PROVEEDOR);
  const fuzzyProv = (a, b) => {
    const wa = a.split(/\s+/), wb = b.split(/\s+/);
    return wa.every(w => wb.some(v => w === v || levenshtein(w, v) <= 1));
  };
  const provMatch = provKeys.find(k => norm(k) === provItem)
    || provKeys.find(k => fuzzyProv(norm(k), provItem));
  const recargo = provMatch ? RECARGO_PROVEEDOR[provMatch] : 0;
  const costoFinal = costo * (1 + recargo);
  return {
    costo: Math.round(costoFinal),
    precio_max: redondearCentenas(costoFinal * 1.60),
    precio_min: redondearCentenas(costoFinal * 1.35),
    proveedor: item.proveedor,
    detalle: item.detalle_original,
    codigo_usado: item.codigo_proveedor
  };
};

const SA = {
  client_email: process.env.SA_EMAIL,
  private_key: (process.env.SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
};

// ── Google Auth (JWT manual — sin dependencias extra) ──────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (_tokenCache.token && _tokenCache.expiresAt > Date.now() + 60000) return _tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const cls = Buffer.from(JSON.stringify({
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const input = `${hdr}.${cls}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const sig = signer.sign(SA.private_key).toString('base64url');
  const jwt = `${input}.${sig}`;
  const r = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _tokenCache = { token: r.data.access_token, expiresAt: Date.now() + 3500000 };
  return _tokenCache.token;
}

async function uploadToDrive(fileUrl, fileName, mimeType) {
  try {
    const fileResp = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(fileResp.data).toString('base64');
    const resp = await axios.post(
      N8N_DRIVE_WEBHOOK,
      { filename: fileName, data: base64, mimeType: mimeType || 'image/jpeg' },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return resp.data.url || null;
  } catch (e) {
    console.error('[drive upload]', e.message);
    return null;
  }
}

// ── Headers de cada hoja ───────────────────────────────────────────────────────
const HEADERS = {
  SESIONES:               ['telegram_id','estado','datos','ts'],
  USUARIOS:               ['telegram_id','nombre','rol','activo','fecha_alta'],
  MOVIMIENTOS_PENDIENTES: ['id_movimiento','tipo','estado','id_producto','numero_serie','cantidad','descripcion_movimiento','referencia_doc','hash_duplicado','telegram_id_operador','nombre_operador','telegram_id_aprobador','nombre_aprobador','fecha_creacion','fecha_aprobacion','motivo_rechazo','notas_aprobador'],
  STOCK:                  ['tipo','marca','modelo','numero_serie','descripcion','ubicacion','stock_actual','stock_minimo','estado_unidad','precio_costo','precio_max','precio_min','rodado','talle','fecha_ingreso','ultima_actualizacion','ficha_tecnica','foto_url','color','codigo_proveedor'],
  HISTORIAL:              ['id_movimiento','tipo','estado','id_producto','cantidad','referencia_doc','telegram_id_operador','nombre_operador','telegram_id_aprobador','nombre_aprobador','fecha_creacion','fecha_aprobacion','motivo_rechazo','notas_aprobador'],
  FACTURAS:               ['id_factura','nombre','domicilio','dni_cuit','tipo','descripcion_producto','precio_venta','fecha','forma_pago','numero_serie','mail','telefono','factura_realizada'],
  VENTAS_ACCESORIOS:      ['fecha','descripcion','precio','forma_pago','operador'],
  VENTAS_BICICLETAS:      ['fecha','descripcion','precio','forma_pago','operador'],
  COMPRAS:                ['fecha','tipo','marca','modelo','descripcion','cantidad','precio_unitario','rodado','talle','ubicacion','foto_drive','codigo_proveedor','estado']
};

const CACHE_KEY = {
  USUARIOS: 'usuarios', SESIONES: 'sesiones',
  STOCK: 'stock', MOVIMIENTOS_PENDIENTES: 'movimientos', FACTURAS: 'facturas'
};

// ── Cache en memoria ───────────────────────────────────────────────────────────
const cache = { usuarios: [], sesiones: [], stock: [], movimientos: [], facturas: [], _catalogo: [] };
let cacheReady = false;

async function loadSheet(name) {
  const token = await getToken();
  const r = await axios.get(`${SHEETS_BASE}/${SHEET_ID}/values/${name}!A:Z?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${token}` } });
  const rows = r.data.values || [];
  if (rows.length < 2) return [];
  const hdrs = rows[0];
  return rows.slice(1).map((row, idx) => {
    if (!row) row = [];
    const obj = { _rowNum: idx + 2 };
    hdrs.forEach((h, i) => { obj[h] = row[i] != null ? String(row[i]) : ''; });
    return obj;
  });
}

let _cacheRefreshing = false;
async function refreshCache() {
  if (_cacheRefreshing) return;
  _cacheRefreshing = true;
  try {
    const [rUsuarios, rSesiones, rStock, rMovimientos, rFacturas, rCatalogo] = await Promise.allSettled([
      loadSheet('USUARIOS'), loadSheet('SESIONES'), loadSheet('STOCK'),
      loadSheet('MOVIMIENTOS_PENDIENTES'), loadSheet('FACTURAS'), loadSheet('CATALOGO_PROVEEDORES')
    ]);
    if (rUsuarios.status    === 'fulfilled') cache.usuarios    = rUsuarios.value;
    else console.error('[cache] USUARIOS falló:', rUsuarios.reason?.message);
    // SESIONES: solo cargar del sheet en el primer arranque (cacheReady=false).
    // En refreshes periódicos mantener la memoria — evita borrar sesiones activas
    // que aún no se escribieron al sheet (escritura async).
    if (!cacheReady && rSesiones.status === 'fulfilled') cache.sesiones = rSesiones.value;
    else if (rSesiones.status === 'rejected') console.error('[cache] SESIONES falló:', rSesiones.reason?.message);
    if (rStock.status       === 'fulfilled') cache.stock       = rStock.value;
    else console.error('[cache] STOCK falló:', rStock.reason?.message);
    if (rMovimientos.status === 'fulfilled') cache.movimientos = rMovimientos.value;
    else console.error('[cache] MOVIMIENTOS falló:', rMovimientos.reason?.message);
    if (rCatalogo.status    === 'fulfilled') cache._catalogo   = rCatalogo.value;
    else console.error('[cache] CATALOGO_PROVEEDORES falló:', rCatalogo.reason?.message);
    if (rFacturas.status    === 'fulfilled') cache.facturas    = rFacturas.value;
    else console.error('[cache] FACTURAS falló:', rFacturas.reason?.message);
    const stock = cache.stock;
    const usuarios = cache.usuarios;
    cacheReady = true;
    console.log(`[cache] users:${usuarios.length} stock:${stock.length} movs:${cache.movimientos.length} facts:${cache.facturas.length}`);
    // Auto-corregir: si stock > 0 pero estado = vendido → poner disponible
    const token = await getToken();
    for (const p of stock) {
      if ((Number(p.stock_actual) || 0) > 0 && (p.estado_unidad || '').toLowerCase() === 'vendido') {
        p.estado_unidad = 'disponible';
        await axios.put(
          `${SHEETS_BASE}/${SHEET_ID}/values/STOCK!I${p._rowNum}?valueInputOption=RAW`,
          { values: [['disponible']] },
          { headers: { Authorization: `Bearer ${token}` } }
        ).catch(e => console.error('[fix-estado]', p.numero_serie, e.message));
        console.log(`[fix-estado] ${p.numero_serie} stock=${p.stock_actual} → disponible`);
      }
    }
  } catch (e) { console.error('[cache] refresh error:', e.message); }
  finally { _cacheRefreshing = false; }
}

async function appendRow(sheetName, data) {
  // Actualizar caché inmediatamente
  const ck = CACHE_KEY[sheetName];
  if (ck) {
    const maxRow = cache[ck].reduce((m, r) => Math.max(m, r._rowNum || 1), 1);
    cache[ck].push({ ...data, _rowNum: maxRow + 1 });
  }
  // Escribir a Google Sheets en segundo plano
  // Usa GET en col A para encontrar la primera fila vacía (evita saltar checkboxes pre-cargados)
  getToken().then(async token => {
    const hdrs = HEADERS[sheetName];
    const endCol = String.fromCharCode(64 + hdrs.length);
    const values = [hdrs.map(h => String(data[h] ?? ''))];
    const r = await axios.get(
      `${SHEETS_BASE}/${SHEET_ID}/values/${sheetName}!A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const colA = r.data.values || [[]];
    // Buscar primera fila vacía después del header
    let nextRow = colA.length + 1;
    for (let i = 1; i < colA.length; i++) {
      if (!colA[i] || !colA[i][0]) { nextRow = i + 1; break; }
    }
    return axios.put(
      `${SHEETS_BASE}/${SHEET_ID}/values/${sheetName}!A${nextRow}:${endCol}${nextRow}?valueInputOption=USER_ENTERED`,
      { values }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  }).catch(e => console.error('[bg append]', sheetName, e.message));
}

async function upsertRow(sheetName, data, keyField) {
  const ck = CACHE_KEY[sheetName];
  const arr = ck ? cache[ck] : [];
  const idx = arr.findIndex(r => String(r[keyField]) === String(data[keyField]));
  if (idx >= 0) {
    const existing = arr[idx];
    const rowNum   = existing._rowNum;
    const hdrs     = HEADERS[sheetName];
    const merged   = { ...existing, ...data };
    const endCol   = String.fromCharCode(64 + hdrs.length);
    // Actualizar caché inmediatamente
    arr[idx] = { ...merged, _rowNum: rowNum };
    // Escribir a Google Sheets en segundo plano
    const values = [hdrs.map(h => String(merged[h] ?? ''))];
    getToken().then(token =>
      axios.put(
        `${SHEETS_BASE}/${SHEET_ID}/values/${sheetName}!A${rowNum}:${endCol}${rowNum}?valueInputOption=USER_ENTERED`,
        { values }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      )
    ).catch(e => console.error('[bg upsert]', sheetName, e.message));
  } else {
    await appendRow(sheetName, data);
  }
}

// ── Ordenar STOCK por marca → modelo → talle ──────────────────────────────────
let _stockSheetId = null;
async function sortStock() {
  try {
    const token = await getToken();
    if (_stockSheetId === null) {
      const meta = await axios.get(`${SHEETS_BASE}/${SHEET_ID}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token}` } });
      const sheet = (meta.data.sheets || []).find(s => s.properties.title === 'STOCK');
      _stockSheetId = sheet ? sheet.properties.sheetId : 0;
    }
    await axios.post(`${SHEETS_BASE}/${SHEET_ID}:batchUpdate`, {
      requests: [{ sortRange: {
        range: { sheetId: _stockSheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.STOCK.length },
        sortSpecs: [
          { dimensionIndex: HEADERS.STOCK.indexOf('marca'),     sortOrder: 'ASCENDING' },
          { dimensionIndex: HEADERS.STOCK.indexOf('modelo'),    sortOrder: 'DESCENDING' },
          { dimensionIndex: HEADERS.STOCK.indexOf('precio_max'), sortOrder: 'DESCENDING' }
        ]
      }}]
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    console.log('[sort] STOCK ordenado por marca/modelo/talle');
    await refreshCache(); // actualizar _rowNum después del sort
  } catch (e) { console.error('[sort]', e.response?.data?.error?.message || e.message); }
}

// ── Sincronizar VISTA_BICIS cuando cambia ubicación en STOCK ──────────────────
async function syncVistaUbicacion(id_producto, ubicacion) {
  try {
    console.log('[vista] sync inicio:', id_producto, '->', ubicacion);
    const token = await getToken();
    const r = await axios.get(`${SHEETS_BASE}/${SHEET_ID}/values/VISTA_BICIS!A:A`,
      { headers: { Authorization: `Bearer ${token}` } });
    const rows = r.data.values || [];
    const rowIdx = rows.findIndex(row => (row[0]||'').trim() === (id_producto||'').trim());
    console.log('[vista] rowIdx:', rowIdx, 'total rows:', rows.length);
    if (rowIdx < 0) { console.log('[vista] producto no encontrado en VISTA_BICIS'); return; }
    const rowNum = rowIdx + 1;
    const res = await axios.put(
      `${SHEETS_BASE}/${SHEET_ID}/values/VISTA_BICIS!G${rowNum}?valueInputOption=USER_ENTERED`,
      { values: [[ubicacion]] },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('[vista] OK fila', rowNum, 'status:', res.status);
  } catch (e) { console.error('[bg vista] ERROR:', e.response?.data || e.message); }
}

// ── Telegram helpers ───────────────────────────────────────────────────────────
async function tgPost(method, body) {
  try { return (await axios.post(`${TG}/${method}`, body)).data; }
  catch (e) { console.error(`[tg] ${method}:`, e.response?.data?.description || e.message); return null; }
}
async function tgSend(chatId, text, kb) {
  const b = { chat_id: String(chatId), text, parse_mode: 'HTML' };
  if (kb) b.reply_markup = { inline_keyboard: kb };
  return tgPost('sendMessage', b);
}
async function tgAnswer(cbId) { return tgPost('answerCallbackQuery', { callback_query_id: cbId, text: '' }); }

// ── Fecha Argentina ────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).split('/').join('-').replace(', ', ' ');
}

// Valores que se tratan como "sin dato" en toda la app
const EMPTY_VALS = new Set(['-', 'n/n', 'n/a', '']);
const isEmpty = v => !v || EMPTY_VALS.has((v + '').toLowerCase().trim());

// ── Fuzzy search ───────────────────────────────────────────────────────────────
function norm(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => i||j));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function fuzzy(query, target) {
  const q = norm(query), t = norm(target);
  if (!q) return false;
  if (t.includes(q)) return true;
  if (q.length < 3) return false;
  return t.split(/\s+/).some(w => levenshtein(q,w) <= Math.max(1, Math.floor(q.length/3)));
}

// ── Normalizar campos con rodado/talle embebidos en modelo ────────────────────
// Ej: "7.0 R29 17\"" → { modelo: "7.0", rodado: "29", talle: "17" }
function normalizarCampos(p) {
  let modelo = (p.modelo || '').trim();
  let rodado = isEmpty(p.rodado) ? '' : String(p.rodado);
  let talle  = isEmpty(p.talle)  ? '' : String(p.talle);
  if (!rodado) {
    const mRod = modelo.match(/\bR(\d+(?:\.\d+)?)\b/i);
    if (mRod) { rodado = mRod[1]; modelo = modelo.replace(mRod[0], '').trim(); }
  }
  if (!talle) {
    const mTalle = modelo.match(/\b(\d+(?:\.\d+)?)[""]\s*$/);
    if (mTalle) { talle = mTalle[1]; modelo = modelo.replace(mTalle[0], '').trim(); }
  }
  return { modelo, rodado, talle };
}

// ── Menú principal ─────────────────────────────────────────────────────────────
function mainMenu(rol) {
  const kb = [[{ text: '📦 Consultar Stock', callback_data: 'stock' }]];
  if (['operador','aprobador','administrador'].includes(rol)) {
    kb.push([{ text: '💰 Registrar Venta', callback_data: 'venta_rapida' }]);
    kb.push([{ text: '🔄 Transferir Producto', callback_data: 'transf2' }]);
    kb.push([{ text: '📋 Registrar Movimiento', callback_data: 'movimiento' }]);
  }
  if (rol === 'administrador') kb.push([{ text: '⚙️ Panel Admin', callback_data: 'admin' }]);
  return kb;
}

// ── Procesar update de Telegram ────────────────────────────────────────────────
async function processUpdate(update) {
  const usuarios    = cache.usuarios.filter(u => u.telegram_id);
  const sesiones    = cache.sesiones.filter(s => s.telegram_id);
  const stock       = cache.stock.filter(s => s.numero_serie || s.marca);
  const movPend     = cache.movimientos.filter(m => m.id_movimiento && m.estado === 'pendiente');
  const factPend    = cache.facturas.filter(f => f.id_factura && (f.factura_realizada === 'FALSE' || f.factura_realizada === false || f.factura_realizada === ''));

  let userId, chatId, text, cb, cbId, firstName, message;
  if (update.callback_query) {
    const q = update.callback_query;
    userId = String(q.from.id); chatId = String(q.message.chat.id);
    firstName = q.from.first_name || ''; cb = q.data || ''; cbId = q.id; text = ''; message = null;
  } else if (update.message) {
    const m = update.message;
    userId = String(m.from.id); chatId = String(m.chat.id);
    firstName = m.from.first_name || ''; text = m.text || ''; cb = ''; cbId = null; message = m;
  } else return;

  if (cbId) await tgAnswer(cbId);

  // Transcribir nota de voz
  if (message?.voice && !text) {
    const vfid = message.voice.file_id;
    try {
      await tgSend(chatId, '🎤 Transcribiendo...');
      const fi  = await tgPost('getFile', { file_id: vfid });
      const fp  = fi?.result?.file_path;
      if (!fp) { await tgSend(chatId, '❌ No pude obtener el audio.'); return; }
      const audioResp = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fp}`, { responseType: 'arraybuffer' });
      const fd = new FormData();
      fd.append('file', Buffer.from(audioResp.data), { filename: 'voice.ogg', contentType: 'audio/ogg' });
      fd.append('model', 'whisper-large-v3-turbo');
      fd.append('language', 'es');
      const tr = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', fd,
        { headers: { Authorization: `Bearer ${GROQ_KEY}`, ...fd.getHeaders() }, timeout: 30000 });
      text = tr.data?.text || '';
      if (!text) { await tgSend(chatId, '❌ No entendí el audio. Intentá escribir.'); return; }
      await tgSend(chatId, `🎤 Entendí: <i>"${text}"</i>`);
      // Detectar intención por voz
      const tl = text.toLowerCase().trim();
      if (/consultar|buscar|stock|ver stock/.test(tl)) { cb = 'stock'; text = ''; }
      else if (/movimiento|registrar|entrada|salida/.test(tl)) { cb = 'movimiento'; text = ''; }
      else if (/men[uú]|inicio|volver/.test(tl)) { cb = 'main_menu'; text = ''; }
      else if (/transferir|transferencia/.test(tl)) { cb = 'transf2'; text = ''; }
      // Si no coincide ningún comando, buscar directamente como producto
      else { cb = 'voice_search'; }
    } catch (e) { await tgSend(chatId, '❌ Error al transcribir: ' + e.message); return; }
  }

  const findUser  = uid => usuarios.find(u => String(u.telegram_id) === String(uid)) || null;
  const findSesion= uid => sesiones.find(s => String(s.telegram_id) === String(uid)) || null;
  const findProd  = q => {
    return stock.filter(p =>
      (Number(p.stock_actual) || 0) > 0 &&
      !['vendido','inactivo'].includes((p.estado_unidad || '').toLowerCase()) &&
      (fuzzy(q, p.numero_serie||'') || fuzzy(q, p.marca||'') ||
       fuzzy(q, p.modelo||'')       || fuzzy(q, p.descripcion||''))
    );
  };

  const showProdDetail = async (p) => {
    const stk = Number(p.stock_actual) || 0;
    const pmax = Number(p.precio_max) > 0 ? '$'+Number(p.precio_max).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '-';
    const pmin = Number(p.precio_min) > 0 ? '$'+Number(p.precio_min).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '-';
    let msg = `📦 <b>${p.marca}${p.modelo ? ' '+p.modelo : ''}</b>${isEmpty(p.rodado) ? '' : ' R'+p.rodado}\n`;
    if (!isEmpty(p.talle) || !isEmpty(p.color)) msg += `${!isEmpty(p.talle) ? 'Talle: '+p.talle : ''}${!isEmpty(p.talle) && !isEmpty(p.color) ? ' | ' : ''}${!isEmpty(p.color) ? 'Color: '+p.color : ''}\n`;
    msg += `${p.descripcion||''}\n`;
    msg += `📍 ${p.ubicacion||'local'} | Stock: ${stk} | ${p.estado_unidad||'disponible'}\n`;
    msg += `💰 Precio: ${pmax} | Mín: ${pmin}`;
    const kb = [[{ text: '🔍 Nueva búsqueda', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]];
    if (stk > 0) kb.unshift([{ text: '⚡ Venta rápida', callback_data: `vrap_${p.numero_serie}` }, { text: '🧾 Con factura', callback_data: `vender_${p.numero_serie}` }]);
    kb.unshift([{ text: '📋 Ver detalle completo', callback_data: `ficha_${p.numero_serie}` }]);
    if (p.foto_url) {
      await tgPost('sendPhoto', { chat_id: chatId, photo: p.foto_url, caption: `${p.marca} ${p.modelo||''}`.trim(), parse_mode: 'HTML' });
    }
    await tgSend(chatId, msg, kb);
  };

  const showVariants = async (variants) => {
    if (!variants || !variants.length) { await tgSend(chatId, '❌ No hay variantes disponibles en stock para este modelo.', [[{ text: '🔍 Buscar otro', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]); return; }
    const first = variants[0];
    const titulo = `${first.marca}${first.modelo ? ' '+first.modelo : ''}${isEmpty(first.rodado) ? '' : ' R'+first.rodado}`;
    const kb = variants.map(p => {
      let label = '';
      if (!isEmpty(p.talle)) label += 'T: '+p.talle;
      if (!isEmpty(p.color)) label += (label ? ' - ' : '') + p.color;
      if (!label) label = p.descripcion ? p.descripcion.substring(0, 25) : p.numero_serie;
      label += ` (${p.ubicacion || 'local'})`;
      return [{ text: label, callback_data: `prod_${p.numero_serie}` }];
    });
    kb.push([{ text: '🔍 Nueva búsqueda', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]);
    await tgSend(chatId, `📦 <b>${titulo}</b> — ${variants.length} variante(s)\n¿Cuál buscás?`, kb);
  };

  const showProdList = async (res, query) => {
    const groups = {};
    res.forEach(p => {
      const n = normalizarCampos(p);
      const key = `${(p.marca||'').toLowerCase()}|${n.modelo.toLowerCase()}|${n.rodado.toLowerCase()}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ p, n });
    });
    const groupKeys = Object.keys(groups);
    if (groupKeys.length === 1) { await showVariants(groups[groupKeys[0]].map(x => x.p)); return; }
    let msg = `📦 <b>${res.length} resultados para "${query}"</b>\nElegí un modelo:`;
    const kb = groupKeys.map(key => {
      const variants = groups[key];
      const { p, n } = variants[0];
      const nombre = `${p.marca}${n.modelo ? ' '+n.modelo : ''}${n.rodado ? ' R'+n.rodado : ''}`;
      const ubic = p.ubicacion || 'local';
      if (variants.length === 1) return [{ text: `${nombre} (${ubic})`, callback_data: `prod_${p.numero_serie}` }];
      // múltiples variantes: mostrar ubicaciones distintas si las hay
      const ubicaciones = [...new Set(variants.map(v => v.p.ubicacion || 'local'))];
      const ubicStr = ubicaciones.length === 1 ? ubicaciones[0] : ubicaciones.join('/');
      return [{ text: `${nombre} — ${variants.length} colores (${ubicStr})`, callback_data: `grp_${p.numero_serie}` }];
    });
    kb.push([{ text: '🔍 Nueva búsqueda', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]);
    await tgSend(chatId, msg, kb);
  };

  let user = findUser(userId);
  if (!user && userId === ADMIN_ID) {
    user = { telegram_id: userId, nombre: firstName, rol: 'administrador', activo: 'TRUE', fecha_alta: now() };
    await appendRow('USUARIOS', user);
  }
  if (!user) { await tgSend(chatId, 'No estás registrado. Contactá al administrador.'); return; }
  if (user.activo === 'FALSE') { await tgSend(chatId, 'Tu cuenta está inactiva.'); return; }
  const rol = user.rol || 'operador';

  const sesion = findSesion(userId);
  const estado = sesion?.estado || '';
  let datos = {};
  try { datos = sesion?.datos ? JSON.parse(sesion.datos) : {}; } catch (e) {}

  const saveSession = (est, dat) =>
    upsertRow('SESIONES', { telegram_id: userId, estado: est, datos: JSON.stringify(dat || {}), ts: now() }, 'telegram_id');
  const clearSession = () => saveSession('', {});

  // ── /start ─────────────────────────────────────────────────────────────────
  if (text === '/refresh' && ['administrador','aprobador'].includes(rol)) {
    await tgSend(chatId, '🔄 Actualizando datos...');
    await refreshCache();
    await tgSend(chatId, `✅ Listo. Stock: ${cache.stock.filter(s=>s.numero_serie||s.marca).length} productos`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  if (text === '/start' || cb === 'main_menu') {
    await clearSession();
    await tgSend(chatId, `Hola <b>${user.nombre}</b> (${rol}) 👋\n¿Qué querés hacer?`, mainMenu(rol));
    return;
  }

  // ── Búsqueda directa por voz ──────────────────────────────────────────────
  if (cb === 'voice_search' && text) {
    let res = findProd(text);
    if (!res.length) {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const sets = words.map(w => findProd(w));
      if (sets.length) {
        const ids = sets[0].map(p => p.numero_serie);
        const inter = sets.slice(1).reduce((acc, s) => acc.filter(id => s.some(p => p.numero_serie === id)), ids);
        res = inter.length ? stock.filter(p => inter.includes(p.numero_serie)) : sets.flat().filter((p,i,a) => a.findIndex(x=>x.numero_serie===p.numero_serie)===i);
      }
    }
    await clearSession();
    if (!res.length) {
      await tgSend(chatId, `No encontré "${text}" en el stock.`, [[{ text: '🔍 Buscar de nuevo', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    } else if (res.length === 1) {
      await showProdDetail(res[0]);
    } else {
      await showProdList(res, text);
    }
    return;
  }

  // ── Consultar Stock ────────────────────────────────────────────────────────
  if (cb === 'stock') {
    await saveSession('WAIT_SEARCH', {});
    await tgSend(chatId, '🔍 <b>Consultar Stock</b>\nEscribí el nombre del producto:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'WAIT_SEARCH' && text) {
    const res = findProd(text); await clearSession();
    if (!res.length) {
      await tgSend(chatId, `No encontré "${text}" en el stock.`, [[{ text: '🔍 Buscar de nuevo', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    } else if (res.length === 1) {
      await showProdDetail(res[0]);
    } else {
      await showProdList(res, text);
    }
    return;
  }

  // ── Registrar Movimiento ───────────────────────────────────────────────────
  if (cb === 'movimiento') {
    if (!['operador','aprobador','administrador'].includes(rol)) { await tgSend(chatId, 'Sin permiso.'); return; }
    await saveSession('MOV_INICIO', {});
    await tgSend(chatId, '📋 ¿Es producto nuevo o ya existe en stock?',
      [[{ text: '🆕 Producto nuevo', callback_data: 'mov_nuevo' }, { text: '📦 Ya existe', callback_data: 'mov_exist' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }

  // Flujo NUEVO producto
  if (cb === 'mov_nuevo' && estado === 'MOV_INICIO') {
    await saveSession('MOV_NUEVO', {});
    await tgSend(chatId,
      '📦 <b>Nuevo producto + entrada de stock</b>\nMandame todo en un mensaje:\n\n' +
      '<code>tipo, marca, modelo, descripcion, precio, stock_minimo, rodado, talle, color, numero_serie, cantidad, referencia, codigo_proveedor</code>\n\n' +
      '• <b>precio</b>: dejalo en 0 si ponés código de proveedor (se calcula solo)\n• <b>numero_serie</b>: vacío = auto (B01, A01...)\n• <b>codigo_proveedor</b>: opcional, ej: <code>BIN7.0-29C</code>\n\n' +
      '<i>Ejemplo con precio auto:</i>\n<code>bicicleta, Raleigh, 7.0, Negro con gris, 0, 1, 29, 17, Negro, B005, 1, Compra Dal Santo, BIN7.0-29C</code>\n\n' +
      '<i>Ejemplo sin código proveedor:</i>\n<code>bicicleta, Giant, Talon 29, MTB aluminio, 280000, 1, 29, M, Rojo, , 1, Compra ABC</code>',
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_NUEVO' && text) {
    const p = text.split(',').map(x => x.trim());
    if (p.length < 12) { await tgSend(chatId, 'Faltan datos. Necesito al menos 12 campos separados por coma.'); return; }
    const [tipo, marca, modelo, desc, precioRaw, stMin, rodado, talle, color, serieInput, cantidad, ref, codProv] = p;
    const referencia = ref || 'Sin referencia';
    const codigoProv = codProv || '';
    // Calcular precios desde catálogo si se dio código de proveedor
    const preciosAuto = codigoProv ? calcularPrecios(codigoProv) : null;
    const precio = preciosAuto ? String(preciosAuto.precio_max) : (precioRaw || '0');
    const precioMin = preciosAuto ? String(preciosAuto.precio_min) : (precioRaw || '0');
    const precioCosto = preciosAuto ? String(preciosAuto.costo) : '0';
    const cant = parseInt(cantidad);
    if (isNaN(cant) || cant <= 0) { await tgSend(chatId, 'La cantidad debe ser un número mayor a 0.'); return; }
    // Auto-generar serie si no se ingresó
    const prefix = tipo.toLowerCase() === 'bicicleta' ? 'B' : tipo.toLowerCase() === 'cuadro' ? 'C' : tipo.toLowerCase() === 'accesorio' ? 'A' : 'P';
    const existentes = stock.filter(s => (s.numero_serie||'').toUpperCase().startsWith(prefix)).map(s => parseInt((s.numero_serie||'').slice(prefix.length))).filter(n => !isNaN(n));
    const siguiente = existentes.length ? Math.max(...existentes) + 1 : 1;
    const idAuto = prefix + String(siguiente).padStart(2, '0');
    const id = serieInput || idAuto;
    await saveSession('MOV_NUEVO_CONF', { id, tipo, marca, modelo, desc, precio: precio||'0', precioMin: precioMin||'0', precioCosto: precioCosto||'0', codigoProv, stMin: stMin||'1', rodado: rodado||'', talle: talle||'', color: color||'', cantidad: cant, referencia });
    // Verificar si ya existe producto con misma marca+modelo+talle+color+serie
    const match = cache.stock.find(s =>
      (s.numero_serie||'').toLowerCase() === id.toLowerCase() &&
      (s.marca||'').toLowerCase() === marca.toLowerCase() &&
      (s.modelo||'').toLowerCase() === modelo.toLowerCase() &&
      (s.talle||'').toLowerCase() === (talle||'').toLowerCase() &&
      (s.color||'').toLowerCase() === (color||'').toLowerCase()
    );
    const serieExisteOtro = !match && cache.stock.find(s => (s.numero_serie||'').toLowerCase() === id.toLowerCase());
    if (serieExisteOtro) {
      await tgSend(chatId,
        `❌ El número de serie <code>${id}</code> ya existe pero corresponde a otro producto (${serieExisteOtro.marca} ${serieExisteOtro.modelo}). Verificá el número.`,
        [[{ text: '🔄 Intentar de nuevo', callback_data: 'mov_nuevo' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
      await clearSession();
    } else if (match) {
      const stk = Number(match.stock_actual) || 0;
      await tgSend(chatId,
        `⚠️ <b>Ya existe este producto en stock:</b>\n\nSerie: <code>${match.numero_serie}</code>\n${match.marca} ${match.modelo}${talle ? ' — Talle '+talle : ''}${color ? ' — '+color : ''}\nStock actual: <b>${stk}</b> uds\n\n¿Qué querés hacer?`,
        [[{ text: `🔄 Sumar ${cant} ud${cant>1?'s':''} al stock de ${match.numero_serie}`, callback_data: `movsum_${match.numero_serie}` }],
         [{ text: '➕ Crear con serie nueva (auto)', callback_data: 'movnew_ok' }],
         [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    } else {
      const precioInfo = preciosAuto
        ? `Costo: $${Number(precioCosto).toLocaleString('es-AR', { maximumFractionDigits: 0 })} | Máx: $${Number(precio).toLocaleString('es-AR', { maximumFractionDigits: 0 })} | Mín: $${Number(precioMin).toLocaleString('es-AR', { maximumFractionDigits: 0 })}\n<i>📋 ${preciosAuto.proveedor} — ${preciosAuto.detalle}</i>`
        : `Precio: $${precio||'0'}`;
      await tgSend(chatId,
        `📦 <b>Confirmar nuevo producto:</b>\nSerie: <b>${id}</b>${serieInput ? '' : ' (auto)'}\nTipo: ${tipo} | ${marca} ${modelo}${rodado ? ' R'+rodado : ''}${talle ? ' T'+talle : ''}${color ? ' '+color : ''}\nDescripción: ${desc}\n${precioInfo} | Stock mín: ${stMin||'1'}\n\n📥 Entrada: ${cant} unidades\nRef: ${referencia}`,
        [[{ text: '✅ Confirmar', callback_data: 'movnew_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    }
    return;
  }
  if (cb.startsWith('movsum_') && estado === 'MOV_NUEVO_CONF') {
    const d = datos; const t = now();
    const serieExist = cb.slice(7);
    await clearSession();
    const movId = `MOV-${Date.now()}`;
    await appendRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, tipo: 'entrada', estado: 'pendiente', id_producto: serieExist, numero_serie: serieExist, cantidad: String(d.cantidad), descripcion_movimiento: `entrada ${d.cantidad}u ${serieExist}`, referencia_doc: d.referencia, hash_duplicado: `${serieExist}-entrada-${d.cantidad}-${d.referencia}`, telegram_id_operador: userId, nombre_operador: user.nombre, telegram_id_aprobador: '', nombre_aprobador: '', fecha_creacion: t, fecha_aprobacion: '', motivo_rechazo: '', notas_aprobador: '' });
    await tgSend(chatId, `✅ Entrada de <b>${d.cantidad}</b> ud${d.cantidad>1?'s':''} sumada al stock de <b>${serieExist}</b>.\nMovimiento <b>${movId}</b> enviado para aprobación.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    for (const u of usuarios)
      if (['aprobador','administrador'].includes(u.rol) && String(u.telegram_id) !== userId && u.activo === 'TRUE')
        await tgSend(u.telegram_id, `⚠️ Entrada de stock de ${user.nombre}:\nProducto: ${serieExist} ${d.marca} ${d.modelo}\nCantidad: ${d.cantidad}\nRef: ${d.referencia}`, [[{ text: '✅ Ver pendientes', callback_data: 'pendientes' }]]);
    return;
  }
  if (cb === 'movnew_ok' && estado === 'MOV_NUEVO_CONF') {
    const d = datos; const t = now(); const movId = `MOV-${Date.now()}`;
    await appendRow('STOCK', { tipo: d.tipo, marca: d.marca, modelo: d.modelo, numero_serie: d.id, descripcion: d.desc, ubicacion: 'local', stock_actual: '0', stock_minimo: d.stMin, estado_unidad: 'disponible', precio_costo: d.precioCosto||'0', precio_max: d.precio, precio_min: d.precioMin||d.precio, rodado: d.rodado, talle: d.talle||'', fecha_ingreso: t, ultima_actualizacion: t, ficha_tecnica: '', foto_url: '', color: d.color||'' });
    await appendRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, tipo: 'entrada', estado: 'pendiente', id_producto: d.id, numero_serie: d.id, cantidad: d.cantidad, descripcion_movimiento: `entrada ${d.cantidad}u ${d.id}`, referencia_doc: d.referencia, hash_duplicado: `${d.id}-entrada-${d.cantidad}-${d.referencia}`, telegram_id_operador: userId, nombre_operador: user.nombre, telegram_id_aprobador: '', nombre_aprobador: '', fecha_creacion: t, fecha_aprobacion: '', motivo_rechazo: '', notas_aprobador: '' });
    await clearSession();
    await tgSend(chatId, `✅ Producto <b>${d.id}</b> creado y movimiento <b>${movId}</b> enviado para aprobación.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    setTimeout(() => sortStock(), 2000);
    for (const u of usuarios)
      if (['aprobador','administrador'].includes(u.rol) && String(u.telegram_id) !== userId && u.activo === 'TRUE')
        await tgSend(u.telegram_id, `⚠️ Nuevo producto + entrada de ${user.nombre}:\nProducto: ${d.id} ${d.marca} ${d.modelo}${d.talle?' T'+d.talle:''}${d.color?' '+d.color:''}\nCantidad: ${d.cantidad}\nRef: ${d.referencia}`, [[{ text: '✅ Ver pendientes', callback_data: 'pendientes' }]]);
    return;
  }

  // Flujo producto EXISTENTE
  if (cb === 'mov_exist' && estado === 'MOV_INICIO') {
    await saveSession('MOV_TIPO', {});
    await tgSend(chatId, '📋 Tipo de movimiento:',
      [[{ text: '📥 Entrada', callback_data: 'mov_e' }, { text: '📤 Salida', callback_data: 'mov_s' }],
       [{ text: '🔄 Transferencia', callback_data: 'mov_transf' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'mov_transf' && estado === 'MOV_TIPO') {
    await saveSession('MOV_TRANSF_PROD', {});
    await tgSend(chatId, '🔄 <b>Transferencia</b>\nBuscá el producto por marca, modelo o número de serie:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_TRANSF_PROD' && text) {
    const res = findProd(text);
    if (!res.length) { await tgSend(chatId, `❌ No encontré "${text}". Intentá con otro nombre.`); return; }
    if (res.length === 1) {
      const p = res[0];
      await saveSession('MOV_TRANSF_DEST', { id_producto: p.id_producto, numero_serie: p.numero_serie, marca: p.marca, modelo: p.modelo, ubic_actual: p.ubicacion || 'sin ubicación' });
      await tgSend(chatId, `Producto: <b>${p.marca} ${p.modelo}</b>\nUbicación actual: ${p.ubicacion || 'sin ubicación'}\n\n¿A dónde lo transferís?`,
        [[{ text: '🏪 Local', callback_data: 'transf_local' }, { text: '🏭 Galpón', callback_data: 'transf_galpon' }],
         [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    } else {
      await saveSession('MOV_TRANSF_PICK', {});
      const kb = res.map(p => ([{ text: `${p.marca} ${p.modelo}${isEmpty(p.rodado) ? '' : ' R'+p.rodado} (${p.numero_serie})`, callback_data: `mt_pick_${p.numero_serie}` }]));
      kb.push([{ text: '❌ Cancelar', callback_data: 'main_menu' }]);
      await tgSend(chatId, `🔍 ${res.length} coincidencias. ¿Cuál es?`, kb);
    }
    return;
  }
  if (cb.startsWith('mt_pick_') && estado === 'MOV_TRANSF_PICK') {
    const p = cache.stock.find(p => p.numero_serie === cb.slice(8));
    if (!p) { await tgSend(chatId, '❌ No encontrado.'); return; }
    await saveSession('MOV_TRANSF_DEST', { id_producto: p.id_producto, numero_serie: p.numero_serie, marca: p.marca, modelo: p.modelo, ubic_actual: p.ubicacion || 'sin ubicación' });
    await tgSend(chatId, `Producto: <b>${p.marca} ${p.modelo}</b>\nUbicación actual: ${p.ubicacion || 'sin ubicación'}\n\n¿A dónde lo transferís?`,
      [[{ text: '🏪 Local', callback_data: 'transf_local' }, { text: '🏭 Galpón', callback_data: 'transf_galpon' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if ((cb === 'transf_local' || cb === 'transf_galpon') && estado === 'MOV_TRANSF_DEST') {
    const destino = cb === 'transf_local' ? 'local' : 'galpon';
    await saveSession('MOV_TRANSF_CONF', { ...datos, destino });
    await tgSend(chatId, `🔄 <b>Confirmar transferencia:</b>\nProducto: ${datos.numero_serie} - ${datos.marca} ${datos.modelo}\nDe: ${datos.ubic_actual} → A: ${destino}`,
      [[{ text: '✅ Confirmar', callback_data: 'transf_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'transf_ok' && estado === 'MOV_TRANSF_CONF') {
    const keyField = datos.numero_serie ? 'numero_serie' : 'id_producto';
    const keyVal = datos.numero_serie || datos.id_producto;
    await upsertRow('STOCK', { [keyField]: keyVal, ubicacion: datos.destino, ultima_actualizacion: now() }, keyField);
    await clearSession();
    await tgSend(chatId, `✅ <b>${datos.marca} ${datos.modelo}</b> transferido a <b>${datos.destino}</b>.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }
  if ((cb === 'mov_e' || cb === 'mov_s') && estado === 'MOV_TIPO') {
    await saveSession('MOV_PROD', { tipo: cb === 'mov_e' ? 'entrada' : 'salida' });
    await tgSend(chatId, '🔍 Buscá el producto por marca, modelo o número de serie:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_PROD' && text) {
    const res = findProd(text);
    if (!res.length) { await tgSend(chatId, `❌ No encontré "${text}". Intentá con otro nombre.`); return; }
    if (res.length === 1) {
      const p = res[0];
      await saveSession('MOV_CANT', { ...datos, id_producto: p.id_producto, numero_serie: p.numero_serie, marca: p.marca, modelo: p.modelo });
      await tgSend(chatId, `Producto: <b>${p.marca} ${p.modelo}</b>\n¿Cuántas unidades?`, [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    } else {
      await saveSession('MOV_PROD_PICK', { tipo: datos.tipo });
      const kb = res.map(p => ([{ text: `${p.marca} ${p.modelo}${isEmpty(p.rodado) ? '' : ' R'+p.rodado} (${p.numero_serie})`, callback_data: `mp_pick_${p.numero_serie}` }]));
      kb.push([{ text: '❌ Cancelar', callback_data: 'main_menu' }]);
      await tgSend(chatId, `🔍 ${res.length} coincidencias. ¿Cuál es?`, kb);
    }
    return;
  }
  if (cb.startsWith('mp_pick_') && estado === 'MOV_PROD_PICK') {
    const p = cache.stock.find(p => p.numero_serie === cb.slice(8));
    if (!p) { await tgSend(chatId, '❌ No encontrado.'); return; }
    await saveSession('MOV_CANT', { ...datos, id_producto: p.id_producto, numero_serie: p.numero_serie, marca: p.marca, modelo: p.modelo });
    await tgSend(chatId, `Producto: <b>${p.marca} ${p.modelo}</b>\n¿Cuántas unidades?`, [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_CANT' && text) {
    const cant = parseInt(text);
    if (isNaN(cant) || cant <= 0) { await tgSend(chatId, 'Ingresá un número válido:'); return; }
    await saveSession('MOV_REF', { ...datos, cantidad: cant });
    await tgSend(chatId, 'Referencia/documento:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_REF' && text) {
    const d = { ...datos, referencia: text };
    await saveSession('MOV_CONF', d);
    await tgSend(chatId, `📋 <b>Confirmar:</b>\nTipo: ${d.tipo}\nProducto: ${d.id_producto} - ${d.marca} ${d.modelo}\nCantidad: ${d.cantidad}\nRef: ${d.referencia}`,
      [[{ text: '✅ Confirmar', callback_data: 'mov_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'mov_ok' && estado === 'MOV_CONF') {
    const d = datos; const movId = `MOV-${Date.now()}`;
    await clearSession(); // anti double-click
    await appendRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, tipo: d.tipo, estado: 'pendiente', id_producto: d.id_producto||'', numero_serie: d.numero_serie||'', cantidad: d.cantidad, descripcion_movimiento: `${d.tipo} ${d.cantidad}u ${d.numero_serie||d.id_producto}`, referencia_doc: d.referencia, hash_duplicado: `${d.numero_serie||d.id_producto}-${d.tipo}-${d.cantidad}-${d.referencia}`, telegram_id_operador: userId, nombre_operador: user.nombre, telegram_id_aprobador: '', nombre_aprobador: '', fecha_creacion: now(), fecha_aprobacion: '', motivo_rechazo: '', notas_aprobador: '' });
    await tgSend(chatId, `✅ Movimiento <b>${movId}</b> enviado para aprobación.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    for (const u of usuarios)
      if (['aprobador','administrador'].includes(u.rol) && String(u.telegram_id) !== userId && u.activo === 'TRUE')
        await tgSend(u.telegram_id, `⚠️ Nuevo movimiento de ${user.nombre}:\n${d.tipo} ${d.cantidad}x ${d.id_producto}\nRef: ${d.referencia}`, [[{ text: '✅ Ver pendientes', callback_data: 'pendientes' }]]);
    return;
  }

  // ── Pendientes ─────────────────────────────────────────────────────────────
  if (cb === 'pendientes') {
    if (!['aprobador','administrador'].includes(rol)) { await tgSend(chatId, 'Sin permiso.'); return; }
    if (!movPend.length && !factPend.length) { await tgSend(chatId, '✅ No hay pendientes.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]); await clearSession(); return; }
    for (const mov of movPend.slice(0, 5))
      await tgSend(chatId, `📋 <b>Movimiento pendiente</b>\n\nID: ${mov.id_movimiento}\nTipo: ${mov.tipo}\nProducto: ${mov.id_producto}\nCantidad: ${mov.cantidad}\nRef: ${mov.referencia_doc}\nOperador: ${mov.nombre_operador}`,
        [[{ text: '✅ Aprobar', callback_data: `apr_${mov.id_movimiento}` }, { text: '❌ Rechazar', callback_data: `rej_${mov.id_movimiento}` }]]);
    for (const f of factPend.slice(0, 5))
      await tgSend(chatId, `🧾 <b>Factura pendiente</b>\n\nCliente: ${f.nombre}\nDomicilio: ${f.domicilio}\nDNI/CUIT: ${f.dni_cuit}\nTipo: ${f.tipo}\nDescripción: ${f.descripcion_producto}\nPrecio: $${f.precio_venta}\nFecha: ${(f.fecha||'').substring(0,10)}`,
        [[{ text: '✅ Datos OK', callback_data: `factok_${f.id_factura}` }]]);
    const extra = (movPend.length > 5 ? movPend.length - 5 : 0) + (factPend.length > 5 ? factPend.length - 5 : 0);
    if (extra > 0) await tgSend(chatId, `... y ${extra} más en la planilla.`);
    return;
  }

  // ── Aprobar movimiento ─────────────────────────────────────────────────────
  if (cb.startsWith('apr_')) {
    if (!['aprobador','administrador'].includes(rol)) { await tgSend(chatId, 'Sin permiso.'); return; }
    const movId = cb.slice(4);
    const mov   = cache.movimientos.find(m => m.id_movimiento === movId);
    if (!mov) { await tgSend(chatId, 'Movimiento no encontrado.'); await clearSession(); return; }
    const fechaApr = now();
    await upsertRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, estado: 'aprobado', telegram_id_aprobador: userId, nombre_aprobador: user.nombre, fecha_aprobacion: fechaApr, motivo_rechazo: '', notas_aprobador: '' }, 'id_movimiento');
    await appendRow('HISTORIAL', { id_movimiento: movId, tipo: mov.tipo, estado: 'aprobado', id_producto: mov.id_producto || mov.numero_serie, cantidad: mov.cantidad, referencia_doc: mov.referencia_doc, telegram_id_operador: mov.telegram_id_operador, nombre_operador: mov.nombre_operador, telegram_id_aprobador: userId, nombre_aprobador: user.nombre, fecha_creacion: mov.fecha_creacion, fecha_aprobacion: fechaApr, motivo_rechazo: '', notas_aprobador: '' });
    const prod = cache.stock.find(p => p.id_producto === mov.id_producto) || cache.stock.find(p => mov.numero_serie && p.numero_serie === mov.numero_serie);
    if (prod) {
      let nuevoStock = parseInt(prod.stock_actual) || 0;
      if (mov.tipo === 'entrada') nuevoStock += parseInt(mov.cantidad) || 0;
      else if (mov.tipo === 'salida') nuevoStock -= parseInt(mov.cantidad) || 0;
      if (nuevoStock < 0) nuevoStock = 0;
      const nuevoEstado = nuevoStock === 0 ? 'vendido' : (nuevoStock > 0 && (prod.estado_unidad||'').toLowerCase() === 'vendido' ? 'disponible' : prod.estado_unidad || 'disponible');
      await upsertRow('STOCK', { numero_serie: prod.numero_serie, stock_actual: String(nuevoStock), estado_unidad: nuevoEstado, ultima_actualizacion: fechaApr }, 'numero_serie');
    }
    await clearSession();
    await tgSend(chatId, `✅ Movimiento <b>${movId}</b> aprobado.\nStock actualizado.`, [[{ text: '📋 Ver más', callback_data: 'pendientes' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    if (mov.telegram_id_operador) await tgSend(mov.telegram_id_operador, `✅ Tu movimiento <b>${movId}</b> fue aprobado por ${user.nombre}.`);
    return;
  }

  // ── Rechazar movimiento ────────────────────────────────────────────────────
  if (cb.startsWith('rej_')) {
    if (!['aprobador','administrador'].includes(rol)) { await tgSend(chatId, 'Sin permiso.'); return; }
    await saveSession('WAIT_REJ', { movId: cb.slice(4) });
    await tgSend(chatId, 'Motivo del rechazo:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'WAIT_REJ' && text) {
    const movId = datos.movId;
    const mov   = cache.movimientos.find(m => m.id_movimiento === movId);
    const fechaRej = now();
    await upsertRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, estado: 'rechazado', telegram_id_aprobador: userId, nombre_aprobador: user.nombre, fecha_aprobacion: fechaRej, motivo_rechazo: text, notas_aprobador: '' }, 'id_movimiento');
    await appendRow('HISTORIAL', { id_movimiento: movId, tipo: mov?.tipo||'', estado: 'rechazado', id_producto: mov?.id_producto||'', cantidad: mov?.cantidad||'', referencia_doc: mov?.referencia_doc||'', telegram_id_operador: mov?.telegram_id_operador||'', nombre_operador: mov?.nombre_operador||'', telegram_id_aprobador: userId, nombre_aprobador: user.nombre, fecha_creacion: mov?.fecha_creacion||'', fecha_aprobacion: fechaRej, motivo_rechazo: text, notas_aprobador: '' });
    await clearSession();
    await tgSend(chatId, `❌ Movimiento <b>${movId}</b> rechazado.`, [[{ text: '📋 Ver más', callback_data: 'pendientes' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    if (mov?.telegram_id_operador) await tgSend(mov.telegram_id_operador, `❌ Tu movimiento <b>${movId}</b> fue rechazado por ${user.nombre}.\nMotivo: ${text}`);
    return;
  }

  // ── Facturas pendientes ────────────────────────────────────────────────────
  if (cb === 'fact_pend') {
    if (!['aprobador','administrador'].includes(rol)) { await tgSend(chatId, 'Sin permiso.'); return; }
    if (!factPend.length) { await tgSend(chatId, '✅ No hay facturas pendientes.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]); await clearSession(); return; }
    for (const f of factPend.slice(0, 5))
      await tgSend(chatId, `🧾 <b>Factura pendiente</b>\n\nCliente: ${f.nombre}\nDomicilio: ${f.domicilio}\nDNI/CUIT: ${f.dni_cuit}\nTipo: ${f.tipo}\nDescripción: ${f.descripcion_producto}\nPrecio: $${f.precio_venta}\nFecha: ${(f.fecha||'').substring(0,10)}`,
        [[{ text: '✅ Datos OK', callback_data: `factok_${f.id_factura}` }]]);
    if (factPend.length > 5) await tgSend(chatId, `... y ${factPend.length - 5} más en la planilla.`);
    return;
  }
  if (cb.startsWith('factok_')) {
    if (!['aprobador','administrador'].includes(rol)) { await tgSend(chatId, 'Sin permiso.'); return; }
    const facId = cb.slice(7);
    await upsertRow('FACTURAS', { id_factura: facId, factura_realizada: 'SI' }, 'id_factura');
    await clearSession();
    await tgSend(chatId, `✅ Factura <b>${facId}</b> marcada como realizada.`, [[{ text: '🧾 Ver más', callback_data: 'fact_pend' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Nueva Factura ──────────────────────────────────────────────────────────
  if (cb === 'factura') {
    await saveSession('FACT_DATA', {});
    await tgSend(chatId,
      '🧾 <b>Datos para factura</b>\nMandame todo en un mensaje con este formato:\n\n' +
      '<code>Nombre, Domicilio, DNI/CUIT, Tipo (A/B/C), Descripción, Precio, Mail, Teléfono</code>\n\n' +
      '<i>Ejemplo:</i>\n<code>Juan García, Av. Corrientes 123, 20-12345678-9, B, Trek Mountain Pro 29, 150000, juan@mail.com, 1155667788</code>\n' +
      '<i>Mail y teléfono son opcionales.</i>',
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'FACT_DATA' && text) {
    const p = text.split(',').map(x => x.trim());
    if (p.length < 6) { await tgSend(chatId, 'Faltan datos. Mandá al menos los 6 campos separados por coma:\n<code>Nombre, Domicilio, DNI/CUIT, Tipo, Descripción, Precio</code>'); return; }
    // Parseo robusto: DNI/CUIT tiene dígitos/guiones, detectarlo para manejar domicilios con coma
    const dniIdx = p.findIndex(x => /^\d{2}-\d{7,8}-\d$/.test(x.replace(/\s/g,'')) || /^\d{7,8}$/.test(x.replace(/\s/g,'')));
    let nombre, domicilio, dni_cuit, tipo, descripcion, precioRaw, mail, telefono;
    if (dniIdx >= 2) {
      nombre = p.slice(0, dniIdx - 1).join(', ');
      domicilio = p[dniIdx - 1];
      dni_cuit = p[dniIdx];
      tipo = p[dniIdx + 1] || '';
      descripcion = p[dniIdx + 2] || '';
      precioRaw = p[dniIdx + 3] || '0';
      mail = p[dniIdx + 4] || '';
      telefono = p[dniIdx + 5] || '';
    } else {
      [nombre, domicilio, dni_cuit, tipo, descripcion, precioRaw] = p;
      mail = p[6] || ''; telefono = p[7] || '';
    }
    const precio     = (precioRaw||'0').trim().replace(/\./g,'').replace(',','.');
    if (isNaN(Number(precio)) || Number(precio) < 0) { await tgSend(chatId, '❌ El precio no es válido. Usá solo números (ej: 150000). Reintentá.'); return; }
    const tipoUpper  = (tipo||'').toUpperCase();
    if (!['A','B','C'].includes(tipoUpper)) { await tgSend(chatId, 'El tipo debe ser A, B o C. Reintentá.'); return; }
    await saveSession('FACT_CONF', { nombre, domicilio, dni_cuit, tipo: tipoUpper, descripcion, precio, mail, telefono });
    await tgSend(chatId,
      `🧾 <b>Confirmar datos:</b>\nCliente: ${nombre}\nDomicilio: ${domicilio}\nDNI/CUIT: ${dni_cuit}\nTipo: ${tipoUpper}\nDescripción: ${descripcion}\nPrecio: $${precio}` +
      (mail ? `\nMail: ${mail}` : '') + (telefono ? `\nTeléfono: ${telefono}` : ''),
      [[{ text: '✅ Confirmar', callback_data: 'fact_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'fact_ok' && estado === 'FACT_CONF') {
    const d = datos;
    await clearSession(); // anti double-click
    await appendRow('FACTURAS', { id_factura: `FAC-${Date.now()}`, nombre: d.nombre, domicilio: d.domicilio, dni_cuit: d.dni_cuit, tipo: d.tipo, descripcion_producto: d.descripcion, precio_venta: d.precio, fecha: now(), forma_pago: '', numero_serie: '', factura_realizada: 'FALSE', mail: d.mail||'', telefono: d.telefono||'' });
    await tgSend(chatId, '✅ Datos de factura guardados. Revisá la hoja FACTURAS en Google Sheets.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Panel Admin ────────────────────────────────────────────────────────────
  if (cb === 'admin' && rol === 'administrador') {
    await tgSend(chatId, '⚙️ <b>Panel Admin:</b>',
      [[{ text: '👤 Agregar Usuario', callback_data: 'adm_user' }],
       [{ text: '🧾 Cargar Datos Factura', callback_data: 'factura' }],
       [{ text: '📷 Carga por Factura (OCR)', callback_data: 'fact_prov' }],
       [{ text: '🔄 Recargar datos del stock', callback_data: 'adm_reload' }],
       [{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'adm_reload' && rol === 'administrador') {
    await tgSend(chatId, '🔄 Recargando datos...');
    await refreshCache();
    await tgSend(chatId, `✅ Datos actualizados.\n📦 Stock: ${cache.stock.filter(s => s.numero_serie || s.marca).length} productos`, [[{ text: '⚙️ Panel Admin', callback_data: 'admin' }]]);
    return;
  }
  if (cb === 'adm_user' && rol === 'administrador') {
    await saveSession('ADM_USER', {});
    await tgSend(chatId, 'Datos del usuario:\n<code>ID_telegram,nombre,rol</code>\nRoles: operador / aprobador / administrador', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'ADM_USER' && text) {
    const parts = text.split(',').map(p => p.trim());
    if (parts.length < 3) { await tgSend(chatId, 'Formato: ID,nombre,rol'); return; }
    const [nId, nNombre, nRol] = parts;
    if (!['operador','aprobador','administrador'].includes(nRol)) { await tgSend(chatId, '❌ Rol inválido. Usá: operador / aprobador / administrador'); return; }
    if (findUser(nId)) { await tgSend(chatId, `Ya existe ID ${nId}.`); await clearSession(); return; }
    await appendRow('USUARIOS', { telegram_id: nId, nombre: nNombre, rol: nRol, activo: 'TRUE', fecha_alta: now() });
    await clearSession();
    await tgSend(chatId, `✅ Usuario ${nNombre} (${nRol}) agregado.`, [[{ text: '⚙️ Admin', callback_data: 'admin' }]]);
    return;
  }

  // ── OCR: Carga por factura de proveedor ───────────────────────────────────
  if (cb === 'fact_prov' && rol === 'administrador') {
    await tgSend(chatId, '📦 <b>Carga por factura de proveedor</b>\n¿Cómo querés cargar los productos?',
      [[{ text: '📷 Foto / PDF', callback_data: 'fact_prov_foto' }, { text: '✏️ Escribir manualmente', callback_data: 'fact_prov_texto' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'fact_prov_foto' && rol === 'administrador') {
    await saveSession('FACT_PROV_WAIT', {});
    await tgSend(chatId, '📷 <b>Carga por foto/PDF</b>\nMandame una foto o PDF de la factura. La IA detectará los productos automáticamente.', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'fact_prov_texto' && rol === 'administrador') {
    await saveSession('FACT_PROV_TEXT', {});
    await tgSend(chatId,
      '✏️ <b>Carga manual</b>\nMandame los productos, <b>uno por línea</b>, con este formato:\n\n' +
      '<code>Tipo, Marca, Modelo, Descripción, Cantidad, Precio unitario, Rodado</code>\n\n' +
      '<i>Tipos:</i> bicicleta, cuadro, accesorio, otro\n' +
      '<i>Rodado:</i> número para bicis (26, 29), dejalo vacío para accesorios\n\n' +
      '<i>Ejemplo:</i>\n<code>bicicleta, Raleigh, Scout 2.0, MTB aluminio doble disco, 2, 150000, 26\naccesorio, Bell, Casco Nutcase, Casco talle M, 3, 15000,</code>',
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'FACT_PROV_TEXT' && text && !cb) {
    const lineas = text.split('\n').map(l => l.trim()).filter(Boolean);
    const productos = [];
    const TIPOS_VALIDOS = ['bicicleta','cuadro','accesorio','otro'];
    for (const linea of lineas) {
      const p = linea.split(',').map(x => x.trim());
      if (p.length < 3) continue;
      // Si el primer campo es un tipo válido, usarlo; sino asumir 'bicicleta' y no consumir el campo
      let idx = 0;
      const tipo = TIPOS_VALIDOS.includes(p[0].toLowerCase()) ? p[idx++].toLowerCase() : 'bicicleta';
      const marca = p[idx++] || '';
      const modelo = p[idx++] || '';
      const descripcion = p[idx++] || '';
      const cantidad = parseInt(p[idx++]) || 1;
      // El precio puede tener puntos de miles (100.000) — eliminarlos y tomar solo dígitos
      const precioRaw = (p[idx++] || '0').replace(/\./g, '').replace(',', '.');
      const precio_unitario = precioRaw || '0';
      const rodado = p[idx++] || '';
      productos.push({ tipo, marca, modelo, descripcion, cantidad, precio_unitario, rodado });
    }
    if (!productos.length) {
      await tgSend(chatId, '❌ No pude leer los productos. Revisá el formato:\n<code>Tipo, Marca, Modelo, Descripción, Cantidad, Precio, Rodado</code>\nUn producto por línea.');
      return;
    }
    let resumen = `📦 <b>${productos.length} producto(s) a cargar:</b>\n\n`;
    productos.forEach((p, i) => { resumen += `${i+1}. <b>${p.marca} ${p.modelo}</b> (${p.tipo})${p.rodado ? ' R'+p.rodado : ''}\n   ${p.descripcion}\n   ${p.cantidad}u × $${p.precio_unitario}\n\n`; });
    if (resumen.length > 3800) resumen = resumen.substring(0, 3800) + '\n<i>...y más</i>\n\n';
    resumen += '¿Dónde ingresan estos productos?';
    await saveSession('FACT_PROV_UBIC', { productos, driveUrl: null });
    await tgSend(chatId, resumen, [[{ text: '🏪 Local', callback_data: 'fprov_local' }, { text: '🏭 Galpón', callback_data: 'fprov_galpon' }], [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'FACT_PROV_WAIT' && message && (message.photo || message.document)) {
    const isPhoto  = !!message.photo;
    const fileId   = isPhoto ? message.photo[message.photo.length - 1].file_id : message.document.file_id;
    await tgSend(chatId, '🔍 Analizando con IA...');
    const fileInfo = await tgPost('getFile', { file_id: fileId });
    const filePath = fileInfo?.result?.file_path;
    if (!filePath) { await tgSend(chatId, '❌ Error al obtener el archivo.'); await clearSession(); return; }
    const fileUrl  = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const mimeType = isPhoto ? 'image/jpeg' : (message.document.mime_type || 'application/pdf');
    const ext      = isPhoto ? 'jpg' : (filePath.split('.').pop() || 'pdf');
    const fileName = `factura_${now().replace(/\//g,'-').replace(/ /g,'_').replace(/:/g,'')}.${ext}`;
    const ocrPrompt = 'Analizá esta factura de proveedor. Extraé TODOS los productos/artículos. Devolvé SOLO un JSON array sin markdown ni texto extra: [{"tipo":"bicicleta","marca":"","modelo":"","descripcion":"","cantidad":1,"precio_unitario":"0","rodado":""}]. Tipos: bicicleta, cuadro, accesorio, otro. rodado: número para bicis/cuadros (ej 26, 29), vacío para accesorios.';
    const groqBody = { model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: fileUrl } }, { type: 'text', text: ocrPrompt }] }], max_tokens: 1000 };
    const [ocrRes, driveRes] = await Promise.allSettled([
      axios.post('https://api.groq.com/openai/v1/chat/completions', groqBody, { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }),
      uploadToDrive(fileUrl, fileName, mimeType)
    ]);
    if (ocrRes.status === 'rejected') { await tgSend(chatId, '❌ Error IA: ' + ocrRes.reason.message); await clearSession(); return; }
    const rawText = ocrRes.value.data.choices?.[0]?.message?.content || '[]';
    const driveUrl = driveRes.status === 'fulfilled' ? driveRes.value : null;
    let productos = [];
    try { const s = rawText.indexOf('['); const e = rawText.lastIndexOf(']'); if (s !== -1 && e !== -1) productos = JSON.parse(rawText.slice(s, e+1)); } catch {}
    if (!productos.length) { await tgSend(chatId, '❌ No pude detectar productos. Intentá con una foto más nítida.'); await clearSession(); return; }
    let resumen = `📦 <b>Detecté ${productos.length} producto(s):</b>\n\n`;
    productos.forEach((p, i) => { resumen += `${i+1}. <b>${p.marca} ${p.modelo}</b> (${p.tipo})${p.rodado ? ' R'+p.rodado : ''}\n   ${p.descripcion}\n   ${p.cantidad}u × $${p.precio_unitario}\n\n`; });
    if (resumen.length > 3700) resumen = resumen.substring(0, 3700) + '\n<i>...y más</i>\n\n';
    resumen += '¿Dónde ingresan estos productos?';
    if (driveUrl) resumen += `\n\n💾 <a href="${driveUrl}">Factura guardada en Drive</a>`;
    await saveSession('FACT_PROV_UBIC', { productos, driveUrl });
    await tgSend(chatId, resumen, [[{ text: '🏪 Local', callback_data: 'fprov_local' }, { text: '🏭 Galpón', callback_data: 'fprov_galpon' }], [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'FACT_PROV_WAIT' && text && !cb) { await tgSend(chatId, '📷 Necesito una foto o PDF de la factura. Por favor enviá el archivo.'); return; }
  if ((cb === 'fprov_local' || cb === 'fprov_galpon') && estado === 'FACT_PROV_UBIC') {
    const ubicacion = cb === 'fprov_local' ? 'local' : 'galpon';
    const { productos, driveUrl: dUrl } = datos;
    await saveSession('FACT_PROV_CONF', { productos, ubicacion, driveUrl: dUrl || null });
    let conf = `✅ <b>Confirmar carga en ${ubicacion}:</b>\n\n`;
    productos.forEach((p, i) => { conf += `${i+1}. ${p.marca} ${p.modelo} × ${p.cantidad}\n`; });
    conf += '\n¿Guardamos en la hoja de Compras para revisión?';
    await tgSend(chatId, conf, [[{ text: '✅ Guardar en Compras', callback_data: 'fprov_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'fprov_ok' && estado === 'FACT_PROV_CONF') {
    const { productos, ubicacion, driveUrl } = datos; const t = now();
    await clearSession(); // anti double-click
    for (const p of productos)
      await appendRow('COMPRAS', { fecha: t, tipo: p.tipo, marca: p.marca||'', modelo: p.modelo||'', descripcion: p.descripcion||'', cantidad: String(p.cantidad||1), precio_unitario: p.precio_unitario||'0', rodado: p.rodado||'', ubicacion, estado: 'pendiente', foto_drive: driveUrl||'' });
    let confMsg = `✅ <b>${productos.length} producto(s)</b> guardados en la hoja <b>COMPRAS</b>. Revisalos y pasalos al stock cuando quieras.`;
    if (driveUrl) confMsg += `\n💾 <a href="${driveUrl}">Ver factura en Drive</a>`;
    await tgSend(chatId, confMsg, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Transferencia mejorada ─────────────────────────────────────────────────
  if (cb === 'transf2') {
    await saveSession('TRANSF2_ORIGEN', {});
    await tgSend(chatId, '🔄 <b>Transferir Producto</b>\n¿Desde dónde lo movés?',
      [[{ text: '🏪 Desde Local', callback_data: 't2_or_local' }, { text: '🏭 Desde Galpón', callback_data: 't2_or_galpon' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if ((cb === 't2_or_local' || cb === 't2_or_galpon') && estado === 'TRANSF2_ORIGEN') {
    const origen = cb === 't2_or_local' ? 'local' : 'galpon';
    const destino = origen === 'local' ? 'galpon' : 'local';
    await saveSession('TRANSF2_CAT', { origen, destino });
    await tgSend(chatId, `🔄 <b>De ${origen} → ${destino}</b>\n¿Qué tipo de producto?`,
      [[{ text: '🚲 Bicicleta', callback_data: 't2_cat_bici' }, { text: '🏗️ Cuadro', callback_data: 't2_cat_cuad' }],
       [{ text: '🔧 Accesorio', callback_data: 't2_cat_acc' }, { text: '🔍 Todos', callback_data: 't2_cat_todo' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb.startsWith('t2_cat_') && estado === 'TRANSF2_CAT') {
    const catMap = { t2_cat_bici:'bicicleta', t2_cat_cuad:'cuadro', t2_cat_acc:'accesorio', t2_cat_todo:'' };
    const cat = catMap[cb] ?? '';
    await saveSession('TRANSF2_BUSCA', { ...datos, cat });
    await tgSend(chatId, '🔍 Escribí la marca o modelo (toleramos errores de tipeo):',
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'TRANSF2_BUSCA' && text) {
    const { origen, destino, cat } = datos;
    let resultados = stock.filter(p =>
      p.ubicacion === origen &&
      (cat === '' || (p.tipo||'').toLowerCase() === cat) &&
      (fuzzy(text, p.marca||'') || fuzzy(text, p.modelo||'') || fuzzy(text, p.numero_serie||'') || fuzzy(text, p.descripcion||''))
    );
    if (!resultados.length) {
      await tgSend(chatId, `❌ No encontré "${text}" en ${origen}. Intentá con otro nombre:`,
        [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
      return;
    }
    if (resultados.length === 1) {
      const p = resultados[0];
      await saveSession('TRANSF2_CONF', { ...datos, numero_serie: p.numero_serie, marca: p.marca, modelo: p.modelo, rodado: p.rodado||'', talle: p.talle||'', color: p.color||'' });
      let detalle = `📦 ${p.marca} ${p.modelo}${p.rodado ? ' R'+p.rodado : ''} (${p.numero_serie})`;
      if (!isEmpty(p.talle)) detalle += `\n📐 Talle: ${p.talle}`;
      if (!isEmpty(p.color)) detalle += `\n🎨 Color: ${p.color}`;
      if (!isEmpty(p.descripcion)) detalle += `\n📝 ${p.descripcion}`;
      await tgSend(chatId,
        `🔄 <b>Confirmar transferencia:</b>\n${detalle}\n📍 ${origen} → ${destino}`,
        [[{ text: '✅ Confirmar', callback_data: 't2_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
      return;
    }
    // Múltiples resultados — mostrar botones
    await saveSession('TRANSF2_PICK', { ...datos });
    const kb = resultados.map(p => {
      let label = `${p.marca} ${p.modelo}${p.rodado ? ' R'+p.rodado : ''}`;
      if (!isEmpty(p.talle)) label += ` T:${p.talle}`;
      if (!isEmpty(p.color)) label += ` ${p.color}`;
      label += ` (${p.numero_serie})`;
      return [{ text: label, callback_data: `t2_pick_${p.numero_serie}` }];
    });
    kb.push([{ text: '❌ Cancelar', callback_data: 'main_menu' }]);
    await tgSend(chatId, `🔍 Encontré ${resultados.length} coincidencias. ¿Cuál es?`, kb);
    return;
  }
  if (cb.startsWith('t2_pick_') && estado === 'TRANSF2_PICK') {
    const id = cb.slice(8);
    const p = cache.stock.find(p => p.numero_serie === id);
    if (!p) { await tgSend(chatId, '❌ Producto no encontrado.'); return; }
    const { origen, destino } = datos;
    await saveSession('TRANSF2_CONF', { ...datos, numero_serie: p.numero_serie, marca: p.marca, modelo: p.modelo, rodado: p.rodado||'', talle: p.talle||'', color: p.color||'' });
    let detalle = `📦 ${p.marca} ${p.modelo}${p.rodado ? ' R'+p.rodado : ''} (${p.numero_serie})`;
    if (!isEmpty(p.talle)) detalle += `\n📐 Talle: ${p.talle}`;
    if (!isEmpty(p.color)) detalle += `\n🎨 Color: ${p.color}`;
    if (!isEmpty(p.descripcion)) detalle += `\n📝 ${p.descripcion}`;
    await tgSend(chatId,
      `🔄 <b>Confirmar transferencia:</b>\n${detalle}\n📍 ${origen} → ${destino}`,
      [[{ text: '✅ Confirmar', callback_data: 't2_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 't2_ok' && estado === 'TRANSF2_CONF') {
    const { numero_serie, marca, modelo, rodado, destino } = datos;
    await upsertRow('STOCK', { numero_serie, ubicacion: destino, ultima_actualizacion: now() }, 'numero_serie');
    syncVistaUbicacion(numero_serie, destino).catch(e => console.error('[vista sync]', e.message));
    await clearSession();
    await tgSend(chatId,
      `✅ <b>${marca} ${modelo}${rodado ? ' R'+rodado : ''}</b> transferido a <b>${destino}</b>.`,
      [[{ text: '🔄 Otra transferencia', callback_data: 'transf2' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Ver detalle de producto desde lista ───────────────────────────────────
  if (cb.startsWith('prod_')) {
    const serie = cb.replace('prod_', '');
    const p = stock.find(s => s.numero_serie === serie);
    if (!p) { await tgSend(chatId, 'Producto no encontrado.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]); return; }
    await showProdDetail(p);
    return;
  }

  // ── Ver variantes de un modelo ────────────────────────────────────────────
  if (cb.startsWith('grp_')) {
    const refSerie = cb.slice(4);
    const ref = cache.stock.find(p => p.numero_serie === refSerie);
    if (!ref) { await tgSend(chatId, '❌ Modelo no encontrado.'); return; }
    const refN = normalizarCampos(ref);
    const variants = stock.filter(p => {
      const pN = normalizarCampos(p);
      return (p.marca||'').toLowerCase() === (ref.marca||'').toLowerCase()
        && pN.modelo.toLowerCase() === refN.modelo.toLowerCase()
        && pN.rodado.toLowerCase() === refN.rodado.toLowerCase();
    });
    await showVariants(variants);
    return;
  }

  // ── Venta rápida (accesorios / bicicletas sin stock) ──────────────────────
  if (cb === 'venta_rapida') {
    await tgSend(chatId, '💰 <b>Registrar Venta</b>\n¿Qué tipo?',
      [[{ text: '🔧 Accesorio', callback_data: 'vr_acc' }, { text: '🚲 Bicicleta', callback_data: 'vr_bici' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'vr_acc' || cb === 'vr_bici') {
    const tipo = cb === 'vr_acc' ? 'accesorio' : 'bicicleta';
    await saveSession('VR_DATA', { tipo });
    await tgSend(chatId,
      `💰 <b>Venta de ${tipo}</b>\n\nMandame los datos separados por coma:\n` +
      `<code>Descripción, Precio, Forma de pago</code>\n\n` +
      `<i>Ejemplo:</i>\n<code>Casco Nutcase talle M, 15000, Efectivo</code>`,
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'VR_DATA' && text) {
    const parts = text.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 3) {
      await tgSend(chatId, '❌ Faltan datos. Necesito: Descripción, Precio, Forma de pago');
      return;
    }
    const [descripcion, precioRawVr, forma_pago] = parts;
    const precio = (precioRawVr||'0').replace(/\./g,'').replace(',','.');
    if (isNaN(Number(precio)) || Number(precio) < 0) { await tgSend(chatId, '❌ El precio no es válido. Usá solo números (ej: 15000). Reintentá.'); return; }
    const { tipo } = datos;
    await saveSession('VR_CONF', { tipo, descripcion, precio, forma_pago });
    await tgSend(chatId,
      `💰 <b>Confirmar venta:</b>\n\n` +
      `📦 ${descripcion}\n💵 $${precio} — ${forma_pago}`,
      [[{ text: '✅ Confirmar', callback_data: 'vr_ok' }, { text: '✏️ Editar', callback_data: 'vr_edit' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'vr_edit' && estado === 'VR_CONF') {
    const { tipo, descripcion, precio, forma_pago } = datos;
    await saveSession('VR_DATA', { tipo });
    await tgSend(chatId,
      `✏️ <b>Editar venta</b>\n\nMandame los datos separados por coma:\n` +
      `<code>Descripción, Precio, Forma de pago</code>\n\n` +
      `<i>Datos anteriores:</i>\n<code>${descripcion}, ${precio}, ${forma_pago}</code>`,
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'vr_ok' && estado === 'VR_CONF') {
    const { tipo, descripcion, precio, forma_pago } = datos;
    const sheet = tipo === 'accesorio' ? 'VENTAS_ACCESORIOS' : 'VENTAS_BICICLETAS';
    await clearSession(); // anti double-click
    await appendRow(sheet, { fecha: now(), descripcion, precio, forma_pago, operador: user.nombre });
    await tgSend(chatId,
      `✅ <b>Venta registrada</b>\n📦 ${descripcion}\n💵 $${precio} — ${forma_pago}`,
      [[{ text: '💰 Otra venta', callback_data: 'venta_rapida' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Registrar venta ────────────────────────────────────────────────────────
  if (cb.startsWith('vender_')) {
    const serie = cb.slice(7);
    const p = cache.stock.find(p => p.numero_serie === serie);
    if (!p) { await tgSend(chatId, '❌ Producto no encontrado.'); return; }
    const desc = [p.marca, p.modelo, p.rodado ? 'R'+p.rodado : '', p.talle ? 'T'+p.talle : '', p.color].filter(Boolean).join(' ');
    const precioHint = p.precio_max ? ` (sugerido: $${Number(p.precio_max).toLocaleString('es-AR', { maximumFractionDigits: 0 })})` : '';
    await saveSession('VENTA_DATA', { numero_serie: serie, descripcion: desc });
    await tgSend(chatId,
      `💰 <b>Registrar Venta</b>\n📦 ${desc}\n\n` +
      `Mandame los datos separados por coma:\n` +
      `<code>Nombre, Domicilio, DNI/CUIT, Tipo (A/B/C), Precio${precioHint}, Forma de pago, Mail, Teléfono</code>\n\n` +
      `<i>Ejemplo:</i>\n<code>Juan Pérez, Av. Corrientes 123, 12345678, B, 280000, Efectivo, juan@mail.com, 1155667788</code>\n` +
      `<i>Mail y teléfono son opcionales, podés dejarlos vacíos.</i>`,
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'VENTA_DATA' && text) {
    const parts = text.split(',').map(l => l.trim());
    if (parts.length < 6) {
      await tgSend(chatId, '❌ Faltan datos. Mandame al menos los 6 separados por coma:\nNombre, Domicilio, DNI/CUIT, Tipo (A/B/C), Precio, Forma de pago');
      return;
    }
    // Parseo robusto: detectar DNI/CUIT para manejar domicilios con coma
    const dniIdx2 = parts.findIndex(x => /^\d{2}-\d{7,8}-\d$/.test(x.replace(/\s/g,'')) || /^\d{7,8}$/.test(x.replace(/\s/g,'')));
    let nombre, domicilio, dni_cuit, tipoRaw, precioRaw, forma_pago, mail, telefono;
    if (dniIdx2 >= 2) {
      nombre = parts.slice(0, dniIdx2 - 1).join(', ');
      domicilio = parts[dniIdx2 - 1];
      dni_cuit = parts[dniIdx2];
      tipoRaw = parts[dniIdx2 + 1] || '';
      precioRaw = parts[dniIdx2 + 2] || '0';
      forma_pago = parts[dniIdx2 + 3] || '';
      mail = parts[dniIdx2 + 4] || '';
      telefono = parts[dniIdx2 + 5] || '';
    } else {
      [nombre, domicilio, dni_cuit, tipoRaw, precioRaw, forma_pago] = parts;
      mail = parts[6] || ''; telefono = parts[7] || '';
    }
    const tipo = tipoRaw.toUpperCase();
    if (!['A','B','C'].includes(tipo)) { await tgSend(chatId, '❌ El tipo de factura debe ser A, B o C. Reintentá.'); return; }
    const precio = (precioRaw||'0').trim().replace(/\./g,'').replace(',','.');
    if (isNaN(Number(precio)) || Number(precio) < 0) { await tgSend(chatId, '❌ El precio no es válido. Usá solo números (ej: 280000). Reintentá.'); return; }
    await saveSession('VENTA_CONF', { ...datos, nombre, domicilio, dni_cuit, tipo, precio, forma_pago, mail, telefono });
    await tgSend(chatId,
      `💰 <b>Confirmar venta:</b>\n\n` +
      `📦 ${datos.descripcion}\n` +
      `👤 ${nombre}\n` +
      `🏠 ${domicilio}\n` +
      `🪪 ${dni_cuit}\n` +
      `🧾 Factura tipo ${tipo}\n` +
      `💵 $${precio} — ${forma_pago}` +
      (mail ? `\n📧 ${mail}` : '') +
      (telefono ? `\n📞 ${telefono}` : ''),
      [[{ text: '✅ Confirmar', callback_data: 'venta_ok' }, { text: '✏️ Editar', callback_data: 'venta_edit' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'venta_edit' && estado === 'VENTA_CONF') {
    const { numero_serie, descripcion, nombre, domicilio, dni_cuit, tipo, precio, forma_pago, mail, telefono } = datos;
    const p = cache.stock.find(p => p.numero_serie === numero_serie);
    const precioHint = p?.precio_max ? ` (sugerido: $${Number(p.precio_max).toLocaleString('es-AR', { maximumFractionDigits: 0 })})` : '';
    await saveSession('VENTA_DATA', { numero_serie, descripcion });
    await tgSend(chatId,
      `✏️ <b>Editar datos</b>\n📦 ${descripcion}\n\n` +
      `Mandame los datos separados por coma:\n` +
      `<code>Nombre, Domicilio, DNI/CUIT, Tipo (A/B/C), Precio${precioHint}, Forma de pago, Mail, Teléfono</code>\n\n` +
      `<i>Datos anteriores:</i>\n<code>${nombre}, ${domicilio}, ${dni_cuit}, ${tipo}, ${precio}, ${forma_pago}, ${mail||''}, ${telefono||''}</code>`,
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'venta_ok' && estado === 'VENTA_CONF') {
    const { numero_serie, descripcion, nombre, domicilio, dni_cuit, tipo, precio, forma_pago, mail, telefono } = datos;
    const p = cache.stock.find(p => p.numero_serie === numero_serie);
    if (!p) { await tgSend(chatId, '❌ No se encontró el producto en stock. Recargá los datos e intentá de nuevo.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]); await clearSession(); return; }
    await clearSession(); // anti double-click: limpiar sesión antes de procesar
    const newStock = Math.max(0, (Number(p.stock_actual) || 0) - 1);
    const ventaTs = now();
    await appendRow('FACTURAS', { id_factura: `FAC-${Date.now()}`, nombre, domicilio, dni_cuit, tipo, descripcion_producto: descripcion, precio_venta: precio, fecha: ventaTs, factura_realizada: 'FALSE', forma_pago, numero_serie, mail: mail||'', telefono: telefono||'' });
    await upsertRow('STOCK', { numero_serie, stock_actual: String(newStock), estado_unidad: newStock === 0 ? 'vendido' : (p.estado_unidad || 'disponible'), ultima_actualizacion: ventaTs }, 'numero_serie');
    await tgSend(chatId,
      `✅ <b>Venta registrada</b>\n\n📦 ${descripcion}\n👤 ${nombre}\n💵 $${precio} — ${forma_pago}\n\n📋 Factura pendiente en Google Sheets.`,
      [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Detalle completo del producto ────────────────────────────────────────
  if (cb.startsWith('ficha_')) {
    const serie = cb.replace('ficha_', '');
    const p = stock.find(s => s.numero_serie === serie);
    if (!p) { await tgSend(chatId, 'Producto no encontrado.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]); return; }
    const pmax  = Number(p.precio_max)  > 0 ? '$'+Number(p.precio_max).toLocaleString('es-AR',  { maximumFractionDigits: 0 }) : 'n/n';
    const pmin  = Number(p.precio_min)  > 0 ? '$'+Number(p.precio_min).toLocaleString('es-AR',  { maximumFractionDigits: 0 }) : 'n/n';
    const pcost = Number(p.precio_costo)> 0 ? '$'+Number(p.precio_costo).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : 'n/n';
    const stk2  = Number(p.stock_actual) || 0;
    let msg = `📋 <b>${p.marca}${p.modelo ? ' '+p.modelo : ''}</b> — Detalle completo\n\n`;
    msg += `🏷️ Tipo: ${p.tipo||'n/n'}\n`;
    msg += `🔢 Serie: ${p.numero_serie||'n/n'}\n`;
    msg += `📐 Rodado: ${isEmpty(p.rodado)?'n/n':p.rodado} | Talle: ${isEmpty(p.talle)?'n/n':p.talle}\n`;
    msg += `🎨 Color: ${isEmpty(p.color)?'n/n':p.color}\n`;
    msg += `📍 Ubicación: ${p.ubicacion||'n/n'} | Stock: ${stk2} | ${p.estado_unidad||'n/n'}\n`;
    msg += `💰 Precio máx: ${pmax} | Mín: ${pmin} | Costo: ${pcost}\n`;
    msg += `📦 Cod. proveedor: ${isEmpty(p.codigo_proveedor)?'n/n':p.codigo_proveedor}\n`;
    if (!isEmpty(p.ficha_tecnica)) {
      const fichaRaw = p.ficha_tecnica.length > 3000 ? p.ficha_tecnica.substring(0, 3000) + '...' : p.ficha_tecnica;
      const fichaItems = fichaRaw.split(/[,;\n]+|(?<!\d)\.\s+/).map(s => s.trim()).filter(Boolean);
      const fichaLista = `• ${p.tipo||'Producto'} ${isEmpty(p.rodado)?'':('R'+p.rodado+' ')}\n` +
        fichaItems.map(i => `• ${i}`).join('\n');
      msg += `\n📋 Ficha técnica:\n${fichaLista}`;
    } else {
      msg += `\n📋 Ficha técnica: n/n`;
    }
    const kbFicha = [];
    if (stk2 > 0) kbFicha.push([{ text: '⚡ Venta rápida', callback_data: `vrap_${p.numero_serie}` }, { text: '🧾 Con factura', callback_data: `vender_${p.numero_serie}` }]);
    kbFicha.push([{ text: '🔍 Buscar otro', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]);
    if (p.foto_url) {
      await tgPost('sendPhoto', { chat_id: chatId, photo: p.foto_url, caption: `${p.marca} ${p.modelo||''}`.trim(), parse_mode: 'HTML' });
    }
    await tgSend(chatId, msg, kbFicha);
    return;
  }

  // ── Venta rápida ─────────────────────────────────────────────────────────
  if (cb.startsWith('vrap_')) {
    const serie = cb.slice(5);
    const p = cache.stock.find(p => p.numero_serie === serie);
    if (!p) { await tgSend(chatId, '❌ Producto no encontrado.'); return; }
    const desc = [p.marca, p.modelo, p.rodado ? 'R'+p.rodado : '', p.talle ? 'T'+p.talle : '', p.color].filter(Boolean).join(' ');
    const precioSug = Number(p.precio_max) > 0 ? `$${Number(p.precio_max).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : 'sin precio cargado';
    await saveSession('VRAP_DATA', { numero_serie: serie, descripcion: desc, precio: Number(p.precio_max) || 0 });
    await tgSend(chatId,
      `⚡ <b>Venta rápida</b>\n📦 ${desc}\n💰 Precio sugerido: ${precioSug}\n\nMandá nombre y forma de pago separados por coma:\n<code>Juan Pérez, Efectivo</code>`,
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'VRAP_DATA' && text) {
    const parts = text.split(',').map(s => s.trim());
    if (parts.length < 2) { await tgSend(chatId, '❌ Mandá nombre y forma de pago separados por coma.\nEj: Juan Pérez, Efectivo'); return; }
    const nombre = parts[0];
    const forma_pago = parts.slice(1).join(', ');
    const precioStr = datos.precio > 0 ? `$${Number(datos.precio).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : 'sin precio';
    await saveSession('VRAP_CONF', { ...datos, nombre, forma_pago });
    await tgSend(chatId,
      `⚡ <b>Confirmar venta rápida:</b>\n\n📦 ${datos.descripcion}\n👤 ${nombre}\n💰 ${precioStr} — ${forma_pago}`,
      [[{ text: '✅ Confirmar', callback_data: 'vrap_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'vrap_ok' && estado === 'VRAP_CONF') {
    const { numero_serie, descripcion, nombre, forma_pago, precio } = datos;
    const p = cache.stock.find(p => p.numero_serie === numero_serie);
    if (!p) { await tgSend(chatId, '❌ No se encontró el producto.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]); await clearSession(); return; }
    await clearSession();
    const newStock = Math.max(0, (Number(p.stock_actual) || 0) - 1);
    const ventaTs = now();
    const hoja = (p.tipo||'').toLowerCase().includes('bici') ? 'VENTAS_BICICLETAS' : 'VENTAS_ACCESORIOS';
    await appendRow(hoja, { fecha: ventaTs, descripcion, precio: precio || '', forma_pago, operador: user.nombre });
    await upsertRow('STOCK', { numero_serie, stock_actual: String(newStock), estado_unidad: newStock === 0 ? 'vendido' : (p.estado_unidad || 'disponible'), ultima_actualizacion: ventaTs }, 'numero_serie');
    const precioStr = precio > 0 ? `$${Number(precio).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : 'sin precio';
    await tgSend(chatId,
      `✅ <b>Venta rápida registrada</b>\n\n📦 ${descripcion}\n👤 ${nombre}\n💰 ${precioStr} — ${forma_pago}`,
      [[{ text: '📦 Buscar otro', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // Fallback: si no hay estado de sesión, intentar búsqueda de stock
  if (text && !cb) {
    let res = findProd(text);
    if (!res.length) {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const sets = words.map(w => findProd(w));
      if (sets.length) {
        const ids = sets[0].map(p => p.numero_serie);
        const inter = sets.slice(1).reduce((acc, s) => acc.filter(id => s.some(p => p.numero_serie === id)), ids);
        res = inter.length ? stock.filter(p => inter.includes(p.numero_serie)) : sets.flat().filter((p,i,a) => a.findIndex(x=>x.numero_serie===p.numero_serie)===i);
      }
    }
    await clearSession();
    if (!res.length) {
      await tgSend(chatId, 'No entendí ese mensaje. Usá el menú 👇', mainMenu(rol));
    } else if (res.length === 1) {
      await showProdDetail(res[0]);
    } else {
      await showProdList(res, text);
    }
  }
}

// ── Express ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/health', (req, res) =>
  res.json({ ok: true, cacheReady, users: cache.usuarios.length, stock: cache.stock.length, movs: cache.movimientos.length })
);

app.get('/stock-report', async (req, res) => {
  if (!cacheReady) await refreshCache();
  const lowStock = cache.stock.filter(p => {
    if (!p.numero_serie) return false;
    const actual = parseInt(p.stock_actual || 0);
    const minimo = parseInt(p.stock_minimo || 0);
    return actual <= minimo;
  });
  res.json({ lowStock, total: cache.stock.length, fecha: now() });
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    if (!cacheReady) await refreshCache();
    await processUpdate(req.body);
  } catch (e) { console.error('[webhook] error:', e.message); }
});

app.listen(PORT, async () => {
  console.log(`Bot bicicletería en puerto ${PORT} — v2026-04-02`);
  await refreshCache();
  setInterval(refreshCache, 20 * 1000); // refrescar cache cada 20s
});

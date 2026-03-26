'use strict';
const express = require('express');
const axios   = require('axios');
const FormData = require('form-data');
const crypto  = require('crypto');

// ── Constantes ─────────────────────────────────────────────────────────────────
const PORT      = process.env.PORT || 3000;
const BOT_TOKEN = '8794560347:AAFLk7ZT6ktdnUex2RvZHYaXZuNhJ8eVVqY';
const TG        = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_ID  = '5307233657';
const GROQ_KEY  = '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';
const SHEET_ID  = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const SA = {
  client_email: 'bot-bicicleteria@n8n-bicicleteria.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDKSu4lhbVeHpZX\nakycBHWHC0X+cuVuLV1fuPP03n/drRgKTLGXEHB+GcC3Q6wOUjXrI3RoWbjTpyDj\nArIW0gUEGfs7/ljbwM6Dx8/oJS4Z+oq2Sf1hnYTZaQ2Xqz03ARbUagyu5LgJw0qR\nBCDm9RaUtTqa6d/2dk/13lCLmvGb1R6eMduXX2StNoATWfZjJZxu77WiJHVuuhx/\npTsNlZO2XfDIGeEXBSRG0c4CoBIKea9H2C6CTluMz7MxGzyk6rITZVH/cK6ngb0q\ndXwN6YViXC2cA4ajf0oGO4IX58VOKNEPEbnYdBlAz5Nqpk8Q3FihF/EqpIVCA6hD\n/DhHQpHLAgMBAAECggEANmRmWy10Ak4cI34AAlVKmpiD5fJT0UeeWy4aXmVzIRI5\nLA/KEnHHpYhcIoquGR2uxL5APwyc30AJXjCr3On0klFAFbYCg3f4r0NLGkLg/fg5\nUuFbIWOexGx0TKss5vzCfDPVnDMAbxOVGZ/wDtmojCyciOnIn/bY8iWoJ5luTHVL\nGjsS+mOTzCYbNTIIoqhcs0Fmws3Val/Yd2q8u4ucqa6Cve1KMjTnXSrEAapL+W3B\ngSEcQc/eK36jES9t0a2FPY/dry4A06LvKZGdAlu/ptoyVzoggzH7Jr57TaPMkE8b\nR+6iWZQG+ZwuE0Bv/As5xyegLaWZzta0kCdxvrR09QKBgQD3hvGvdGJWV65UUg3E\nQX50tENx19tBjIA6XwfyK+9DFD+6FwcbKDKPfv6t7BptHHUFaJbEoR3Woq72yHZe\nj9R8ILwy/5RqmGshCEH+5O2fatzU9Qwf2xHvPysab3eecSELNRU7m6MeCWfykkW9\nT3tWGed2XowwyqOCoYWG2GtTxQKBgQDRN5nvovZXa3LH7G1I/sszU+51xuvheOV8\npcW8I+I9HkioTnkrgOAc2nKFVSOq2LXB3cPHlaENE9b4e8FZWTHqj/rI9ziRSyCm\nxmzzvi/itC998E2A9QjaqWdhsUxq/yzeOJ77PtKsSuunRlR6l1rAQv2OIw3IkpfR\nkJguUXhYTwKBgGOjeXRkSBVzlCQzJ4GBz7KQwbl457SaJx/YEy3Dy7tX0lNJY73l\nz3x95W0DZpvXYa+8qzwZkxZMRFvo0+U6xpD06G0q/oZuNmmElnRRmOmcLaq3vZqx\nJ6YD6ojop+Eqrt+BDbwB6YZ0yNgXU2ViMka1hLvcUVhuqaUy+boPMhz1AoGAXfKe\n0GoYPpdEWpxDUtT/gFP/L6ocwAne20NBcMOYUyOnMtTSOoPLn4lEhbT+qDhaHe0s\nfhIl2M6A6OIBp9KSxKbU0auaHjxjNCDESgusSxvoe6AN3Yuq5y3M+6R3EVD23+8D\nDQVf6vhVq668PrR6jv1GCK6bAOc6/2Lzw1DYPqcCgYAk3YiUnRTDWd1/HzUZk736\nrbqbg6cjUueXpUD6xptM8y+XGAxaCEvY0OK39RzovIGdXpbUj0zB1bWY7xmJRk2P\nIdLiZEzjRv3mMIkQq0JBL6NM8hH90K10tN1pHoBm7MKJjt0ZatP40Z4xliV/XHL/\nLepE03P0AeXncVlp7qjhyQ==\n-----END PRIVATE KEY-----\n'
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

// ── Headers de cada hoja ───────────────────────────────────────────────────────
const HEADERS = {
  SESIONES:               ['telegram_id','estado','datos','ts'],
  USUARIOS:               ['telegram_id','nombre','rol','activo','fecha_alta'],
  MOVIMIENTOS_PENDIENTES: ['id_movimiento','tipo','estado','id_producto','numero_serie','cantidad','descripcion_movimiento','referencia_doc','hash_duplicado','telegram_id_operador','nombre_operador','telegram_id_aprobador','nombre_aprobador','fecha_creacion','fecha_aprobacion','motivo_rechazo','notas_aprobador'],
  STOCK:                  ['id_producto','tipo','marca','modelo','numero_serie','descripcion','ubicacion','stock_actual','stock_minimo','estado_unidad','precio_costo','precio_venta','rodado','fecha_ingreso','ultima_actualizacion'],
  HISTORIAL:              ['id_movimiento','tipo','estado','id_producto','cantidad','referencia_doc','telegram_id_operador','nombre_operador','telegram_id_aprobador','nombre_aprobador','fecha_creacion','fecha_aprobacion','motivo_rechazo','notas_aprobador'],
  FACTURAS:               ['id_factura','nombre','domicilio','dni_cuit','tipo','descripcion_producto','precio_venta','fecha','factura_realizada'],
  COMPRAS:                ['fecha','tipo','marca','modelo','descripcion','cantidad','precio_unitario','rodado','ubicacion','estado']
};

const CACHE_KEY = {
  USUARIOS: 'usuarios', SESIONES: 'sesiones',
  STOCK: 'stock', MOVIMIENTOS_PENDIENTES: 'movimientos', FACTURAS: 'facturas'
};

// ── Cache en memoria ───────────────────────────────────────────────────────────
const cache = { usuarios: [], sesiones: [], stock: [], movimientos: [], facturas: [] };
let cacheReady = false;

async function loadSheet(name) {
  const token = await getToken();
  const r = await axios.get(`${SHEETS_BASE}/${SHEET_ID}/values/${name}!A:Z`,
    { headers: { Authorization: `Bearer ${token}` } });
  const rows = r.data.values || [];
  if (rows.length < 2) return [];
  const hdrs = rows[0];
  return rows.slice(1).map((row, idx) => {
    const obj = { _rowNum: idx + 2 };
    hdrs.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

async function refreshCache() {
  try {
    const [usuarios, sesiones, stock, movimientos, facturas] = await Promise.all([
      loadSheet('USUARIOS'), loadSheet('SESIONES'), loadSheet('STOCK'),
      loadSheet('MOVIMIENTOS_PENDIENTES'), loadSheet('FACTURAS')
    ]);
    cache.usuarios    = usuarios;
    cache.sesiones    = sesiones;
    cache.stock       = stock;
    cache.movimientos = movimientos;
    cache.facturas    = facturas;
    cacheReady = true;
    console.log(`[cache] users:${usuarios.length} stock:${stock.length} movs:${movimientos.length} facts:${facturas.length}`);
  } catch (e) { console.error('[cache] refresh error:', e.message); }
}

async function appendRow(sheetName, data) {
  // Actualizar caché inmediatamente
  const ck = CACHE_KEY[sheetName];
  if (ck) {
    const maxRow = cache[ck].reduce((m, r) => Math.max(m, r._rowNum || 1), 1);
    cache[ck].push({ ...data, _rowNum: maxRow + 1 });
  }
  // Escribir a Google Sheets en segundo plano
  getToken().then(token => {
    const values = [HEADERS[sheetName].map(h => String(data[h] ?? ''))];
    return axios.post(
      `${SHEETS_BASE}/${SHEET_ID}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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

// ── Fuzzy search ───────────────────────────────────────────────────────────────
function norm(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
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
  return t.split(/\s+/).some(w => levenshtein(q,w) <= Math.max(1, Math.floor(q.length/4)));
}

// ── Menú principal ─────────────────────────────────────────────────────────────
function mainMenu(rol, movPend, factPend) {
  const kb = [[{ text: '📦 Consultar Stock', callback_data: 'stock' }]];
  if (['operador','aprobador','administrador'].includes(rol)) {
    kb.push([{ text: '🔄 Transferir Producto', callback_data: 'transf2' }]);
    kb.push([{ text: '📋 Registrar Movimiento', callback_data: 'movimiento' }]);
  }
  if (['aprobador','administrador'].includes(rol)) {
    const n = movPend.length + factPend.length;
    kb.push([{ text: `✅ Pendientes${n > 0 ? ' ('+n+')' : ''}`, callback_data: 'pendientes' }]);
  }
  if (rol === 'administrador') kb.push([{ text: '⚙️ Panel Admin', callback_data: 'admin' }]);
  return kb;
}

// ── Procesar update de Telegram ────────────────────────────────────────────────
async function processUpdate(update) {
  const usuarios    = cache.usuarios.filter(u => u.telegram_id);
  const sesiones    = cache.sesiones.filter(s => s.telegram_id);
  const stock       = cache.stock.filter(s => s.id_producto);
  const movPend     = cache.movimientos.filter(m => m.id_movimiento && m.estado === 'pendiente');
  const factPend    = cache.facturas.filter(f => f.id_factura && f.factura_realizada === 'NO');

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
        { headers: { Authorization: `Bearer ${GROQ_KEY}`, ...fd.getHeaders() } });
      text = tr.data?.text || '';
      if (!text) { await tgSend(chatId, '❌ No entendí el audio. Intentá escribir.'); return; }
      await tgSend(chatId, `🎤 Entendí: <i>"${text}"</i>`);
    } catch (e) { await tgSend(chatId, '❌ Error al transcribir: ' + e.message); return; }
  }

  const findUser  = uid => usuarios.find(u => String(u.telegram_id) === String(uid)) || null;
  const findSesion= uid => sesiones.find(s => String(s.telegram_id) === String(uid)) || null;
  const findProd  = q => {
    return stock.filter(p =>
      fuzzy(q, p.id_producto||'') || fuzzy(q, p.marca||'') ||
      fuzzy(q, p.modelo||'')      || fuzzy(q, p.descripcion||'')
    );
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
  if (text === '/start' || cb === 'main_menu') {
    await clearSession();
    await tgSend(chatId, `Hola <b>${user.nombre}</b> (${rol}) 👋\n¿Qué querés hacer?`, mainMenu(rol, movPend, factPend));
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
    } else {
      let msg = `📦 <b>Resultados para "${text}":</b>\n\n`;
      for (const p of res) {
        const stk = p.tipo === 'accesorio' ? `Stock: ${p.stock_actual}` : `Estado: ${p.estado_unidad || 'disponible'}`;
        msg += `<b>${p.marca} ${p.modelo}</b> (${p.id_producto})\n${p.descripcion || ''} | ${p.ubicacion || 'local'}\n${stk} | $${p.precio_venta || '-'}\n\n`;
      }
      await tgSend(chatId, msg.trim(), [[{ text: '🔍 Nueva búsqueda', callback_data: 'stock' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
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
      '<code>tipo, marca, modelo, descripcion, precio, stock_minimo, rodado, cantidad, referencia</code>\n\n' +
      'El código se genera automático (B01, C01, A01...)\n\n' +
      '<i>Ejemplo bici:</i>\n<code>bicicleta, Giant, Talon 29, MTB aluminio, 280000, 1, 29, 2, Compra proveedor ABC</code>\n\n' +
      '<i>Ejemplo accesorio (rodado vacío):</i>\n<code>accesorio, Shimano, Cadena XT, Cadena 11v, 8000, 5, , 10, Proveedor XYZ</code>',
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_NUEVO' && text) {
    const p = text.split(',').map(x => x.trim());
    if (p.length < 7) { await tgSend(chatId, 'Faltan datos. Necesito al menos 9 campos separados por coma.'); return; }
    const [tipo, marca, modelo, desc, precio, stMin, rodado, cantidad, ...refParts] = p;
    const referencia = refParts.join(',').trim() || 'Sin referencia';
    const cant = parseInt(cantidad);
    if (isNaN(cant) || cant <= 0) { await tgSend(chatId, 'La cantidad debe ser un número mayor a 0.'); return; }
    const prefix = tipo.toLowerCase() === 'bicicleta' ? 'B' : tipo.toLowerCase() === 'cuadro' ? 'C' : tipo.toLowerCase() === 'accesorio' ? 'A' : 'P';
    const existentes = stock.filter(s => (s.id_producto||'').toUpperCase().startsWith(prefix)).map(s => parseInt((s.id_producto||'').slice(prefix.length))).filter(n => !isNaN(n));
    const siguiente = existentes.length ? Math.max(...existentes) + 1 : 1;
    const id = prefix + String(siguiente).padStart(2, '0');
    await saveSession('MOV_NUEVO_CONF', { id, tipo, marca, modelo, desc, precio: precio||'0', stMin: stMin||'1', rodado: rodado||'', cantidad: cant, referencia });
    await tgSend(chatId,
      `📦 <b>Confirmar:</b>\nCódigo asignado: <b>${id}</b>\nTipo: ${tipo} | ${marca} ${modelo}${rodado ? '\nRodado: '+rodado : ''}\nDescripción: ${desc}\nPrecio: $${precio||'0'} | Stock mín: ${stMin||'1'}\n\n📥 Entrada: ${cant} unidades\nRef: ${referencia}`,
      [[{ text: '✅ Confirmar', callback_data: 'movnew_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'movnew_ok' && estado === 'MOV_NUEVO_CONF') {
    const d = datos; const t = now(); const movId = `MOV-${Date.now()}`;
    await appendRow('STOCK', { id_producto: d.id, tipo: d.tipo, marca: d.marca, modelo: d.modelo, numero_serie: '', descripcion: d.desc, ubicacion: 'local', stock_actual: '0', stock_minimo: d.stMin, estado_unidad: 'disponible', precio_costo: '0', precio_venta: d.precio, rodado: d.rodado, fecha_ingreso: t, ultima_actualizacion: t });
    await appendRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, tipo: 'entrada', estado: 'pendiente', id_producto: d.id, numero_serie: '', cantidad: d.cantidad, descripcion_movimiento: `entrada ${d.cantidad}u ${d.id}`, referencia_doc: d.referencia, hash_duplicado: `${d.id}-entrada-${d.cantidad}-${d.referencia}`, telegram_id_operador: userId, nombre_operador: user.nombre, telegram_id_aprobador: '', nombre_aprobador: '', fecha_creacion: t, fecha_aprobacion: '', motivo_rechazo: '', notas_aprobador: '' });
    await clearSession();
    await tgSend(chatId, `✅ Producto <b>${d.id}</b> creado y movimiento <b>${movId}</b> enviado para aprobación.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    for (const u of usuarios)
      if (['aprobador','administrador'].includes(u.rol) && String(u.telegram_id) !== userId && u.activo === 'TRUE')
        await tgSend(u.telegram_id, `⚠️ Nuevo producto + entrada de ${user.nombre}:\nProducto: ${d.id} ${d.marca} ${d.modelo}\nCantidad: ${d.cantidad}\nRef: ${d.referencia}`, [[{ text: '✅ Ver pendientes', callback_data: 'pendientes' }]]);
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
    await tgSend(chatId, '🔄 <b>Transferencia</b>\nID del producto a transferir:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_TRANSF_PROD' && text) {
    const p = stock.find(p => (p.id_producto||'').toUpperCase() === text.trim().toUpperCase());
    if (!p) { await tgSend(chatId, `Producto "${text}" no encontrado.`); return; }
    await saveSession('MOV_TRANSF_DEST', { id_producto: p.id_producto, marca: p.marca, modelo: p.modelo, ubic_actual: p.ubicacion || 'sin ubicación' });
    await tgSend(chatId, `Producto: <b>${p.marca} ${p.modelo}</b>\nUbicación actual: ${p.ubicacion || 'sin ubicación'}\n\n¿A dónde lo transferís?`,
      [[{ text: '🏪 Local', callback_data: 'transf_local' }, { text: '🏭 Galpón', callback_data: 'transf_galpon' }],
       [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if ((cb === 'transf_local' || cb === 'transf_galpon') && estado === 'MOV_TRANSF_DEST') {
    const destino = cb === 'transf_local' ? 'local' : 'galpon';
    await saveSession('MOV_TRANSF_CONF', { ...datos, destino });
    await tgSend(chatId, `🔄 <b>Confirmar transferencia:</b>\nProducto: ${datos.id_producto} - ${datos.marca} ${datos.modelo}\nDe: ${datos.ubic_actual} → A: ${destino}`,
      [[{ text: '✅ Confirmar', callback_data: 'transf_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'transf_ok' && estado === 'MOV_TRANSF_CONF') {
    await upsertRow('STOCK', { id_producto: datos.id_producto, ubicacion: datos.destino, ultima_actualizacion: now() }, 'id_producto');
    await clearSession();
    await tgSend(chatId, `✅ <b>${datos.marca} ${datos.modelo}</b> transferido a <b>${datos.destino}</b>.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }
  if ((cb === 'mov_e' || cb === 'mov_s') && estado === 'MOV_TIPO') {
    await saveSession('MOV_PROD', { tipo: cb === 'mov_e' ? 'entrada' : 'salida' });
    await tgSend(chatId, 'ID del producto:', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'MOV_PROD' && text) {
    const p = stock.find(p => (p.id_producto||'').toUpperCase() === text.trim().toUpperCase());
    if (!p) { await tgSend(chatId, `Producto "${text}" no encontrado.`); return; }
    await saveSession('MOV_CANT', { ...datos, id_producto: p.id_producto, marca: p.marca, modelo: p.modelo });
    await tgSend(chatId, `Producto: <b>${p.marca} ${p.modelo}</b>\nCantidad:`, [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
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
    await appendRow('MOVIMIENTOS_PENDIENTES', { id_movimiento: movId, tipo: d.tipo, estado: 'pendiente', id_producto: d.id_producto, numero_serie: '', cantidad: d.cantidad, descripcion_movimiento: `${d.tipo} ${d.cantidad}u ${d.id_producto}`, referencia_doc: d.referencia, hash_duplicado: `${d.id_producto}-${d.tipo}-${d.cantidad}-${d.referencia}`, telegram_id_operador: userId, nombre_operador: user.nombre, telegram_id_aprobador: '', nombre_aprobador: '', fecha_creacion: now(), fecha_aprobacion: '', motivo_rechazo: '', notas_aprobador: '' });
    await clearSession();
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
    await appendRow('HISTORIAL', { id_movimiento: movId, tipo: mov.tipo, estado: 'aprobado', id_producto: mov.id_producto, cantidad: mov.cantidad, referencia_doc: mov.referencia_doc, telegram_id_operador: mov.telegram_id_operador, nombre_operador: mov.nombre_operador, telegram_id_aprobador: userId, nombre_aprobador: user.nombre, fecha_creacion: mov.fecha_creacion, fecha_aprobacion: fechaApr, motivo_rechazo: '', notas_aprobador: '' });
    const prod = cache.stock.find(p => p.id_producto === mov.id_producto);
    if (prod) {
      let nuevoStock = parseInt(prod.stock_actual || 0);
      if (mov.tipo === 'entrada') nuevoStock += parseInt(mov.cantidad || 0);
      else if (mov.tipo === 'salida') nuevoStock -= parseInt(mov.cantidad || 0);
      if (nuevoStock < 0) nuevoStock = 0;
      await upsertRow('STOCK', { id_producto: mov.id_producto, stock_actual: String(nuevoStock), ultima_actualizacion: fechaApr }, 'id_producto');
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
      '<code>Nombre, Domicilio, DNI/CUIT, Tipo (A o B), Descripción, Precio</code>\n\n' +
      '<i>Ejemplo:</i>\n<code>Juan García, Av. Corrientes 123, 20-12345678-9, B, Trek Mountain Pro 29, 150000</code>',
      [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'FACT_DATA' && text) {
    const p = text.split(',').map(x => x.trim());
    if (p.length < 6) { await tgSend(chatId, 'Faltan datos. Mandá los 6 campos separados por coma:\n<code>Nombre, Domicilio, DNI/CUIT, Tipo, Descripción, Precio</code>'); return; }
    const [nombre, domicilio, dni_cuit, tipo, descripcion, precioRaw] = p;
    const precio     = (precioRaw||'0').trim().replace(/\./g,'').replace(',','.');
    const tipoUpper  = (tipo||'').toUpperCase();
    if (!['A','B'].includes(tipoUpper)) { await tgSend(chatId, 'El tipo debe ser A o B. Reintentá.'); return; }
    await saveSession('FACT_CONF', { nombre, domicilio, dni_cuit, tipo: tipoUpper, descripcion, precio });
    await tgSend(chatId, `🧾 <b>Confirmar datos:</b>\nCliente: ${nombre}\nDomicilio: ${domicilio}\nDNI/CUIT: ${dni_cuit}\nTipo: ${tipoUpper}\nDescripción: ${descripcion}\nPrecio: $${precio}`,
      [[{ text: '✅ Confirmar', callback_data: 'fact_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'fact_ok' && estado === 'FACT_CONF') {
    const d = datos;
    await appendRow('FACTURAS', { id_factura: `FAC-${Date.now()}`, nombre: d.nombre, domicilio: d.domicilio, dni_cuit: d.dni_cuit, tipo: d.tipo, descripcion_producto: d.descripcion, precio_venta: d.precio, fecha: now(), factura_realizada: 'NO' });
    await clearSession();
    await tgSend(chatId, '✅ Datos de factura guardados. Revisá la hoja FACTURAS en Google Sheets.', [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // ── Panel Admin ────────────────────────────────────────────────────────────
  if (cb === 'admin' && rol === 'administrador') {
    await tgSend(chatId, '⚙️ <b>Panel Admin:</b>',
      [[{ text: '👤 Agregar Usuario', callback_data: 'adm_user' }],
       [{ text: '🧾 Cargar Datos Factura', callback_data: 'factura' }],
       [{ text: '📷 Carga por Factura (OCR)', callback_data: 'fact_prov' }],
       [{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
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
    if (findUser(nId)) { await tgSend(chatId, `Ya existe ID ${nId}.`); await clearSession(); return; }
    await appendRow('USUARIOS', { telegram_id: nId, nombre: nNombre, rol: nRol, activo: 'TRUE', fecha_alta: now() });
    await clearSession();
    await tgSend(chatId, `✅ Usuario ${nNombre} (${nRol}) agregado.`, [[{ text: '⚙️ Admin', callback_data: 'admin' }]]);
    return;
  }

  // ── OCR: Carga por factura de proveedor ───────────────────────────────────
  if (cb === 'fact_prov' && rol === 'administrador') {
    await saveSession('FACT_PROV_WAIT', {});
    await tgSend(chatId, '📷 <b>Carga por factura de proveedor</b>\nMandame una foto o PDF de la factura. La IA detectará los productos automáticamente.', [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
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
    const ocrPrompt = 'Analizá esta factura de proveedor. Extraé TODOS los productos/artículos. Devolvé SOLO un JSON array sin markdown ni texto extra: [{"tipo":"bicicleta","marca":"","modelo":"","descripcion":"","cantidad":1,"precio_unitario":"0","rodado":""}]. Tipos: bicicleta, cuadro, accesorio, otro. rodado: número para bicis/cuadros (ej 26, 29), vacío para accesorios.';
    let rawText = '[]';
    try {
      const groqBody = { model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: fileUrl } }, { type: 'text', text: ocrPrompt }] }], max_tokens: 1000 };
      const groqResp = await axios.post('https://api.groq.com/openai/v1/chat/completions', groqBody, { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
      rawText = groqResp.data.choices?.[0]?.message?.content || '[]';
    } catch (e) { await tgSend(chatId, '❌ Error IA: ' + e.message); await clearSession(); return; }
    let productos = [];
    try { const s = rawText.indexOf('['); const e = rawText.lastIndexOf(']'); if (s !== -1 && e !== -1) productos = JSON.parse(rawText.slice(s, e+1)); } catch {}
    if (!productos.length) { await tgSend(chatId, '❌ No pude detectar productos. Intentá con una foto más nítida.'); await clearSession(); return; }
    let resumen = `📦 <b>Detecté ${productos.length} producto(s):</b>\n\n`;
    productos.forEach((p, i) => { resumen += `${i+1}. <b>${p.marca} ${p.modelo}</b> (${p.tipo})${p.rodado ? ' R'+p.rodado : ''}\n   ${p.descripcion}\n   ${p.cantidad}u × $${p.precio_unitario}\n\n`; });
    resumen += '¿Dónde ingresan estos productos?';
    await saveSession('FACT_PROV_UBIC', { productos });
    await tgSend(chatId, resumen, [[{ text: '🏪 Local', callback_data: 'fprov_local' }, { text: '🏭 Galpón', callback_data: 'fprov_galpon' }], [{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (estado === 'FACT_PROV_WAIT' && text && !cb) { await tgSend(chatId, '📷 Necesito una foto o PDF de la factura. Por favor enviá el archivo.'); return; }
  if ((cb === 'fprov_local' || cb === 'fprov_galpon') && estado === 'FACT_PROV_UBIC') {
    const ubicacion = cb === 'fprov_local' ? 'local' : 'galpon';
    const { productos } = datos;
    await saveSession('FACT_PROV_CONF', { productos, ubicacion });
    let conf = `✅ <b>Confirmar carga en ${ubicacion}:</b>\n\n`;
    productos.forEach((p, i) => { conf += `${i+1}. ${p.marca} ${p.modelo} × ${p.cantidad}\n`; });
    conf += '\n¿Guardamos en la hoja de Compras para revisión?';
    await tgSend(chatId, conf, [[{ text: '✅ Guardar en Compras', callback_data: 'fprov_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 'fprov_ok' && estado === 'FACT_PROV_CONF') {
    const { productos, ubicacion } = datos; const t = now();
    for (const p of productos)
      await appendRow('COMPRAS', { fecha: t, tipo: p.tipo, marca: p.marca||'', modelo: p.modelo||'', descripcion: p.descripcion||'', cantidad: String(p.cantidad||1), precio_unitario: p.precio_unitario||'0', rodado: p.rodado||'', ubicacion, estado: 'pendiente' });
    await clearSession();
    await tgSend(chatId, `✅ <b>${productos.length} producto(s)</b> guardados en la hoja <b>COMPRAS</b>. Revisalos y pasalos al stock cuando quieras.`, [[{ text: '🏠 Menú', callback_data: 'main_menu' }]]);
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
      (fuzzy(text, p.marca||'') || fuzzy(text, p.modelo||'') || fuzzy(text, p.id_producto||'') || fuzzy(text, p.descripcion||''))
    );
    if (!resultados.length) {
      await tgSend(chatId, `❌ No encontré "${text}" en ${origen}. Intentá con otro nombre:`,
        [[{ text: '❌ Cancelar', callback_data: 'main_menu' }]]);
      return;
    }
    if (resultados.length === 1) {
      const p = resultados[0];
      await saveSession('TRANSF2_CONF', { ...datos, id_producto: p.id_producto, marca: p.marca, modelo: p.modelo, rodado: p.rodado||'' });
      await tgSend(chatId,
        `🔄 <b>Confirmar transferencia:</b>\n📦 ${p.marca} ${p.modelo}${p.rodado ? ' R'+p.rodado : ''} (${p.id_producto})\n📍 ${origen} → ${destino}`,
        [[{ text: '✅ Confirmar', callback_data: 't2_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
      return;
    }
    // Múltiples resultados — mostrar botones
    await saveSession('TRANSF2_PICK', { ...datos });
    const kb = resultados.slice(0, 8).map(p => ([{
      text: `${p.marca} ${p.modelo}${p.rodado ? ' R'+p.rodado : ''} (${p.ubicacion})`,
      callback_data: `t2_pick_${p.id_producto}`
    }]));
    kb.push([{ text: '❌ Cancelar', callback_data: 'main_menu' }]);
    await tgSend(chatId, `🔍 Encontré ${resultados.length} coincidencias. ¿Cuál es?`, kb);
    return;
  }
  if (cb.startsWith('t2_pick_') && estado === 'TRANSF2_PICK') {
    const id = cb.slice(8);
    const p = cache.stock.find(p => p.id_producto === id);
    if (!p) { await tgSend(chatId, '❌ Producto no encontrado.'); return; }
    const { origen, destino } = datos;
    await saveSession('TRANSF2_CONF', { ...datos, id_producto: p.id_producto, marca: p.marca, modelo: p.modelo, rodado: p.rodado||'' });
    await tgSend(chatId,
      `🔄 <b>Confirmar transferencia:</b>\n📦 ${p.marca} ${p.modelo}${p.rodado ? ' R'+p.rodado : ''} (${p.id_producto})\n📍 ${origen} → ${destino}`,
      [[{ text: '✅ Confirmar', callback_data: 't2_ok' }, { text: '❌ Cancelar', callback_data: 'main_menu' }]]);
    return;
  }
  if (cb === 't2_ok' && estado === 'TRANSF2_CONF') {
    const { id_producto, marca, modelo, rodado, destino } = datos;
    await upsertRow('STOCK', { id_producto, ubicacion: destino, ultima_actualizacion: now() }, 'id_producto');
    await clearSession();
    await tgSend(chatId,
      `✅ <b>${marca} ${modelo}${rodado ? ' R'+rodado : ''}</b> transferido a <b>${destino}</b>.`,
      [[{ text: '🔄 Otra transferencia', callback_data: 'transf2' }, { text: '🏠 Menú', callback_data: 'main_menu' }]]);
    return;
  }

  // Fallback
  if (text && !cb) { await tgSend(chatId, 'No entendí ese mensaje. Usá el menú 👇', mainMenu(rol, movPend, factPend)); await clearSession(); }
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
    if (!p.id_producto) return false;
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
  console.log(`Bot bicicletería en puerto ${PORT}`);
  await refreshCache();
  setInterval(refreshCache, 5 * 60 * 1000); // refrescar cache cada 5 min
});

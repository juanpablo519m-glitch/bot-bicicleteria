'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const { SHEET_ID, SHEETS_BASE, SA, GOOGLE_OAUTH, DRIVE_FOTOS, DRIVE_FACTURAS, RECARGO_PROVEEDOR, round5000, normCod } = require('./config');
const { norm, levenshtein } = require('./utils');

// ── Google Auth (JWT manual) ───────────────────────────────────────────────────
const _tokenCache = {};
async function getToken(scope = 'https://www.googleapis.com/auth/spreadsheets') {
  const cached = _tokenCache[scope];
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const cls = Buffer.from(JSON.stringify({
    iss: SA.client_email, scope,
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
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: TOPE_MS }
  );
  _tokenCache[scope] = { token: r.data.access_token, expiresAt: Date.now() + 3500000 };
  return _tokenCache[scope].token;
}

// ── Subir una foto al Drive de Juan Pablo ──────────────────────────────────────
// Antes pasaba por n8n; desde el 31/10/2026 sube el bot directo con el permiso de SU cuenta
// (ver GOOGLE_OAUTH en config.js: por qué cambió y por qué el permiso vive en las variables).
// Devuelve el link para ver el archivo, o null si no se pudo (el que llama ya contempla null:
// la foto se guarda igual con la referencia de Telegram).
let _oauthCache = null;
async function tokenUsuario() {
  if (_oauthCache && _oauthCache.expiresAt > Date.now() + 60000) return _oauthCache.token;
  const { client_id, client_secret, refresh_token } = GOOGLE_OAUTH;
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('falta el permiso de Google (GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH en las variables del servicio)');
  }
  const r = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: TOPE_MS });
  _oauthCache = { token: r.data.access_token, expiresAt: Date.now() + 3500000 };
  return _oauthCache.token;
}

async function uploadToDrive(fileUrl, fileName, mimeType) {
  try {
    const fileResp = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 60000 });
    const token = await tokenUsuario();
    const carpeta = String(fileName).startsWith('producto_') ? DRIVE_FOTOS : DRIVE_FACTURAS;
    const tipo = mimeType || 'image/jpeg';

    // subida multipart: primero los datos del archivo, después el archivo
    const lim = `bici${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name: fileName, parents: [carpeta] });
    const cuerpo = Buffer.concat([
      Buffer.from(`--${lim}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${lim}\r\nContent-Type: ${tipo}\r\n\r\n`),
      Buffer.from(fileResp.data),
      Buffer.from(`\r\n--${lim}--`),
    ]);
    const up = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      cuerpo,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${lim}` }, timeout: 60000, maxBodyLength: Infinity });

    // que se pueda ver con el link, como hacía n8n (si esto falla, el archivo igual quedó subido)
    try {
      await axios.post(`https://www.googleapis.com/drive/v3/files/${up.data.id}/permissions`,
        { role: 'reader', type: 'anyone' }, { headers: { Authorization: `Bearer ${token}` }, timeout: TOPE_MS });
    } catch (e) { console.error('[drive upload] subió pero no pude darle link público:', e.message); }

    return up.data.webViewLink || `https://drive.google.com/file/d/${up.data.id}/view`;
  } catch (e) {
    console.error('[drive upload]', e.response?.data?.error?.message || e.response?.data?.error_description || e.message);
    return null;
  }
}

// Prefija con ' valores que Sheets (locale es_AR) confundiría como fechas (ej: 27.5 → 27 de mayo)
// o como fórmulas: un texto que empieza con =, + o @ (ej: el teléfono +54 9 11... quedaba como número o #ERROR!)
const _DATE_LIKE = /^\d{1,2}[./]\d{1,2}$/;
const _FORMULA_LIKE = /^[=+@]/;
function safeVal(v) {
  const s = String(v ?? '');
  return _DATE_LIKE.test(s) || _FORMULA_LIKE.test(s) ? `'${s}` : s;
}

// ── Escrituras en orden ────────────────────────────────────────────────────────
// Las escrituras van en segundo plano (el usuario no las espera), pero de a una por hoja: si salían dos
// juntas, las dos leían la misma "primera fila libre" y la segunda pisaba a la primera (se perdían productos
// de COMPRAS, ventas y filas de HISTORIAL). Cada pedido tiene tope de tiempo: uno colgado no frena la cola.
const TOPE_MS = 20000;
const _colas = {};
const _gen = {};   // cuantas escrituras entraron a la cola de cada hoja (la recarga lo usa para no pisar el cache)
function encolar(hoja, trabajo) {
  _gen[hoja] = (_gen[hoja] || 0) + 1;
  const p = (_colas[hoja] || Promise.resolve()).then(trabajo);
  _colas[hoja] = p.catch(() => {});
  return p;
}
const escriturasPendientes = () => Promise.all(Object.values(_colas));
const opciones = token => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: TOPE_MS });
const colLetra = i => String.fromCharCode(65 + i);   // 0 -> A (ninguna hoja pasa de 26 columnas)

// ── Headers de cada hoja ───────────────────────────────────────────────────────
const HEADERS = {
  SESIONES:               ['telegram_id','estado','datos','ts'],
  USUARIOS:               ['telegram_id','nombre','rol','activo','fecha_alta'],
  MOVIMIENTOS_PENDIENTES: ['id_movimiento','tipo','estado','id_producto','numero_serie','cantidad','descripcion_movimiento','referencia_doc','hash_duplicado','telegram_id_operador','nombre_operador','telegram_id_aprobador','nombre_aprobador','fecha_creacion','fecha_aprobacion','motivo_rechazo','notas_aprobador'],
  STOCK:                  ['tipo','marca','modelo','numero_serie','ubicacion','stock_actual','stock_minimo','estado_unidad','precio_costo','precio_max','precio_min','rodado','talle','fecha_ingreso','ultima_actualizacion','ficha_tecnica','foto_url','color','codigo_proveedor'],
  HISTORIAL:              ['id_movimiento','tipo','estado','id_producto','cantidad','referencia_doc','telegram_id_operador','nombre_operador','telegram_id_aprobador','nombre_aprobador','fecha_creacion','fecha_aprobacion','motivo_rechazo','notas_aprobador'],
  FACTURAS:               ['id_factura','nombre','domicilio','dni_cuit','tipo','descripcion_producto','precio_venta','fecha','forma_pago','numero_serie','mail','telefono','factura_realizada'],
  VENTAS_ACCESORIOS:      ['fecha','nombre','descripcion','precio','forma_pago','operador','factura_realizada'],
  VENTAS_BICICLETAS:      ['fecha','nombre','descripcion','precio','forma_pago','operador','factura_realizada'],
  COMPRAS:                ['fecha','tipo','marca','modelo','cantidad','precio_unitario','rodado','talle','ubicacion','foto_drive','codigo_proveedor','estado','color'],
};

const CACHE_KEY = {
  USUARIOS: 'usuarios', SESIONES: 'sesiones',
  STOCK: 'stock', MOVIMIENTOS_PENDIENTES: 'movimientos', FACTURAS: 'facturas',
};

// ── Cache en memoria ───────────────────────────────────────────────────────────
const cache = { usuarios: [], sesiones: [], stock: [], movimientos: [], facturas: [], _catalogo: [] };
const state = { cacheReady: false, sesionesCargadas: false };

async function loadSheet(name) {
  const token = await getToken();
  // con tope: una lectura colgada dejaba la recarga "en curso" para siempre y el cache no se actualizaba mas
  const r = await axios.get(`${SHEETS_BASE}/${SHEET_ID}/values/${name}!A:Z?valueRenderOption=UNFORMATTED_VALUE`,
    opciones(token));
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
    // Esperar las escrituras en curso: si no, se recargaba la planilla vieja y por unos segundos el bot
    // "olvidaba" una venta o una aprobación recién hecha (y podía vender dos veces la misma bici).
    await escriturasPendientes();
    const genAntes = { ..._gen };
    // SESIONES se lee una sola vez (después manda el cache), pero hasta que cargue bien: si fallaba en el
    // primer intento no se volvía a leer nunca y cada usuario terminaba con una fila duplicada.
    const [rUsuarios, rSesiones, rStock, rMovimientos, rFacturas, rCatalogo] = await Promise.allSettled([
      loadSheet('USUARIOS'), state.sesionesCargadas ? null : loadSheet('SESIONES'), loadSheet('STOCK'),
      loadSheet('MOVIMIENTOS_PENDIENTES'), loadSheet('FACTURAS'), loadSheet('CATALOGO_PROVEEDORES'),
    ]);
    // Si mientras se leia entro una escritura a esa hoja, lo leido puede no tenerla todavia: se deja el cache
    // como esta (ya la tiene) y se relee en la proxima recarga. Si no, una venta recien hecha "volvia atras".
    const usar = (hoja, r) => {
      if (r.status === 'rejected') { console.error(`[cache] ${hoja} falló:`, r.reason?.message); return false; }
      if ((_gen[hoja] || 0) !== (genAntes[hoja] || 0)) { console.log(`[cache] ${hoja}: hubo una escritura durante la lectura, se relee en la próxima`); return false; }
      cache[CACHE_KEY[hoja]] = r.value;
      return true;
    };
    usar('USUARIOS', rUsuarios);
    if (!state.sesionesCargadas && usar('SESIONES', rSesiones)) state.sesionesCargadas = true;
    const stockNuevo = usar('STOCK', rStock);
    usar('MOVIMIENTOS_PENDIENTES', rMovimientos);
    usar('FACTURAS', rFacturas);
    if (rCatalogo.status    === 'fulfilled') cache._catalogo   = rCatalogo.value;
    else console.error('[cache] CATALOGO_PROVEEDORES falló:', rCatalogo.reason?.message);
    state.cacheReady = true;
    console.log(`[cache] users:${cache.usuarios.length} stock:${cache.stock.length} movs:${cache.movimientos.length} facts:${cache.facturas.length}`);
    // Auto-corregir estados inconsistentes. Solo filas con producto: antes escribia "vendido" en las filas
    // vacias (stock vacio = 0) y esas filas quedaban "ocupadas" con basura.
    if (stockNuevo) for (const p of cache.stock) {
      if (!(p.numero_serie || p.marca)) continue;
      const stk = Number(p.stock_actual) || 0;
      const estado = (p.estado_unidad || '').toLowerCase();
      let nuevoEstado = null;
      if (stk > 0 && estado === 'vendido') nuevoEstado = 'disponible';
      else if (stk === 0 && estado !== 'vendido') nuevoEstado = 'vendido';
      if (!nuevoEstado) continue;
      console.log(`[fix-estado] ${p.numero_serie} stock=${stk} → ${nuevoEstado}`);
      // Por la cola y buscando la fila real del producto (pudieron ordenar STOCK desde que se leyo)
      if (p.numero_serie) { upsertRow('STOCK', { numero_serie: p.numero_serie, estado_unidad: nuevoEstado }, 'numero_serie'); continue; }
      p.estado_unidad = nuevoEstado;
      const fila = p._rowNum;
      encolar('STOCK', async () => {
        const token = await getToken();
        await axios.put(`${SHEETS_BASE}/${SHEET_ID}/values/STOCK!H${fila}?valueInputOption=RAW`, { values: [[nuevoEstado]] }, opciones(token));
      }).catch(e => console.error('[fix-estado]', p.marca, e.message));
    }
  } catch (e) { console.error('[cache] refresh error:', e.message); }
  finally { _cacheRefreshing = false; }
}

// Una casilla destildada (FALSE) cuenta como vacia: hay hojas con casillas pre-cargadas hacia abajo.
const celdaVacia = c => c === '' || c == null || c === false || String(c).trim().toUpperCase() === 'FALSE';
const filaVacia = row => !row || row.every(celdaVacia);

// Primera fila sin NINGUN dato. Antes miraba solo la columna A y pisaba productos con el "tipo" vacio.
// Se llama siempre desde la cola de la hoja (dos a la vez veian la misma fila libre y una pisaba a la otra).
async function primeraFilaLibre(hoja, token) {
  const endCol = colLetra(HEADERS[hoja].length - 1);
  const r = await axios.get(`${SHEETS_BASE}/${SHEET_ID}/values/${hoja}!A:${endCol}?valueRenderOption=UNFORMATTED_VALUE`, opciones(token));
  const filas = r.data.values || [];
  for (let i = 1; i < filas.length; i++) if (filaVacia(filas[i])) return i + 1;
  return Math.max(filas.length, 1) + 1;
}
async function escribirFilaNueva(hoja, data, token) {
  const hdrs = HEADERS[hoja];
  const fila = await primeraFilaLibre(hoja, token);
  await axios.put(
    `${SHEETS_BASE}/${SHEET_ID}/values/${hoja}!A${fila}:${colLetra(hdrs.length - 1)}${fila}?valueInputOption=USER_ENTERED`,
    { values: [hdrs.map(h => safeVal(data[h]))] }, opciones(token)
  );
  return fila;
}

// Fila REAL de esa clave en este momento: alguien pudo ordenar o borrar filas a mano desde que se leyo el
// cache, y escribir en el numero viejo pisaba OTRO producto. null si ya no esta.
async function filaDeClave(hoja, col, clave, filaCache, token) {
  const c = colLetra(col);
  const r = await axios.get(`${SHEETS_BASE}/${SHEET_ID}/values/${hoja}!${c}:${c}?valueRenderOption=UNFORMATTED_VALUE`, opciones(token));
  const vals = (r.data.values || []).map(f => String((f && f[0]) ?? '').trim());
  if (filaCache > 1 && vals[filaCache - 1] === clave) return filaCache;
  const i = vals.findIndex((v, j) => j > 0 && v === clave);
  return i > 0 ? i + 1 : null;
}

async function appendRow(sheetName, data) {
  const ck = CACHE_KEY[sheetName];
  let enCache = null;
  if (ck) {
    // numero de fila provisorio: el real se sabe recien al escribir (puede caer en un hueco del medio)
    const maxRow = cache[ck].reduce((m, r) => Math.max(m, r._rowNum || 1), 1);
    enCache = { ...data, _rowNum: maxRow + 1 };
    cache[ck].push(enCache);
  }
  encolar(sheetName, async () => {
    const fila = await escribirFilaNueva(sheetName, data, await getToken());
    if (enCache) enCache._rowNum = fila;   // si no, un cambio posterior iba a la fila provisoria y la duplicaba
  }).catch(e => console.error('[bg append]', sheetName, e.message));
}

// Actualiza la fila de esa clave. Devuelve false si no hay tal fila (no escribe nada).
async function upsertRow(sheetName, data, keyField) {
  const hdrs  = HEADERS[sheetName];
  const col   = hdrs ? hdrs.indexOf(keyField) : -1;
  const clave = String(data[keyField] ?? '').trim();
  if (!clave || col < 0) { console.error(`[upsert] ${sheetName}: sin clave ${keyField}, no se escribe nada`); return false; }
  const ck  = CACHE_KEY[sheetName];
  const arr = ck ? cache[ck] : [];
  const esLaClave = r => String(r[keyField] ?? '').trim() === clave;
  let existing = sheetName === 'SESIONES' ? arr.find(r => esLaClave(r) && r.estado) : null;
  if (!existing) existing = arr.find(esLaClave);
  if (!existing) {
    // Solo una sesion nueva se agrega. En las otras hojas quedaba una fila suelta con dos o tres datos (basura).
    if (sheetName === 'SESIONES') { await appendRow(sheetName, data); return true; }
    console.error(`[upsert] ${sheetName}: no hay fila con ${keyField}=${clave}, no se crea una fila suelta`);
    return false;
  }
  // Mismo objeto (no una copia): si la fila todavia se esta agregando, la escritura de abajo ve su fila real
  Object.assign(existing, data);
  // Solo las celdas que cambian (null = Google no toca esa celda): antes se reescribia la fila entera con lo
  // que tenia el cache y se perdia lo editado a mano en la planilla (precio, ficha tecnica...).
  const values = [hdrs.map(h => (h !== keyField && Object.prototype.hasOwnProperty.call(data, h) ? safeVal(data[h]) : null))];
  encolar(sheetName, async () => {
    const token = await getToken();
    const fila  = await filaDeClave(sheetName, col, clave, existing._rowNum, token);
    if (!fila) {
      if (sheetName === 'SESIONES') { existing._rowNum = await escribirFilaNueva(sheetName, existing, token); return; }
      console.error(`[upsert] ${sheetName}: ${keyField}=${clave} ya no está en la planilla, no se escribe`);
      return;
    }
    existing._rowNum = fila;
    await axios.put(
      `${SHEETS_BASE}/${SHEET_ID}/values/${sheetName}!A${fila}:${colLetra(hdrs.length - 1)}${fila}?valueInputOption=USER_ENTERED`,
      { values }, opciones(token)
    );
  }).catch(e => console.error('[bg upsert]', sheetName, e.message));
  return true;
}

// ── Ordenar STOCK ──────────────────────────────────────────────────────────────
let _stockSheetId = null;
async function sortStock() {
  try {
    // Leer, ordenar y reescribir va en la cola de STOCK: una venta o un alta en el medio se perdia o caia en
    // otra fila. La recarga va despues y FUERA de la cola (adentro se quedaba esperandose a si misma).
    const ordenado = await encolar('STOCK', ordenarStock);
    if (!ordenado) return;
    await refreshCache();
    await rebuildVistaBicis();
  } catch (e) { console.error('[sort]', e.response?.data?.error?.message || e.message); }
}
async function ordenarStock() {
  const token = await getToken();
  const hdrs = HEADERS.STOCK;
  const endCol = String.fromCharCode(64 + hdrs.length);

  // Leer filas actuales del sheet
  const r = await axios.get(
    `${SHEETS_BASE}/${SHEET_ID}/values/STOCK!A2:${endCol}1000?valueRenderOption=UNFORMATTED_VALUE`,
    opciones(token)
  );
  const leidas = r.data.values || [];
  const rows = leidas.filter(row => row && row.some(c => c !== '' && c != null));
  if (!rows.length) return false;

  // Contar items por marca
  const marcaIdx = hdrs.indexOf('marca');
  const modeloIdx = hdrs.indexOf('modelo');
  const precioMaxIdx = hdrs.indexOf('precio_max');
  const brandCount = {};
  rows.forEach(row => {
    const m = String(row[marcaIdx] || '').toLowerCase();
    brandCount[m] = (brandCount[m] || 0) + 1;
  });

  // Ordenar: cuadros al final, luego marca con más items primero, modelo DESC, precio DESC
  const tipoIdx = hdrs.indexOf('tipo');
  rows.sort((a, b) => {
    const tA = String(a[tipoIdx] || '').toLowerCase();
    const tB = String(b[tipoIdx] || '').toLowerCase();
    const aCuadro = tA === 'cuadro' ? 1 : 0;
    const bCuadro = tB === 'cuadro' ? 1 : 0;
    if (aCuadro !== bCuadro) return aCuadro - bCuadro;
    const mA = String(a[marcaIdx] || '').toLowerCase();
    const mB = String(b[marcaIdx] || '').toLowerCase();
    const diff = (brandCount[mB] || 0) - (brandCount[mA] || 0);
    if (diff !== 0) return diff;
    if (mA !== mB) return mA.localeCompare(mB);
    const modA = String(a[modeloIdx] || '').toLowerCase();
    const modB = String(b[modeloIdx] || '').toLowerCase();
    if (modB !== modA) return modB.localeCompare(modA);
    return (Number(b[precioMaxIdx]) || 0) - (Number(a[precioMaxIdx]) || 0);
  });

  // Rellenar filas cortas para que todas tengan el mismo ancho
  const filled = rows.map(row => {
    const r2 = [...row];
    while (r2.length < hdrs.length) r2.push('');
    return r2.slice(0, hdrs.length);
  });

  const safeFilled = filled.map(row => row.map(safeVal));
  // Las filas vacias del medio se descartan al ordenar: se reescriben en blanco las que sobran abajo.
  // Antes quedaban como estaban y el ultimo producto aparecia duplicado.
  const blancos = Array.from({ length: leidas.length - rows.length }, () => hdrs.map(() => ''));
  await axios.put(
    `${SHEETS_BASE}/${SHEET_ID}/values/STOCK!A2:${endCol}${leidas.length + 1}?valueInputOption=USER_ENTERED`,
    { values: [...safeFilled, ...blancos] },
    opciones(token)
  );
  console.log('[sort] STOCK ordenado por frecuencia de marca');
  return true;
}

// ── Reconstruir VISTA_BICIS completa ──────────────────────────────────────────
async function rebuildVistaBicis() {
  try {
    const token = await getToken();
    const bicis = cache.stock.filter(p =>
      (p.tipo || '').toLowerCase() === 'bicicleta' &&
      (p.estado_unidad || '').toLowerCase() !== 'vendido'
    );
    if (!bicis.length) return;

    // Filtrar bicis sin datos mínimos (sin marca o sin modelo)
    const bicisCompletas = bicis.filter(p => p.marca && p.marca.trim() && p.modelo && p.modelo.trim());

    // Agrupar por marca normalizando (trim + lowercase para agrupar, mostrar el primer nombre encontrado)
    const byMarca = {};
    const marcaDisplay = {};
    for (const p of bicisCompletas) {
      const key = p.marca.trim().toLowerCase();
      const display = p.marca.trim();
      if (!byMarca[key]) { byMarca[key] = []; marcaDisplay[key] = display; }
      byMarca[key].push(p);
    }
    const marcas = Object.keys(byMarca).sort((a, b) => {
      const diff = byMarca[b].length - byMarca[a].length;
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    const colHeaders = ['Código','Tipo','Marca','Modelo','Rodado','Talle','Ubicación','Stock','Estado','P.Costo','P.Venta'];
    const NUM_COLS = colHeaders.length;
    const fmtP = v => {
      const n = Number(v);
      return n > 0 ? `$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '';
    };

    const allRows = [];
    const titleRowIdxs = [];    // bicis — azul oscuro
    const headerRowIdxs = [];   // headers bicis — azul medio
    const cuadroTitleIdxs = []; // cuadros — verde oscuro
    const cuadroHeaderIdxs = [];// headers cuadros — verde medio
    const separatorIdxs = [];   // fila separadora entre bicis y cuadros

    const pushItems = (items, titleIdxs, headIdxs, emoji, label) => {
      items.sort((a, b) => {
        const modA = (a.modelo || '').trim().toLowerCase(), modB = (b.modelo || '').trim().toLowerCase();
        if (modA !== modB) return modA.localeCompare(modB);
        const rodA = Number(a.rodado) || 0, rodB = Number(b.rodado) || 0;
        return rodB - rodA;
      });
      titleIdxs.push(allRows.length);
      allRows.push([`${emoji}  ${label}  —  ${items.length} unidad(es)`]);
      headIdxs.push(allRows.length);
      allRows.push(colHeaders);
      for (const p of items) {
        allRows.push([
          p.numero_serie, p.tipo, p.marca, p.modelo,
          p.rodado || 'n/n', p.talle || 'n/n',
          p.ubicacion, p.stock_actual, p.estado_unidad,
          fmtP(p.precio_costo), fmtP(p.precio_max),
        ]);
      }
      allRows.push([]);
      allRows.push([]);
    };

    // ── Sección bicis ─────────────────────────────────────────────────────────
    for (const marca of marcas) {
      pushItems(byMarca[marca], titleRowIdxs, headerRowIdxs, '🚲', marcaDisplay[marca].toUpperCase());
    }

    // ── Separador ─────────────────────────────────────────────────────────────
    separatorIdxs.push(allRows.length);
    allRows.push(['🔧  CUADROS']);
    allRows.push([]);

    // ── Sección cuadros (lista única ordenada por talle mayor→menor) ──────────
    const cuadros = cache.stock.filter(p =>
      (p.tipo || '').toLowerCase() === 'cuadro' &&
      (p.estado_unidad || '').toLowerCase() !== 'vendido'
    );
    const talleVal = t => {
      const s = (t || '').trim().toUpperCase();
      if (s === 'XXL') return 5; if (s === 'XL') return 4;
      if (s === 'L') return 3;   if (s === 'M') return 2;
      if (s === 'S') return 1;   if (s === 'XS') return 0;
      const n = parseFloat(s);   return isNaN(n) ? -1 : n;
    };
    cuadros.sort((a, b) => {
      const td = talleVal(b.talle) - talleVal(a.talle);
      if (td !== 0) return td;
      return (a.marca || '').localeCompare(b.marca || '');
    });
    cuadroTitleIdxs.push(allRows.length);
    allRows.push([`🔧  CUADROS  —  ${cuadros.length} unidad(es)`]);
    cuadroHeaderIdxs.push(allRows.length);
    allRows.push(colHeaders);
    for (const p of cuadros) {
      allRows.push([
        p.numero_serie, p.tipo, p.marca, p.modelo,
        p.rodado || 'n/n', p.talle || 'n/n',
        p.ubicacion, p.stock_actual, p.estado_unidad,
        fmtP(p.precio_costo), fmtP(p.precio_max),
      ]);
    }

    // Obtener sheetId numérico de VISTA_BICIS
    const metaRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const sheetMeta = metaRes.data.sheets.find(s => s.properties.title === 'VISTA_BICIS');
    const sheetId = sheetMeta.properties.sheetId;

    // Desmerger todo y limpiar formato previo
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      {
        requests: [
          { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: NUM_COLS } } },
          { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: NUM_COLS }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } }
        ]
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    // Limpiar valores y escribir
    await axios.post(
      `${SHEETS_BASE}/${SHEET_ID}/values:batchClear`,
      { ranges: ['VISTA_BICIS!A1:K2000'] },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    await axios.put(
      `${SHEETS_BASE}/${SHEET_ID}/values/VISTA_BICIS!A1:K${allRows.length}?valueInputOption=RAW`,
      { values: allRows },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    // Aplicar colores y formato a títulos y headers
    const fmtRequests = [];
    for (const r of titleRowIdxs) {
      fmtRequests.push({
        mergeCells: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
          mergeType: 'MERGE_ALL'
        }
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.051, green: 0.278, blue: 0.631 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 12 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
        }
      });
    }
    for (const r of headerRowIdxs) {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.098, green: 0.463, blue: 0.824 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
              horizontalAlignment: 'CENTER',
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      });
    }
    // Cuadros: títulos verde oscuro
    for (const r of cuadroTitleIdxs) {
      fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS }, mergeType: 'MERGE_ALL' } });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.106, green: 0.369, blue: 0.125 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 12 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
        }
      });
    }
    // Cuadros: headers verde medio
    for (const r of cuadroHeaderIdxs) {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.18, green: 0.557, blue: 0.2 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            horizontalAlignment: 'CENTER',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
        }
      });
    }
    // Separador: gris oscuro
    for (const r of separatorIdxs) {
      fmtRequests.push({ mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS }, mergeType: 'MERGE_ALL' } });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 13 },
            horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
          }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
        }
      });
    }

    if (fmtRequests.length) {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
        { requests: fmtRequests },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[vista] VISTA_BICIS reconstruida: ${marcas.length} marcas bicis, ${cuadros.length} cuadros`);
  } catch (e) { console.error('[vista rebuild]', e.response?.data?.error?.message || e.message); }
}

// ── Sincronizar VISTA_BICIS ────────────────────────────────────────────────────
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
      `${SHEETS_BASE}/${SHEET_ID}/values/VISTA_BICIS!G${rowNum}?valueInputOption=RAW`,
      { values: [[ubicacion]] },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('[vista] OK fila', rowNum, 'status:', res.status);
  } catch (e) { console.error('[bg vista] ERROR:', e.response?.data || e.message); }
}

// ── Calcular precios desde catálogo ───────────────────────────────────────────
function calcularPrecios(codigoProv) {
  if (!codigoProv) return null;
  const codLower = normCod(codigoProv);
  const catalogo = cache._catalogo || [];

  let item = catalogo.find(r => normCod(r.codigo_proveedor) === codLower);

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
      const esEspecial = (cod) => {
        const extra = cod.slice(codLower.length);
        return /^h/i.test(extra) || /h[a-z\d]+$/i.test(cod.split('-').pop());
      };
      candidatos.sort((a, b) => {
        const aCod = (a.codigo_proveedor||'').toLowerCase();
        const bCod = (b.codigo_proveedor||'').toLowerCase();
        const aEsp = esEspecial(aCod) ? 1 : 0;
        const bEsp = esEspecial(bCod) ? 1 : 0;
        if (aEsp !== bEsp) return aEsp - bEsp;
        return aCod.length - bCod.length;
      });
      item = candidatos[0];
    }
  }

  if (!item || !item.costo) return null;
  const costo = parseFloat((item.costo||'0').replace(',','.'));
  if (!costo) return null;
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
    precio_max: round5000(costoFinal * 1.60),
    precio_min: round5000(costoFinal * 1.35),
    proveedor: item.proveedor,
    detalle: item.detalle_original,
    codigo_usado: item.codigo_proveedor,
  };
}

module.exports = {
  getToken, uploadToDrive,
  HEADERS, CACHE_KEY,
  cache, state,
  loadSheet, refreshCache, appendRow, upsertRow,
  sortStock, rebuildVistaBicis, syncVistaUbicacion, calcularPrecios,
};

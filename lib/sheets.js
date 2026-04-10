'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const { SHEET_ID, SHEETS_BASE, SA, N8N_DRIVE_WEBHOOK, RECARGO_PROVEEDOR, round5000, normCod } = require('./config');
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
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _tokenCache[scope] = { token: r.data.access_token, expiresAt: Date.now() + 3500000 };
  return _tokenCache[scope].token;
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

// Prefija con ' valores que Sheets (locale es_AR) confundiría como fechas (ej: 27.5 → 27 de mayo)
const _DATE_LIKE = /^\d{1,2}[./]\d{1,2}$/;
function safeVal(v) {
  const s = String(v ?? '');
  return _DATE_LIKE.test(s) ? `'${s}` : s;
}

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
const state = { cacheReady: false };

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
      loadSheet('MOVIMIENTOS_PENDIENTES'), loadSheet('FACTURAS'), loadSheet('CATALOGO_PROVEEDORES'),
    ]);
    if (rUsuarios.status    === 'fulfilled') cache.usuarios    = rUsuarios.value;
    else console.error('[cache] USUARIOS falló:', rUsuarios.reason?.message);
    if (!state.cacheReady && rSesiones.status === 'fulfilled') cache.sesiones = rSesiones.value;
    else if (rSesiones.status === 'rejected') console.error('[cache] SESIONES falló:', rSesiones.reason?.message);
    if (rStock.status       === 'fulfilled') cache.stock       = rStock.value;
    else console.error('[cache] STOCK falló:', rStock.reason?.message);
    if (rMovimientos.status === 'fulfilled') cache.movimientos = rMovimientos.value;
    else console.error('[cache] MOVIMIENTOS falló:', rMovimientos.reason?.message);
    if (rCatalogo.status    === 'fulfilled') cache._catalogo   = rCatalogo.value;
    else console.error('[cache] CATALOGO_PROVEEDORES falló:', rCatalogo.reason?.message);
    if (rFacturas.status    === 'fulfilled') cache.facturas    = rFacturas.value;
    else console.error('[cache] FACTURAS falló:', rFacturas.reason?.message);
    state.cacheReady = true;
    console.log(`[cache] users:${cache.usuarios.length} stock:${cache.stock.length} movs:${cache.movimientos.length} facts:${cache.facturas.length}`);
    // Auto-corregir estados inconsistentes
    const token = await getToken();
    for (const p of cache.stock) {
      const stk = Number(p.stock_actual) || 0;
      const estado = (p.estado_unidad || '').toLowerCase();
      let nuevoEstado = null;
      if (stk > 0 && estado === 'vendido') nuevoEstado = 'disponible';
      else if (stk === 0 && estado !== 'vendido') nuevoEstado = 'vendido';
      if (nuevoEstado) {
        p.estado_unidad = nuevoEstado;
        await axios.put(
          `${SHEETS_BASE}/${SHEET_ID}/values/STOCK!H${p._rowNum}?valueInputOption=RAW`,
          { values: [[nuevoEstado]] },
          { headers: { Authorization: `Bearer ${token}` } }
        ).catch(e => console.error('[fix-estado]', p.numero_serie, e.message));
        console.log(`[fix-estado] ${p.numero_serie} stock=${stk} → ${nuevoEstado}`);
      }
    }
  } catch (e) { console.error('[cache] refresh error:', e.message); }
  finally { _cacheRefreshing = false; }
}

async function appendRow(sheetName, data) {
  const ck = CACHE_KEY[sheetName];
  if (ck) {
    const maxRow = cache[ck].reduce((m, r) => Math.max(m, r._rowNum || 1), 1);
    cache[ck].push({ ...data, _rowNum: maxRow + 1 });
  }
  getToken().then(async token => {
    const hdrs = HEADERS[sheetName];
    const endCol = String.fromCharCode(64 + hdrs.length);
    const values = [hdrs.map(h => safeVal(data[h]))];
    const r = await axios.get(
      `${SHEETS_BASE}/${SHEET_ID}/values/${sheetName}!A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const colA = r.data.values || [[]];
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
  let idx = sheetName === 'SESIONES'
    ? arr.findIndex(r => String(r[keyField]) === String(data[keyField]) && r.estado)
    : -1;
  if (idx < 0) idx = arr.findIndex(r => String(r[keyField]) === String(data[keyField]));
  if (idx >= 0) {
    const existing = arr[idx];
    const rowNum   = existing._rowNum;
    const hdrs     = HEADERS[sheetName];
    const merged   = { ...existing, ...data };
    const endCol   = String.fromCharCode(64 + hdrs.length);
    arr[idx] = { ...merged, _rowNum: rowNum };
    const values = [hdrs.map(h => safeVal(merged[h]))];
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

// ── Ordenar STOCK ──────────────────────────────────────────────────────────────
let _stockSheetId = null;
async function sortStock() {
  try {
    const token = await getToken();
    const hdrs = HEADERS.STOCK;
    const endCol = String.fromCharCode(64 + hdrs.length);

    // Leer filas actuales del sheet
    const r = await axios.get(
      `${SHEETS_BASE}/${SHEET_ID}/values/STOCK!A2:${endCol}1000?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rows = (r.data.values || []).filter(row => row && row.some(c => c !== '' && c != null));
    if (!rows.length) return;

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
    await axios.put(
      `${SHEETS_BASE}/${SHEET_ID}/values/STOCK!A2:${endCol}${safeFilled.length + 1}?valueInputOption=USER_ENTERED`,
      { values: safeFilled },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('[sort] STOCK ordenado por frecuencia de marca');
    await refreshCache();
    await rebuildVistaBicis();
  } catch (e) { console.error('[sort]', e.response?.data?.error?.message || e.message); }
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

    // Agrupar por marca y contar
    const byMarca = {};
    for (const p of bicis) {
      const m = p.marca || 'Sin marca';
      if (!byMarca[m]) byMarca[m] = [];
      byMarca[m].push(p);
    }
    const marcas = Object.keys(byMarca).sort((a, b) => {
      const diff = byMarca[b].length - byMarca[a].length;
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    const colHeaders = ['Código','Tipo','Marca','Modelo','Rodado','Talle','Ubicación','Stock','Estado','P.Costo','P.Venta'];
    const fmtP = v => {
      const n = Number(v);
      return n > 0 ? `$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '';
    };

    const allRows = [];
    for (const marca of marcas) {
      const items = byMarca[marca];
      items.sort((a, b) => {
        const modA = (a.modelo || '').toLowerCase(), modB = (b.modelo || '').toLowerCase();
        if (modB !== modA) return modB.localeCompare(modA);
        return (Number(b.precio_max) || 0) - (Number(a.precio_max) || 0);
      });
      allRows.push([`  🚲  ${marca.toUpperCase()}  ·  ${items.length} unidad(es)`]);
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
    }

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
    console.log(`[vista] VISTA_BICIS reconstruida: ${marcas.length} marcas, ${bicis.length} bicis`);
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

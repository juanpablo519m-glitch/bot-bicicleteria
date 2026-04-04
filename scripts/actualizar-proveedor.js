'use strict';
// Uso: node scripts/actualizar-proveedor.js "dal santo" nueva-lista.json
// El archivo JSON debe ser un array: [["proveedor","codigo","detalle","costo"], ...]
// La primera fila puede ser o no el header — el script lo detecta.
//
// Estrategia: lee todo el catálogo, reemplaza el bloque del proveedor,
// y reescribe el sheet completo con buffers frescos entre cada proveedor.
// NUNCA pisa datos de otros proveedores.

require('dotenv').config();
const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');

const SHEET_ID    = process.env.SHEET_ID;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const BUFFER      = 100;
const HEADER      = ['proveedor', 'codigo_proveedor', 'detalle_original', 'costo'];

const SA = {
  client_email: process.env.SA_EMAIL,
  private_key: (process.env.SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
};

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const cls = Buffer.from(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
  })).toString('base64url');
  const input  = `${hdr}.${cls}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const jwt = `${input}.${signer.sign(SA.private_key).toString('base64url')}`;
  const r = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return r.data.access_token;
}

async function leerCatalogo(token) {
  const r = await axios.get(
    `${SHEETS_BASE}/${SHEET_ID}/values/CATALOGO_PROVEEDORES!A:D`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return r.data.values || [];
}

// Extrae bloques por proveedor ignorando filas vacías
function extraerBloques(rows) {
  const bloques = {}; // { nombreProveedor: [[fila], ...] }
  const orden   = []; // orden de aparición de proveedores
  for (let i = 1; i < rows.length; i++) {
    const prov = (rows[i][0] || '').trim();
    if (!prov) continue; // fila vacía = buffer, ignorar
    const provLow = prov.toLowerCase();
    if (!bloques[provLow]) { bloques[provLow] = []; orden.push(provLow); }
    bloques[provLow].push(rows[i]);
  }
  return { bloques, orden };
}

// Reconstruye el sheet con buffers frescos entre proveedores
function reconstruir(bloques, orden) {
  const buffer = Array(BUFFER).fill(['', '', '', '']);
  const rows   = [HEADER];
  orden.forEach((prov, i) => {
    rows.push(...bloques[prov]);
    if (i < orden.length - 1) rows.push(...buffer); // buffer entre proveedores, no al final
  });
  return rows;
}

(async () => {
  const proveedorArg = (process.argv[2] || '').trim().toLowerCase();
  const archivoArg   = process.argv[3];

  if (!proveedorArg || !archivoArg) {
    console.error('Uso: node scripts/actualizar-proveedor.js "nombre proveedor" archivo.json');
    process.exit(1);
  }
  if (!fs.existsSync(archivoArg)) {
    console.error('Archivo no encontrado:', archivoArg);
    process.exit(1);
  }

  const nuevaLista = JSON.parse(fs.readFileSync(archivoArg, 'utf8'));
  const nuevasFilas = nuevaLista[0] && (nuevaLista[0][0] || '').toLowerCase() === 'proveedor'
    ? nuevaLista.slice(1)
    : nuevaLista;

  if (!nuevasFilas.length) { console.error('El archivo está vacío.'); process.exit(1); }

  const token   = await getToken();
  const catalog = await leerCatalogo(token);

  const { bloques, orden } = extraerBloques(catalog);

  const esNuevo = !bloques[proveedorArg];
  if (esNuevo) {
    console.log(`Proveedor "${proveedorArg}" no encontrado — se agregará al final.`);
    orden.push(proveedorArg);
  } else {
    console.log(`Proveedor "${proveedorArg}": ${bloques[proveedorArg].length} filas actuales → ${nuevasFilas.length} nuevas`);
  }

  // Reemplazar o agregar el bloque
  bloques[proveedorArg] = nuevasFilas;

  // Reconstruir todo el sheet con buffers frescos
  const newRows = reconstruir(bloques, orden);
  console.log(`Reconstruyendo sheet: ${newRows.length} filas totales`);
  orden.forEach(p => console.log(`  ${p}: ${bloques[p].length} filas`));

  // Limpiar sheet completo primero (en caso de que el nuevo sea más corto que el anterior)
  const filaActual = catalog.length;
  if (filaActual > newRows.length) {
    const vacias = Array(filaActual - newRows.length).fill(['', '', '', '']);
    await axios.put(
      `${SHEETS_BASE}/${SHEET_ID}/values/CATALOGO_PROVEEDORES!A${newRows.length + 1}:D${filaActual}?valueInputOption=RAW`,
      { values: vacias },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  }

  // Escribir todo de una
  await axios.put(
    `${SHEETS_BASE}/${SHEET_ID}/values/CATALOGO_PROVEEDORES!A1:D${newRows.length}?valueInputOption=RAW`,
    { values: newRows },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  console.log(`✅ Listo. Datos de otros proveedores intactos.`);
})().catch(e => console.error('ERROR:', e.response?.data || e.message));

'use strict';
const express = require('express');
const axios   = require('axios');
const { PORT, BOT_TOKEN, SHEET_ID, ADMIN_ID } = require('./lib/config');
const { cache, state, refreshCache, getToken } = require('./lib/sheets');
const { now } = require('./lib/utils');
const { processUpdate } = require('./lib/handlers');
const { asegurarWebhook, tgSend } = require('./lib/telegram');
const reportes = require('./lib/reportes');

const CM_SHEET_ID = '1E8tMRrWjo7rKGcKLeLw37Vlj-JJoSTenxLrZ8LGK0lk';

if (!BOT_TOKEN)            { console.error('FATAL: BOT_TOKEN no configurado'); process.exit(1); }
if (!SHEET_ID)             { console.error('FATAL: SHEET_ID no configurado'); process.exit(1); }
if (!process.env.SA_EMAIL) { console.error('FATAL: SA_EMAIL no configurado'); process.exit(1); }

const app = express();
app.use(express.json());

app.get('/health', (req, res) =>
  res.json({ ok: true, cacheReady: state.cacheReady, users: cache.usuarios.length, stock: cache.stock.length, movs: cache.movimientos.length })
);

app.get('/stock-report', async (req, res) => {
  if (!state.cacheReady) await refreshCache();
  const lowStock = cache.stock.filter(p => {
    if (!p.numero_serie) return false;
    const actual = parseInt(p.stock_actual || 0);
    const minimo = parseInt(p.stock_minimo || 0);
    return actual <= minimo;
  });
  res.json({ lowStock, total: cache.stock.length, fecha: now() });
});

app.post('/cm-write', async (req, res) => {
  const { secret, data } = req.body || {};
  if (!secret || secret !== process.env.CM_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!data || !Array.isArray(data)) return res.status(400).json({ error: 'data must be an array' });
  try {
    const token = await getToken();
    const r = await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${CM_SHEET_ID}/values:batchUpdate`,
      { valueInputOption: 'USER_ENTERED', data },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    res.json({ ok: true, updated: r.data.totalUpdatedCells });
  } catch (e) {
    console.error('[cm-write]', e.response?.data?.error?.message || e.message);
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

app.get('/pandora-data', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.PANDORA_SECRET || token !== process.env.PANDORA_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  if (!state.cacheReady) await refreshCache();

  const stock = cache.stock.map(p => ({
    marca: p.marca, modelo: p.modelo, tipo: p.tipo,
    stock_actual: p.stock_actual, estado: p.estado_unidad,
    precio_max: p.precio_max, rodado: p.rodado, talle: p.talle,
    ubicacion: p.ubicacion, descripcion: p.ficha_tecnica || ''
  }));

  const movimientos_pendientes = cache.movimientos
    .filter(m => m.estado === 'pendiente')
    .map(m => ({
      tipo: m.tipo, descripcion: m.descripcion_movimiento,
      operador: m.nombre_operador, fecha: m.fecha_creacion
    }));

  // Antes se comparaba la fecha con "08/10/2026" (barras, sin hora) pero la planilla guarda "08-10-2026 18:30:55":
  // ventas_hoy salia SIEMPRE vacio. Ahora usa la misma funcion que el reporte diario (lib/reportes.js).
  let ventas_hoy = [];
  try { ventas_hoy = await reportes.ventasDelDia({ getToken, SHEET_ID }); }
  catch (e) { console.error('[pandora-data ventas]', e.message); }

  res.json({ stock, movimientos_pendientes, ventas_hoy });
});

// Como quedarian el reporte y la alerta de las 22 h, con datos de ahora, SIN mandar nada.
app.get('/reportes/vista', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.PANDORA_SECRET || token !== process.env.PANDORA_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json({ activo: reportes.activo(), ...(await reportes.vista({ cache, state, refreshCache, getToken, SHEET_ID })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    if (!state.cacheReady) await refreshCache();
    await processUpdate(req.body);
  } catch (e) { console.error('[webhook] error:', e.message); }
});

app.listen(PORT, async () => {
  console.log(`Bot bicicletería en puerto ${PORT} — v2026-04-11`);
  await refreshCache();
  setInterval(refreshCache, 20 * 1000);
  asegurarWebhook(true);
  setInterval(asegurarWebhook, 10 * 60 * 1000);
  reportes.iniciarReportes({ cache, state, refreshCache, getToken, SHEET_ID, tgSend, adminId: ADMIN_ID });
});

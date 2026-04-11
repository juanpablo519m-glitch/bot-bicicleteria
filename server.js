'use strict';
const express = require('express');
const { PORT, BOT_TOKEN, SHEET_ID } = require('./lib/config');
const { cache, state, refreshCache } = require('./lib/sheets');
const { now } = require('./lib/utils');
const { processUpdate } = require('./lib/handlers');

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
});

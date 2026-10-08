'use strict';
// Reporte diario y alerta de stock bajo por Telegram. Reemplaza a los dos disparadores de las 22 h del flujo
// viejo de n8n ("Sistema Bicicleteria - Bot Telegram"), que fallaban todas las noches por una credencial
// OAuth vencida (y uno de sus nodos tenia un error de sintaxis). Aca se lee del cache del bot con la cuenta
// de servicio, que no se vence.
//
// ESTA APAGADO POR DEFECTO (pedido de Juan Pablo, 08/10/2026: "que no mande reportes todavia").
// Para prenderlo: variable de entorno REPORTES_ACTIVOS=true en el servicio y redeploy.
// Para ver como quedarian los mensajes SIN mandarlos: GET /reportes/vista (Bearer PANDORA_SECRET).
const axios = require('axios');

const TZ = 'America/Argentina/Buenos_Aires';
const HORA_REPORTE = { h: 22, m: 0 };
const HORA_ALERTA  = { h: 22, m: 5 };
const VENTANA_MIN = 30;        // si el bot arranca pasada la hora, manda igual hasta 30 min despues; despues espera a mañana
const MAX_LINEAS_ALERTA = 10;
const MAX_LINEAS_REPORTE = 5;

const activo = () => String(process.env.REPORTES_ACTIVOS || '').trim().toLowerCase() === 'true';

// ---------- utilidades puras (con tests en tests/reportes.test.js) ----------
const n = v => parseInt(v || 0, 10) || 0;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "$100.000" / "590000" / "1.145.000,50" -> numero. Sin datos o ilegible -> 0.
function parsePrecio(v) {
  let s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');   // coma = decimal, puntos = miles
  else s = s.replace(/\./g, '');                                       // solo puntos = miles
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : 0;
}
const plata = x => '$' + Math.round(x).toLocaleString('es-AR');

// Fecha/hora de Argentina. La planilla guarda las ventas como "dd-MM-yyyy HH:mm:ss" (ver now() en utils.js).
function ahoraAR(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { dia: `${p.day}-${p.month}-${p.year}`, h: Number(p.hour), m: Number(p.minute), min: Number(p.hour) * 60 + Number(p.minute) };
}

// Filas [fecha, nombre, descripcion, precio, forma_pago, operador, ...] de una hoja de ventas -> las de ese dia.
// Acepta "08-10-2026 ..." y "08/10/2026 ..." (la comparacion vieja de /pandora-data usaba barras y sin hora: nunca encontraba nada).
function ventasDeFilas(filas, dia, tipo) {
  const prefijos = [dia, dia.replace(/-/g, '/')];
  return (filas || []).slice(1)
    .filter(r => r && prefijos.some(p => String(r[0] || '').startsWith(p)))
    .map(r => ({ tipo, fecha: r[0], nombre: r[1], descripcion: r[2], precio: r[3], forma_pago: r[4], operador: r[5] }));
}

// Variante = misma bici/accesorio (marca + modelo + rodado + talle + color). "Bajo" = el stock total de la variante
// esta POR DEBAJO del minimo cargado. La regla vieja (actual <= minimo) marcaba 121 de las 128 bicis, porque cada
// bici es una unidad con minimo 1: la alerta habria listado todo el stock todas las noches.
function stockBajo(stock) {
  const grupos = new Map();
  for (const p of (stock || []).filter(x => x && x.tipo)) {
    const k = [p.tipo, p.marca, p.modelo, p.rodado, p.talle, p.color].map(x => String(x || '').trim().toLowerCase()).join('|');
    const g = grupos.get(k) || { tipo: p.tipo, marca: p.marca, modelo: p.modelo, rodado: p.rodado, talle: p.talle, color: p.color, actual: 0, minimo: 0 };
    g.actual += n(p.stock_actual);
    g.minimo = Math.max(g.minimo, n(p.stock_minimo));
    grupos.set(k, g);
  }
  return [...grupos.values()].filter(g => g.minimo > 0 && g.actual < g.minimo)
    .sort((a, b) => (a.marca + a.modelo).localeCompare(b.marca + b.modelo));
}
const nombreVariante = g => [g.marca, g.modelo, g.rodado && 'R' + g.rodado, g.talle && 'T' + g.talle, g.color].filter(Boolean).map(esc).join(' ');

function armarAlerta(stock, dia) {
  const bajos = stockBajo(stock);
  if (!bajos.length) return null;                       // nada que avisar: no se manda nada
  const l = [`⚠️ <b>Stock bajo — ${esc(dia)}</b>`, ''];
  bajos.slice(0, MAX_LINEAS_ALERTA).forEach(g => l.push(`• ${nombreVariante(g)}: ${g.actual} (mín ${g.minimo})`));
  if (bajos.length > MAX_LINEAS_ALERTA) l.push(`…y ${bajos.length - MAX_LINEAS_ALERTA} más`);
  l.push('', '👇 Revisar y reponer');
  return l.join('\n');
}

// ventas: lista de ventasDeFilas(), o null si no se pudieron leer (no se dice "sin ventas" si no se sabe).
function armarReporte(stock, ventas, dia) {
  const items = (stock || []).filter(p => p && p.tipo);
  const bicis = items.filter(p => p.tipo === 'bicicleta');
  const cuadros = items.filter(p => p.tipo === 'cuadro');
  const accs = items.filter(p => p.tipo !== 'bicicleta' && p.tipo !== 'cuadro');
  const uds = lista => lista.reduce((s, p) => s + n(p.stock_actual), 0);
  const modelos = lista => new Set(lista.map(p => `${p.marca}|${p.modelo}`.toLowerCase())).size;
  const bajos = stockBajo(items);
  const l = ['🚲 <b>Reporte diario Bicicletería</b>', `📅 ${esc(dia)}`, '━━━━━━━━━━', '💰 <b>Ventas de hoy</b>'];
  if (ventas === null) l.push('• No pude leer las ventas de la planilla');
  else if (!ventas.length) l.push('• Sin ventas hoy');
  else {
    const nb = ventas.filter(v => v.tipo === 'bicicleta').length, na = ventas.length - nb;
    l.push(`• ${ventas.length} venta(s): ${nb} bici(s), ${na} accesorio(s)`);
    const total = ventas.reduce((s, v) => s + parsePrecio(v.precio), 0);
    if (total > 0) l.push(`• Total: ${plata(total)}`);
  }
  l.push('', '📦 <b>Stock</b>',
    `• Bicicletas: ${uds(bicis)} uds (${modelos(bicis)} modelos)`,
    `• Cuadros: ${uds(cuadros)} uds`,
    `• Accesorios: ${uds(accs)} uds (${modelos(accs)} modelos)`, '');
  if (bajos.length) {
    l.push(`⚠️ <b>Stock bajo: ${bajos.length}</b>`);
    bajos.slice(0, MAX_LINEAS_REPORTE).forEach(g => l.push(`• ${nombreVariante(g)}: ${g.actual}/${g.minimo}`));
    if (bajos.length > MAX_LINEAS_REPORTE) l.push(`…y ${bajos.length - MAX_LINEAS_REPORTE} más`);
  } else l.push('✅ Sin stock bajo');
  l.push('', '🤖 Reporte automático');
  return l.join('\n');
}

// ---------- con red (Sheets / Telegram) ----------
// Ventas del dia (ambas hojas). Devuelve la lista, o lanza error si no pudo leer (el llamador decide que decir).
async function ventasDelDia({ getToken, SHEET_ID }, dia = ahoraAR().dia) {
  const t = await getToken();
  const get = hoja => axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${hoja}!A:G?valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${t}` }, timeout: 20000 });
  const [r1, r2] = await Promise.all([get('VENTAS_BICICLETAS'), get('VENTAS_ACCESORIOS')]);
  return [...ventasDeFilas(r1.data?.values, dia, 'bicicleta'), ...ventasDeFilas(r2.data?.values, dia, 'accesorio')];
}

// Arma los dos mensajes con datos de ahora, SIN mandar nada.
async function vista(dep) {
  if (!dep.state.cacheReady) await dep.refreshCache();
  const { dia } = ahoraAR();
  let ventas = null;
  try { ventas = await ventasDelDia(dep, dia); } catch (e) { console.error('[reportes] no pude leer las ventas:', e.response?.data?.error?.message || e.message); }
  return { dia, reporte: armarReporte(dep.cache.stock, ventas, dia), alerta: armarAlerta(dep.cache.stock, dia) };
}

// Revisa cada minuto si toca mandar. dep = { cache, state, refreshCache, getToken, SHEET_ID, tgSend, adminId }
function iniciarReportes(dep) {
  if (!activo()) { console.log("[reportes] APAGADOS (para prenderlos: REPORTES_ACTIVOS=true). Ver como quedan: GET /reportes/vista"); return; }
  console.log(`[reportes] ACTIVOS: reporte ${HORA_REPORTE.h}:${String(HORA_REPORTE.m).padStart(2, '0')} y alerta ${HORA_ALERTA.h}:${String(HORA_ALERTA.m).padStart(2, '0')} (hora Argentina) a ${dep.adminId}`);
  const enviado = { reporte: '', alerta: '' };
  const tocaAhora = (hora, ahora) => ahora.min >= hora.h * 60 + hora.m && ahora.min < hora.h * 60 + hora.m + VENTANA_MIN;
  setInterval(async () => {
    try {
      const ahora = ahoraAR();
      const pendientes = [['reporte', HORA_REPORTE], ['alerta', HORA_ALERTA]].filter(([k, hora]) => enviado[k] !== ahora.dia && tocaAhora(hora, ahora));
      if (!pendientes.length) return;
      const v = await vista(dep);
      for (const [k] of pendientes) {
        enviado[k] = ahora.dia;                          // se marca antes de mandar: si falla no se repite en loop cada minuto
        const texto = v[k];
        if (!texto) { console.log(`[reportes] ${k}: nada para avisar hoy`); continue; }
        const r = await dep.tgSend(dep.adminId, texto);
        console.log(`[reportes] ${k} ${r ? 'enviado' : 'NO SE PUDO ENVIAR'} (${ahora.dia})`);
      }
    } catch (e) { console.error('[reportes] error:', e.message); }
  }, 60 * 1000);
}

module.exports = { iniciarReportes, vista, ventasDelDia, ventasDeFilas, armarReporte, armarAlerta, stockBajo, parsePrecio, ahoraAR, activo };

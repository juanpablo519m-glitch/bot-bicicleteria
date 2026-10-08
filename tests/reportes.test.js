'use strict';
// Tests de lib/reportes.js (sin red). Correr desde bot-node:  node tests/reportes.test.js
const assert = require('assert');
const R = require('../lib/reportes.js');

let ok = 0;
const t = (n, fn) => { fn(); ok++; console.log('  ok  ' + n); };
const bici = (o) => ({ tipo: 'bicicleta', marca: 'Raleigh', modelo: 'Scout', rodado: '29', talle: '17', color: 'gris', stock_actual: '1', stock_minimo: '1', ...o });

t('parsePrecio entiende los formatos que hay en la planilla', () => {
  assert.strictEqual(R.parsePrecio('$100.000'), 100000);
  assert.strictEqual(R.parsePrecio('590000'), 590000);
  assert.strictEqual(R.parsePrecio('$ 1.145.000,50'), 1145000.5);
  assert.strictEqual(R.parsePrecio(''), 0);
  assert.strictEqual(R.parsePrecio('3 cuotas'), 3); // texto mezclado: no revienta
  assert.strictEqual(R.parsePrecio(undefined), 0);
});

t('ahoraAR da dia con guiones y hora de Argentina (UTC-3), no la del servidor', () => {
  const a = R.ahoraAR(new Date('2026-10-09T01:30:00Z')); // 22:30 del 08/10 en Argentina
  assert.deepStrictEqual([a.dia, a.h, a.m, a.min], ['08-10-2026', 22, 30, 1350]);
  assert.strictEqual(R.ahoraAR(new Date('2026-10-08T21:05:00Z')).h, 18);
});

t('ventasDeFilas encuentra las ventas del dia con el formato REAL de la planilla (guiones + hora)', () => {
  const filas = [['fecha', 'nombre'], ['08-10-2026 15:30:55', 'pepe', 'Trek', '590000', 'efectivo', 'Dueño'], ['07-10-2026 10:00:00', 'ana'], ['08/10/2026', 'raul'], null, []];
  const v = R.ventasDeFilas(filas, '08-10-2026', 'bicicleta');
  assert.deepStrictEqual(v.map(x => x.nombre), ['pepe', 'raul']);
  assert.strictEqual(v[0].tipo, 'bicicleta');
  assert.deepStrictEqual(R.ventasDeFilas(undefined, '08-10-2026', 'x'), []);
});

t('stock bajo: bicis con 1 unidad y minimo 1 NO son stock bajo (la regla vieja marcaba 121 de 128)', () => {
  const stock = Array.from({ length: 5 }, (_, i) => bici({ talle: String(15 + i) }));
  assert.deepStrictEqual(R.stockBajo(stock), []);
});

t('stock bajo: una variante cuyo stock total queda debajo del minimo SI avisa', () => {
  const stock = [bici({ stock_actual: '0', estado_unidad: 'vendido' }), bici({ talle: '19' }), { tipo: 'casco', marca: 'Bell', modelo: 'Sport', stock_actual: '2', stock_minimo: '5' }];
  const b = R.stockBajo(stock);
  assert.deepStrictEqual(b.map(g => g.marca), ['Bell', 'Raleigh']);
  assert.deepStrictEqual([b[0].actual, b[0].minimo], [2, 5]);
});

t('stock bajo: dos unidades iguales se suman antes de comparar', () => {
  const stock = [bici({ stock_actual: '1', stock_minimo: '2' }), bici({ stock_actual: '1', stock_minimo: '2' })];
  assert.deepStrictEqual(R.stockBajo(stock), []); // 1 + 1 = 2, no esta debajo de 2
});

t('stock bajo: sin minimo cargado no avisa', () => {
  assert.deepStrictEqual(R.stockBajo([bici({ stock_actual: '0', stock_minimo: '' })]), []);
});

t('la alerta no se manda si no hay nada (devuelve null)', () => {
  assert.strictEqual(R.armarAlerta([bici()], '08-10-2026'), null);
});

t('la alerta se recorta para no pasar el limite de Telegram y escapa el HTML', () => {
  const stock = Array.from({ length: 40 }, (_, i) => ({ tipo: 'accesorio', marca: 'A&B', modelo: `Cubierta <${i}>`, stock_actual: '0', stock_minimo: '3' }));
  const txt = R.armarAlerta(stock, '08-10-2026');
  assert.ok(txt.length < 4000, `largo ${txt.length}`);
  assert.ok(txt.includes('…y 30 más'));
  assert.ok(txt.includes('A&amp;B Cubierta &lt;') && !/<\d/.test(txt), 'un < sin escapar rompe el mensaje en Telegram (400)');
});

t('el reporte con ventas: cuenta, suma y separa bicis de accesorios', () => {
  const ventas = [{ tipo: 'bicicleta', precio: '590000' }, { tipo: 'accesorio', precio: '$100.000' }];
  const txt = R.armarReporte([bici(), bici({ talle: '19' })], ventas, 'jueves 08/10');
  assert.ok(txt.includes('2 venta(s): 1 bici(s), 1 accesorio(s)'));
  assert.ok(txt.includes('Total: $690.000'));
  assert.ok(txt.includes('Bicicletas: 2 uds (1 modelos)'));
  assert.ok(txt.includes('✅ Sin stock bajo'));
});

t('el reporte sin ventas dice "Sin ventas hoy"; si no pudo leerlas lo dice (no inventa un cero)', () => {
  assert.ok(R.armarReporte([bici()], [], 'x').includes('Sin ventas hoy'));
  const txt = R.armarReporte([bici()], null, 'x');
  assert.ok(txt.includes('No pude leer las ventas') && !txt.includes('Sin ventas hoy'));
});

t('APAGADO por defecto: sin REPORTES_ACTIVOS no se programa nada (no hay ningun setInterval)', () => {
  delete process.env.REPORTES_ACTIVOS;
  assert.strictEqual(R.activo(), false);
  let intervalos = 0; const orig = global.setInterval;
  global.setInterval = () => { intervalos++; return { unref() {} }; };
  const log = console.log; console.log = () => {};
  R.iniciarReportes({ adminId: '1' });
  console.log = log; global.setInterval = orig;
  assert.strictEqual(intervalos, 0);
  for (const v of ['false', '0', '', 'si']) { process.env.REPORTES_ACTIVOS = v; assert.strictEqual(R.activo(), false, v); }
  process.env.REPORTES_ACTIVOS = 'TRUE'; assert.strictEqual(R.activo(), true);
  delete process.env.REPORTES_ACTIVOS;
});

console.log(`\n${ok} tests OK`);

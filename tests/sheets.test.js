'use strict';
// Tests de lib/sheets.js contra la planilla falsa (ver tests/simulador.js). Correr:  node tests/sheets.test.js
const assert = require('assert');
const sim = require('./simulador');
const { cache, state, refreshCache, appendRow, upsertRow, sortStock } = require('../lib/sheets');

const bici = o => ({ tipo: 'bicicleta', marca: 'Raleigh', modelo: 'Mojave', numero_serie: 'B01', ubicacion: 'local', stock_actual: 1, stock_minimo: 1, estado_unidad: 'disponible', precio_max: 300000, ...o });
const series = () => sim.filas('STOCK').map(f => f.numero_serie);

sim.correr([
  ['agregar un producto no pisa una fila de STOCK que tiene el "tipo" (columna A) vacio', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'B01' }), bici({ numero_serie: 'B02', tipo: '' }), bici({ numero_serie: 'B03' })] });
    await appendRow('STOCK', bici({ numero_serie: 'B04' }));
    await sim.esperarRed();
    assert.deepStrictEqual(series(), ['B01', 'B02', 'B03', 'B04']);
  }],

  ['varias filas agregadas a la vez a la misma hoja quedan todas (no se pisan)', async () => {
    await sim.planilla({});
    await Promise.all(['MOV-1', 'MOV-2', 'MOV-3', 'MOV-4'].map(id => appendRow('HISTORIAL', { id_movimiento: id, estado: 'aprobado' })));
    await sim.esperarRed();
    assert.deepStrictEqual(sim.filas('HISTORIAL').map(f => f.id_movimiento), ['MOV-1', 'MOV-2', 'MOV-3', 'MOV-4']);
  }],

  ['si la fila nueva cae en un hueco, el bot recuerda la fila REAL (un cambio posterior no la duplica)', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'B01' }), bici({ numero_serie: 'B02' }), bici({ numero_serie: 'B03' })] });
    sim.hojas.STOCK[2] = [];                                        // alguien vacio a mano la fila 3 (B02)
    await appendRow('STOCK', bici({ numero_serie: 'B04' }));        // cae en el hueco de la fila 3
    await sim.esperarRed();
    await upsertRow('STOCK', { numero_serie: 'B04', stock_actual: '7' }, 'numero_serie');
    await sim.esperarRed();
    const b04 = sim.filas('STOCK').filter(f => f.numero_serie === 'B04');
    assert.strictEqual(b04.length, 1);
    assert.strictEqual(String(b04[0].stock_actual), '7');
  }],

  ['actualizar un producto escribe solo las celdas que cambian', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'B01', ficha_tecnica: 'vieja' })] });
    sim.hojas.STOCK[1][15] = 'ficha nueva escrita a mano';          // columna P (ficha_tecnica), editada despues de cargar el cache
    await upsertRow('STOCK', { numero_serie: 'B01', ubicacion: 'galpon' }, 'numero_serie');
    await sim.esperarRed();
    const [b] = sim.filas('STOCK');
    assert.strictEqual(b.ubicacion, 'galpon');
    assert.strictEqual(b.ficha_tecnica, 'ficha nueva escrita a mano');
  }],

  ['actualizar un producto que ya no esta en STOCK no crea una fila basura', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'B01' })] });
    await upsertRow('STOCK', { numero_serie: 'NO-EXISTE', ubicacion: 'galpon' }, 'numero_serie');
    await upsertRow('STOCK', { numero_serie: '', ubicacion: 'galpon' }, 'numero_serie');
    await sim.esperarRed();
    assert.deepStrictEqual(series(), ['B01']);
  }],

  ['la recarga del cache espera las escrituras pendientes (no "des-vende" lo recien vendido)', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'A01', tipo: 'accesorio', stock_actual: 5 })] });
    sim.demora.escritura = 60;                                      // Google tarda mas en escribir que en leer
    await upsertRow('STOCK', { numero_serie: 'A01', stock_actual: '4' }, 'numero_serie');
    await refreshCache();
    assert.strictEqual(cache.stock.find(p => p.numero_serie === 'A01').stock_actual, '4');
  }],

  ['el autocorrector de estados no escribe "vendido" en filas vacias', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'B01' }), [], bici({ numero_serie: 'B03' })] });
    assert.deepStrictEqual(sim.hojas.STOCK[2].filter(v => v !== '' && v != null), []);
  }],

  ['si SESIONES no carga al arrancar, se vuelve a intentar en la proxima recarga', async () => {
    await sim.planilla({ SESIONES: [{ telegram_id: 7, estado: 'WAIT_SEARCH', datos: '{}', ts: '' }] });
    state.cacheReady = false; state.sesionesCargadas = false; cache.sesiones = [];   // "reinicio" del bot
    sim.fallarLectura.add('SESIONES');
    await refreshCache();
    assert.strictEqual(cache.sesiones.length, 0);
    await refreshCache();
    assert.strictEqual(cache.sesiones.length, 1);
  }],

  ['ordenar STOCK con una fila vaciada a mano no deja productos duplicados abajo', async () => {
    await sim.planilla({ STOCK: [bici({ numero_serie: 'B01' }), bici({ numero_serie: 'B02', marca: 'Venzo' }), bici({ numero_serie: 'B03' })] });
    sim.hojas.STOCK[2] = [];                                        // B02 borrado a mano (fila vacia en el medio)
    await sortStock();
    await sim.esperarRed();
    assert.deepStrictEqual(series().sort(), ['B01', 'B03']);
  }],
]);

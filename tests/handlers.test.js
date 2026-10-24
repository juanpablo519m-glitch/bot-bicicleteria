'use strict';
// Tests de punta a punta: mensaje de Telegram -> lib/handlers.js -> planilla (todo falso, ver tests/simulador.js).
// Correr desde la raiz del repo:  node tests/handlers.test.js
const assert = require('assert');
const sim = require('./simulador');
const { cache, HEADERS } = require('../lib/sheets');
const { processUpdate } = require('../lib/handlers');

// Cada prueba usa gente nueva: el bot frena a quien manda mas de 30 mensajes por minuto.
let ultimoId = 10;
const persona = (rol, extra) => ({ telegram_id: ++ultimoId, nombre: `${rol} ${ultimoId}`, rol, activo: 'TRUE', fecha_alta: '', ...extra });
const bici = o => ({ tipo: 'bicicleta', marca: 'Raleigh', modelo: 'Mojave 2.0', numero_serie: 'B01', ubicacion: 'local', stock_actual: 1, stock_minimo: 1, estado_unidad: 'disponible', precio_costo: 100000, precio_max: 300000, precio_min: 250000, rodado: 29, talle: 17, color: 'Negro', ...o });
const acc = o => ({ tipo: 'accesorio', marca: 'Bell', modelo: 'Casco Sport', numero_serie: 'A01', ubicacion: 'local', stock_actual: 5, stock_minimo: 1, estado_unidad: 'disponible', precio_max: 15000, precio_min: 12000, ...o });
const mov = o => ({ id_movimiento: 'MOV-1', tipo: 'entrada', estado: 'pendiente', id_producto: 'B01', numero_serie: 'B01', cantidad: 2, referencia_doc: 'Factura 1', telegram_id_operador: 3, nombre_operador: 'Operador', fecha_creacion: '01-10-2026 10:00:00', ...o });
const porSerie = () => Object.fromEntries(sim.filas('STOCK').map(f => [f.numero_serie, f]));
const sesionDe = u => cache.sesiones.find(s => String(s.telegram_id) === String(u.telegram_id));
const ir = async (...updates) => { for (const u of updates) await processUpdate(u); await sim.esperarRed(); };
const ventaRapida = (u, serie, datos = 'Cliente, Efectivo') => ir(sim.boton(u.telegram_id, `vrap_${serie}`), sim.texto(u.telegram_id, datos), sim.boton(u.telegram_id, `vrap_ok_${serie}`));

sim.correr([
  ['aprobar dos veces el mismo movimiento (dos admins o doble toque) suma el stock UNA sola vez', async () => {
    const jp = persona('administrador'), rafa = persona('administrador');
    await sim.planilla({ USUARIOS: [jp, rafa], STOCK: [bici({ stock_actual: 1 })], MOVIMIENTOS_PENDIENTES: [mov({ cantidad: 2 })] });
    await ir(sim.boton(jp.telegram_id, 'apr_MOV-1'), sim.boton(rafa.telegram_id, 'apr_MOV-1'));
    assert.strictEqual(String(porSerie().B01.stock_actual), '3');
    assert.match(sim.ultimo(rafa.telegram_id).text, /ya fue aprobado/);
    assert.strictEqual(sim.filas('HISTORIAL').length, 1);
  }],

  ['un movimiento rechazado no se puede aprobar despues con un boton viejo', async () => {
    const jp = persona('administrador');
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici({ stock_actual: 1 })], MOVIMIENTOS_PENDIENTES: [mov({ estado: 'rechazado' })] });
    await ir(sim.boton(jp.telegram_id, 'apr_MOV-1'));
    assert.strictEqual(String(porSerie().B01.stock_actual), '1');
    assert.strictEqual(sim.filas('MOVIMIENTOS_PENDIENTES')[0].estado, 'rechazado');
  }],

  ['un movimiento aprobado no se puede rechazar despues (el stock ya cambio)', async () => {
    const jp = persona('administrador');
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici({ stock_actual: 3 })], MOVIMIENTOS_PENDIENTES: [mov({ estado: 'aprobado' })] });
    await ir(sim.boton(jp.telegram_id, 'rej_MOV-1'), sim.texto(jp.telegram_id, 'me equivoque'));
    assert.strictEqual(sim.filas('MOVIMIENTOS_PENDIENTES')[0].estado, 'aprobado');
    assert.strictEqual(sim.filas('HISTORIAL').length, 0);
  }],

  ['si el producto del movimiento no esta en STOCK, no se aprueba ni se dice "Stock actualizado"', async () => {
    const jp = persona('administrador');
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici({ numero_serie: 'B09' })], MOVIMIENTOS_PENDIENTES: [mov({ numero_serie: 'B01', id_producto: 'B01' })] });
    await ir(sim.boton(jp.telegram_id, 'apr_MOV-1'));
    assert.strictEqual(sim.filas('MOVIMIENTOS_PENDIENTES')[0].estado, 'pendiente');
    assert.doesNotMatch(sim.ultimo(jp.telegram_id).text, /Stock actualizado/);
  }],

  ['cargar varios productos por factura de proveedor guarda TODAS las filas en COMPRAS', async () => {
    const jp = persona('administrador');
    const productos = [1, 2, 3].map(i => ({ tipo: 'accesorio', marca: 'Marca' + i, modelo: 'Modelo' + i, cantidad: i, precio_unitario: '1000', rodado: '' }));
    await sim.planilla({ USUARIOS: [jp], COMPRAS: [], SESIONES: [{ telegram_id: jp.telegram_id, estado: 'FACT_PROV_CONF', datos: JSON.stringify({ productos, ubicacion: 'local', driveUrl: null }), ts: '' }] });
    await ir(sim.boton(jp.telegram_id, 'fprov_ok'));
    assert.deepStrictEqual(sim.filas('COMPRAS').map(f => f.marca), ['Marca1', 'Marca2', 'Marca3']);
  }],

  ['dos ventas al mismo tiempo (dos personas) quedan las dos en VENTAS_ACCESORIOS', async () => {
    const jp = persona('administrador'), rafa = persona('administrador');
    await sim.planilla({ USUARIOS: [jp, rafa], STOCK: [acc({ stock_actual: 5 })], VENTAS_ACCESORIOS: [] });
    await ir(sim.boton(jp.telegram_id, 'vrap_A01'), sim.texto(jp.telegram_id, 'Ana, Efectivo'), sim.boton(rafa.telegram_id, 'vrap_A01'), sim.texto(rafa.telegram_id, 'Beto, Debito'));
    await Promise.all([processUpdate(sim.boton(jp.telegram_id, 'vrap_ok_A01')), processUpdate(sim.boton(rafa.telegram_id, 'vrap_ok_A01'))]);
    await sim.esperarRed();
    assert.deepStrictEqual(sim.filas('VENTAS_ACCESORIOS').map(f => f.nombre).sort(), ['Ana', 'Beto']);
    assert.strictEqual(String(porSerie().A01.stock_actual), '3');
  }],

  ['vender no pisa lo que alguien cambio a mano en la planilla (precio editado hace segundos)', async () => {
    const jp = persona('administrador');
    await sim.planilla({ USUARIOS: [jp], STOCK: [acc({ stock_actual: 5, precio_max: 10000 })], VENTAS_ACCESORIOS: [] });
    sim.hojas.STOCK[1][HEADERS.STOCK.indexOf('precio_max')] = 12000;   // edicion a mano: el cache del bot no se entero
    await ventaRapida(jp, 'A01');
    assert.strictEqual(String(porSerie().A01.stock_actual), '4');
    assert.strictEqual(String(porSerie().A01.precio_max), '12000');
  }],

  ['si alguien reordena STOCK a mano, la venta descuenta el producto correcto y no pisa otra fila', async () => {
    const jp = persona('administrador');
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici({ numero_serie: 'B01' }), bici({ numero_serie: 'B02', modelo: 'Talon' })], VENTAS_BICICLETAS: [] });
    const [enc, f1, f2] = sim.hojas.STOCK;
    sim.hojas.STOCK.splice(0, 3, enc, f2, f1);                          // orden a mano: B02 queda arriba
    await ventaRapida(jp, 'B01');
    const s = porSerie();
    assert.strictEqual(sim.filas('STOCK').length, 2);
    assert.strictEqual(String(s.B01.stock_actual), '0');
    assert.strictEqual(String(s.B02.stock_actual), '1');
    assert.strictEqual(s.B02.modelo, 'Talon');
  }],

  ['un desconocido que manda un audio no gasta la cuenta de Groq', async () => {
    await sim.planilla({ USUARIOS: [persona('administrador')] });
    sim.telegram.transcripcion = 'stock';
    await ir(sim.mensaje(999, { voice: { file_id: 'v1' } }));
    assert.ok(!sim.llamadas.some(l => l.url.includes('groq')), 'llamo a Groq');
    assert.match(sim.ultimo(999).text, /No estás registrado/);
  }],

  ['"activo" marcado como casilla (true/false) se respeta: se avisa a los admins y se bloquea al inactivo', async () => {
    const jp = persona('administrador'), rafa = persona('administrador', { activo: true }), ex = persona('operador', { activo: false });
    await sim.planilla({ USUARIOS: [jp, rafa, ex], STOCK: [bici()] });
    await ir(sim.texto(ex.telegram_id, '/start'));
    assert.match(sim.ultimo(ex.telegram_id).text, /inactiva/);
    const j = jp.telegram_id;
    await ir(sim.boton(j, 'movimiento'), sim.boton(j, 'mov_exist'), sim.boton(j, 'mov_e'), sim.texto(j, 'B01'), sim.texto(j, '2'), sim.texto(j, 'Remito 5'), sim.boton(j, 'mov_ok'));
    assert.ok(sim.mensajesA(rafa.telegram_id).some(m => /Nuevo movimiento/.test(m.text)), 'Rafael no recibio el aviso');
  }],

  ['un boton viejo de venta no vende dos veces la misma bici', async () => {
    const jp = persona('administrador'), rafa = persona('administrador');
    await sim.planilla({ USUARIOS: [jp, rafa], STOCK: [bici({ stock_actual: 1 })], VENTAS_BICICLETAS: [] });
    await ir(sim.boton(rafa.telegram_id, 'vrap_B01'));          // Rafael abre la venta y la deja a medias
    await ventaRapida(jp, 'B01');                              // Juan Pablo la vende
    await ir(sim.texto(rafa.telegram_id, 'Pedro, Efectivo'), sim.boton(rafa.telegram_id, 'vrap_ok_B01'));
    assert.strictEqual(sim.filas('VENTAS_BICICLETAS').length, 1);
    assert.match(sim.ultimo(rafa.telegram_id).text, /sin stock|vendid/i);
  }],

  ['confirmar con el boton de OTRA venta no mezcla los datos de las dos', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici({ numero_serie: 'B01' }), bici({ numero_serie: 'B02', modelo: 'Talon' })], VENTAS_BICICLETAS: [], FACTURAS: [] });
    await ir(sim.boton(j, 'vender_B01'), sim.texto(j, 'Ana, Calle 1, 12345678, B, 300000, Efectivo'));
    await ir(sim.boton(j, 'vender_B02'), sim.texto(j, 'Beto, Calle 2, 23456789, B, 280000, Debito'));
    await ir(sim.boton(j, 'venta_ok_B01'));                     // toca el "Confirmar" viejo, el de B01
    assert.strictEqual(sim.filas('FACTURAS').length, 0);
    assert.strictEqual(String(porSerie().B01.stock_actual), '1');
    await ir(sim.boton(j, 'venta_ok_B02'));
    assert.deepStrictEqual(sim.filas('FACTURAS').map(f => [f.nombre, f.numero_serie]), [['Beto', 'B02']]);
    assert.strictEqual(String(porSerie().B02.stock_actual), '0');
  }],

  ['"Editar" en Registrar Venta pide los mismos 4 datos que despues se leen (con el nombre)', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp], VENTAS_ACCESORIOS: [] });
    await ir(sim.boton(j, 'vr_acc'), sim.texto(j, 'Ana, Casco, 15000, Efectivo'), sim.boton(j, 'vr_edit'));
    assert.match(sim.ultimo(j).text, /Nombre cliente, Descripción, Precio, Forma de pago/);
    assert.match(sim.ultimo(j).text, /Ana, Casco, 15000, Efectivo/);
  }],

  ['carga manual por factura: el ejemplo que muestra el bot se lee bien (cantidad, precio y rodado)', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp] });
    await ir(sim.boton(j, 'fact_prov_texto'));
    const ejemplo = (sim.ultimo(j).text.match(/<code>(bicicleta, [^\n<]+)/) || [])[1];
    assert.ok(ejemplo, 'no encontre el ejemplo en el mensaje');
    await ir(sim.texto(j, ejemplo));
    const leido = () => JSON.parse(sesionDe(jp).datos).productos.map(p => [p.marca, p.cantidad, p.precio_unitario, p.rodado]);
    assert.deepStrictEqual(leido(), [['Raleigh', 2, '150000', '26']]);
    // quien ya se acostumbro al formato viejo (con descripcion) tampoco carga datos corridos
    await ir(sim.boton(j, 'fact_prov_texto'), sim.texto(j, 'bicicleta, Raleigh, Scout 2.0, MTB aluminio doble disco, 2, 150000, 26'));
    assert.deepStrictEqual(leido(), [['Raleigh', 2, '150000', '26']]);
  }],

  ['"Crear con serie nueva (auto)" crea el producto con una serie NUEVA, no con la repetida', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici({ numero_serie: 'B05', modelo: '7.0', color: 'Negro', talle: 17 })], MOVIMIENTOS_PENDIENTES: [] });
    await ir(sim.boton(j, 'movimiento'), sim.boton(j, 'mov_nuevo'), sim.texto(j, 'bicicleta, Raleigh, 7.0, 300000, 1, 29, 17, Negro, B05, 1, Compra'));
    const kb = sim.ultimo(j).reply_markup.inline_keyboard.flat();
    const nueva = kb.find(b => /serie nueva/.test(b.text));
    await ir(sim.boton(j, nueva.callback_data));
    const series = sim.filas('STOCK').map(f => f.numero_serie);
    assert.deepStrictEqual(series, ['B05', 'B06']);
    assert.strictEqual(sim.filas('MOVIMIENTOS_PENDIENTES')[0].numero_serie, 'B06');
  }],

  ['"Cancelar" al agregar una foto cancela de verdad (despues se puede buscar)', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici()] });
    await ir(sim.boton(j, 'foto_B01'), sim.boton(j, 'ficha_B01'), sim.texto(j, 'mojave'));
    assert.doesNotMatch(sim.ultimo(j).text, /Necesito una foto/);
    assert.match(sim.ultimo(j).text, /Mojave/);
  }],

  ['"Consultar Stock" encuentra una busqueda de dos palabras (igual que escribir sin tocar el boton)', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp], STOCK: [bici(), bici({ numero_serie: 'B02', marca: 'Venzo', modelo: 'Loki' })] });
    await ir(sim.boton(j, 'stock'), sim.texto(j, 'raleigh mojave'));
    assert.doesNotMatch(sim.ultimo(j).text, /No encontré/);
    assert.match(sim.ultimo(j).text, /Raleigh Mojave/);
  }],

  ['la lista de variantes de un modelo no ofrece unidades ya vendidas', async () => {
    const jp = persona('administrador'), j = jp.telegram_id;
    await sim.planilla({ USUARIOS: [jp], STOCK: [
      bici({ numero_serie: 'B01', talle: 17 }), bici({ numero_serie: 'B02', talle: 19, stock_actual: 0, estado_unidad: 'vendido' }),
      bici({ numero_serie: 'B03', modelo: 'Otra' }),
    ] });
    await ir(sim.boton(j, 'grp_B01'));
    assert.deepStrictEqual(sim.botonesDe(sim.ultimo(j)).filter(c => /^(prod|vgrp)_/.test(c)), ['prod_B01']);
  }],
]);

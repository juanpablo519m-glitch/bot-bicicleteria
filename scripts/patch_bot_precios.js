'use strict';
const fs = require('fs');
const path = require('path');

const toolResultPath = 'C:\\Users\\Usuario\\.claude\\projects\\c--Users-Usuario-Desktop-PROGRAMADOR-N8N-BICICLETERIA\\c0b89003-0c7e-487b-afbb-aa589b1d27d8\\tool-results\\toolu_018E473T9oWGp66gh4yuVNXX.json';

const raw = fs.readFileSync(toolResultPath, 'utf8');
const data = JSON.parse(raw);
const wf = JSON.parse(data[0].text);
const nodes = wf.data.nodes;
const botMain = nodes.find(n => n.id === 'bot-main');
let code = botMain.parameters.jsCode;

// Reemplazar la línea de precio_venta por los dos precios
const OLD = "${stk} | $${p.precio_venta||'-'}\\n\\n`";
const NEW = "${stk}\\n💰 Máx: $${p.precio_max||'-'} | Mín: $${p.precio_min||'-'}\\n\\n`";

if (!code.includes(OLD)) {
  console.error('No se encontró el fragmento a reemplazar. Buscando contexto...');
  const idx = code.indexOf('precio_venta');
  console.log('Contexto:', JSON.stringify(code.substring(idx - 30, idx + 50)));
  process.exit(1);
}

const updated = code.replace(OLD, NEW);
console.log('✅ Reemplazo realizado.');

// Verificar
const idx = updated.indexOf('precio_max');
console.log('Nuevo contexto:', updated.substring(idx - 30, idx + 80));

// Guardar el código actualizado
fs.writeFileSync(path.join(__dirname, 'bot_code_updated.txt'), updated);
console.log('✅ Código guardado en bot_code_updated.txt');
console.log('Longitud código:', updated.length);

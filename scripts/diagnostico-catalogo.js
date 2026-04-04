/**
 * diagnostico-catalogo.js
 * Lee el catálogo completo y muestra un mapa de proveedores,
 * rangos de filas, cantidad de códigos y ejemplos.
 * Uso: node scripts/diagnostico-catalogo.js
 */
require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');

const SHEET_ID = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';

const SA = { client_email: process.env.SA_EMAIL, private_key: (process.env.SA_PRIVATE_KEY||'').replace(/\\n/g,'\n') };
let _tok = { token: null, exp: 0 };
async function getToken() {
  if (_tok.token && _tok.exp > Date.now()+60000) return _tok.token;
  const now = Math.floor(Date.now()/1000);
  const hdr = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const cls = Buffer.from(JSON.stringify({iss:SA.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(hdr+'.'+cls);
  const sig = signer.sign(SA.private_key).toString('base64url');
  const jwt = hdr+'.'+cls+'.'+sig;
  const body = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+jwt;
  return new Promise((res,rej)=>{
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);_tok={token:j.access_token,exp:Date.now()+3500000};res(j.access_token);})});
    req.on('error',rej);req.write(body);req.end();
  });
}
function sheetGet(url,hdrs){return new Promise((res,rej)=>{const u=new URL(url);const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method:'GET',headers:hdrs},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))});req.on('error',rej);req.end();})}

async function main(){
  const token = await getToken();
  const base  = 'https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID;

  console.log('Leyendo catálogo completo...\n');
  const resp = await sheetGet(base+'/values/CATALOGO_PROVEEDORES!A2:D5000', { Authorization:'Bearer '+token });
  const rows = resp.values || [];

  // Agrupar por proveedor
  const proveedores = {}; // { nombre: { filas:[], codigos:[], conCosto:0, sinCosto:0 } }

  rows.forEach((row, i) => {
    const prov  = (row[0]||'').toLowerCase().trim() || '(vacío)';
    const cod   = (row[1]||'').trim();
    const costo = parseFloat((row[3]||'0').replace(',','.'));
    const fila  = i + 2; // fila real en sheet (empieza en 2)

    if (!proveedores[prov]) proveedores[prov] = { filas:[], codigos:[], conCosto:0, sinCosto:0 };
    const p = proveedores[prov];
    p.filas.push(fila);
    if (cod) p.codigos.push(cod);
    if (costo > 0) p.conCosto++; else p.sinCosto++;
  });

  const nombres = Object.keys(proveedores).filter(n => n !== '(vacío)');

  console.log('═══════════════════════════════════════════════════════');
  console.log(' MAPA DEL CATÁLOGO DE PROVEEDORES');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const nombre of nombres) {
    const p = proveedores[nombre];
    const filaMin = Math.min(...p.filas);
    const filaMax = Math.max(...p.filas);
    const total   = p.codigos.length;

    // Ejemplos: primeros 3 códigos y últimos 2
    const ejemplos = total <= 5
      ? p.codigos.slice(0,5)
      : [...p.codigos.slice(0,3), '...', ...p.codigos.slice(-2)];

    console.log(`Proveedor : ${nombre.toUpperCase()}`);
    console.log(`Filas     : ${filaMin} → ${filaMax}`);
    console.log(`Códigos   : ${total} total (${p.conCosto} con costo, ${p.sinCosto} sin costo)`);
    console.log(`Ejemplos  : ${ejemplos.join(' | ')}`);
    console.log('───────────────────────────────────────────────────────');
  }

  console.log(`\nTotal filas leídas: ${rows.length}`);
  console.log(`Total proveedores:  ${nombres.length}`);

  // Verificar codigos del STOCK contra catálogo
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' VERIFICACIÓN: CODIGOS EN STOCK vs CATÁLOGO');
  console.log('═══════════════════════════════════════════════════════\n');

  const stockResp = await sheetGet(base+'/values/STOCK!B2:T107', { Authorization:'Bearer '+token });
  const stockRows = stockResp.values || [];
  const catalogSet = new Set(rows.map(r=>(r[1]||'').trim().toLowerCase().replace(/_/g,'-')));

  const sinMatch = [], conMatch = [];
  for (const row of stockRows) {
    const marca  = row[0]||'';
    const modelo = row[1]||'';
    const serie  = row[2]||'';
    const cod    = (row[18]||'').trim(); // T = índice 18 relativo a B
    if (!cod || cod.toLowerCase()==='n/n') continue;
    const codN = cod.toLowerCase().replace(/_/g,'-');
    // Buscar exacto o por prefijo
    const exacto = catalogSet.has(codN);
    const prefijo = !exacto && [...catalogSet].some(c=>{
      const base2 = codN.includes('-') ? codN.split('-')[0] : codN;
      return codN.includes('-')
        ? c.startsWith(codN) && c.split('-')[0]===base2
        : c.includes('-') && c.split('-')[0]===base2;
    });
    if (exacto || prefijo) {
      conMatch.push({ serie, marca, modelo, cod, tipo: exacto?'exacto':'prefijo' });
    } else {
      sinMatch.push({ serie, marca, modelo, cod });
    }
  }

  console.log(`✅ Con match (${conMatch.length}):`);
  conMatch.forEach(r=>console.log(`   ${r.serie.padEnd(5)} ${r.marca.padEnd(12)} ${r.modelo.padEnd(20)} → ${r.cod} (${r.tipo})`));

  if (sinMatch.length) {
    console.log(`\n❌ Sin match en catálogo (${sinMatch.length}):`);
    sinMatch.forEach(r=>console.log(`   ${r.serie.padEnd(5)} ${r.marca.padEnd(12)} ${r.modelo.padEnd(20)} → ${r.cod}`));
  } else {
    console.log('\n✅ Todos los códigos del stock tienen match en el catálogo.');
  }
}

main().catch(e=>{ console.error('❌', e.message); process.exit(1); });

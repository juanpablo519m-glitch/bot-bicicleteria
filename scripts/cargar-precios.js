require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');

const SHEET_ID = '1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps';
const RECARGOS = { 'dal santo': 0.05, 'stark': 0.21, 'aries comercial': 0.21 };

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
function sheetPost(url,data,hdrs){return new Promise((res,rej)=>{const body=JSON.stringify(data);const u=new URL(url);const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method:'POST',headers:{...hdrs,'Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))});req.on('error',rej);req.write(body);req.end();})}

const normCod = s => (s||'').trim().toLowerCase().replace(/_/g,'-');
const round100 = n => Math.round(n/100)*100;

async function main(){
  const token = await getToken();
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID;
  const hdrs = { Authorization: 'Bearer '+token };

  // Leer catalogo completo
  const catResp = await sheetGet(base+'/values/CATALOGO_PROVEEDORES!A2:D3000', hdrs);
  const catalogo = (catResp.values||[])
    .map(r=>({ proveedor:(r[0]||'').toLowerCase().trim(), codigo: normCod(r[1]), costo: parseFloat((r[3]||'0').replace(',','.')) }))
    .filter(r=>r.costo>0);

  // Leer stock: columna D (serie) y T (codigo_proveedor)
  // D2:T107 = 17 columnas (D=0, E=1 ... T=16)
  const stockResp = await sheetGet(base+'/values/STOCK!D2:T107', hdrs);
  const rows = stockResp.values||[];

  // { rowNum (en sheet, base 2), costo, pmax, pmin }
  const updates = [];
  let matches=0, omitidos=0;

  for(let i=0; i<rows.length; i++){
    const row     = rows[i];
    const serie   = row[0]||'';
    const codProv = normCod(row[16]||''); // T es índice 16
    const sheetRow = i + 2; // fila real en el sheet

    if(!codProv || codProv==='n/n'){
      omitidos++;
      continue; // sin código → no tocar precios manuales
    }

    // 1. Exacto
    let item = catalogo.find(c=>c.codigo===codProv);

    // 2. Prefijo
    if(!item){
      const base2 = codProv.includes('-') ? codProv.split('-')[0] : codProv;
      const cands = codProv.includes('-')
        ? catalogo.filter(c=>{ const cc=c.codigo; return cc.startsWith(codProv) && cc!==codProv && cc.split('-')[0]===base2; })
        : catalogo.filter(c=>{ const cc=c.codigo; return cc!==codProv && cc.includes('-') && cc.split('-')[0]===base2; });
      if(cands.length){
        const esH = cod => { const extra=cod.slice(codProv.length); return /^h/i.test(extra)||/h[a-z\d]+$/.test(cod.split('-').pop()); };
        cands.sort((a,b)=>{ const aH=esH(a.codigo)?1:0, bH=esH(b.codigo)?1:0; return aH!==bH?aH-bH:a.codigo.length-b.codigo.length; });
        item=cands[0];
      }
    }

    if(!item){
      omitidos++;
      continue; // código sin match en catálogo → no tocar
    }

    const recargo = RECARGOS[item.proveedor] ?? 0;
    const costoFinal = item.costo*(1+recargo);
    const costo  = Math.round(costoFinal);
    const pmax   = round100(costoFinal*1.60);
    const pmin   = round100(costoFinal*1.35);
    updates.push({ sheetRow, costo, pmax, pmin });
    matches++;
    console.log(serie.padEnd(5)+' | '+row[16].padEnd(20)+' → costo:'+costo+' max:'+pmax+' min:'+pmin);
  }

  console.log('\nMatches: '+matches+' / Omitidos (sin tocar): '+omitidos);

  if(!updates.length){ console.log('Nada que actualizar.'); return; }

  // Escribir solo las filas con match, una por una en batch
  const data = {
    valueInputOption: 'USER_ENTERED',
    data: updates.map(u=>({
      range: `STOCK!J${u.sheetRow}:L${u.sheetRow}`,
      values: [[u.costo, u.pmax, u.pmin]]
    }))
  };
  const r = await sheetPost(
    base+'/values:batchUpdate',
    data,
    {Authorization:'Bearer '+token,'Content-Type':'application/json'}
  );
  console.log('✅ Precios actualizados: '+r.totalUpdatedCells+' celdas ('+updates.length+' productos)');
}
main().catch(e=>{console.error('❌',e.message);process.exit(1);});

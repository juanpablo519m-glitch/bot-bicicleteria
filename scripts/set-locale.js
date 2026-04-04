require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');
const SA = { client_email: process.env.SA_EMAIL, private_key: (process.env.SA_PRIVATE_KEY||'').replace(/\\n/g,'\n') };

async function getToken(){
  const now=Math.floor(Date.now()/1000);
  const hdr=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const cls=Buffer.from(JSON.stringify({iss:SA.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const sg=crypto.createSign('RSA-SHA256'); sg.update(hdr+'.'+cls);
  const sig=sg.sign(SA.private_key).toString('base64url');
  const jwt=hdr+'.'+cls+'.'+sig;
  const body='grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+jwt;
  return new Promise((res,rej)=>{
    const req=https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d).access_token));});
    req.on('error',rej);req.write(body);req.end();
  });
}

(async()=>{
  const token = await getToken();
  const payload = JSON.stringify({
    requests:[{ updateSpreadsheetProperties:{ properties:{ locale:'es_AR' }, fields:'locale' } }]
  });
  const result = await new Promise((res,rej)=>{
    const req=https.request({
      hostname:'sheets.googleapis.com',
      path:'/v4/spreadsheets/1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps:batchUpdate',
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}
    },r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));});
    req.on('error',rej);req.write(payload);req.end();
  });
  if(result.error) console.error('Error:',result.error.message);
  else console.log('✅ Locale cambiado a es_419 (Argentina) — los números ahora usan puntos como separador de miles');
})();

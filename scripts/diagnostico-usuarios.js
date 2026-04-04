require('dotenv').config();
const https  = require('https');
const crypto = require('crypto');
const SA = { client_email: process.env.SA_EMAIL, private_key: (process.env.SA_PRIVATE_KEY||'').replace(/\\n/g,'\n') };
let _tok = { token: null, exp: 0 };
async function getToken() {
  const now = Math.floor(Date.now()/1000);
  const hdr = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const cls = Buffer.from(JSON.stringify({iss:SA.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const sg = crypto.createSign('RSA-SHA256'); sg.update(`${hdr}.${cls}`);
  const sig = sg.sign(SA.private_key).toString('base64url');
  const jwt = `${hdr}.${cls}.${sig}`;
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  return new Promise((res,rej) => {
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);_tok={token:j.access_token,exp:Date.now()+3500000};res(j.access_token);});});
    req.on('error',rej);req.write(body);req.end();
  });
}
function api(method, path, data, token) {
  return new Promise((res,rej) => {
    const body = data ? JSON.stringify(data) : null;
    const req = https.request({hostname:'sheets.googleapis.com',path,method,
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json',...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));});
    req.on('error',rej); if(body) req.write(body); req.end();
  });
}
(async()=>{
  const token = await getToken();
  // Ver formato real de las celdas A1:E3 con includeGridData
  const meta = await api('GET',
    `/v4/spreadsheets/1qTMua-CQOeR3HrbcoCwoJKi9kW8foeEnzQhxIRKd3ps?ranges=USUARIOS!A1:E3&includeGridData=true&fields=sheets.data.rowData.values.userEnteredFormat.backgroundColor`,
    null, token);
  const rows = meta.sheets[0].data[0].rowData || [];
  rows.forEach((row, ri) => {
    const colors = (row.values || []).map(c => {
      const bg = c.userEnteredFormat?.backgroundColor;
      if (!bg) return 'sin color';
      return `rgb(${Math.round((bg.red||0)*255)},${Math.round((bg.green||0)*255)},${Math.round((bg.blue||0)*255)})`;
    });
    console.log(`Fila ${ri+1}:`, colors.join(' | '));
  });
})().catch(console.error);

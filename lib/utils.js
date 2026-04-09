'use strict';

function now() {
  return new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).split('/').join('-').replace(', ', ' ');
}

const EMPTY_VALS = new Set(['-', 'n/n', 'n/a', '']);
const isEmpty = v => !v || EMPTY_VALS.has((v + '').toLowerCase().trim());

function norm(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => i||j));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function fuzzy(query, target) {
  const q = norm(query), t = norm(target);
  if (!q) return false;
  if (t.includes(q)) return true;
  if (q.length < 3) return false;
  return t.split(/\s+/).some(w => levenshtein(q,w) <= Math.max(1, Math.floor(q.length/3)));
}

function normalizarCampos(p) {
  let modelo = (p.modelo || '').trim();
  let rodado = isEmpty(p.rodado) ? '' : String(p.rodado);
  let talle  = isEmpty(p.talle)  ? '' : String(p.talle);
  if (!rodado) {
    const mRod = modelo.match(/\bR(\d+(?:\.\d+)?)\b/i);
    if (mRod) { rodado = mRod[1]; modelo = modelo.replace(mRod[0], '').trim(); }
  }
  if (!talle) {
    const mTalle = modelo.match(/\b(\d+(?:\.\d+)?)[""]\s*$/);
    if (mTalle) { talle = mTalle[1]; modelo = modelo.replace(mTalle[0], '').trim(); }
  }
  return { modelo, rodado, talle };
}

module.exports = { now, EMPTY_VALS, isEmpty, norm, levenshtein, fuzzy, normalizarCampos };

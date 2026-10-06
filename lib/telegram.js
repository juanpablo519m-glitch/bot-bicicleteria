'use strict';
const axios = require('axios');
const { TG } = require('./config');

async function tgPost(method, body) {
  try { return (await axios.post(`${TG}/${method}`, body)).data; }
  catch (e) { console.error(`[tg] ${method}:`, e.response?.data?.description || e.message); return null; }
}
// Si Telegram rechaza el HTML (un "<" o "&" suelto en una marca, modelo, descripcion o nombre de cliente)
// el mensaje se perdia entero y el bot parecia colgado. Ahora se reintenta como texto plano, con el mismo
// teclado, y se anota el motivo exacto (simulacros 06/10/2026; mismo arreglo que Pandora).
function aTextoPlano(t) {
  return String(t == null ? '' : t)
    .replace(/<\/?(b|strong|i|em|u|ins|s|strike|del|code|pre|a|span|tg-spoiler|blockquote)(\s[^>]*)?>/gi, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
async function tgSend(chatId, text, kb) {
  const b = { chat_id: String(chatId), text, parse_mode: 'HTML' };
  if (kb) b.reply_markup = { inline_keyboard: kb };
  try { return (await axios.post(`${TG}/sendMessage`, b)).data; }
  catch (e) {
    const motivo = e.response?.data?.description || e.message;
    if (e.response?.status === 400 && /parse entities/i.test(motivo)) {
      console.warn(`[tg] sendMessage: HTML rechazado (${motivo}): va como texto plano`);
      const plano = { chat_id: b.chat_id, text: aTextoPlano(text) };
      if (b.reply_markup) plano.reply_markup = b.reply_markup;
      return tgPost('sendMessage', plano);
    }
    console.error('[tg] sendMessage:', motivo);
    return null;
  }
}
async function tgAnswer(cbId) { return tgPost('answerCallbackQuery', { callback_query_id: cbId, text: '' }); }

function mainMenu(rol) {
  const kb = [[{ text: '📦 Consultar Stock', callback_data: 'stock' }]];
  if (['operador','aprobador','administrador'].includes(rol)) {
    kb.push([{ text: '💰 Registrar Venta', callback_data: 'venta_rapida' }]);
    kb.push([{ text: '🔄 Transferir Producto', callback_data: 'transf2' }]);
  }
  if (rol === 'administrador') kb.push([{ text: '⚙️ Panel Admin', callback_data: 'admin' }]);
  return kb;
}

const _rl = {};
function rateLimit(userId) {
  const now = Date.now();
  if (!_rl[userId] || now - _rl[userId].ts > 60000) _rl[userId] = { count: 0, ts: now };
  _rl[userId].count++;
  return _rl[userId].count > 30;
}

module.exports = { tgPost, tgSend, tgAnswer, mainMenu, rateLimit };

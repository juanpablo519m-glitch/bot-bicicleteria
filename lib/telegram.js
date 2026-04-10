'use strict';
const axios = require('axios');
const { TG } = require('./config');

async function tgPost(method, body) {
  try { return (await axios.post(`${TG}/${method}`, body)).data; }
  catch (e) { console.error(`[tg] ${method}:`, e.response?.data?.description || e.message); return null; }
}
async function tgSend(chatId, text, kb) {
  const b = { chat_id: String(chatId), text, parse_mode: 'HTML' };
  if (kb) b.reply_markup = { inline_keyboard: kb };
  return tgPost('sendMessage', b);
}
async function tgAnswer(cbId) { return tgPost('answerCallbackQuery', { callback_query_id: cbId, text: '' }); }

function mainMenu(rol) {
  const kb = [[{ text: '📦 Consultar Stock', callback_data: 'stock' }]];
  if (['operador','aprobador','administrador'].includes(rol)) {
    kb.push([{ text: '💰 Registrar Venta', callback_data: 'venta_rapida' }]);
    kb.push([{ text: '📋 Registrar Movimiento', callback_data: 'movimiento' }]);
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

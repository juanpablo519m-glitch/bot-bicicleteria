'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID  = process.env.SHEET_ID;

module.exports = {
  PORT:    process.env.PORT || 3000,
  BOT_TOKEN,
  TG:      `https://api.telegram.org/bot${BOT_TOKEN}`,
  ADMIN_ID: process.env.ADMIN_ID || '5307233657',
  GROQ_KEY: process.env.GROQ_KEY,
  SHEET_ID,
  SHEETS_BASE:       'https://sheets.googleapis.com/v4/spreadsheets',
  N8N_DRIVE_WEBHOOK: process.env.N8N_DRIVE_WEBHOOK || 'https://bicicleteria-n8n.fs5can.easypanel.host/webhook/drive-upload',
  SA: {
    client_email: process.env.SA_EMAIL,
    private_key:  (process.env.SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  RECARGO_PROVEEDOR: {
    'dal santo':       0.05,
    'stark':           0.21,
    'aries comercial': 0.21,
  },
  round5000: n => Math.round(n / 5000) * 5000,
  normCod:   s => (s||'').trim().toLowerCase().replace(/_/g, '-'),
};

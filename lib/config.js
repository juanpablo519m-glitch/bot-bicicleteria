'use strict';

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID  = process.env.SHEET_ID;

module.exports = {
  PORT:    process.env.PORT || 3000,
  BOT_TOKEN,
  TG:      `https://api.telegram.org/bot${BOT_TOKEN}`,
  WEBHOOK_URL: process.env.WEBHOOK_URL || 'https://bicicleteria-bot-bicicleteria.fs5can.easypanel.host/webhook',
  ADMIN_ID: process.env.ADMIN_ID || '5307233657',
  GROQ_KEY: process.env.GROQ_KEY,
  SHEET_ID,
  SHEETS_BASE:       'https://sheets.googleapis.com/v4/spreadsheets',
  // ── Drive: subir las fotos al Drive de Juan Pablo (31/10/2026) ──────────────────────────────
  // Antes esto lo hacia n8n (webhook -> su OAuth -> Drive). n8n quedo APAGADO y, peor, su permiso
  // estaba VENCIDO desde hacia meses: su proyecto de Google estaba en modo "Prueba" y ahi Google
  // vence los permisos a los 7 dias. Resultado: desde abril de 2026 ninguna foto llegaba a Drive
  // (el bot no se rompia: guardaba la referencia de Telegram). Ahora sube el bot, directo.
  // El permiso es de SU cuenta y vive SOLO en las variables del servicio (este repo es PUBLICO).
  GOOGLE_OAUTH: {
    client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH,
  },
  // Las mismas carpetas de siempre, las que el ya tenia (no se crean nuevas).
  DRIVE_FOTOS:    process.env.DRIVE_FOTOS    || '1xfsZN_ihAFTkLVcaQlMWM5m0jwN-M7OD',   // "Fotos Bicis": las que empiezan con producto_
  DRIVE_FACTURAS: process.env.DRIVE_FACTURAS || '1U-o_gMKtbxYDkWM_LWeZUTc2LdpxJuIP',   // "Bicicleteria-Bot": facturas y lo demas
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

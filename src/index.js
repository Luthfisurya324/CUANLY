import 'dotenv/config';
import express from 'express';
import dns from 'dns';
import { createLogger } from './utils/logger.js';
import { startWhatsApp, getCurrentQR } from './core/whatsapp.js';
import { startTelegramBot } from './core/telegram.js';

// WORKAROUND UNTUK HUGGING FACE: Force IPv4 untuk node-fetch dan Websocket
// Ini akan memperbaiki error "Client network socket disconnected before secure TLS connection was established"
dns.setDefaultResultOrder('ipv4first');

const app = express();
const port = process.env.PORT || 7860;

app.get('/', (req, res) => {
  const qr = getCurrentQR();
  if (qr) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
    res.send(`
      <html>
        <head>
          <title>Login Cuanly Bot</title>
          <meta http-equiv="refresh" content="5">
        </head>
        <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#111827; color: white;">
          <h2>📱 Scan QR Code untuk Login WhatsApp</h2>
          <img src="${qrImageUrl}" alt="QR Code" style="border: 10px solid white; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: 20px; width: 300px; height: 300px;" />
          <p>Buka WhatsApp di HP lo &gt; Linked Devices &gt; Link a Device</p>
          <p style="color:#9ca3af; font-size: 14px;">(Halaman ini otomatis refresh setiap 5 detik)</p>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#111827; color: #10b981;">
          <h1>✅ Cuanly Bot is running 24/7! 🚀</h1>
          <p style="color: white;">Bot sudah terhubung ke WhatsApp.</p>
        </body>
      </html>
    `);
  }
});

app.listen(port, () => {
  console.log(`Health check server running on port ${port}`);
});

const logger = createLogger('main');

/**
 * ============================================
 *  CUANLY — Bot WA Pencatat Keuangan AI Gen Z
 * ============================================
 *
 * Dual-AI Engine:
 *   1. Chutes  → Parse natural language → JSON transaksi
 *   2. Chutes  → Generate roasting Gen Z yang viral
 *
 * Arsitektur:
 *   src/
 *   ├── index.js           ← Entry point (ini)
 *   ├── core/
 *   │   ├── whatsapp.js    ← Koneksi Baileys & handler pesan
 *   │   └── router.js      ← Routing pesan → handler yang tepat
 *   ├── services/
 *   │   ├── gemini.js      ← AI Engine 1: Parsing
 *   │   └── roaster.js     ← AI Engine 2: Roasting
 *   └── utils/
 *       └── logger.js      ← Logging utility
 */
async function main() {
  logger.info('🚀 Cuanly bot starting...');

  // Validasi env vars
  const requiredEnvs = ['CHUTES_API_KEY', 'DATABASE_URL', 'TELEGRAM_TOKEN'];
  const missing = requiredEnvs.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.warn(`⚠️  Missing env vars: ${missing.join(', ')}`);
    logger.warn('   Bot tetap jalan, tapi AI features akan pakai fallback.');
  }

  // Start Telegram Bot
  startTelegramBot();

  // Start WhatsApp connection
  await startWhatsApp();
}

main().catch(err => {
  logger.error(err, '💀 Fatal error, bot crashed');
  process.exit(1);
});

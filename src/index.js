import 'dotenv/config';
import { createLogger } from './utils/logger.js';
import { startWhatsApp } from './core/whatsapp.js';
import { startTelegramBot } from './core/telegram.js';

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
  const requiredEnvs = ['GEMINI_API_KEY', 'GROQ_API_KEY'];
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

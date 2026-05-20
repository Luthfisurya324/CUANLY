import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import qrcode from 'qrcode-terminal';
import { createLogger } from '../utils/logger.js';
import { handleIncomingMessage } from './router.js';
import { usePostgresAuthState } from './postgresAuthState.js';

const logger = createLogger('whatsapp');

const msgRetryCounterCache = new NodeCache();

// Deduplication: track processed message IDs to avoid double-processing
// (Baileys retry mechanism & HF container wake-up can re-deliver messages)
const PROCESSED_MSG_IDS = new Set();
const MAX_PROCESSED_IDS = 500;

/** @type {import('@whiskeysockets/baileys').WASocket | null} */
let sock = null;

let currentQR = '';
export const getCurrentQR = () => currentQR;
export const getSock = () => sock;

/**
 * Inisialisasi koneksi WhatsApp via Baileys.
 * - Scan QR code di terminal
 * - Auto-reconnect jika terputus
 * - Meneruskan pesan masuk ke router
 */
export async function startWhatsApp() {
  const { state, saveCreds } = await usePostgresAuthState();
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info(`Baileys v${version.join('.')} (latest: ${isLatest})`);

  sock = makeWASocket({
    version,
    logger: createLogger('baileys', 'silent'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, createLogger('keystore', 'silent')),
    },
    browser: Browsers.ubuntu('Desktop'),
    msgRetryCounterCache,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: true,
    getMessage: async () => undefined,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000
  });

  // ── Connection Events ──────────────────────────
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      logger.info('📱 Scan QR Code di tab "App" (Web) Hugging Face lo, atau klik link ini:');
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
      logger.info(`🔗 ${qrImageUrl}`);
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      currentQR = '';
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`Koneksi terputus (code: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        const delay = statusCode === 408 ? 10000 : 3000;
        logger.info(`⏳ Reconnecting dalam ${delay / 1000} detik...`);
        setTimeout(() => startWhatsApp(), delay);
      } else {
        logger.error('Logged out dari WhatsApp. Hapus session di database lalu restart bot.');
      }
    }

    if (connection === 'open') {
      currentQR = '';
      logger.info('✅ Cuanly terhubung ke WhatsApp!');
    }
  });

  // ── Credential Persistence ─────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Message Handler ────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Hanya proses pesan real-time (bukan history sync)
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip pesan dari diri sendiri atau pesan tanpa content
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      // ── DEDUPLICATION: Skip jika message ID ini sudah pernah diproses ──
      // Ini mencegah Baileys retry/re-delivery memproses pesan yang sama dua kali
      const msgId = msg.key.id;
      if (msgId && PROCESSED_MSG_IDS.has(msgId)) {
        logger.warn(`[DEDUP] Skipping duplicate message: ${msgId}`);
        continue;
      }

      // Tandai sebagai sudah diproses (sebelum async handler)
      if (msgId) {
        PROCESSED_MSG_IDS.add(msgId);
        // Bersihkan cache lama supaya tidak memory leak
        if (PROCESSED_MSG_IDS.size > MAX_PROCESSED_IDS) {
          const firstKey = PROCESSED_MSG_IDS.values().next().value;
          PROCESSED_MSG_IDS.delete(firstKey);
        }
      }

      try {
        await handleIncomingMessage(sock, msg);
      } catch (err) {
        logger.error(err, `Error handling message from ${msg.key.remoteJid}`);
      }
    }
  });

  return sock;
}

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import qrcode from 'qrcode-terminal';
import { createLogger } from '../utils/logger.js';
import { handleIncomingMessage } from './router.js';

const logger = createLogger('whatsapp');

/** @type {import('@whiskeysockets/baileys').WASocket | null} */
let sock = null;

/**
 * Inisialisasi koneksi WhatsApp via Baileys.
 * - Scan QR code di terminal
 * - Auto-reconnect jika terputus
 * - Meneruskan pesan masuk ke router
 */
export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info(`Baileys v${version.join('.')} (latest: ${isLatest})`);

  const msgRetryCounterCache = new NodeCache();

  sock = makeWASocket({
    version,
    logger: createLogger('baileys', 'silent'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, createLogger('keystore', 'silent')),
    },

    msgRetryCounterCache,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  // ── Connection Events ──────────────────────────
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info('📱 Scan QR Code di bawah untuk login WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`Koneksi terputus (code: ${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        startWhatsApp();
      } else {
        logger.error('Logged out dari WhatsApp. Hapus folder auth_info/ lalu restart bot.');
      }
    }

    if (connection === 'open') {
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

      try {
        await handleIncomingMessage(sock, msg);
      } catch (err) {
        logger.error(err, `Error handling message from ${msg.key.remoteJid}`);
      }
    }
  });

  return sock;
}

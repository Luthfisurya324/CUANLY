import { createLogger } from '../utils/logger.js';
import { parseWithGemini } from '../services/gemini.js';
import { roastWithAI } from '../services/roaster.js';

const logger = createLogger('router');

/**
 * Pola command yang bisa di-handle tanpa LLM (hemat token).
 * Sesuai Prinsip Cost Optimization dari Prompt Blueprint §4.1
 */
const COMMAND_HANDLERS = {
  '/saldo':   handleBalanceCommand,
  '/sisa':    handleBalanceCommand,
  '/help':    handleHelpCommand,
  '/wishlist': handleWishlistCommand,
};

/**
 * Router utama — menerima pesan masuk dan menentukan flow.
 *
 * Pipeline (dari Prompt Blueprint §1):
 *   1. Pre-processing (strip, detect command)
 *   2. Command? → Template response (NO LLM)
 *   3. Natural language? → Gemini parsing → Save DB → Roasting check
 *
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {import('@whiskeysockets/baileys').WAMessage} msg
 */
export async function handleIncomingMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const text = extractText(msg);

  if (!text) return; // Abaikan non-text (gambar, sticker, dll) untuk MVP

  logger.info(`📩 [${jid}]: ${text}`);

  // ── Step 1: Pre-processing ─────────────────────
  const cleaned = text.trim().toLowerCase();

  // ── Step 2: Check command ──────────────────────
  const commandHandler = COMMAND_HANDLERS[cleaned];
  if (commandHandler) {
    const response = commandHandler(jid);
    await sendReply(sock, jid, msg, response);
    return;
  }

  // ── Step 3: Natural language → AI Pipeline ─────
  try {
    // AI Engine 1: Gemini → Parse ke JSON transaksi
    const parsed = await parseWithGemini(text);
    logger.info({ parsed }, 'Gemini parsed result');

    if (!parsed || parsed.confidence < 0.5) {
      await sendReply(sock, jid, msg,
        'Hmm gw bingung 😅 lo mau cek saldo, catat jajan, atau apa?\n' +
        'Coba format: "abis kopi 25rb pake gopay" ✌️'
      );
      return;
    }

    // TODO: Simpan transaksi ke database (Supabase)
    // await saveTransaction(jid, parsed);

    // Kirim konfirmasi
    const confirmMsg = formatConfirmation(parsed);
    await sendReply(sock, jid, msg, confirmMsg);

    // AI Engine 2: Groq → Roasting (jika trigger terpenuhi)
    const roastData = {
      userName: jid.split('@')[0],
      description: parsed.description,
      amount: parsed.amount,
      category: parsed.category,
      remainingBudget: 500000, // TODO: Ambil dari DB
      monthlyBudget: 1000000,  // TODO: Ambil dari DB
      daysLeft: 15,            // TODO: Hitung dari tanggal
      wishlistName: 'Tiket Konser',
      wishlistProgress: 30,
    };

    const roast = await roastWithAI(roastData);
    if (roast) {
      await sendReply(sock, jid, msg, roast);
    }

  } catch (err) {
    logger.error(err, 'AI Pipeline error');
    await sendReply(sock, jid, msg,
      'Waduh, otak AI gw lagi error bentar 😵 Coba lagi ya bestie!'
    );
  }
}

// ═══════════════════════════════════════════════
//  Helper Functions
// ═══════════════════════════════════════════════

/**
 * Ekstrak text dari berbagai jenis pesan WA.
 */
function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    null
  );
}

/**
 * Kirim reply dengan quote ke pesan asli.
 */
async function sendReply(sock, jid, quotedMsg, text) {
  await sock.sendMessage(jid, { text }, { quoted: quotedMsg });
  logger.info(`📤 [${jid}]: ${text.substring(0, 80)}...`);
}

/**
 * Format konfirmasi transaksi yang sudah di-parse.
 */
function formatConfirmation(parsed) {
  const amount = new Intl.NumberFormat('id-ID').format(parsed.amount);
  const payment = parsed.payment_method !== 'unknown'
    ? ` via ${parsed.payment_method.toUpperCase()}`
    : '';

  return (
    `✅ Tercatat!\n` +
    `💸 ${parsed.description} — Rp ${amount}${payment}\n` +
    `📂 Kategori: ${parsed.category}`
  );
}

// ═══════════════════════════════════════════════
//  Command Handlers (No LLM — Template Response)
// ═══════════════════════════════════════════════

function handleBalanceCommand(_jid) {
  // TODO: Ambil saldo real dari database
  return (
    '💰 *Saldo Bulan Ini*\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    'Uang Saku   : Rp 1.000.000\n' +
    'Terpakai    : Rp 500.000\n' +
    'Sisa        : Rp 500.000\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    '📊 Sisa 15 hari lagi. Budget harian: ~Rp 33.333'
  );
}

function handleHelpCommand(_jid) {
  return (
    '🤖 *Cuanly — Bantuan*\n' +
    '━━━━━━━━━━━━━━━━━\n\n' +
    '📝 *Catat pengeluaran:*\n' +
    '   Ketik aja natural, contoh:\n' +
    '   "abis ngopi 25rb pake gopay"\n' +
    '   "beli seblak 15k dana"\n\n' +
    '💰 *Cek saldo:*\n' +
    '   /saldo atau /sisa\n\n' +
    '🎯 *Lihat wishlist:*\n' +
    '   /wishlist\n\n' +
    '💡 Tips: Ngetik aja kayak chat temen. Cuanly ngerti kok! 😎'
  );
}

function handleWishlistCommand(_jid) {
  // TODO: Ambil wishlist dari database
  return (
    '🎯 *Wishlist Kamu*\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    '🎵 Tiket Konser — Rp 1.500.000\n' +
    '   Progress: ████░░░░░░ 30%\n' +
    '   Terkumpul: Rp 450.000\n' +
    '   Kurang: Rp 1.050.000\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    '💪 Semangat nabung, bestie!'
  );
}

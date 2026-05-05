import { createLogger } from '../utils/logger.js';
import { parseWithGemini } from '../services/gemini.js';
import { roastWithAI } from '../services/roaster.js';
import { db } from '../db/index.js';
import { users, transactions } from '../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';

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
    const response = await commandHandler(jid);
    await sendReply(sock, jid, msg, response);
    return;
  }

  // ── Step 3: Natural language → AI Pipeline ─────
  try {
    // Pastikan user ada di DB
    let userResult = await db.select().from(users).where(eq(users.wa_number, jid)).limit(1);
    let user = userResult[0];
    
    if (!user) {
      const display_name = msg.pushName || jid.split('@')[0];
      const inserted = await db.insert(users).values({
        wa_number: jid,
        display_name: display_name,
        monthly_budget: 1000000, // Default 1 juta untuk MVP
      }).returning();
      user = inserted[0];
    }

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

    const transactionType = (parsed.type || parsed.tipe || '').toLowerCase();
    const isIncome = transactionType === 'income' || transactionType === 'pemasukan';
    const finalType = isIncome ? 'income' : 'expense';

    console.log('FINAL TYPE DETECTED:', finalType);

    // Simpan transaksi ke database (Supabase)
    await db.insert(transactions).values({
      user_id: user.id,
      type: finalType, // Dinamis dari Gemini (expense/income)
      amount: parsed.amount,
      category: parsed.category,
      payment_method: parsed.payment_method || 'unknown',
      raw_input: text,
    });

    // Kirim konfirmasi
    const confirmMsg = formatConfirmation(parsed);
    await sendReply(sock, jid, msg, confirmMsg);

    // Logika Roasting: Skip untuk Pemasukan
    if (isIncome) {
      await sendReply(sock, jid, msg, 'Wah mantap bos dapet duit! Udah gue masukin ke saldo ya. Jangan foya-foya! 💸');
      return;
    }

    // Hitung sisa budget bulan ini
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const expenseResult = await db.select({ total: sql`sum(amount)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.user_id, user.id),
          eq(transactions.type, 'expense'),
          gte(transactions.created_at, startOfMonth)
        )
      );
    const totalSpent = Number(expenseResult[0]?.total || 0);

    const incomeResult = await db.select({ total: sql`sum(amount)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.user_id, user.id),
          eq(transactions.type, 'income'),
          gte(transactions.created_at, startOfMonth)
        )
      );
    const totalIncome = Number(incomeResult[0]?.total || 0);

    const effectiveBudget = user.monthly_budget + totalIncome;
    const remainingBudget = effectiveBudget - totalSpent;

    // Hitung sisa hari dalam bulan ini
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysLeft = endOfMonth.getDate() - now.getDate();

    // AI Engine 2: Groq → Roasting (jika trigger terpenuhi)
    const roastData = {
      userName: user.display_name || user.wa_number.split('@')[0],
      description: parsed.description,
      amount: parsed.amount,
      category: parsed.category,
      remainingBudget: remainingBudget,
      monthlyBudget: user.monthly_budget,
      daysLeft: daysLeft,
      wishlistName: 'Tiket Konser', // TODO: Next MVP
      wishlistProgress: 30,         // TODO: Next MVP
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

async function handleBalanceCommand(jid) {
  let userResult = await db.select().from(users).where(eq(users.wa_number, jid)).limit(1);
  let user = userResult[0];
  
  if (!user) {
    return 'Belum ada data nih bos. Coba catat transaksi pertamamu dulu!';
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const expenseResult = await db.select({ total: sql`sum(amount)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, user.id),
        eq(transactions.type, 'expense'),
        gte(transactions.created_at, startOfMonth)
      )
    );
  const totalSpent = Number(expenseResult[0]?.total || 0);

  const incomeResult = await db.select({ total: sql`sum(amount)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, user.id),
        eq(transactions.type, 'income'),
        gte(transactions.created_at, startOfMonth)
      )
    );
  const totalIncome = Number(incomeResult[0]?.total || 0);

  const effectiveBudget = user.monthly_budget + totalIncome;
  const remainingBudget = effectiveBudget - totalSpent;

  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = endOfMonth.getDate() - now.getDate() || 1; // Cegah division by zero
  const dailyBudget = Math.floor(remainingBudget / daysLeft);

  const formatRp = (num) => new Intl.NumberFormat('id-ID').format(num);

  return (
    '💰 *Saldo Bulan Ini*\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    `Uang Saku   : Rp ${formatRp(user.monthly_budget)}\n` +
    `Pemasukan   : Rp ${formatRp(totalIncome)}\n` +
    `Terpakai    : Rp ${formatRp(totalSpent)}\n` +
    `Sisa Saldo  : Rp ${formatRp(remainingBudget)}\n` +
    '━━━━━━━━━━━━━━━━━\n' +
    `📊 Sisa ${daysLeft} hari lagi. Budget harian: ~Rp ${formatRp(dailyBudget)}`
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

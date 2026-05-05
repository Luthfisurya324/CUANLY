import { createLogger } from '../utils/logger.js';
import { parseWithAI, parseWishlistWithAI, roastWithAI } from '../services/ai.js';
import { db } from '../db/index.js';
import { users, transactions } from '../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';

const logger = createLogger('router');

const SPAM_CACHE = new Map();

/**
 * Pola command yang bisa di-handle tanpa LLM (hemat token).
 * Sesuai Prinsip Cost Optimization dari Prompt Blueprint §4.1
 */
const COMMAND_HANDLERS = {
  '/saldo':   handleBalanceCommand,
  '/sisa':    handleBalanceCommand,
  '/help':    handleHelpCommand,
  '/wishlist': handleWishlistCommand,
  '/upgrade': handleUpgradeCommand,
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

  // ── SPAM FILTER ────────────────────────────────
  const now = Date.now();
  if (!SPAM_CACHE.has(jid)) {
    SPAM_CACHE.set(jid, []);
  }
  const timestamps = SPAM_CACHE.get(jid).filter(t => now - t < 5000);
  timestamps.push(now);
  SPAM_CACHE.set(jid, timestamps);

  if (timestamps.length > 3) {
    logger.warn(`Spam detected from ${jid}`);
    return;
  }

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
        monthly_budget: 0, // Default 0 untuk ditanya nanti
        onboarding_step: 'ASK_BUDGET'
      }).returning();
      user = inserted[0];
    }

    // ── QUOTA CHECKER ──────────────────────────────
    if (user.tier === 'free' && user.chat_count >= 30) {
      await sendReply(sock, jid, msg, "Kuota gratis lo bulan ini udah abis bos! Biar gue tetep bisa nyatet dan ngeroast lo, yuk upgrade ke Premium (Rp 15.000/bulan). Ketik /upgrade buat info lanjut! 💸");
      return;
    }

    // ── State Machine: Onboarding Flow ─────────────────────
    if (user.onboarding_step === 'ASK_BUDGET') {
      await db.update(users).set({ 
        onboarding_step: 'WAITING_BUDGET',
        chat_count: sql`${users.chat_count} + 1`,
        last_chat_date: new Date()
      }).where(eq(users.id, user.id));
      await sendReply(sock, jid, msg, "Halo bos! Gue Cuanly, asisten keuangan lo yang anti-basa-basi. Biar gue bisa mantau dompet lo, uang saku/gaji lo bulan ini berapa totalnya?");
      return;
    }

    if (user.onboarding_step === 'WAITING_BUDGET') {
      // Bersihkan kata 'rp', spasi, dan titik
      let cleanText = text.toLowerCase().replace(/rp|\s|\./g, '');
      // Konversi singkatan menjadi angka nol
      cleanText = cleanText.replace(/juta|jt/g, '000000').replace(/ribu|k/g, '000');
      // Ekstrak angka yang tersisa
      const match = cleanText.match(/\d+/);
      const amount = match ? parseInt(match[0], 10) : 0;
      
      if (amount <= 0) {
         await sendReply(sock, jid, msg, "Wah, gw ga ngerti angkanya. Coba ketik yang bener, misal: '1 juta' atau '2000000'");
         return;
      }

      await db.update(users).set({ 
        monthly_budget: amount,
        onboarding_step: 'WAITING_WISHLIST',
        chat_count: sql`${users.chat_count} + 1`,
        last_chat_date: new Date()
      }).where(eq(users.id, user.id));
      
      await sendReply(sock, jid, msg, "Sip, dicatet. Terus, lo lagi nabung pengen beli apa nih? (Sebutin barang & harganya, misal: Tiket Konser NIKI 1.5jt)");
      return;
    }

    if (user.onboarding_step === 'WAITING_WISHLIST') {
      const parsed = await parseWishlistWithAI(text);

      let wishlistName = parsed?.item_name || '';
      let wishlistTarget = parsed?.target_price || 0;

      // Jika Gemini gagal atau tidak dipanggil, gunakan Smart Fallback Regex
      if (!wishlistName || wishlistTarget <= 0) {
          // Memisahkan huruf (nama barang) dan sisanya (harga)
          const match = text.match(/([a-zA-Z\s]+)\s*(.*)/);
          if (match) {
              wishlistName = match[1].trim();
              // Sanitasi harga ala Gen Z
              let priceText = match[2].toLowerCase().replace(/rp|\s|\./g, '');
              priceText = priceText.replace(/juta|jt/g, '000000').replace(/ribu|k/g, '000');
              const priceMatch = priceText.match(/\d+/);
              wishlistTarget = priceMatch ? parseInt(priceMatch[0], 10) : 0;
          }
      }

      // Validasi Akhir
      if (wishlistName && wishlistTarget > 0) {
          await db.update(users).set({
            wishlist_name: wishlistName,
            wishlist_target: wishlistTarget,
            onboarding_step: 'DONE',
            chat_count: sql`${users.chat_count} + 1`,
            last_chat_date: new Date()
          }).where(eq(users.id, user.id));

          await sendReply(sock, jid, msg, `Oke, target ${wishlistName} Rp ${new Intl.NumberFormat('id-ID').format(wishlistTarget)}. Mulai sekarang, tiap lo jajan atau dapet duit, ketik aja di sini. Kalo lo boros, siap-siap gue gas 💀. Coba tes ketik pengeluaran lo hari ini!`);
          return;
      } else {
          await sendReply(sock, jid, msg, "Eh kurang jelas nih. Sebutin nama barang dan harganya ya, contoh: 'Sepatu 500rb' atau 'PS5 8 juta'.");
          return;
      }
    }

    // AI Engine: Parse ke JSON transaksi
    const parsed = await parseWithAI(text);
    logger.info({ parsed }, 'AI parsed result');

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

    // UPDATE KUOTA
    await db.update(users).set({
      chat_count: sql`${users.chat_count} + 1`,
      last_chat_date: new Date()
    }).where(eq(users.id, user.id));

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
      wishlistName: user.wishlist_name || 'Barang Impian',
      wishlistProgress: user.wishlist_target && user.wishlist_target > 0 
        ? Math.round((remainingBudget / user.wishlist_target) * 100) 
        : 0,
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

function handleUpgradeCommand(_jid) {
  return (
    'Mau jadi member VIP Cuanly biar chat unlimited? 🔥\n\n' +
    '1. Scan QRIS/Transfer Rp 15.000 ke Dana: 0812xxxxxx (a.n. Luthfi)\n' +
    '2. Kirim bukti transfer (screenshot) ke nomor WA Admin: wa.me/628xxxxxx\n\n' +
    'Nanti akun lo bakal langsung di-upgrade secara manual!'
  );
}

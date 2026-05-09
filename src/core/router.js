import { createLogger } from '../utils/logger.js';
import { parseWithAI, parseWishlistWithAI, roastWithAI, analyzeReceipt } from '../services/ai.js';
import { db } from '../db/index.js';
import { users, transactions } from '../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const logger = createLogger('router');

const SPAM_CACHE = new Map();

const COMMAND_HANDLERS = {
  '/saldo':   handleBalanceCommand,
  '/sisa':    handleBalanceCommand,
  '/help':    handleHelpCommand,
  '/wishlist': handleWishlistCommand,
  '/upgrade': handleUpgradeCommand,
  '/migrasi': handleMigrasiCommand,
  '/web':     handleWebCommand,
};

/**
 * Universal Message Processor for both WhatsApp and Telegram
 * 
 * @param {string} userId - wa_number for WhatsApp, telegram_id for Telegram
 * @param {string} platform - 'whatsapp' | 'telegram'
 * @param {string} text - Message text
 * @param {string} pushName - Display name (for new users)
 * @param {Function} replyFn - Async function(text) to send reply
 */
export async function processMessage(userId, platform, text, pushName, replyFn, mediaData = null) {
  if (!text && !mediaData) return;

  // ── SPAM FILTER ────────────────────────────────
  const now = Date.now();
  const cacheKey = `${platform}:${userId}`;
  if (!SPAM_CACHE.has(cacheKey)) {
    SPAM_CACHE.set(cacheKey, []);
  }
  const timestamps = SPAM_CACHE.get(cacheKey).filter(t => now - t < 5000);
  timestamps.push(now);
  SPAM_CACHE.set(cacheKey, timestamps);

  if (timestamps.length > 3) {
    logger.warn(`Spam detected from ${cacheKey}`);
    return;
  }

  logger.info(`📩 [${platform}] [${userId}]: ${text}`);

  const cleaned = (text || '').trim().toLowerCase();

  try {
    let userResult;
    if (platform === 'whatsapp') {
      userResult = await db.select().from(users).where(eq(users.wa_number, userId)).limit(1);
    } else {
      userResult = await db.select().from(users).where(eq(users.telegram_id, userId)).limit(1);
    }
    let user = userResult[0];
    
    if (!user) {
      if (platform === 'telegram') {
        await replyFn("Lo belum link akun WA lo nih. Ketik /start buat info lebih lanjut.");
        return;
      }
      const display_name = pushName || userId.split('@')[0];
      const inserted = await db.insert(users).values({
        wa_number: userId,
        display_name: display_name,
        monthly_budget: 0,
        onboarding_step: 'ASK_BUDGET'
      }).returning();
      user = inserted[0];
    }

    // ── Step 2: Check command ──────────────────────
    const commandHandler = COMMAND_HANDLERS[cleaned];
    if (commandHandler) {
      const response = await commandHandler(user);
      await replyFn(response);
      return;
    }

    // ── QUOTA CHECKER ──────────────────────────────
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const lastResetMs = user.last_reset_date ? new Date(user.last_reset_date).getTime() : new Date(user.created_at).getTime();

    if (nowMs - lastResetMs >= SEVEN_DAYS_MS) {
      await db.update(users).set({
        chat_count: 0,
        last_reset_date: new Date()
      }).where(eq(users.id, user.id));
      
      user.chat_count = 0;
      user.last_reset_date = new Date();
    }

    if (user.tier === 'free' && user.chat_count >= 30) {
      const upgradeMsg = `🚨 *LIMIT MINGGUAN LO UDAH HABIS, BOS!* 🚨

Gaya selangit, jajan puluhan ribu lancar, giliran invest Rp15.000/bulan buat nyelametin dompet sendiri aja mendadak miskin? 💀💅

Jatah 30 chat gratis lo minggu ini udah ludes. Mulai detik ini gue mogok nyatet pengeluaran lo.

Ketik */upgrade* sekarang kalau lo emang niat waras ngatur duit. Atau yaudah, silakan lanjut halu jadi crazy rich sampai saldo lo beneran koma. Bye! 👋💸`;
      
      await replyFn(upgradeMsg);
      return;
    }

    // ── State Machine: Onboarding Flow ─────────────────────
    if (user.onboarding_step === 'ASK_BUDGET') {
      await db.update(users).set({ 
        onboarding_step: 'WAITING_BUDGET',
        chat_count: sql`${users.chat_count} + 1`,
        last_chat_date: new Date()
      }).where(eq(users.id, user.id));
      await replyFn("Halo bos! Gue Cuanly, asisten keuangan lo yang anti-basa-basi. Biar gue bisa mantau dompet lo, uang saku/gaji lo bulan ini berapa totalnya?");
      return;
    }

    if (user.onboarding_step === 'WAITING_BUDGET') {
      let cleanText = (text || '').toLowerCase().replace(/rp|\s|\./g, '');
      cleanText = cleanText.replace(/juta|jt/g, '000000').replace(/ribu|k/g, '000');
      const match = cleanText.match(/\d+/);
      const amount = match ? parseInt(match[0], 10) : 0;
      
      if (amount <= 0) {
         await replyFn("Wah, gw ga ngerti angkanya. Coba ketik yang bener, misal: '1 juta' atau '2000000'");
         return;
      }

      await db.update(users).set({ 
        monthly_budget: amount,
        onboarding_step: 'WAITING_WISHLIST',
        chat_count: sql`${users.chat_count} + 1`,
        last_chat_date: new Date()
      }).where(eq(users.id, user.id));
      
      await replyFn("Sip, dicatet. Terus, lo lagi nabung pengen beli apa nih? (Sebutin barang & harganya, misal: Tiket Konser NIKI 1.5jt)");
      return;
    }

    if (user.onboarding_step === 'WAITING_WISHLIST') {
      const parsed = await parseWishlistWithAI(text || '');

      let wishlistName = parsed?.item_name || '';
      let wishlistTarget = parsed?.target_price || 0;

      if (!wishlistName || wishlistTarget <= 0) {
          const match = text.match(/([a-zA-Z\s]+)\s*(.*)/);
          if (match) {
              wishlistName = match[1].trim();
              let priceText = match[2].toLowerCase().replace(/rp|\s|\./g, '');
              priceText = priceText.replace(/juta|jt/g, '000000').replace(/ribu|k/g, '000');
              const priceMatch = priceText.match(/\d+/);
              wishlistTarget = priceMatch ? parseInt(priceMatch[0], 10) : 0;
          }
      }

      if (wishlistName && wishlistTarget > 0) {
          await db.update(users).set({
            wishlist_name: wishlistName,
            wishlist_target: wishlistTarget,
            onboarding_step: 'DONE',
            chat_count: sql`${users.chat_count} + 1`,
            last_chat_date: new Date()
          }).where(eq(users.id, user.id));

          await replyFn(`Oke, target ${wishlistName} Rp ${new Intl.NumberFormat('id-ID').format(wishlistTarget)}. Mulai sekarang, tiap lo jajan atau dapet duit, ketik aja di sini. Kalo lo boros, siap-siap gue gas 💀. Coba tes ketik pengeluaran lo hari ini!`);
          return;
      } else {
          await replyFn("Eh kurang jelas nih. Sebutin nama barang dan harganya ya, contoh: 'Sepatu 500rb' atau 'PS5 8 juta'.");
          return;
      }
    }

    let parsed = null;
    let isReceipt = false;

    if (mediaData) {
      await replyFn("Mata gue lagi nyecan struk lo, sabar...");
      const receiptData = await analyzeReceipt(mediaData.buffer, mediaData.mimetype);
      
      logger.info({ receiptData }, 'Data hasil scan struk');

      if (receiptData === 'QUOTA_EXCEEDED') {
        await replyFn("Waduh bos, limit API Google Gemini gue lagi abis (Quota Exceeded 429). Coba lagi besok atau upgrade API key lo ya!");
        return;
      }

      if (!receiptData) {
        await replyFn("Ini foto apaan bos? Buram atau bukan struk nih. Ulangi yang bener fotonya!");
        return;
      }
      
      const amount = receiptData.total_amount || receiptData.totalAmount || receiptData.amount;
      const items = receiptData.items || receiptData.item || receiptData.description || 'Barang belanjaan';
      let category = receiptData.category || 'lainnya';

      if (!amount) {
        await replyFn("Struk kebaca sih, tapi gue nggak nemu total harganya. Ulangi fotonya yang jelas di bagian Total/Grand Total!");
        return;
      }
      
      isReceipt = true;
      parsed = {
        type: 'expense',
        amount: Number(amount),
        category: category.toLowerCase(),
        description: items,
        payment_method: 'unknown',
        confidence: 1.0,
      };
      logger.info({ parsed }, 'AI Receipt parsed result');
    } else {
      // AI Engine: Parse ke JSON transaksi
      parsed = await parseWithAI(text || '');
      logger.info({ parsed }, 'AI parsed result');
    }

    if (!parsed || parsed.confidence < 0.5) {
      await replyFn(
        'Hmm gw bingung 😅 lo mau cek saldo, catat jajan, atau apa?\n' +
        'Coba format: "abis kopi 25rb pake gopay" ✌️'
      );
      return;
    }

    const transactionType = (parsed.type || parsed.tipe || '').toLowerCase();
    const isIncome = transactionType === 'income' || transactionType === 'pemasukan';
    const finalType = isIncome ? 'income' : 'expense';

    console.log('FINAL TYPE DETECTED:', finalType);

    await db.insert(transactions).values({
      user_id: user.id,
      type: finalType,
      amount: parsed.amount,
      category: parsed.category,
      payment_method: parsed.payment_method || 'unknown',
      raw_input: text || 'IMAGE_RECEIPT',
    });

    await db.update(users).set({
      chat_count: sql`${users.chat_count} + 1`,
      last_chat_date: new Date()
    }).where(eq(users.id, user.id));

    if (isReceipt) {
      const amountFmt = new Intl.NumberFormat('id-ID').format(parsed.amount);
      await replyFn(`Udah gue catat boncos lo Rp ${amountFmt} buat ${parsed.description}.`);
    } else {
      const confirmMsg = formatConfirmation(parsed);
      await replyFn(confirmMsg);
    }

    if (isIncome) {
      await replyFn('Wah mantap bos dapet duit! Udah gue masukin ke saldo ya. Jangan foya-foya! 💸');
      return;
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

    const nowD = new Date();
    const endOfMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0);
    const daysLeft = endOfMonth.getDate() - nowD.getDate();

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
      await replyFn(roast);
    }

  } catch (err) {
    logger.error(err, 'AI Pipeline error');
    await replyFn('Waduh, otak AI gw lagi error bentar 😵 Coba lagi ya bestie!');
  }
}

/**
 * Adapter untuk WhatsApp message (Backward compatibility)
 */
export async function handleIncomingMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const text = extractText(msg);
  const pushName = msg.pushName;
  
  const isImage = !!(msg.message?.imageMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);
  
  if (!text && !isImage) return;

  const replyFn = async (replyText) => {
    await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
    logger.info(`📤 [WA] [${jid}]: ${replyText.substring(0, 80)}...`);
  };

  let mediaData = null;
  if (isImage) {
    const imageMsg = msg.message?.imageMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    if (imageMsg) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage });
        mediaData = {
          buffer,
          mimetype: imageMsg.mimetype || 'image/jpeg'
        };
      } catch (e) {
        logger.error(e, 'Failed to download media');
        await replyFn('Gagal download gambar lo. Coba kirim ulang.');
        return;
      }
    }
  }

  return processMessage(jid, 'whatsapp', text, pushName, replyFn, mediaData);
}

// ═══════════════════════════════════════════════
//  Helper Functions
// ═══════════════════════════════════════════════

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    null
  );
}

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

async function handleBalanceCommand(user) {
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
  const daysLeft = endOfMonth.getDate() - now.getDate() || 1; 
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

function handleHelpCommand(_user) {
  return (
    '🤖 *Pusat Bantuan Cuanly* 📉\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    'Gue tau lo males baca, jadi gue persingkat aja biar lo cepet sadar diri.\n\n' +
    '💸 *CARA NYATET BONCOS*\n' +
    'Ngetik aja senatural mungkin, nggak usah kaku kayak ngomong sama dosen:\n' +
    '> "Jajan ketoprak sultan 25k"\n' +
    '> "Isi bensin 50rb pake gopay"\n' +
    '> "Dapet arisan 2jt" (jarang-jarang kan lo begini)\n\n' +
    '🛠️ *COMMAND SAKTI*\n' +
    '▪️ */saldo* : Cek sisa napas dompet lo bulan ini.\n' +
    '▪️ */wishlist* : Liat progress barang impian vs realita.\n' +
    '▪️ */web* : 🌐 [BARU!] Buka dashboard rahasia buat liat grafik dosa finansial lo.\n' +
    '▪️ */migrasi* : 🛟 Bikin kode sekoci kalau WA ini mendadak diblokir Meta.\n\n' +
    '💡 *Pro-Tip:* Nggak usah baper kalau gue roast tiap lo jajan. Tujuan gue murni biar dompet lo selamat sampai akhir bulan. 🚩'
  );
}

async function handleWishlistCommand(user) {
  if (!user.wishlist_target || !user.wishlist_name) {
    return "Lo aja belum punya target impian bos! Mau nabung buat apa? Karet gelang?\nKetik nama barang & harganya kalau mau dibuatin wishlist, contoh: 'Sepatu 500rb'.";
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const expenseResult = await db.select({ total: sql`sum(amount)` })
    .from(transactions)
    .where(and(eq(transactions.user_id, user.id), eq(transactions.type, 'expense'), gte(transactions.created_at, startOfMonth)));
  const totalSpent = Number(expenseResult[0]?.total || 0);

  const incomeResult = await db.select({ total: sql`sum(amount)` })
    .from(transactions)
    .where(and(eq(transactions.user_id, user.id), eq(transactions.type, 'income'), gte(transactions.created_at, startOfMonth)));
  const totalIncome = Number(incomeResult[0]?.total || 0);

  const saved = Math.max(0, totalIncome - totalSpent);
  const pct = Math.min(100, Math.round((saved / user.wishlist_target) * 100));

  const formatRp = (num) => new Intl.NumberFormat('id-ID').format(num);

  let roastMsg = "";
  if (pct === 0) roastMsg = "Nol besar! Pemasukan lo habis dimakan gaya hidup. Kapan bisa belinya bos?";
  else if (pct < 30) roastMsg = "Baru sekecil ini gaya lo udah selangit. Kurangin nongkrong!";
  else if (pct < 80) roastMsg = "Udah lumayan, tapi jangan cepet puas. Awas aja tiba-tiba lo check out barang gajelas.";
  else if (pct < 100) roastMsg = "Dikit lagi! Tahan napsu, jangan goyah sama diskonan nggak penting.";
  else roastMsg = "Wih, tembus juga target lo! Keren juga lo ternyata, gue kira cuma jago ngutang.";

  return (
    '🎯 *Realita vs Ekspektasi*\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    `🎵 Impian   : ${user.wishlist_name}\n` +
    `💸 Harga    : Rp ${formatRp(user.wishlist_target)}\n` +
    `📈 Tabungan : Rp ${formatRp(saved)} (${pct}%)\n` +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    `🔥 *Cuanly Says:*\n${roastMsg}`
  );
}

function handleUpgradeCommand(_user) {
  return (
    'Mau jadi member VIP Cuanly biar chat unlimited? 🔥\n\n' +
    '1. Scan QRIS/Transfer Rp 15.000 ke Dana: 0812xxxxxx (a.n. Luthfi)\n' +
    '2. Kirim bukti transfer (screenshot) ke nomor WA Admin: wa.me/628xxxxxx\n\n' +
    'Nanti akun lo bakal langsung di-upgrade secara manual!'
  );
}

async function handleMigrasiCommand(user) {
  try {
    const uniqueCode = crypto.randomBytes(4).toString('hex');
    await db.update(users)
      .set({ migration_code: uniqueCode })
      .where(eq(users.id, user.id));

    return (
      `Kode migrasi lo udah siap, bos.\n\n` +
      `Key: *${uniqueCode}*\n\n` +
      `Kode ini cuma punya lo seorang. Kalau WA ini mendadak mokad, cari gue di Telegram @CuanlyBot dan ketik:\n\n` +
      `/link ${uniqueCode}\n\n` +
      `Jaga baik-baik, jangan dikasih ke siapa-siapa kalau nggak mau ketahuan lo sering jajan boncos.`
    );
  } catch (error) {
    logger.error("Gagal generate kode migrasi:", error);
    return "Aduh database gue lagi ngambek. Coba lagi bentar ya.";
  }
}

async function handleWebCommand(user) {
  try {
    // Generate a secure 32-byte hex token as the magic link
    const token = crypto.randomBytes(32).toString('hex');

    await db.update(users)
      .set({ web_token: token })
      .where(eq(users.id, user.id));

    const magicUrl = `https://cuanlybot.vercel.app/auth/${token}`;

    return (
      `Mau liat rapor merah keuangan lo? 📊\n\n` +
      `Klik link ini buat masuk ke dashboard:\n` +
      `👉 ${magicUrl}\n\n` +
      `Link berlaku terus sampai lo minta yang baru lagi pake /web.\n` +
      `Jangan kasih link ini ke siapapun ya bos. 🔐`
    );
  } catch (error) {
    logger.error("Gagal generate magic link:", error);
    return "Waduh gagal bikin link. Database lagi ngambek, coba lagi bentar.";
  }
}

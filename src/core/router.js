import { createLogger } from '../utils/logger.js';
import { parseWithAI, parseWishlistWithAI, roastWithAI, analyzeReceipt } from '../services/ai.js';
import { sendWeeklyReports } from '../services/notifier.js';
import { db } from '../db/index.js';
import { users, transactions } from '../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const logger = createLogger('router');

const SPAM_CACHE = new Map();

// ── Pending Transaction Store ──────────────────────────────────
// Menyimpan transaksi yang menunggu konfirmasi judul/kategori dari user
// Key: `${platform}:${userId}`, Value: { parsed, state, insertedId? }
// state: 'CONFIRM_TITLE' | 'CONFIRM_CATEGORY'
const PENDING_TX = new Map();

// Helper: hapus pending setelah 5 menit (timeout)
function setPendingTx(key, value) {
  PENDING_TX.set(key, { ...value, expiresAt: Date.now() + 5 * 60 * 1000 });
}
function getPendingTx(key) {
  const entry = PENDING_TX.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { PENDING_TX.delete(key); return null; }
  return entry;
}

// Deteksi apakah description kurang jelas
function isDescriptionVague(description) {
  if (!description) return true;
  const vague = ['transaksi', 'lainnya', 'barang', 'sesuatu', 'ini', 'itu', 'bayar', 'beli'];
  const lower = description.toLowerCase().trim();
  if (lower.length < 3) return true;
  if (vague.includes(lower)) return true;
  return false;
}

const COMMAND_HANDLERS = {
  '/saldo': handleBalanceCommand,
  '/sisa': handleBalanceCommand,
  '/help': handleHelpCommand,
  '/wishlist': handleWishlistCommand,
  '/upgrade': handleUpgradeCommand,
  '/migrasi': handleMigrasiCommand,
  '/web': handleWebCommand,
  '/laporan': handleLaporanCommand,
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
  // Window 10 detik (lebih longgar dari sebelumnya 5 detik)
  // AI response bisa 2-5 detik, window lama terlalu ketat
  const timestamps = SPAM_CACHE.get(cacheKey).filter(t => now - t < 10000);
  timestamps.push(now);
  SPAM_CACHE.set(cacheKey, timestamps);

  if (timestamps.length > 5) {
    logger.warn(`Spam detected from ${cacheKey}`);
    return;
  }

  logger.info(`📩 [${platform}] [${userId}]: ${text}`);

  // Internal signal dari /start untuk resume onboarding — ubah ke teks kosong
  // agar state machine onboarding tetap jalan tanpa parsing AI
  const effectiveText = (text === '/start_resume') ? '' : text;
  const cleaned = (effectiveText || '').trim().toLowerCase();

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
        // Buat akun baru untuk user Telegram (tanpa WA)
        // wa_number diisi dummy agar constraint NOT NULL terpenuhi
        const display_name = pushName || `tg_${userId}`;
        const inserted = await db.insert(users).values({
          wa_number: `tg_${userId}`,   // dummy, tidak dipakai untuk WA
          telegram_id: userId,
          display_name: display_name,
          monthly_budget: 0,
          onboarding_step: 'ASK_BUDGET'
        }).returning();
        user = inserted[0];
      } else {
        const display_name = pushName || userId.split('@')[0];
        const inserted = await db.insert(users).values({
          wa_number: userId,
          display_name: display_name,
          monthly_budget: 0,
          onboarding_step: 'ASK_BUDGET'
        }).returning();
        user = inserted[0];
      }
    }

    // ── Step 2: Check command ──────────────────────
    const commandHandler = COMMAND_HANDLERS[cleaned];
    if (commandHandler) {
      const response = await commandHandler(user);
      await replyFn(response);
      return;
    }

    // ── Step 2.5: Handle pending transaction confirmation ──
    const pendingKey = `${platform}:${userId}`;
    const pending = getPendingTx(pendingKey);

    if (pending) {
      // User sedang dalam flow konfirmasi judul/kategori
      if (pending.state === 'CONFIRM_TITLE') {
        const userAnswer = (effectiveText || '').trim();

        // User jawab "skip" atau "-" → simpan apa adanya
        if (/^(skip|lewat|gapapa|gpp|-)$/i.test(userAnswer)) {
          PENDING_TX.delete(pendingKey);
          await savePendingTransaction(pending.parsed, user, effectiveText, replyFn);
          return;
        }

        // User kasih judul baru → coba re-kategorikan via AI
        // Kalau AI gagal, pakai fallback keyword mapping dari ai.js
        const newDescription = userAnswer.substring(0, 40);
        let newCategory = pending.parsed.category;

        try {
          const reParsed = await parseWithAI(`${newDescription} ${pending.parsed.amount}`);
          if (reParsed && reParsed.category && reParsed.category !== 'lainnya') {
            newCategory = reParsed.category;
          }
        } catch (_) { /* pakai kategori lama */ }

        // Fallback: deteksi kategori dari keyword judul
        if (newCategory === 'lainnya') {
          const lower = newDescription.toLowerCase();
          if (/makan|minum|kopi|teh|jajan|warteg|resto|cafe|snack|boba|nasi|ayam|bakso|mie|soto/.test(lower)) newCategory = 'makan_minum';
          else if (/bensin|ojek|grab|gojek|gocar|taxi|parkir|tol|busway|kereta|tiket/.test(lower)) newCategory = 'transport';
          else if (/indomaret|alfamart|supermarket|minimarket|belanja|sabun|deterjen/.test(lower)) newCategory = 'belanja';
          else if (/nonton|bioskop|konser|game|netflix|spotify|streaming|wisata/.test(lower)) newCategory = 'hiburan';
          else if (/obat|dokter|apotek|vitamin|gym|fitness/.test(lower)) newCategory = 'kesehatan';
          else if (/baju|kaos|celana|sepatu|sandal|tas|dompet/.test(lower)) newCategory = 'fashion';
          else if (/skincare|makeup|serum|salon|potong rambut|spa/.test(lower)) newCategory = 'kecantikan';
          else if (/kursus|les|buku|spp|sekolah|seminar/.test(lower)) newCategory = 'pendidikan';
          else if (/listrik|air|internet|wifi|pulsa|kuota|iuran|cicilan|bpjs/.test(lower)) newCategory = 'tagihan';
          else if (/tabungan|investasi|nabung|reksa|saham/.test(lower)) newCategory = 'tabungan';
          else if (/hadiah|kado|sumbangan|donasi|arisan|traktir|kondangan/.test(lower)) newCategory = 'sosial';
        }

        const updatedParsed = {
          ...pending.parsed,
          description: newDescription,
          category: newCategory,
        };

        PENDING_TX.delete(pendingKey);
        await savePendingTransaction(updatedParsed, user, effectiveText, replyFn);
        return;
      }

      if (pending.state === 'CONFIRM_CATEGORY') {
        const userAnswer = (effectiveText || '').trim().toLowerCase();

        // Daftar kategori valid
        const VALID_CATS = [
          'makan_minum', 'transport', 'belanja', 'hiburan', 'kesehatan',
          'fashion', 'kecantikan', 'pendidikan', 'tagihan', 'tabungan', 'sosial', 'lainnya',
        ];

        // User konfirmasi "ya" → simpan dengan kategori lainnya
        if (/^(ya|iya|yes|y|bener|betul)$/.test(userAnswer)) {
          PENDING_TX.delete(pendingKey);
          await savePendingTransaction(pending.parsed, user, effectiveText, replyFn);
          return;
        }

        // User ketik nama kategori yang valid langsung → pakai langsung
        if (VALID_CATS.includes(userAnswer)) {
          const updatedParsed = { ...pending.parsed, category: userAnswer };
          PENDING_TX.delete(pendingKey);
          await savePendingTransaction(updatedParsed, user, effectiveText, replyFn);
          return;
        }

        // User ketik deskripsi bebas → coba re-parse AI untuk dapat kategori
        const reParsed = await parseWithAI(`${userAnswer} ${pending.parsed.amount}`);
        const updatedParsed = {
          ...pending.parsed,
          category: (reParsed && reParsed.category && reParsed.category !== 'lainnya')
            ? reParsed.category
            : 'lainnya',
          description: (reParsed && reParsed.description && !isDescriptionVague(reParsed.description))
            ? reParsed.description
            : pending.parsed.description,
        };

        PENDING_TX.delete(pendingKey);
        await savePendingTransaction(updatedParsed, user, effectiveText, replyFn);
        return;
      }
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
      await replyFn(
        '⏰ Jatah chat gratis mingguan lo udah ludes bos.\n\n' +
        'Lo sanggup jajan puluhan ribu, masa bayar asisten AI *Rp 15.000/bulan* buat nyelametin dompet lo aja gemeter? 💀\n\n' +
        '🔥 *Upgrade Premium & dapetin:*\n' +
        '▪️ Unlimited chat ke bot\n' +
        '▪️ Laporan mingguan otomatis\n' +
        '▪️ Command /laporan kapan aja\n' +
        '▪️ History transaksi lengkap di dashboard\n\n' +
        'Ketik */upgrade* sekarang kalau masih mau gue pantau. 🚩'
      );
      return;
    }

    // Warning saat mendekati batas quota (chat ke-25 dari 30)
    if (user.tier === 'free' && user.chat_count === 25) {
      await replyFn(
        '⚠️ Heads up bos — jatah chat gratis lo tinggal *5 lagi* minggu ini.\n\n' +
        'Kalau mau tetap dipantau tanpa batas, upgrade Premium cuma *Rp 15.000/bulan*.\n' +
        'Ketik */upgrade* buat info. 🔥'
      );
      // Tidak return — tetap proses pesan
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
      let cleanText = (effectiveText || '').toLowerCase().replace(/rp|\s|\./g, '');
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
      const parsed = await parseWishlistWithAI(effectiveText || '');

      let wishlistName = parsed?.item_name || '';
      let wishlistTarget = parsed?.target_price || 0;

      if (!wishlistName || wishlistTarget <= 0) {
        const match = (effectiveText || '').match(/([a-zA-Z\s]+)\s*(.*)/);
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
          onboarding_step: 'CONFIRM_NAME',
          chat_count: sql`${users.chat_count} + 1`,
          last_chat_date: new Date()
        }).where(eq(users.id, user.id));

        await replyFn(
          `Oke, target ${wishlistName} Rp ${new Intl.NumberFormat('id-ID').format(wishlistTarget)} dicatet!\n\n` +
          `Satu lagi — nama lo siapa bos? Biar gue bisa manggil lo dengan bener, bukan cuma "bos" terus.\n` +
          `(Ketik nama lo, atau ketik *skip* kalau mau tetap dipanggil bos)`
        );
        return;
      } else {
        await replyFn("Eh kurang jelas nih. Sebutin nama barang dan harganya ya, contoh: 'Sepatu 500rb' atau 'PS5 8 juta'.");
        return;
      }
    }

    if (user.onboarding_step === 'CONFIRM_NAME') {
      const answer = (effectiveText || '').trim();

      // Helper: bersihkan nama dari emoji/simbol
      const cleanName = answer
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim()
        .substring(0, 50);

      if (/^(skip|lewat|gapapa|gpp|-)$/i.test(answer) || cleanName.length < 2) {
        // Skip atau nama tidak valid → lanjut dengan nama WA yang ada
        await db.update(users).set({
          onboarding_step: 'DONE',
          chat_count: sql`${users.chat_count} + 1`,
          last_chat_date: new Date()
        }).where(eq(users.id, user.id));

        await replyFn(
          `Oke, gue panggil lo "bos" aja kalau gitu.\n\n` +
          `Mulai sekarang, tiap lo jajan atau dapet duit, ketik aja di sini. Kalo lo boros, siap-siap gue gas 💀\n` +
          `Coba tes ketik pengeluaran lo hari ini!`
        );
        return;
      }

      // Simpan nama yang sudah dibersihkan
      await db.update(users).set({
        display_name: cleanName,
        onboarding_step: 'DONE',
        chat_count: sql`${users.chat_count} + 1`,
        last_chat_date: new Date()
      }).where(eq(users.id, user.id));

      await replyFn(
        `Sip, gue catat nama lo: *${cleanName}*.\n\n` +
        `Mulai sekarang, tiap lo jajan atau dapet duit, ketik aja di sini. Kalo lo boros, siap-siap gue gas 💀\n` +
        `Coba tes ketik pengeluaran lo hari ini!`
      );
      return;
    }

    let parsed = null;
    let isReceipt = false;

    if (mediaData) {
      // ── Fitur scan struk sementara di-hold (butuh API OpenAI berbayar) ──
      await replyFn(
        '📸 Fitur scan struk lagi dalam maintenance bos.\n\n' +
        'Sementara catat manual aja ya, contoh:\n' +
        '"Belanja Indomaret 45rb"\n\n' +
        'Fitur ini akan segera aktif kembali. 🔧'
      );
      return;
    } else {
      // AI Engine: Parse ke JSON transaksi
      parsed = await parseWithAI(effectiveText || '');
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

    // ── Cek apakah perlu konfirmasi judul atau kategori ──
    const pendingKey2 = `${platform}:${userId}`;

    // Kasus 1: description kurang jelas → tanya judul
    if (!isReceipt && finalType === 'expense' && isDescriptionVague(parsed.description)) {
      setPendingTx(pendingKey2, { parsed: { ...parsed, type: finalType }, state: 'CONFIRM_TITLE' });
      const amt = new Intl.NumberFormat('id-ID').format(parsed.amount);
      await replyFn(
        `Gue nangkep ada pengeluaran Rp ${amt}, tapi judulnya kurang jelas nih bos.\n\n` +
        `Ini buat apa? (contoh: "Kopi Susu", "Makan Siang", "Grab ke Mall")\n` +
        `Atau ketik *skip* kalau mau langsung disimpen.`
      );
      return;
    }

    // Kasus 2: kategori lainnya → tanya konfirmasi
    if (!isReceipt && finalType === 'expense' && parsed.category === 'lainnya') {
      setPendingTx(pendingKey2, { parsed: { ...parsed, type: finalType }, state: 'CONFIRM_CATEGORY' });
      const desc = parsed.description || 'transaksi ini';
      await replyFn(
        `Gue catat "${desc}" tapi bingung masuk kategori apa.\n\n` +
        `Ini termasuk apa bos? Ketik salah satu:\n` +
        `makan_minum · transport · belanja · hiburan · kesehatan · fashion · kecantikan · pendidikan · tagihan · tabungan · sosial\n\n` +
        `Atau ketik *ya* kalau memang masuk "lainnya".`
      );
      return;
    }

    // Langsung simpan
    await savePendingTransaction({ ...parsed, type: finalType }, user, effectiveText, replyFn);

  } catch (err) {
    logger.error(err, 'AI Pipeline error');
    await replyFn('Waduh, otak AI gw lagi error bentar 😵 Coba lagi ya bestie!');
  }
}

// ── Helper: simpan transaksi ke DB dan kirim konfirmasi + roasting ──
async function savePendingTransaction(parsed, user, rawText, replyFn) {
  const isIncome = parsed.type === 'income';

  await db.insert(transactions).values({
    user_id: user.id,
    type: parsed.type,
    amount: parsed.amount,
    category: parsed.category,
    description: parsed.description || null,
    payment_method: parsed.payment_method || 'unknown',
    raw_input: rawText || 'IMAGE_RECEIPT',
  });

  await db.update(users).set({
    chat_count: sql`${users.chat_count} + 1`,
    last_chat_date: new Date()
  }).where(eq(users.id, user.id));

  const confirmMsg = formatConfirmation(parsed);
  await replyFn(confirmMsg);

  if (isIncome) {
    await replyFn('Wah mantap bos dapet duit! Udah gue masukin ke saldo ya. Jangan foya-foya! 💸');
    return;
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

  const effectiveBudget = user.monthly_budget + totalIncome;
  const remainingBudget = effectiveBudget - totalSpent;

  const nowD = new Date();
  const endOfMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0);
  const daysLeft = endOfMonth.getDate() - nowD.getDate();

  const roastData = {
    userName: user.display_name || user.wa_number.split('@')[0],
    description: parsed.description || parsed.category,
    amount: parsed.amount,
    category: parsed.category,
    remainingBudget,
    monthlyBudget: user.monthly_budget,
    daysLeft,
    wishlistName: user.wishlist_name || 'Barang Impian',
    wishlistProgress: user.wishlist_target && user.wishlist_target > 0
      ? Math.round((remainingBudget / user.wishlist_target) * 100)
      : 0,
  };

  const roast = await roastWithAI(roastData);
  if (roast) await replyFn(roast);

  // ── Upsell premium sesekali (1 dari 5 transaksi, hanya untuk free user) ──
  if (user.tier === 'free' && user.chat_count > 0 && user.chat_count % 5 === 0) {
    const upsells = [
      `💡 *Btw* — lo udah catat ${user.chat_count} transaksi sama gue. Kalau mau laporan mingguan otomatis + unlimited chat, upgrade Premium cuma *Rp 15.000/bln*. Ketik */upgrade* 🔥`,
      `📊 Udah ${user.chat_count} transaksi tercatat. Mau liat analisis lengkap mingguannya? Itu fitur Premium bos — *Rp 15.000/bln*. Ketik */upgrade* kalau penasaran.`,
      `🔓 Saldo lo dipantau ketat sama gue. Kalau mau gue kirim laporan otomatis tiap Senin + akses history lengkap, upgrade Premium *Rp 15.000/bln*. Ketik */upgrade* 💸`,
    ];
    await replyFn(upsells[Math.floor(user.chat_count / 5) % upsells.length]);
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
  const name = parsed.description || parsed.category || 'Transaksi';

  return (
    `✅ Tercatat!\n` +
    `💸 ${name} — Rp ${amount}${payment}\n` +
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
    'Ngetik aja senatural mungkin:\n' +
    '> "Kopi susu 25k pake gopay"\n' +
    '> "Isi bensin 50rb"\n' +
    '> "Grab ke kantor 18rb"\n' +
    '> "Dapet gaji 3jt" (jarang-jarang kan lo begini)\n\n' +

    '📸 *SCAN STRUK* — Segera hadir\n\n' +

    '📂 *KATEGORI YANG ADA*\n' +
    'makan_minum · transport · belanja · hiburan · kesehatan\n' +
    'fashion · kecantikan · pendidikan · tagihan · tabungan · sosial · lainnya\n\n' +

    '🛠️ *COMMAND SAKTI*\n' +
    '▪️ */saldo*   — Cek sisa napas dompet lo bulan ini\n' +
    '▪️ */wishlist* — Liat progress barang impian vs realita\n' +
    '▪️ */laporan* — Minta laporan mingguan sekarang juga\n' +
    '▪️ */web*     — Buka dashboard grafik dosa finansial lo 🌐\n' +
    '▪️ */upgrade* — Info langganan premium (Rp 15.000/bln)\n' +
    '▪️ */migrasi* — Bikin kode pindah ke Telegram kalau WA diblokir\n\n' +

    '💡 *Pro-Tip:*\n' +
    'Kalau gue nggak ngerti judulnya, gue bakal nanya dulu.\n' +
    'Kalau kategorinya nggak jelas, gue juga bakal konfirmasi.\n' +
    'Ketik *skip* kalau mau langsung disimpen apa adanya.\n\n' +

    'Nggak usah baper kalau gue roast. Itu tanda gue sayang sama dompet lo. 🚩'
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
    '🔥 *UPGRADE MODE TOBAT — Rp 15.000/bulan*\n\n' +
    'Dapetin akses:\n' +
    '▪️ Unlimited chat ke bot\n' +
    '▪️ Laporan bulanan mendalam\n' +
    '▪️ Notifikasi auto-boncos\n' +
    '▪️ Dashboard tanpa limit\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '*Cara upgrade:*\n' +
    '1️⃣ Transfer *Rp 15.000* ke Gopay:\n' +
    '   📱 *085156773573* (Luthfi Surya Saputra)\n\n' +
    '2️⃣ Kirim bukti transfer (screenshot) ke WA Admin:\n' +
    '   👉 wa.me/6285156773573\n\n' +
    '3️⃣ Akun lo di-upgrade dalam 1×24 jam setelah konfirmasi.\n\n' +
    '_Lebih murah dari seblak sebulan, bos. Masa dompet lo gak worth it dibenerin?_ 💀'
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
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

    await db.update(users)
      .set({
        web_token: token,
        web_token_expires_at: expiresAt
      })
      .where(eq(users.id, user.id));

    const magicUrl = `https://cuanlybot.vercel.app/auth/${token}`;

    return (
      `Mau liat rapor merah keuangan lo? 📊\n\n` +
      `Klik link ini buat masuk ke dashboard:\n` +
      `👉 ${magicUrl}\n\n` +
      `Link berlaku selama 1 jam sampai lo minta yang baru lagi pake /web.\n` +
      `Jangan kasih link ini ke siapapun ya bos. 🔐`
    );
  } catch (error) {
    logger.error("Gagal generate magic link:", error);
    return "Waduh gagal bikin link. Database lagi ngambek, coba lagi bentar.";
  }
}

async function handleLaporanCommand(user) {
  // Gate: hanya premium
  if (user.tier !== 'premium') {
    return (
      '📋 Fitur */laporan* on-demand adalah fitur *Premium* bos.\n\n' +
      'User free hanya dapat laporan otomatis setiap Senin pagi.\n\n' +
      'Upgrade ke Premium (Rp 15.000/bln) buat:\n' +
      '▪️ Minta laporan kapan aja\n' +
      '▪️ Unlimited chat ke bot\n' +
      '▪️ History transaksi lengkap\n\n' +
      'Ketik */upgrade* untuk info langganan. 🔥'
    );
  }

  try {
    const now = new Date();
    const weekEnd = new Date(now);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    // Import buildWeeklyReport & formatReport dari notifier
    const { sendWeeklyReports } = await import('../services/notifier.js');

    // Kirim laporan hanya untuk user ini
    // Kita build manual di sini agar bisa return sebagai string
    const { db: dbConn } = await import('../db/index.js');
    const { transactions: txTable } = await import('../db/schema.js');
    const { and: andOp, gte: gteOp, lte: lteOp, eq: eqOp, sql: sqlOp } = await import('drizzle-orm');

    const txs = await dbConn.select().from(txTable).where(
      andOp(eqOp(txTable.user_id, user.id), gteOp(txTable.created_at, weekStart), lteOp(txTable.created_at, weekEnd))
    );

    const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalIncome  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

    const categoryMap = {};
    txs.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category ?? 'lainnya';
      categoryMap[cat] = (categoryMap[cat] ?? 0) + t.amount;
    });
    const topCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const mExp = await dbConn.select({ total: sqlOp`sum(amount)` }).from(txTable)
      .where(andOp(eqOp(txTable.user_id, user.id), eqOp(txTable.type, 'expense'), gteOp(txTable.created_at, startOfMonth)));
    const mInc = await dbConn.select({ total: sqlOp`sum(amount)` }).from(txTable)
      .where(andOp(eqOp(txTable.user_id, user.id), eqOp(txTable.type, 'income'), gteOp(txTable.created_at, startOfMonth)));

    const monthExpense = Number(mExp[0]?.total || 0);
    const monthIncome  = Number(mInc[0]?.total || 0);
    const effectiveBudget = (user.monthly_budget ?? 0) + monthIncome;
    const remainingBudget = effectiveBudget - monthExpense;
    const pctBurned = effectiveBudget > 0 ? Math.round((monthExpense / effectiveBudget) * 100) : 0;

    const wishlistSaved = Math.max(0, monthIncome - monthExpense);
    const wishlistPct = user.wishlist_target && user.wishlist_target > 0
      ? Math.min(100, Math.round((wishlistSaved / user.wishlist_target) * 100)) : 0;

    const fmt = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;
    const weekLabel = `${weekStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – ${weekEnd.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    const name = user.display_name || 'Bos';

    let roast;
    if (txs.length === 0) roast = `Lo nggak nyatet apapun minggu ini. Entah lo emang hemat, atau lo males nyatet boncos lo. Gue curiga yang kedua. 🤡`;
    else if (pctBurned >= 90) roast = `${pctBurned}% budget bulan ini udah lo bakar. Sisa ${fmt(remainingBudget)} buat survive. Semoga cukup buat makan, bos. 💀`;
    else if (pctBurned >= 70) roast = `Udah ${pctBurned}% budget kepake dan bulan belum kelar. Slow down dikit, bos. 📉`;
    else roast = `${fmt(totalExpense)} melayang minggu ini. Semoga ada gunanya, bos. 🚩`;

    let categoryText = '';
    if (topCategories.length > 0) {
      categoryText = '\n📊 *Top Dosa Minggu Ini:*\n';
      topCategories.forEach(([cat, amt], i) => {
        categoryText += `${['🥇','🥈','🥉'][i]} ${cat}: ${fmt(amt)}\n`;
      });
    }

    let wishlistText = '';
    if (user.wishlist_name && user.wishlist_target) {
      wishlistText = `\n🎯 *${user.wishlist_name}:* ${wishlistPct}% tercapai`;
    }

    return (
      `📋 *LAPORAN MINGGUAN CUANLY*\n` +
      `${weekLabel}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 Halo ${name}!\n\n` +
      `💸 Keluar   : ${fmt(totalExpense)}\n` +
      `💰 Masuk    : ${fmt(totalIncome)}\n` +
      `🏦 Sisa bln : ${fmt(remainingBudget)} (${pctBurned}% terbakar)\n` +
      `📝 Transaksi: ${txs.length} kali` +
      categoryText +
      wishlistText +
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Cuanly Says:*\n${roast}\n\n` +
      `_Ketik /saldo buat cek real-time, atau /web buat buka dashboard._`
    );
  } catch (error) {
    logger.error(error, 'Gagal generate laporan manual');
    return 'Waduh gagal bikin laporan. Coba lagi bentar ya bos.';
  }
}

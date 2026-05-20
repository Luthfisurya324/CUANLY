import { db } from '../db/index.js';
import { users, transactions } from '../db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('notifier');

// ── Formatting helpers ─────────────────────────────────────────
const formatRp = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;

// ── Build laporan mingguan untuk satu user ─────────────────────
async function buildWeeklyReport(user, weekStart, weekEnd) {
  // Transaksi minggu ini
  const txs = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.user_id, user.id),
        gte(transactions.created_at, weekStart),
        lte(transactions.created_at, weekEnd)
      )
    );

  const totalExpense = txs
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const totalIncome = txs
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);

  // Kategori terbesar minggu ini
  const categoryMap = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    const cat = t.category ?? 'lainnya';
    categoryMap[cat] = (categoryMap[cat] ?? 0) + t.amount;
  });
  const topCategories = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Sisa budget bulan ini
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthExpenseResult = await db
    .select({ total: sql`sum(amount)` })
    .from(transactions)
    .where(and(eq(transactions.user_id, user.id), eq(transactions.type, 'expense'), gte(transactions.created_at, startOfMonth)));
  const monthExpense = Number(monthExpenseResult[0]?.total || 0);

  const monthIncomeResult = await db
    .select({ total: sql`sum(amount)` })
    .from(transactions)
    .where(and(eq(transactions.user_id, user.id), eq(transactions.type, 'income'), gte(transactions.created_at, startOfMonth)));
  const monthIncome = Number(monthIncomeResult[0]?.total || 0);

  const effectiveBudget = (user.monthly_budget ?? 0) + monthIncome;
  const remainingBudget = effectiveBudget - monthExpense;
  const pctBurned = effectiveBudget > 0 ? Math.round((monthExpense / effectiveBudget) * 100) : 0;

  // Wishlist progress
  const wishlistSaved = Math.max(0, monthIncome - monthExpense);
  const wishlistPct = user.wishlist_target && user.wishlist_target > 0
    ? Math.min(100, Math.round((wishlistSaved / user.wishlist_target) * 100))
    : 0;

  return {
    totalExpense,
    totalIncome,
    topCategories,
    remainingBudget,
    pctBurned,
    wishlistPct,
    txCount: txs.length,
  };
}

// ── Format pesan laporan ───────────────────────────────────────
function formatReport(user, report, weekLabel) {
  const name = user.display_name || 'Bos';
  const { totalExpense, totalIncome, topCategories, remainingBudget, pctBurned, wishlistPct, txCount } = report;

  // Pilih roasting berdasarkan kondisi
  let roast;
  if (txCount === 0) {
    roast = `Lo nggak nyatet apapun minggu ini. Entah lo emang hemat, atau lo males nyatet boncos lo. Gue curiga yang kedua. 🤡`;
  } else if (pctBurned >= 90) {
    roast = `${pctBurned}% budget bulan ini udah lo bakar. Sisa ${formatRp(remainingBudget)} buat survive. Semoga cukup buat makan, bos. 💀`;
  } else if (pctBurned >= 70) {
    roast = `Udah ${pctBurned}% budget kepake dan bulan belum kelar. Slow down dikit, bos. Dompet lo minta napas. 📉`;
  } else if (totalExpense === 0) {
    roast = `Minggu ini lo nggak keluar duit sama sekali? Entah lo lagi tobat atau emang bokek. Gue bangga (atau kasihan). 🏆`;
  } else {
    roast = `${formatRp(totalExpense)} melayang minggu ini. Semoga ada gunanya, bos. Kalau buat jajan doang, ya... lo tau sendiri. 🚩`;
  }

  // Top kategori
  let categoryText = '';
  if (topCategories.length > 0) {
    categoryText = '\n📊 *Top Dosa Minggu Ini:*\n';
    topCategories.forEach(([cat, amt], i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      categoryText += `${medal} ${cat}: ${formatRp(amt)}\n`;
    });
  }

  // Wishlist note
  let wishlistText = '';
  if (user.wishlist_name && user.wishlist_target) {
    wishlistText = `\n🎯 *${user.wishlist_name}:* ${wishlistPct}% tercapai`;
    if (wishlistPct < 20) wishlistText += ` — masih jauh bos 😬`;
    else if (wishlistPct < 80) wishlistText += ` — lumayan, jangan nyerah`;
    else wishlistText += ` — hampir sampai! Tahan diri lo!`;
  }

  return (
    `📋 *LAPORAN MINGGUAN CUANLY*\n` +
    `${weekLabel}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👋 Halo ${name}!\n\n` +
    `💸 Keluar   : ${formatRp(totalExpense)}\n` +
    `💰 Masuk    : ${formatRp(totalIncome)}\n` +
    `🏦 Sisa bln : ${formatRp(remainingBudget)} (${pctBurned}% terbakar)\n` +
    `📝 Transaksi: ${txCount} kali` +
    categoryText +
    wishlistText +
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥 *Cuanly Says:*\n${roast}\n\n` +
    `_Ketik /saldo buat cek real-time, atau /web buat buka dashboard._`
  );
}

// ── Kirim notifikasi ke semua user aktif ───────────────────────
export async function sendWeeklyReports(waSock, tgBot) {
  logger.info('📬 Memulai pengiriman laporan mingguan...');

  // Range: 7 hari ke belakang
  const now = new Date();
  const weekEnd = new Date(now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const weekLabel = `${weekStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} – ${weekEnd.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  // Ambil semua user yang sudah onboarding selesai
  const allUsers = await db
    .select()
    .from(users)
    .where(eq(users.onboarding_step, 'DONE'));

  logger.info(`📨 Mengirim laporan ke ${allUsers.length} user (premium: full, free: teaser)...`);

  let successCount = 0;
  let failCount = 0;

  for (const user of allUsers) {
    try {
      let message;

      if (user.tier === 'premium') {
        // Premium: laporan penuh
        const report = await buildWeeklyReport(user, weekStart, weekEnd);
        message = formatReport(user, report, weekLabel);
      } else {
        // Free: teaser ringkas + upsell
        const report = await buildWeeklyReport(user, weekStart, weekEnd);
        const name = user.display_name || 'Bos';
        const fmt = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;
        message = (
          `📋 *RINGKASAN MINGGU INI*\n` +
          `${weekLabel}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👋 Halo ${name}!\n\n` +
          `💸 Total keluar : ${fmt(report.totalExpense)}\n` +
          `💰 Total masuk  : ${fmt(report.totalIncome)}\n` +
          `📝 Transaksi    : ${report.txCount} kali\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔒 *Laporan lengkap* (breakdown kategori, analisis mendalam, roasting) tersedia untuk member *Premium*.\n\n` +
          `Upgrade Rp 15.000/bln → ketik */upgrade* 🔥`
        );
      }

      let sent = false;

      // Kirim via WhatsApp
      if (user.wa_number && !user.wa_number.startsWith('tg_') && waSock) {
        try {
          const jid = user.wa_number.includes('@')
            ? user.wa_number
            : `${user.wa_number}@s.whatsapp.net`;
          await waSock.sendMessage(jid, { text: message });
          logger.info(`✅ [WA] Laporan terkirim ke ${user.wa_number}`);
          sent = true;
        } catch (waErr) {
          logger.warn(`⚠️ [WA] Gagal kirim ke ${user.wa_number}: ${waErr.message}`);
        }
      }

      // Kirim via Telegram (jika punya telegram_id)
      if (user.telegram_id && tgBot) {
        try {
          await tgBot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' });
          logger.info(`✅ [TG] Laporan terkirim ke ${user.telegram_id}`);
          sent = true;
        } catch (tgErr) {
          logger.warn(`⚠️ [TG] Gagal kirim ke ${user.telegram_id}: ${tgErr.message}`);
        }
      }

      if (sent) successCount++;

      // Delay antar user untuk hindari rate limit
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      logger.error(err, `Gagal build laporan untuk user ${user.id}`);
      failCount++;
    }
  }

  logger.info(`📬 Laporan mingguan selesai. Berhasil: ${successCount}, Gagal: ${failCount}`);
}

// ── Scheduler: Jalankan setiap Senin jam 09.00 WIB (02.00 UTC) ─
export function startWeeklyScheduler(getWaSock, getTgBot) {
  logger.info('⏰ Weekly report scheduler aktif (Senin 09.00 WIB)');

  const CHECK_INTERVAL_MS = 60 * 1000; // cek setiap 1 menit

  let lastSentWeek = null; // track minggu terakhir yang sudah dikirim

  setInterval(async () => {
    const now = new Date();

    // Konversi ke WIB (UTC+7)
    const wibOffset = 7 * 60; // menit
    const wibTime = new Date(now.getTime() + wibOffset * 60 * 1000);

    const dayOfWeek = wibTime.getUTCDay(); // 0=Minggu, 1=Senin
    const hour = wibTime.getUTCHours();
    const minute = wibTime.getUTCMinutes();

    // Senin (1), jam 09:00-09:01 WIB
    if (dayOfWeek !== 1) return;
    if (hour !== 9 || minute !== 0) return;

    // Cek apakah minggu ini sudah dikirim (hindari double send)
    const weekKey = `${wibTime.getUTCFullYear()}-W${getWeekNumber(wibTime)}`;
    if (lastSentWeek === weekKey) return;

    lastSentWeek = weekKey;
    logger.info(`🔔 Trigger laporan mingguan: ${weekKey}`);

    try {
      await sendWeeklyReports(getWaSock(), getTgBot());
    } catch (err) {
      logger.error(err, 'Error saat kirim laporan mingguan');
    }

  }, CHECK_INTERVAL_MS);
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

import { Telegraf } from 'telegraf';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { processMessage } from './router.js';
import https from 'https';

// Force IPv4 untuk koneksi ke Telegram API (fix ETIMEDOUT di AWS)
const ipv4Agent = new https.Agent({ family: 4 });

const logger = createLogger('telegram');

export function startTelegramBot() {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  if (!TELEGRAM_TOKEN) {
    logger.error("TELEGRAM_TOKEN tidak ditemukan di environment variables!");
    return null;
  }
  const bot = new Telegraf(TELEGRAM_TOKEN, {
    telegram: { agent: ipv4Agent }
  });

  bot.command('start', async (ctx) => {
    const telegramId = ctx.from.id.toString();

    // Cek apakah user sudah punya akun
    const userResult = await db.select().from(users).where(eq(users.telegram_id, telegramId)).limit(1);
    const user = userResult[0];

    if (user && user.onboarding_step === 'DONE') {
      // User sudah onboarding selesai
      return ctx.reply(
        `Woy ${user.display_name || 'bos'}, lo udah terdaftar! 👋\n\n` +
        `Langsung aja catat pengeluaran lo, atau ketik /help buat liat semua command.`
      );
    }

    if (user) {
      // User ada tapi onboarding belum selesai — lanjutkan flow
      const replyFn = async (text) => ctx.reply(text);
      const pushName = ctx.from.first_name || 'Bos';
      await processMessage(telegramId, 'telegram', '/start_resume', pushName, replyFn);
      return;
    }

    // User baru — sambut dan mulai onboarding via pesan pertama
    return ctx.reply(
      `Woy! Gue *Cuanly* 👋\n\n` +
      `Asisten keuangan lo yang anti-basa-basi dan siap nge-roast tiap lo boros.\n\n` +
      `Sebelum mulai, ketik aja sesuatu — gue langsung tanya budget lo. Atau kalau lo pindahan dari WA, ketik:\n` +
      `/link [KODE_MIGRASI]`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('link', async (ctx) => {
    try {
      const messageText = ctx.message.text;
      const parts = messageText.split(' ');

      if (parts.length < 2) {
        return ctx.reply("Mana kodenya bos? Ketik yang bener: /link [KODE_MIGRASI]");
      }

      const migrationCode = parts[1].trim();
      const telegramId = ctx.from.id.toString();

      // Cari user berdasarkan migration_code
      const userResult = await db.select().from(users).where(eq(users.migration_code, migrationCode)).limit(1);
      const user = userResult[0];

      if (!user) {
        return ctx.reply("Kode salah atau udah expired. Jangan ngadi-ngadi.");
      }

      // Update telegram_id dan hapus migration_code agar tidak dipakai ulang
      await db.update(users)
        .set({ 
          telegram_id: telegramId,
          migration_code: null
        })
        .where(eq(users.id, user.id));

      return ctx.reply("Welcome back, bos! Data boncos lo aman. Lanjut nyatet!");
      
    } catch (error) {
      logger.error(error, "Error saat handling /link command");
      return ctx.reply("Waduh, otak gue lagi error. Coba lagi bentar ya.");
    }
  });

  // Handle all other text messages
  bot.on('text', async (ctx) => {
    // Abaikan command /link yang sudah di-handle di atas
    // /start sudah handle onboarding, tapi tetap skip agar tidak double-process
    if (ctx.message.text.startsWith('/start') || ctx.message.text.startsWith('/link')) return;

    const telegramId = ctx.from.id.toString();
    const text = ctx.message.text;
    const pushName = ctx.from.first_name || 'Bos';

    const replyFn = async (replyText) => {
      await ctx.reply(replyText, { reply_to_message_id: ctx.message.message_id });
      logger.info(`📤 [TG] [${telegramId}]: ${replyText.substring(0, 80)}...`);
    };

    await processMessage(telegramId, 'telegram', text, pushName, replyFn);
  });

  // Handle errors global
  bot.catch((err, ctx) => {
    logger.error(err, `Error untuk update type ${ctx.updateType}`);
  });

  const launchBot = async (retries = 10) => {
    try {
      await bot.launch({ dropPendingUpdates: true });
      logger.info('🤖 Cuanly Telegram Bot is running!');
    } catch (err) {
      logger.error(err.message || err, `Gagal menjalankan Telegram bot. Sisa percobaan: ${retries}`);
      if (retries > 0) {
        logger.info('⏳ Mencoba ulang koneksi Telegram dalam 10 detik...');
        setTimeout(() => launchBot(retries - 1), 10000);
      } else {
        logger.error('💀 Telegram bot menyerah (Gagal konek ke API Telegram). Pastikan token valid.');
      }
    }
  };

  launchBot();

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

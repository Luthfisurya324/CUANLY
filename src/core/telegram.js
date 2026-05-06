import { Telegraf } from 'telegraf';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { processMessage } from './router.js';

const logger = createLogger('telegram');

export function startTelegramBot() {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  if (!TELEGRAM_TOKEN) {
    logger.error("TELEGRAM_TOKEN tidak ditemukan di environment variables!");
    return null;
  }
  const bot = new Telegraf(TELEGRAM_TOKEN);

  bot.command('start', (ctx) => {
    ctx.reply(
      "Woy. Lo user baru atau pelarian dari WA yang kena blokir?\n\n" +
      "Ketik /link [KODE_MIGRASI] kalau lo mau narik data dari WA."
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
    // Abaikan command start dan link yang sudah di-handle di atas
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

  bot.launch()
    .then(() => logger.info('🤖 Cuanly Telegram Bot is running!'))
    .catch((err) => logger.error(err, 'Gagal menjalankan Telegram bot'));

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

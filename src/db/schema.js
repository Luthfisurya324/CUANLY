import { pgTable, uuid, varchar, integer, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  wa_number: varchar('wa_number', { length: 50 }).notNull().unique(),
  telegram_id: varchar('telegram_id', { length: 255 }).unique(),
  migration_code: varchar('migration_code', { length: 8 }).unique(),
  display_name: varchar('display_name', { length: 100 }),
  monthly_budget: integer('monthly_budget').default(0).notNull(), // As default temporary budget
  onboarding_step: varchar('onboarding_step', { length: 20 }).default('ASK_BUDGET').notNull(),
  wishlist_name: text('wishlist_name'),
  wishlist_target: integer('wishlist_target'),
  tier: text('tier').default('free').notNull(),
  chat_count: integer('chat_count').default(0).notNull(),
  last_chat_date: timestamp('last_chat_date'),
  last_reset_date: timestamp('last_reset_date').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  pin: varchar('pin', { length: 6 }),
  web_token: varchar('web_token', { length: 64 }),
  web_token_expires_at: timestamp('web_token_expires_at'),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // 'expense' | 'income'
  amount: integer('amount').notNull(),
  category: varchar('category', { length: 50 }),
  payment_method: varchar('payment_method', { length: 50 }),
  raw_input: text('raw_input'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const baileys_auth = pgTable('baileys_auth', {
  id: varchar('id', { length: 255 }).primaryKey(),
  data: text('data').notNull(),
});

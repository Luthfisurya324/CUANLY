import { pgTable, uuid, varchar, integer, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  wa_number: varchar('wa_number', { length: 50 }).notNull().unique(),
  display_name: varchar('display_name', { length: 100 }),
  monthly_budget: integer('monthly_budget').default(0).notNull(), // As default temporary budget
  created_at: timestamp('created_at').defaultNow().notNull(),
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

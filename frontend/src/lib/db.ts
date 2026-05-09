import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is missing in environment variables.');
}

// Disable prefetch — required for Supabase Transaction pool mode
const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });

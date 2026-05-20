import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, transactions } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export async function GET() {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Cek tier user
    const userResult = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
    const tier = userResult[0]?.tier ?? 'free';

    // Free: 20 transaksi terakhir | Premium: 200 transaksi terakhir
    const limit = tier === 'premium' ? 200 : 20;

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.user_id, userId))
      .orderBy(desc(transactions.created_at))
      .limit(limit);

    return NextResponse.json({
      transactions: txs,
      tier,
      limit,
    });
  } catch (err) {
    console.error('[/api/me/transactions]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

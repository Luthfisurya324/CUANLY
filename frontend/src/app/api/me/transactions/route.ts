import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export async function GET() {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.user_id, userId))
      .orderBy(desc(transactions.created_at))
      .limit(50);

    return NextResponse.json({ transactions: txs });
  } catch (err) {
    console.error('[/api/me/transactions]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

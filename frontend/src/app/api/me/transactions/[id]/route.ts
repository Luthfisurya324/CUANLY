import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export async function DELETE(
  request: Request,
  { params }: { params: any }
) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const resolvedParams = await Promise.resolve(params);
    const txId = resolvedParams?.id;
    
    if (!txId) return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });

    await db.delete(transactions)
      .where(
        and(
          eq(transactions.id, txId),
          eq(transactions.user_id, userId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[/api/me/transactions/[id]]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

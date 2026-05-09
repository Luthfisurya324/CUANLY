import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession, clearSession } from '@/lib/session';

// PUT /api/me/settings — update wishlist name + target
export async function PUT(req: NextRequest) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { wishlist_name, wishlist_target } = await req.json();

    await db
      .update(users)
      .set({
        wishlist_name:   wishlist_name ?? undefined,
        wishlist_target: wishlist_target ? Number(wishlist_target) : undefined,
      })
      .where(eq(users.id, userId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[PUT /api/me/settings]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE /api/me/settings — logout (clear session)
export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}

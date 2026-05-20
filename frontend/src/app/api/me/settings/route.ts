import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getSession, clearSession } from '@/lib/session';

// PUT /api/me/settings — update display_name, wishlist name + target
export async function PUT(req: NextRequest) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { display_name, wishlist_name, wishlist_target } = await req.json();

    // Validasi display_name — strip emoji/simbol, hanya huruf, angka, spasi
    let cleanName: string | undefined = undefined;
    if (display_name !== undefined) {
      const stripped = (display_name as string)
        .replace(/[^\p{L}\p{N}\s]/gu, '') // hapus non-huruf, non-angka, non-spasi
        .trim()
        .substring(0, 50);
      cleanName = stripped.length >= 2 ? stripped : undefined;
    }

    await db
      .update(users)
      .set({
        ...(cleanName !== undefined && { display_name: cleanName }),
        wishlist_name:   wishlist_name ?? undefined,
        wishlist_target: wishlist_target ? Number(wishlist_target) : undefined,
      })
      .where(eq(users.id, userId));

    return NextResponse.json({ ok: true, display_name: cleanName });
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

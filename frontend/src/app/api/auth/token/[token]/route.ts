import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { setSession } from '@/lib/session';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token || token.length < 32) {
      return NextResponse.json({ error: 'Token tidak valid.' }, { status: 400 });
    }

    const result = await db
      .select()
      .from(users)
      .where(eq(users.web_token, token))
      .limit(1);

    const user = result[0];

    if (!user) {
      return NextResponse.json(
        { error: 'Link tidak valid atau sudah kadaluarsa. Minta link baru via /web di bot.' },
        { status: 401 }
      );
    }

    if (user.web_token_expires_at && new Date() > user.web_token_expires_at) {
      return NextResponse.json(
        { error: 'Link sudah kadaluarsa. Minta link baru via /web di bot.' },
        { status: 401 }
      );
    }

    await setSession(user.id);

    // Optional: invalidate token after single use
    await db.update(users).set({ web_token: null, web_token_expires_at: null }).where(eq(users.id, user.id));

    return NextResponse.json({
      ok: true,
      user: {
        display_name: user.display_name,
        tier: user.tier,
      },
    });
  } catch (err) {
    console.error('[/api/auth/token]', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

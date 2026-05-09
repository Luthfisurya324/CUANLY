import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, and, sql } from 'drizzle-orm';
import { setSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    const { waNumber, pin } = await req.json();

    if (!waNumber || !pin) {
      return NextResponse.json({ error: 'Nomor WA dan PIN wajib diisi.' }, { status: 400 });
    }

    // Normalize input: strip non-digits, strip leading 0, ensure starts with 62
    const normalized = waNumber.replace(/\D/g, '').replace(/^0/, '62');

    // wa_number in DB may be stored with @lid / @s.whatsapp.net suffix (Baileys format)
    // Strip the suffix at DB level for comparison using SPLIT_PART
    const result = await db
      .select()
      .from(users)
      .where(
        and(
          sql`SPLIT_PART(${users.wa_number}, '@', 1) = ${normalized}`,
          eq(users.pin, pin)
        )
      )
      .limit(1);

    const user = result[0];

    if (!user) {
      return NextResponse.json(
        { error: 'Nomor WA atau PIN salah. Coba lagi, bos.' },
        { status: 401 }
      );
    }

    await setSession(user.id);

    return NextResponse.json({
      ok: true,
      user: {
        id:           user.id,
        wa_number:    user.wa_number.replace(/@.+$/, ''), // return clean number to client
        display_name: user.display_name,
        tier:         user.tier,
      },
    });
  } catch (err) {
    console.error('[/api/auth/login]', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

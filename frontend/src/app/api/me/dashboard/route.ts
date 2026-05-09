import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, transactions } from '@/lib/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export async function GET() {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get user profile
    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userResult[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();

    // Get all transactions this month
    const txs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.user_id, userId), gte(transactions.created_at, startOfMonth)));

    // Compute totals
    const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const budget  = user.monthly_budget ?? 0;
    const remaining = budget - expense;
    const pctBurned = budget > 0 ? Math.round((expense / budget) * 100) : 0;

    // Wishlist progress (use income as proxy savings — simplistic MVP)
    const wishlistSaved = Math.max(0, income - expense);

    // Top 3 spending by category
    const categoryMap: Record<string, number> = {};
    txs.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category ?? 'Lainnya';
      categoryMap[cat] = (categoryMap[cat] ?? 0) + t.amount;
    });
    const topSpending = Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((item, i) => ({ ...item, isTop: i === 0 }));

    return NextResponse.json({
      user: {
        display_name:    user.display_name,
        wa_number:       user.wa_number.replace(/@.+$/, ''), // strip @lid/@s.whatsapp.net
        tier:            user.tier,
        wishlist_name:   user.wishlist_name,
        wishlist_target: user.wishlist_target,
      },
      budget: {
        total:      budget,
        spent:      expense,
        remaining,
        pct_burned: pctBurned,
        days_left:  daysLeft,
        is_critical: pctBurned >= 80,
      },
      wishlist: {
        name:   user.wishlist_name,
        target: user.wishlist_target ?? 0,
        saved:  wishlistSaved,
        pct:    user.wishlist_target ? Math.min(100, Math.round((wishlistSaved / user.wishlist_target) * 100)) : 0,
      },
      top_spending: topSpending,
    });
  } catch (err) {
    console.error('[/api/me/dashboard]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

---
inclusion: manual
---

# Skill: Tambah Fitur Baru

Gunakan skill ini sebagai panduan ketika ingin menambahkan fitur baru ke Cuanly.

## Checklist Sebelum Mulai
- [ ] Fitur ini untuk bot (WA/TG), web dashboard, atau keduanya?
- [ ] Apakah butuh kolom baru di database?
- [ ] Apakah butuh API route baru di frontend?

## Menambah Command Bot Baru

Edit `src/core/router.js`:

```javascript
// 1. Tambah di COMMAND_HANDLERS object
const COMMAND_HANDLERS = {
  '/saldo': handleBalanceCommand,
  '/command-baru': handleCommandBaru,  // tambah di sini
  // ...
};

// 2. Buat handler function di bawah
async function handleCommandBaru(user) {
  // logic di sini
  return 'Pesan balasan';
}
```

## Menambah API Route Frontend Baru

Buat file di `frontend/src/app/api/me/[nama-route]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // logic di sini
  return NextResponse.json({ data: '...' });
}
```

## Menambah Kolom Database Baru

1. Edit `src/db/schema.js` dan `frontend/src/lib/schema.ts` (keduanya)
2. Jalankan `npx drizzle-kit push` dari root project
3. Upload schema baru ke EC2: `scp ... src/db/schema.js ubuntu@54.206.103.200:~/cuanly/src/db/schema.js`
4. Restart bot: `pm2 restart cuanly-bot`

## Menambah Halaman Web Baru

Buat folder di `frontend/src/app/(app)/[nama-halaman]/page.tsx`.
Route ini otomatis protected (butuh session) karena ada di dalam group `(app)`.

## Pola Fetch Data di Frontend

```typescript
useEffect(() => {
  fetch('/api/me/[endpoint]')
    .then(res => {
      if (res.status === 401) { router.push('/'); return null; }
      return res.json();
    })
    .then(json => { if (json) setData(json); })
    .finally(() => setLoading(false));
}, [router]);
```

## Design System (Wajib Diikuti)
- Background: `bg-neutral-100`
- Cards: `bg-white border border-neutral-200` — **tanpa rounded** (rounded-none)
- Primary button: `bg-neutral-900 text-white`
- Danger/expense: `text-red-500`
- Income/success: `text-emerald-600`
- Label: `text-[9px] font-bold tracking-widest uppercase text-neutral-400`
- Heading: `font-extrabold tracking-tight text-neutral-900`
- **Jangan tambah warna baru** di luar design system ini

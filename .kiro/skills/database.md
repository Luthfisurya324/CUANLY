---
inclusion: manual
---

# Skill: Database & Schema Management

Gunakan skill ini untuk operasi database Supabase + Drizzle ORM.

## Koneksi
- **Provider:** Supabase PostgreSQL
- **Config:** `drizzle.config.js` di root project
- **Schema bot:** `src/db/schema.js`
- **Schema frontend:** `frontend/src/lib/schema.ts`
- **Keduanya harus selalu sinkron**

## Perintah Penting

### Sync schema ke database (paling sering dipakai)
```powershell
# Dari root project
npx drizzle-kit push
```
Gunakan ini setiap kali ada perubahan schema. Lebih aman dari migration untuk development.

### Generate migration file
```powershell
npx drizzle-kit generate
```

### Jalankan migration
```powershell
npx drizzle-kit migrate
```

### Lihat studio (GUI database)
```powershell
npx drizzle-kit studio
```

## Aturan Perubahan Schema
1. Edit `src/db/schema.js` (bot)
2. Edit `frontend/src/lib/schema.ts` (frontend) — harus sama
3. Jalankan `npx drizzle-kit push` dari root project
4. Upload `src/db/schema.js` ke EC2 jika bot perlu kolom baru

## Catatan
- Supabase free tier **auto-pause** setelah 7 hari tidak ada aktivitas
- Jika bot error `ENOTFOUND tenant/user`, cek apakah Supabase project sudah di-resume di dashboard
- Setelah resume Supabase, bot otomatis reconnect tanpa perlu restart

## Tabel yang Ada
- `users` — profil user, budget, wishlist, auth tokens
- `transactions` — semua transaksi expense/income
- `baileys_auth` — session WhatsApp Baileys (jangan dihapus)

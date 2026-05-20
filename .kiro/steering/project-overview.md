# CUANLY — Project Overview

## Apa ini?
Cuanly adalah Micro-SaaS asisten keuangan AI untuk Gen Z Indonesia. Persona-nya "savage/julid" — setiap kali user catat pengeluaran, bot langsung nge-roast mereka. Tagline: *"Bukan aplikasi keuangan biasa, ini cermin realita dompet lo."*

**Author:** Luthfi Surya Saputra  
**Version:** 1.3  
**Status:** Production (MVP)

---

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│  BOT (Node.js)              FRONTEND (Next.js)       │
│  AWS EC2 t3.micro           Vercel                   │
│  IP: 54.206.103.200                                  │
│                                                      │
│  WhatsApp (Baileys)  ──┐                             │
│  Telegram (Telegraf) ──┤──► PostgreSQL (Supabase) ◄──┤── Web Dashboard
│                        │    Drizzle ORM              │   cuanlybot.vercel.app
└─────────────────────────────────────────────────────┘
```

**Bot** (`/src`) — Node.js ESM, di-deploy ke AWS EC2, dijalankan dengan PM2  
**Frontend** (`/frontend`) — Next.js 15 App Router, di-deploy ke Vercel

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Bot runtime | Node.js 20 ESM, Express (health check port 7860) |
| WA client | `@whiskeysockets/baileys` |
| Telegram | `telegraf` |
| AI parsing | Chutes AI (Qwen2.5-32B) via OpenAI-compatible API |
| AI vision (scan struk) | ⏸️ Di-hold — OpenRouter/Gemini (butuh API OpenAI berbayar) |
| Database | PostgreSQL Supabase + Drizzle ORM |
| Frontend | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS v4, monochrome design system |
| Charts | Recharts (PieChart donat) |
| Icons | lucide-react |
| Process manager | PM2 (di EC2) |

---

## Struktur Folder

```
CUANLY/
├── src/                        # Bot Node.js
│   ├── index.js                # Entry point, Express health check
│   ├── core/
│   │   ├── whatsapp.js         # Koneksi Baileys & handler pesan WA
│   │   ├── telegram.js         # Telegraf bot handler + onboarding TG
│   │   ├── router.js           # Universal message processor (WA + TG)
│   │   └── postgresAuthState.js # Baileys auth state di PostgreSQL
│   ├── db/
│   │   ├── index.js            # Drizzle DB connection
│   │   ├── schema.js           # Database schema
│   │   └── migrations/         # Drizzle migration files
│   ├── services/
│   │   ├── ai.js               # AI engine (parsing, roasting, vision)
│   │   └── notifier.js         # Weekly report scheduler & sender
│   └── utils/
│       └── logger.js           # Pino logger
├── frontend/                   # Next.js Web Dashboard
│   └── src/
│       ├── app/
│       │   ├── page.tsx        # Landing/login page
│       │   ├── auth/[token]/   # Magic link auth handler
│       │   ├── (app)/          # Protected routes (layout + pages)
│       │   │   ├── dashboard/  # Halaman utama dashboard
│       │   │   ├── history/    # Riwayat transaksi + edit + delete
│       │   │   └── settings/   # Pengaturan, upgrade modal, logout
│       │   └── api/me/         # API routes (dashboard, transactions, settings)
│       ├── components/
│       │   └── BottomNav.tsx   # Bottom navigation bar
│       └── lib/
│           ├── db.ts           # Drizzle DB connection (frontend)
│           ├── schema.ts       # Database schema (frontend, sama dengan bot)
│           └── session.ts      # Cookie session management
├── .kiro/
│   ├── steering/               # Kiro AI context files (auto-loaded)
│   └── skills/                 # Kiro skills (manual load via #nama-skill)
├── [BISNIS] CUANLY/            # Dokumen bisnis (business plan, pitch deck, dll)
├── .env                        # Environment variables (bot)
├── frontend/.env.local         # Environment variables (frontend)
├── drizzle.config.js           # Drizzle ORM config
├── package.json                # Bot dependencies
└── Dockerfile                  # Docker config (deprecated, sekarang pakai EC2)
```

---

## Database Schema

### Tabel `users`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | uuid | Primary key |
| wa_number | varchar | Nomor WA (identifier utama). User TG murni diisi `tg_{telegram_id}` |
| telegram_id | varchar | ID Telegram (opsional) |
| migration_code | varchar(8) | Kode migrasi WA → TG |
| display_name | varchar | Nama tampilan |
| monthly_budget | integer | Budget bulanan (Rp) |
| onboarding_step | varchar | State machine: ASK_BUDGET → WAITING_BUDGET → WAITING_WISHLIST → DONE |
| wishlist_name | text | Nama barang impian |
| wishlist_target | integer | Harga target wishlist (Rp) |
| tier | text | 'free' atau 'premium' |
| chat_count | integer | Jumlah chat (untuk quota) |
| last_chat_date | timestamp | Terakhir chat |
| last_reset_date | timestamp | Terakhir reset quota |
| pin | varchar(6) | PIN login (belum dipakai di UI) |
| web_token | varchar(64) | Magic link token (single-use) |
| web_token_expires_at | timestamp | Expiry magic link (1 jam) |
| created_at | timestamp | Waktu registrasi |

### Tabel `transactions`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK ke users |
| type | varchar | 'expense' atau 'income' |
| amount | integer | Nominal (Rp) |
| category | varchar | Kategori (lihat daftar kategori di bawah) |
| description | varchar(100) | Nama transaksi yang sudah dirapikan AI (Title Case, max 40 char) |
| payment_method | varchar | Metode pembayaran |
| raw_input | text | Teks asli dari user |
| created_at | timestamp | Waktu transaksi |

### Tabel `baileys_auth`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | varchar | Primary key |
| data | text | Session data WhatsApp |

---

## Kategori Transaksi (12 kategori, tidak tumpang tindih)

| Kategori | Contoh |
|---|---|
| `makan_minum` | makanan, minuman, kopi, jajan, warteg, restoran, cafe, snack, boba |
| `transport` | bensin, ojek, grab, gojek, parkir, tol, busway, kereta, tiket |
| `belanja` | supermarket, indomaret, alfamart, kebutuhan rumah, sabun |
| `hiburan` | nonton, konser, game, streaming, netflix, spotify, wisata |
| `kesehatan` | obat, dokter, apotek, vitamin, gym, fitness |
| `fashion` | baju, sepatu, tas, aksesoris, jam tangan |
| `kecantikan` | skincare, makeup, serum, salon, potong rambut, spa |
| `pendidikan` | kursus, buku, alat tulis, SPP, seminar |
| `tagihan` | listrik, air, internet, pulsa, kuota, cicilan, BPJS |
| `tabungan` | transfer tabungan, investasi, reksa dana, saham |
| `sosial` | hadiah, sumbangan, arisan, traktir, kondangan |
| `lainnya` | fallback jika tidak masuk kategori manapun |

## Metode Pembayaran
`cash, gopay, dana, ovo, shopeepay, qris, bank_transfer, kartu, unknown`

---

## Fitur Bot

### Commands
| Command | Fungsi |
|---|---|
| `/saldo` atau `/sisa` | Cek sisa budget bulan ini |
| `/wishlist` | Lihat progress wishlist |
| `/laporan` | Minta laporan mingguan on-demand |
| `/web` | Generate magic link untuk web dashboard |
| `/migrasi` | Generate kode migrasi WA → Telegram |
| `/upgrade` | Info upgrade ke premium + instruksi transfer |
| `/help` | Bantuan lengkap |

### Alur Onboarding (State Machine)
`ASK_BUDGET` → `WAITING_BUDGET` → `WAITING_WISHLIST` → `DONE`

Berlaku untuk WA dan Telegram. User Telegram baru langsung dibuat akun saat `/start` atau pesan pertama.

### Quota System
- Free tier: **30 chat per 7 hari**, reset otomatis
- Premium: unlimited

### Pending Transaction Flow (Konfirmasi Judul & Kategori)
Setelah AI parse transaksi, ada 2 kondisi yang memicu konfirmasi:

1. **Description kurang jelas** (terlalu pendek/generic) → bot tanya judul spesifik
   - User jawab judul → bot auto-kategorikan dari keyword, fallback ke AI
   - User ketik `skip` → simpan apa adanya

2. **Kategori `lainnya`** → bot tanya konfirmasi kategori
   - User ketik nama kategori valid (misal `transport`) → langsung dipakai
   - User ketik `ya` → simpan sebagai `lainnya`
   - User ketik deskripsi bebas → re-parse via AI

Pending state disimpan di in-memory Map, timeout 5 menit. Struk foto dan income langsung disimpan tanpa konfirmasi.

### AI Engine (`src/services/ai.js`)
- **`parseWithAI()`** — Parse natural language → JSON transaksi (Chutes/Qwen2.5-32B)
- **`roastWithAI()`** — Generate roasting Gen Z, 6 angle berbeda (survival, kategori, wishlist, motivasi terbalik, notif bank, perbandingan)
- **`analyzeReceipt()`** — Scan foto struk (**sementara di-hold**, butuh API OpenAI berbayar)
- **`parseWishlistWithAI()`** — Parse nama & harga wishlist
- Semua fungsi punya **fallback parser** kalau API key tidak ada atau 404

### Notifikasi Mingguan (`src/services/notifier.js`)
- Scheduler jalan setiap **Senin jam 09.00 WIB** (02.00 UTC)
- Kirim ke semua user `onboarding_step = 'DONE'` via WA dan/atau Telegram
- Isi laporan: total keluar/masuk, top 3 kategori, sisa budget, progress wishlist, roasting
- Anti double-send per minggu via `lastSentWeek` key
- Delay 500ms antar user untuk hindari rate limit

---

## Alur Autentikasi Web Dashboard

1. User ketik `/web` di bot WA/TG
2. Bot generate token 32-byte hex, simpan ke `users.web_token`, expiry 1 jam
3. Bot kirim URL: `https://cuanlybot.vercel.app/auth/{token}`
4. Frontend validasi token → set httpOnly cookie `cuanly_session` (7 hari)
5. Token dihapus setelah dipakai (single-use)
6. Session berisi `user.id` (UUID)

---

## Web Dashboard Pages

| Route | Halaman | Keterangan |
|---|---|---|
| `/` | Login | Instruksi magic link via WA/TG. Link WA ke `6288804035810` |
| `/auth/[token]` | Auth handler | Validasi token, set session |
| `/dashboard` | Rapor Boncos | Budget tracker, wishlist progress, pie chart top spending |
| `/history` | Riwayat Dosa | List transaksi + search + filter + **edit modal** + delete |
| `/settings` | Pengaturan | Profil, update wishlist, **upgrade modal** (step-by-step), logout |

### Edit Transaksi (History Page)
- Tombol ✏️ di setiap baris → buka bottom sheet modal
- Field yang bisa diedit: tipe (expense/income), nominal, deskripsi, kategori
- Optimistic update — list langsung berubah tanpa reload
- API: `PATCH /api/me/transactions/[id]`

### Upgrade Modal (Settings Page)
- Tombol UPGRADE → buka bottom sheet modal
- Step 1: nomor Gopay `085156773573` dengan tombol copy
- Step 2: deep link WA ke bot `6288804035810` dengan pesan `/upgrade` pre-filled
- Upgrade masih manual (konfirmasi admin dalam 1×24 jam)

---

## Deployment

### Bot (AWS EC2)
- **Instance:** t3.micro, Ubuntu 24.04 LTS, region ap-southeast-2 (Sydney)
- **IP Public:** 54.206.103.200
- **Key pair:** `cuanly-key.pem` (di root project, jangan di-commit)
- **Process manager:** PM2
- **SSH:** `ssh -i "cuanly-key.pem" ubuntu@54.206.103.200`
- **Upload file:** `scp -i "cuanly-key.pem" [file] ubuntu@54.206.103.200:~/cuanly/[path]`
- **Restart bot:** `pm2 restart cuanly-bot`
- **Lihat log:** `pm2 logs cuanly-bot`
- **Start command:** `pm2 start src/index.js --name cuanly-bot --node-args="--dns-result-order=ipv4first"`
- **PENTING:** Flag `--dns-result-order=ipv4first` WAJIB ada agar Telegram bisa konek di AWS Sydney

### Frontend (Vercel)
- **URL:** https://cuanlybot.vercel.app
- **Auto-deploy** dari git push ke main

### Database (Supabase)
- **Provider:** Supabase PostgreSQL, region ap-southeast-2
- **Sync schema:** `npx drizzle-kit push` (dari root project, bukan dari `/frontend`)
- **PENTING:** Supabase free tier **auto-pause** setelah 7 hari tidak aktif → bot error `ENOTFOUND`
- **Fix:** Resume project di dashboard Supabase, bot reconnect otomatis

---

## Environment Variables

### Bot (`/.env`)
```
DATABASE_URL=postgresql://postgres.icqjmuhrgthlujopwpug:[PASSWORD]@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres
CHUTES_API_KEY=...
CHUTES_BASE_URL=https://api.chutes.ai/v1
CHUTES_MODEL=Qwen/Qwen2.5-32B-Instruct
TELEGRAM_TOKEN=...
OPENROUTER_API_KEY=...  (opsional, untuk scan struk)
```

### Frontend (`/frontend/.env.local`)
```
DATABASE_URL=...  (sama dengan bot)
```

---

## Monetisasi
- **Free:** 30 chat/7 hari
- **Premium:** Rp 15.000/bulan — unlimited chat, laporan mendalam, notifikasi auto
- **Upgrade flow:** Transfer Gopay ke `085156773573` (Luthfi Surya Saputra) → chat `/upgrade` ke bot → konfirmasi admin

---

## Known Issues & Status

| Item | Status |
|---|---|
| Payment/upgrade flow otomatis | ❌ Masih manual via Gopay + konfirmasi admin |
| Scan struk foto | ⏸️ Di-hold — butuh API OpenAI berbayar. Sementara semua foto dibalas "maintenance" |
| Telegram onboarding user baru | ✅ Selesai — user TG bisa onboarding mandiri |
| Notifikasi otomatis laporan mingguan | ✅ Selesai — Senin 09.00 WIB |
| Edit transaksi dari web | ✅ Selesai — edit modal di history page |
| Konfirmasi judul & kategori | ✅ Selesai — pending state machine di router |
| Kategori terstruktur | ✅ Selesai — 12 kategori tidak tumpang tindih |
| Kolom `description` di transaksi | ✅ Selesai — nama bersih terpisah dari raw_input |
| Nomor WA di landing page | ✅ Selesai — `6288804035810` |

---

## Error yang Pernah Terjadi & Solusinya

| Error | Penyebab | Solusi |
|---|---|---|
| `ENOTFOUND tenant/user postgres.xxx` | Supabase auto-pause | Resume project di dashboard Supabase |
| `column "web_token_expires_at" does not exist` | Schema belum di-migrate | `npx drizzle-kit push` dari root |
| Telegram `ETIMEDOUT` | Node.js IPv6 timeout di AWS | Pastikan PM2 start dengan `--dns-result-order=ipv4first` dan `telegram.js` pakai `https.Agent({ family: 4 })` |
| SSH `UNPROTECTED PRIVATE KEY FILE` | Permission `.pem` terlalu terbuka | `icacls "cuanly-key.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| Kategori tetap `lainnya` setelah konfirmasi | Re-parse AI gagal (404) | Handler sekarang cek nama kategori valid langsung tanpa re-parse |

---

## Dokumen Bisnis
Tersimpan di folder `[BISNIS] CUANLY/`:
- `Cuanly_Business_Plan.md` — Business plan lengkap
- `Cuanly_Marketing_Plan.md` — Rencana marketing
- `Cuanly_Financial_Model.xlsx` — Model keuangan
- `Cuanly_Pitch_Deck.pptx` — Pitch deck investor
- `PRD-Cuanly.md` — Product Requirements Document v1.2

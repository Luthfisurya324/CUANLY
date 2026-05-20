---
inclusion: manual
---

# Skill: Troubleshooting Cuanly

Gunakan skill ini ketika ada error atau masalah di bot/frontend.

## Error yang Pernah Terjadi & Solusinya

### 1. `ENOTFOUND tenant/user postgres.xxx not found`
**Penyebab:** Supabase project auto-pause (free tier pause setelah 7 hari tidak aktif)  
**Solusi:** Buka https://supabase.com → resume project → bot otomatis reconnect

### 2. `column "web_token_expires_at" does not exist`
**Penyebab:** Schema di kode lebih baru dari database  
**Solusi:** Jalankan `npx drizzle-kit push` dari root project

### 3. Telegram `ETIMEDOUT` / `request failed, reason: (kosong)`
**Penyebab:** Node.js mencoba IPv6 ke Telegram API, timeout di AWS  
**Solusi:** 
- Pastikan bot distart dengan flag: `pm2 start src/index.js --name cuanly-bot --node-args="--dns-result-order=ipv4first"`
- Pastikan `telegram.js` menggunakan `https.Agent({ family: 4 })` di Telegraf options

### 4. SSH `WARNING: UNPROTECTED PRIVATE KEY FILE`
**Penyebab:** Permission file `.pem` terlalu terbuka di Windows  
**Solusi:**
```powershell
icacls "C:\dev\SaaS PROJECT\CUANLY\cuanly-key.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

### 5. Bot WA tidak merespons pesan
**Cek:**
```bash
pm2 status          # apakah cuanly-bot running?
pm2 logs cuanly-bot # lihat error terbaru
```
Kalau status `errored`, restart: `pm2 restart cuanly-bot`

### 6. AI parsing selalu null / fallback
**Penyebab:** `CHUTES_API_KEY` tidak valid atau quota habis  
**Cek:** Lihat log `AI API error` di PM2 logs  
**Solusi:** Update API key di `.env` lalu upload ke server dan restart

### 7. Web dashboard 401 Unauthorized
**Penyebab:** Session cookie expired atau tidak ada  
**Solusi:** User perlu login ulang via `/web` command di bot

### 8. `scp` upload gagal dari dalam SSH server
**Penyebab:** `scp` harus dijalankan dari **laptop** (PowerShell), bukan dari dalam server  
**Solusi:** Buka PowerShell baru di laptop, jalankan scp dari sana

## Cara Cek Status Semua Komponen

```bash
# Di server EC2
pm2 status                    # status bot
pm2 logs cuanly-bot --lines 50 # log terbaru

# Test koneksi Telegram dari server
curl -s https://api.telegram.org/bot[TOKEN]/getMe

# Test koneksi DB dari server
node -e "import('./src/db/index.js').then(m => m.db.execute('select 1').then(console.log))"
```

## Log Files
- PM2 stdout: `~/.pm2/logs/cuanly-bot-out.log`
- PM2 stderr: `~/.pm2/logs/cuanly-bot-error.log`
- Filter log: `grep -i "error" ~/.pm2/logs/cuanly-bot-error.log | tail -20`

---
inclusion: manual
---

# Skill: Deploy Bot ke AWS EC2

Gunakan skill ini ketika ingin upload perubahan kode bot ke server AWS EC2.

## Info Server
- **IP:** 54.206.103.200
- **User:** ubuntu
- **Key:** `cuanly-key.pem` (di root project)
- **Path di server:** `~/cuanly/`
- **Process manager:** PM2, nama proses: `cuanly-bot`

## Workflow Deploy

### 1. Upload file yang berubah (dari PowerShell laptop)
```powershell
# Upload satu file
scp -i "C:\dev\SaaS PROJECT\CUANLY\cuanly-key.pem" "C:\dev\SaaS PROJECT\CUANLY\[path-file]" ubuntu@54.206.103.200:~/cuanly/[path-file]

# Upload seluruh folder src
scp -i "C:\dev\SaaS PROJECT\CUANLY\cuanly-key.pem" -r "C:\dev\SaaS PROJECT\CUANLY\src" ubuntu@54.206.103.200:~/cuanly/
```

### 2. Restart bot (dari SSH server)
```bash
pm2 restart cuanly-bot
```

### 3. Cek log
```bash
pm2 logs cuanly-bot --lines 30
```

## SSH ke Server
```powershell
ssh -i "C:\dev\SaaS PROJECT\CUANLY\cuanly-key.pem" ubuntu@54.206.103.200
```

## Catatan Penting
- Setelah upload `package.json` yang berubah, jalankan `npm install` di server sebelum restart
- Bot start command: `pm2 start src/index.js --name cuanly-bot --node-args="--dns-result-order=ipv4first"`
- Flag `--dns-result-order=ipv4first` WAJIB ada agar Telegram bisa konek di AWS Sydney
- Cek PM2 auto-startup sudah aktif: `pm2 startup && pm2 save`

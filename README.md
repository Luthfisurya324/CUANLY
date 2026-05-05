# 🤑 Cuanly — Bot WA Pencatat Keuangan AI untuk Gen Z

Bot WhatsApp yang mencatat keuangan pakai bahasa gaul dan ngeroast kalau boros.

## Arsitektur

```
src/
├── index.js           ← Entry point
├── core/
│   ├── whatsapp.js    ← Koneksi Baileys & QR scanner
│   └── router.js      ← Routing pesan → AI pipeline
├── services/
│   ├── gemini.js      ← AI Engine 1: Parse chat → JSON (Gemini Free)
│   └── roaster.js     ← AI Engine 2: Generate roasting (Groq Free)
└── utils/
    └── logger.js      ← Logging utility (Pino)
```

**Dual-AI Engine Strategy:**
| Engine | Provider | Tugas |
|--------|----------|-------|
| Parser | Google Gemini (Free Tier) | Analisis chat → `{nominal, kategori, payment_method}` |
| Roaster | Groq (Free Tier) | Generate teks roasting gaul Gen Z |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy & isi environment variables
cp .env.example .env
# Edit .env → masukkan API key Gemini & Groq

# 3. Jalankan bot
npm run dev

# 4. Scan QR Code yang muncul di terminal pakai WA kamu
# 5. Kirim pesan ke nomor WA yang di-scan: "abis ngopi 25rb pake gopay"
```

## Cara Mendapatkan API Key (Gratis)

### Google Gemini
1. Buka https://aistudio.google.com/apikey
2. Klik "Create API Key"
3. Copy key → paste ke `.env` → `GEMINI_API_KEY`

### Groq
1. Buka https://console.groq.com/keys
2. Klik "Create API Key"
3. Copy key → paste ke `.env` → `GROQ_API_KEY`

## Commands yang Tersedia

| Command | Fungsi |
|---------|--------|
| `/saldo` atau `/sisa` | Cek sisa uang saku |
| `/wishlist` | Lihat progress wishlist |
| `/help` | Panduan penggunaan |
| Chat bebas | Catat pengeluaran (contoh: "abis seblak 15rb pake dana") |

## Tech Stack
- **Runtime:** Node.js (ESM)
- **WhatsApp:** Baileys (WebSocket, unofficial API)
- **AI Parsing:** Google Gemini 2.0 Flash
- **AI Roasting:** Groq (Llama 3.3 70B)
- **Logger:** Pino

## ⚠️ Disclaimer
Bot ini menggunakan Baileys (unofficial WhatsApp API). Untuk production/scale, migrasikan ke Meta Official Cloud API.

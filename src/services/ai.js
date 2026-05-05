import OpenAI from 'openai';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ai');

const CHUTES_API_KEY = process.env.CHUTES_API_KEY;
const CHUTES_BASE_URL = process.env.CHUTES_BASE_URL || 'https://api.chutes.ai/v1';
const CHUTES_MODEL = process.env.CHUTES_MODEL || 'Qwen/Qwen2.5-32B-Instruct';

const openai = new OpenAI({
  apiKey: CHUTES_API_KEY,
  baseURL: CHUTES_BASE_URL,
});

// === TRANSACTION EXTRACTION ===
const VALID_CATEGORIES = [
  'makanan', 'minuman', 'transport', 'jajan', 'hiburan',
  'kebutuhan', 'beauty', 'gaming', 'fashion', 'pulsa_kuota', 'lainnya',
];

const VALID_PAYMENT_METHODS = [
  'cash', 'gopay', 'dana', 'ovo', 'shopeepay', 'qris',
  'bank_transfer', 'kartu', 'unknown',
];

const EXTRACTION_PROMPT = `Lo adalah ekstraktor data transaksi. Parse pesan user jadi JSON terstruktur.
Output HARUS valid JSON saja, TANPA penjelasan, TANPA markdown code block.

Schema:
{
  "type": <one of: "expense", "income">,
  "amount": <number, dalam rupiah, contoh: 15000>,
  "category": <one of: ${VALID_CATEGORIES.join(', ')}>,
  "description": <string singkat, max 50 karakter>,
  "payment_method": <one of: ${VALID_PAYMENT_METHODS.join(', ')}>,
  "confidence": <0-1, seberapa yakin parsing benar>
}

Aturan:
- WAJIB keluarkan property "type" dengan nilai HANYA "expense" atau "income" (WAJIB bahasa inggris dan key-nya 'type').
- PENTING: Jika pesan mengandung kata "masuk", "gaji", "dikasih", "dapet", "transferan", maka "type": "income". (contoh: "uang masuk 1 juta dari bunda" -> "type": "income")
- Jika pesan tentang beli, bayar, abis, jajan, keluar, maka "type": "expense". (contoh: "beli makan 20rb" -> "type": "expense")
- "rb" = ribu, "jt" = juta, "k" = ribu (contoh: "15k" = 15000)
- "10rb" = 10000, "1.5jt" = 1500000
- Kalau payment method nggak disebut, isi "unknown"
- Kalau nggak bisa parsing (bukan tentang transaksi), return: {"confidence": 0}
- Hari ini: ${new Date().toLocaleDateString('id-ID')}`;

export async function parseWithAI(userText) {
  if (!CHUTES_API_KEY || CHUTES_API_KEY === 'kunci_rahasia_disini') {
    logger.warn('Chutes API key belum diset, pakai fallback parser');
    return fallbackParser(userText);
  }

  try {
    const response = await openai.chat.completions.create({
      model: CHUTES_MODEL,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `[USER MESSAGE]\n${userText}` }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText) {
      logger.warn('AI returned empty response');
      return null;
    }

    const parsed = JSON.parse(rawText);

    if (typeof parsed.confidence === 'number' && parsed.confidence < 0.3) {
      return null;
    }

    if (!VALID_CATEGORIES.includes(parsed.category)) parsed.category = 'lainnya';
    if (!VALID_PAYMENT_METHODS.includes(parsed.payment_method)) parsed.payment_method = 'unknown';

    logger.info({ parsed }, 'AI extraction success');
    console.log('RAW AI PARSED:', parsed);
    return parsed;

  } catch (err) {
    logger.error(err.message, 'AI API error');
    return fallbackParser(userText);
  }
}

function fallbackParser(text) {
  const amountMatch = text.match(/(\d+[.,]?\d*)\s*(rb|ribu|k|jt|juta)?/i);
  if (!amountMatch) return null;

  let amount = parseFloat(amountMatch[1].replace(',', '.'));
  const unit = (amountMatch[2] || '').toLowerCase();

  if (unit === 'rb' || unit === 'ribu' || unit === 'k') amount *= 1000;
  if (unit === 'jt' || unit === 'juta') amount *= 1000000;

  const paymentMap = { gopay: 'gopay', dana: 'dana', ovo: 'ovo', shopeepay: 'shopeepay', qris: 'qris', cash: 'cash' };
  let paymentMethod = 'unknown';
  for (const [keyword, method] of Object.entries(paymentMap)) {
    if (text.toLowerCase().includes(keyword)) {
      paymentMethod = method;
      break;
    }
  }

  const isIncome = /masuk|gaji|dikasih|dapet|transferan/i.test(text);
  const type = isIncome ? 'income' : 'expense';

  const result = {
    type,
    amount,
    category: 'lainnya',
    description: text.substring(0, 50),
    payment_method: paymentMethod,
    confidence: 0.5,
  };

  console.log('RAW AI PARSED (FALLBACK):', result);
  return result;
}

// === WISHLIST EXTRACTION ===
const WISHLIST_PROMPT = `Lo adalah ekstraktor data wishlist. Parse pesan user jadi JSON terstruktur.
Output HARUS valid JSON saja, TANPA penjelasan, TANPA markdown code block.

Schema:
{
  "item_name": <string, nama barang singkat>,
  "target_price": <integer murni, harga barang dalam rupiah, contoh: 15000000>
}

Aturan:
- WAJIB gunakan key "item_name" dan "target_price".
- "target_price" TIDAK BOLEH berupa string, harus integer murni.
- "rb" = ribu, "jt" = juta, "k" = ribu (contoh: "10jt" = 10000000)
- Kalau nggak ketemu harga, isi target_price: 0`;

export async function parseWishlistWithAI(userText) {
  if (!CHUTES_API_KEY || CHUTES_API_KEY === 'kunci_rahasia_disini') {
    return fallbackWishlistParser(userText);
  }

  try {
    const response = await openai.chat.completions.create({
      model: CHUTES_MODEL,
      messages: [
        { role: 'system', content: WISHLIST_PROMPT },
        { role: 'user', content: `[USER MESSAGE]\n${userText}` }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText) return null;

    const parsed = JSON.parse(rawText);
    console.log('RAW AI WISHLIST PARSED:', parsed);
    return parsed;

  } catch (err) {
    logger.error(err.message, 'AI Wishlist API error');
    return fallbackWishlistParser(userText);
  }
}

function fallbackWishlistParser(text) {
  let item_name = '';
  let target_price = 0;

  const match = text.match(/([a-zA-Z\s]+)\s*(.*)/);
  if (match) {
    item_name = match[1].trim();
    let priceText = match[2].toLowerCase().replace(/rp|\s|\./g, '');
    priceText = priceText.replace(/juta|jt/g, '000000').replace(/ribu|k/g, '000');
    const priceMatch = priceText.match(/\d+/);
    target_price = priceMatch ? parseInt(priceMatch[0], 10) : 0;
  }

  if (!item_name) item_name = 'Barang Impian';

  return { item_name, target_price };
}

// === ROASTING ENGINE ===
const CUANLY_IDENTITY = `Lo adalah Cuanly, asisten keuangan WA untuk pelajar Gen Z Indonesia.
- Tone: Gen Z gaul, witty, sarkastik, kayak temen dekat yang jujur soal duit.
- Pakai "lo/gue", slang: cuan, boncos, bestie, fr, no cap.
- Emoji max 1-2, pilih punchy (💀 🔥 😭 💸).
- TIDAK PERNAH menghitung sendiri, pakai angka dari context.`;

export async function roastWithAI(data) {
  if (!CHUTES_API_KEY || CHUTES_API_KEY === 'kunci_rahasia_disini') {
    logger.warn('Chutes API key belum diset, pakai fallback roast');
    return fallbackRoast(data);
  }

  const userPrompt = buildRoastPrompt(data);

  try {
    const response = await openai.chat.completions.create({
      model: CHUTES_MODEL,
      messages: [
        { role: 'system', content: CUANLY_IDENTITY },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.85,
      max_tokens: 150,
      top_p: 0.9
    });

    const roast = response.choices[0]?.message?.content?.trim();
    if (!roast) return null;

    const sanitized = sanitizeRoast(roast);
    logger.info({ roast: sanitized }, 'Roast generated');
    return sanitized;

  } catch (err) {
    logger.error(err.message, 'AI Roasting error');
    return fallbackRoast(data);
  }
}

function buildRoastPrompt(data) {
  const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);

  return `User baru catat pengeluaran. ROASTING dia dengan witty.
Bikin ketawa sambil sadar dia boros.

CONTEXT:
- Pengeluaran: ${data.description} - Rp ${fmt(data.amount)}
- Kategori: ${data.category}
- Sisa saku: Rp ${fmt(data.remainingBudget)} dari Rp ${fmt(data.monthlyBudget)}
- Sisa hari: ${data.daysLeft}
- Wishlist: "${data.wishlistName}" (${data.wishlistProgress}%)

RULES:
- Max 280 karakter, 2-3 kalimat
- WAJIB sebut angka keuangan + humor/sarkasme
- BOLEH 1 emoji. DILARANG ceramah.
- Output roasting langsung, tanpa label.`;
}

function sanitizeRoast(text) {
  if (text.length > 320) text = text.substring(0, 280) + '...';
  if (/\[SYSTEM\]|\[TASK\]|\[CONTEXT\]/i.test(text)) return null;
  if (/^(Selamat|Mohon|Anda|Bapak|Ibu)/i.test(text)) return null;
  return text;
}

function fallbackRoast(data) {
  const amt = new Intl.NumberFormat('id-ID').format(data.amount);
  const roasts = [
    `Rp ${amt} buat ${data.description}? Wishlist "${data.wishlistName}"-mu nangis di pojokan 💀`,
    `Bestie, jajan ${data.description} terus. ${data.wishlistName} masih ${data.wishlistProgress}%. Pilih satu 😭`,
    `Sisa saku ${data.daysLeft} hari lagi tapi masih aja ${data.description}. Kuat mental 🔥`,
    `Rp ${amt} lagi... Lo pikir duit tumbuh di pohon? 💸`,
  ];
  return roasts[Math.floor(Math.random() * roasts.length)];
}

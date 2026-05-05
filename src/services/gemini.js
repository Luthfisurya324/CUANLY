import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('gemini');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Kategori pengeluaran yang didukung (dari Prompt Blueprint §3.2).
 */
const VALID_CATEGORIES = [
  'makanan', 'minuman', 'transport', 'jajan', 'hiburan',
  'kebutuhan', 'beauty', 'gaming', 'fashion', 'pulsa_kuota', 'lainnya',
];

const VALID_PAYMENT_METHODS = [
  'cash', 'gopay', 'dana', 'ovo', 'shopeepay', 'qris',
  'bank_transfer', 'kartu', 'unknown',
];

/**
 * System prompt untuk Entity Extraction.
 * Mengikuti §3.2 Prompt Blueprint — Gemini bertugas PARSING ONLY.
 * Prinsip: "LLM untuk Bahasa, Kode untuk Angka"
 */
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

/**
 * AI Engine 1: Gemini — Parse natural language ke JSON transaksi.
 *
 * @param {string} userText — Pesan mentah dari user WA
 * @returns {Promise<{amount: number, category: string, description: string, payment_method: string, confidence: number} | null>}
 */
export async function parseWithGemini(userText) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
    logger.warn('Gemini API key belum diset, pakai fallback parser');
    return fallbackParser(userText);
  }

  try {
    const response = await axios.post(
      `${GEMINI_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: EXTRACTION_PROMPT },
              { text: `\n\n[USER MESSAGE]\n${userText}` },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Rendah karena tugas deterministik
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING', enum: ['income', 'expense'] },
              amount: { type: 'NUMBER' },
              category: { type: 'STRING', enum: VALID_CATEGORIES },
              description: { type: 'STRING' },
              payment_method: { type: 'STRING', enum: VALID_PAYMENT_METHODS },
              confidence: { type: 'NUMBER' }
            },
            required: ['type', 'amount', 'category', 'description', 'payment_method', 'confidence']
          }
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      logger.warn('Gemini returned empty response');
      return null;
    }

    const parsed = JSON.parse(rawText);

    // Validasi output
    if (typeof parsed.confidence === 'number' && parsed.confidence < 0.3) {
      return null;
    }

    // Sanitize category & payment method
    if (!VALID_CATEGORIES.includes(parsed.category)) {
      parsed.category = 'lainnya';
    }
    if (!VALID_PAYMENT_METHODS.includes(parsed.payment_method)) {
      parsed.payment_method = 'unknown';
    }

    logger.info({ parsed }, 'Gemini extraction success');
    console.log('RAW GEMINI PARSED:', parsed);
    return parsed;

  } catch (err) {
    logger.error(err.response?.data || err.message, 'Gemini API error');
    return fallbackParser(userText);
  }
}

/**
 * Fallback parser sederhana (regex-based) jika Gemini tidak available.
 * Hanya untuk development / graceful degradation.
 */
function fallbackParser(text) {
  const amountMatch = text.match(/(\d+[.,]?\d*)\s*(rb|ribu|k|jt|juta)?/i);
  if (!amountMatch) return null;

  let amount = parseFloat(amountMatch[1].replace(',', '.'));
  const unit = (amountMatch[2] || '').toLowerCase();

  if (unit === 'rb' || unit === 'ribu' || unit === 'k') amount *= 1000;
  if (unit === 'jt' || unit === 'juta') amount *= 1000000;

  // Deteksi payment method
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

  console.log('RAW GEMINI PARSED (FALLBACK):', result);
  return result;
}

import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('roaster');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CUANLY_IDENTITY = `Lo adalah Cuanly, asisten keuangan WA untuk pelajar Gen Z Indonesia.
- Tone: Gen Z gaul, witty, sarkastik, kayak temen dekat yang jujur soal duit.
- Pakai "lo/gue", slang: cuan, boncos, bestie, fr, no cap.
- Emoji max 1-2, pilih punchy (💀 🔥 😭 💸).
- TIDAK PERNAH menghitung sendiri, pakai angka dari context.`;

/**
 * AI Engine 2: Groq — Generate roasting Gen Z yang viral.
 * @param {object} data - Context user untuk roasting
 * @returns {Promise<string | null>}
 */
export async function roastWithAI(data) {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'your_groq_api_key_here') {
    logger.warn('Groq API key belum diset, pakai fallback roast');
    return fallbackRoast(data);
  }

  const userPrompt = buildRoastPrompt(data);

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: CUANLY_IDENTITY },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.85,
        max_tokens: 150,
        top_p: 0.9,
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const roast = response.data?.choices?.[0]?.message?.content?.trim();
    if (!roast) return null;

    const sanitized = sanitizeRoast(roast);
    logger.info(`Roast generated: ${sanitized}`);
    return sanitized;

  } catch (err) {
    logger.error(err.response?.data || err.message, 'Groq API error');
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

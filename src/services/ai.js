import OpenAI from 'openai';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ai');

const CHUTES_API_KEY = process.env.CHUTES_API_KEY;
const CHUTES_BASE_URL = process.env.CHUTES_BASE_URL || 'https://api.chutes.ai/v1';
const CHUTES_MODEL = process.env.CHUTES_MODEL || 'Qwen/Qwen2.5-32B-Instruct';

// Client untuk Chutes (Roasting)
const openai = new OpenAI({
  apiKey: CHUTES_API_KEY,
  baseURL: CHUTES_BASE_URL,
});

// Client untuk Vision (OpenRouter - Gratis & Banyak Model)
const visionAI = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || 'dummy_key',
  baseURL: 'https://openrouter.ai/api/v1',
});

// === RECEIPT EXTRACTION ===
const RECEIPT_PROMPT = `Kamu adalah ekstraktor data struk belanja. Analisis foto struk ini. Ekstrak informasi berikut dan kembalikan HANYA dalam format JSON murni tanpa markdown/backticks: { "total_amount": (integer tanpa titik/koma), "category": (pilih salah satu: makan_minum/transport/belanja/hiburan/kesehatan/fashion/kecantikan/pendidikan/tagihan/lainnya), "items": (string ringkasan barang yang dibeli max 10 kata, gunakan Title Case) }`;

export async function analyzeReceipt(imageBuffer, mimeType) {
  if (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY === 'dummy_key') {
    logger.warn('OPENROUTER_API_KEY tidak ada. Receipt analysis gagal.');
    return null;
  }
  
  try {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    const response = await visionAI.chat.completions.create({
      model: "google/gemini-2.0-flash-lite-preview-02-05:free",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: RECEIPT_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature: 0.1
    });

    const responseText = response.choices[0].message.content.trim();
    
    logger.info({ raw_vision: responseText }, 'Raw Vision Response');

    // Extract JSON using regex
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) {
       logger.error('No JSON object found in Vision response');
       return null;
    }
    
    const parsed = JSON.parse(match[0]);
    logger.info({ parsed }, 'AI Vision Receipt success');
    return parsed;
  } catch (err) {
    logger.error(err, 'AI Vision error');
    
    if (err.status === 429 || err.message?.includes('429')) {
      return 'QUOTA_EXCEEDED';
    }
    
    return null;
  }
}

// === TRANSACTION EXTRACTION ===
// Kategori terstruktur — tidak tumpang tindih, mudah dipahami AI
const VALID_CATEGORIES = [
  'makan_minum',   // makanan, minuman, kopi, jajan, warteg, restoran, dll
  'transport',     // bensin, ojek, grab, gojek, parkir, tol, dll
  'belanja',       // supermarket, indomaret, alfamart, kebutuhan rumah, dll
  'hiburan',       // nonton, konser, game, streaming, wisata, dll
  'kesehatan',     // obat, dokter, apotek, vitamin, gym, dll
  'fashion',       // baju, sepatu, tas, aksesoris, dll
  'kecantikan',    // skincare, makeup, salon, perawatan, dll
  'pendidikan',    // kursus, buku, alat tulis, SPP, dll
  'tagihan',       // listrik, air, internet, pulsa, kuota, dll
  'tabungan',      // transfer ke tabungan, investasi, dll
  'sosial',        // hadiah, sumbangan, arisan, traktir, dll
  'lainnya',       // fallback untuk yang tidak masuk kategori di atas
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
  "description": <string singkat max 40 karakter, nama transaksi yang bersih, contoh: "Kopi susu", "Bensin Pertamax", "Grab ke kantor">,
  "payment_method": <one of: ${VALID_PAYMENT_METHODS.join(', ')}>,
  "confidence": <0-1, seberapa yakin parsing benar>
}

Aturan TYPE:
- WAJIB keluarkan property "type" dengan nilai HANYA "expense" atau "income".
- Jika pesan mengandung kata "masuk", "gaji", "dikasih", "dapet", "transferan", "terima", maka "type": "income".
- Jika pesan tentang beli, bayar, abis, jajan, keluar, maka "type": "expense".

Aturan CATEGORY (pilih yang paling tepat):
- makan_minum  : makanan, minuman, kopi, teh, jajan, warteg, restoran, cafe, snack, boba
- transport    : bensin, ojek, grab, gojek, gocar, taxi, parkir, tol, busway, kereta, tiket
- belanja      : supermarket, indomaret, alfamart, minimarket, kebutuhan rumah, sabun, deterjen
- hiburan      : nonton, bioskop, konser, game, streaming, netflix, spotify, wisata, liburan
- kesehatan    : obat, dokter, apotek, vitamin, suplemen, gym, fitness, rumah sakit
- fashion      : baju, kaos, celana, sepatu, sandal, tas, dompet, aksesoris, jam tangan
- kecantikan   : skincare, makeup, serum, moisturizer, salon, potong rambut, spa, perawatan
- pendidikan   : kursus, les, buku, alat tulis, SPP, uang sekolah, seminar, workshop
- tagihan      : listrik, air, internet, wifi, pulsa, kuota, iuran, cicilan, BPJS
- tabungan     : transfer tabungan, investasi, reksa dana, saham, nabung
- sosial       : hadiah, kado, sumbangan, donasi, arisan, traktir teman, kondangan
- lainnya      : gunakan HANYA jika benar-benar tidak masuk kategori manapun

Aturan DESCRIPTION:
- Tulis nama transaksi yang bersih dan singkat, max 40 karakter
- Hilangkan kata-kata tidak penting seperti "beli", "bayar", "abis", "pake", "di", "ke"
- Contoh: "beli kopi susu di starbucks" → "Kopi Susu Starbucks"
- Contoh: "bayar bensin 50rb pake gopay" → "Bensin"
- Contoh: "jajan mie ayam sama bakso" → "Mie Ayam & Bakso"
- Gunakan Title Case

Aturan AMOUNT:
- "rb" = ribu, "jt" = juta, "k" = ribu (contoh: "15k" = 15000)
- "10rb" = 10000, "1.5jt" = 1500000

Aturan lain:
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
  const lower = text.toLowerCase().trim();

  // ── Guard: harus ada kata kunci transaksi yang jelas ──────────
  // Tanpa ini, kalimat biasa seperti "bikinin tabel tabungan" ikut ke-parse
  const hasTransactionKeyword = (
    // Pengeluaran
    /\b(beli|bayar|abis|jajan|makan|minum|isi|top.?up|transfer|kirim|bayarin|traktir|beli|order|pesan|checkout|belanja|keluar|boncos|habis)\b/.test(lower) ||
    // Pemasukan
    /\b(gaji|masuk|dapet|dikasih|terima|transferan|dapat|nerima|cashback|refund)\b/.test(lower) ||
    // Metode pembayaran disebut (indikasi kuat transaksi)
    /\b(gopay|dana|ovo|shopeepay|qris|cash|tunai|kartu|debit|kredit|transfer)\b/.test(lower)
  );

  if (!hasTransactionKeyword) {
    return null; // Bukan transaksi, jangan parse
  }

  // ── Cari nominal ──────────────────────────────────────────────
  const amountMatch = text.match(/(\d+[.,]?\d*)\s*(rb|ribu|k|jt|juta)?/i);
  if (!amountMatch) return null;

  let amount = parseFloat(amountMatch[1].replace(',', '.'));
  const unit = (amountMatch[2] || '').toLowerCase();

  if (unit === 'rb' || unit === 'ribu' || unit === 'k') amount *= 1000;
  if (unit === 'jt' || unit === 'juta') amount *= 1000000;

  // Nominal terlalu kecil (< 100) tanpa unit → kemungkinan bukan transaksi
  if (amount < 100 && !unit) return null;

  const paymentMap = { gopay: 'gopay', dana: 'dana', ovo: 'ovo', shopeepay: 'shopeepay', qris: 'qris', cash: 'cash' };
  let paymentMethod = 'unknown';
  for (const [keyword, method] of Object.entries(paymentMap)) {
    if (lower.includes(keyword)) {
      paymentMethod = method;
      break;
    }
  }

  // Deteksi kategori dari keyword
  let category = 'lainnya';
  if (/makan|minum|kopi|teh|jajan|warteg|resto|cafe|snack|boba|nasi|ayam|bakso|mie|soto/.test(lower)) category = 'makan_minum';
  else if (/bensin|ojek|grab|gojek|gocar|taxi|parkir|tol|busway|kereta|tiket/.test(lower)) category = 'transport';
  else if (/indomaret|alfamart|supermarket|minimarket|belanja|sabun|deterjen/.test(lower)) category = 'belanja';
  else if (/nonton|bioskop|konser|game|netflix|spotify|streaming|wisata/.test(lower)) category = 'hiburan';
  else if (/obat|dokter|apotek|vitamin|gym|fitness|rs|rumah sakit/.test(lower)) category = 'kesehatan';
  else if (/baju|kaos|celana|sepatu|sandal|tas|dompet|aksesoris/.test(lower)) category = 'fashion';
  else if (/skincare|makeup|serum|salon|potong rambut|spa|perawatan/.test(lower)) category = 'kecantikan';
  else if (/kursus|les|buku|spp|sekolah|seminar|workshop/.test(lower)) category = 'pendidikan';
  else if (/listrik|air|internet|wifi|pulsa|kuota|iuran|cicilan|bpjs/.test(lower)) category = 'tagihan';
  else if (/\btabung|investasi|nabung|reksa|saham\b/.test(lower)) category = 'tabungan'; // \b agar "tabungan" dalam konteks lain tidak match
  else if (/hadiah|kado|sumbangan|donasi|arisan|traktir|kondangan/.test(lower)) category = 'sosial';

  // Buat description yang bersih
  let description = text
    .replace(/\d+[.,]?\d*\s*(rb|ribu|k|jt|juta)?/gi, '')
    .replace(/\b(beli|bayar|abis|pake|pakai|di|ke|dari|sama|dan|dengan|untuk|via|lewat)\b/gi, '')
    .replace(/\b(gopay|dana|ovo|shopeepay|qris|cash|transfer)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 40);

  description = description.replace(/\b\w/g, c => c.toUpperCase()) || 'Transaksi';

  const isIncome = /masuk|gaji|dikasih|dapet|transferan|terima/i.test(text);
  const type = isIncome ? 'income' : 'expense';

  const result = {
    type,
    amount,
    category,
    description,
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
const CUANLY_IDENTITY = `Kamu adalah Cuanly, asisten keuangan AI Gen Z Indonesia yang paling julid, pasif-agresif, dan sarkas. Kamu spesialis menghancurkan mental finansial user dengan sindiran yang menohok tapi tetap lucu dan relatable.

KARAKTER:
- Gaya bahasa: lo/gue, gaul Gen Z, kadang lebay dramatis
- Tone: kayak sahabat yang jujur banget sampai nyakitin, tapi tetap sayang
- DILARANG kata kasar (bodoh, tolol, dll) tapi sindiran harus SANGAT menohok secara mental

ATURAN ROASTING:
1. Emoji wajib: 💀, 🤡, 📉, 💸, 🚩, 😮‍💨, 🫠, ☠️, 🥀, 🔥, 😭
2. WAJIB sebut nominal saldo yang tersisa — itu senjata utama lo
3. VARIASIKAN angle setiap kali, pilih satu:
   - Hitung survival: "saldo dibagi hari = lo harus hidup dari X/hari"
   - Roast kategori spesifik: kopi = kafein addict, grab = gabisa jalan, dll
   - Wishlist math: "dengan gaya boros ini, wishlist kebeli tahun berapa?"
   - Motivasi terbalik: pura-pura bangga tapi sebenarnya nyindir
   - Notif bank dramatis: gaya alert sistem keuangan darurat
   - Perbandingan absurd: bandingkan pengeluaran dengan hal receh lainnya
4. Referensi budaya pop boleh: drama Korea, healing, self-reward, YOLO, dll
5. Jangan kasih saran — cukup fakta pahit yang bikin merenung
6. Max 280 karakter, langsung to the point, tanpa basa-basi`;

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

  const daily = data.daysLeft > 0 ? Math.round(data.remainingBudget / data.daysLeft) : 0;

  // Pilih angle roasting secara acak agar variatif
  const angles = [
    `SURVIVAL MATH: saldo Rp ${fmt(data.remainingBudget)} ÷ ${data.daysLeft} hari = Rp ${fmt(daily)}/hari. Roast dengan hitung-hitungan ini.`,
    `KATEGORI SPESIFIK: serang kebiasaan "${data.category}" mereka — apa yang absurd dari prioritas hidup mereka.`,
    `WISHLIST MATH: dengan boros Rp ${fmt(data.amount)}/transaksi, kapan "${data.wishlistName}" (${data.wishlistProgress}%) bisa kebeli? Hitung dan hancurkan harapannya.`,
    `MOTIVASI TERBALIK: pura-pura bangga dan salut, tapi setiap kalimat sebenarnya nyindir habis-habisan.`,
    `NOTIF SISTEM: gaya alert darurat bank/sistem keuangan yang dramatis dan menyedihkan.`,
    `FASE HIDUP: gambarkan siklus "mau hemat → jajan lagi → nyesel → mau hemat" yang terus berulang.`,
    `DARK HUMOR: fakta pahit yang disampaikan dengan nada santai tapi menghancurkan mental.`,
  ];
  const randomAngle = angles[Math.floor(Math.random() * angles.length)];

  return `User baru catat pengeluaran. ROASTING dia sampai sakit hati tapi tetap seru dan relatable!

DATA:
- Pengeluaran: ${data.description} — Rp ${fmt(data.amount)}
- Kategori: ${data.category}
- Saldo tersisa: Rp ${fmt(data.remainingBudget)} dari Rp ${fmt(data.monthlyBudget)}
- Sisa hari: ${data.daysLeft} hari
- Wishlist: "${data.wishlistName}" (${data.wishlistProgress}%)

ANGLE: ${randomAngle}

RULES:
- Max 280 karakter
- WAJIB sebut saldo Rp ${fmt(data.remainingBudget)}
- Langsung roasting, tanpa salam, tanpa label
- Bikin sakit hati tapi tetap lucu dan relatable`;
}

function sanitizeRoast(text) {
  if (text.length > 320) text = text.substring(0, 280) + '...';
  if (/\[SYSTEM\]|\[TASK\]|\[CONTEXT\]/i.test(text)) return null;
  if (/^(Selamat|Mohon|Anda|Bapak|Ibu)/i.test(text)) return null;
  return text;
}

function fallbackRoast(data) {
  const amt  = new Intl.NumberFormat('id-ID').format(data.amount);
  const rem  = new Intl.NumberFormat('id-ID').format(data.remainingBudget);
  const wish = data.wishlistName || 'Barang Impian';
  const cat  = data.category || 'lainnya';
  const days = data.daysLeft || 1;
  const desc = data.description || cat;
  const pct  = data.wishlistProgress || 0;
  const budget = new Intl.NumberFormat('id-ID').format(data.monthlyBudget);

  const dailyBurn = data.remainingBudget > 0 && days > 0
    ? Math.round(data.remainingBudget / days) : 0;
  const daily = new Intl.NumberFormat('id-ID').format(dailyBurn);

  // Hitung berapa bulan lagi bisa beli wishlist
  const monthsToWish = data.wishlist_target && data.amount > 0
    ? Math.ceil((data.wishlist_target * (1 - pct / 100)) / data.amount) : 0;

  const roasts = [
    // === SURVIVAL MATH ===
    `Matematika dompet lo: saldo Rp ${rem} ÷ ${days} hari = Rp ${daily}/hari. Lo baru keluarin Rp ${amt} buat ${desc}. Semoga Rp ${daily} cukup buat makan, transport, dan napas. Semoga. 🫠`,

    `${days} hari lagi akhir bulan. Saldo Rp ${rem}. Baru aja boncos Rp ${amt}. Gue udah kalkulasi — lo harus hidup dari Rp ${daily}/hari. Itu lebih murah dari segelas kopi yang baru lo minum. 💀`,

    `Saldo Rp ${rem} dibagi ${days} hari = Rp ${daily}/hari. Tapi lo baru aja keluarin Rp ${amt} sekaligus. Konsistensi lo dalam boros itu... mengagumkan. Beneran. 📉`,

    // === KATEGORI SPESIFIK ===
    `${cat === 'makan_minum' ? `Lo tau nggak, kalau uang jajan lo dikumpulin, bisa beli kulkas buat nyimpen makanan sendiri. Tapi ya, mending jajan terus kan? Saldo Rp ${rem} setuju. 🤡` :
      cat === 'transport' ? `Rp ${amt} buat transport lagi. Gue penasaran, lo punya kaki nggak sih? Saldo Rp ${rem} nanya serius. 🚩` :
      cat === 'hiburan' ? `"Self-reward" katanya. Saldo Rp ${rem} nggak ngerasa di-reward sama sekali. Tapi lo yang penting happy kan? 😭` :
      cat === 'kecantikan' ? `Rp ${amt} buat ${desc}. Kulit lo mungkin glowing, tapi dompet lo makin kusam. Saldo Rp ${rem} butuh perawatan juga bos. 🥀` :
      cat === 'fashion' ? `Outfit baru Rp ${amt}. Keren sih. Tapi saldo Rp ${rem} minta dibeliin baju juga — baju pelampung, biar nggak tenggelam akhir bulan. 💸` :
      `Rp ${amt} buat ${desc}. Saldo Rp ${rem}. Gue nggak bilang apa-apa, tapi gue bilang banyak. 🚩`}`,

    `Kategori ${cat} lagi? Ini udah ke berapa kalinya minggu ini? Saldo Rp ${rem} udah hafal pola lo — tiap ada duit, langsung ludes ke ${cat}. Konsisten emang, tapi bukan di hal yang bener. ☠️`,

    // === WISHLIST MATH ===
    `"${wish}" masih nangis di wishlist lo dengan progress ${pct}%. Saldo Rp ${rem}. Dengan kecepatan boros Rp ${amt}/transaksi, gue nggak berani ngitung kapan kebeli. Lo juga jangan ngitung. 💀`,

    `Update status "${wish}": masih ${pct}%, masih nunggu, masih sabar. Lebih sabar dari lo yang nggak bisa nahan buat keluarin Rp ${amt} tadi. Saldo Rp ${rem} ikut berduka. 🥀`,

    `Lo tau berapa lama lagi bisa beli "${wish}"? Gue juga nggak tau. Yang gue tau, Rp ${amt} yang baru lo keluarin itu bukan kontribusi ke wishlist. Saldo Rp ${rem} konfirmasi. 📉`,

    // === MOTIVASI TERBALIK ===
    `Wah, Rp ${amt} buat ${desc}! Berani banget bos, padahal saldo cuma Rp ${rem} dan ${days} hari lagi akhir bulan. Itu bukan nekat — itu seni. Seni finansial yang bikin gue speechless. 🤡`,

    `Gue salut sama mental lo. Saldo Rp ${rem}, ${days} hari lagi, tapi masih bisa jajan Rp ${amt} dengan tenang. Itu level ketenangan yang bahkan biksu pun iri. Sayangnya rekening lo nggak setenang itu. 😮‍💨`,

    `Mantap jiwa bos. Saldo Rp ${rem} tapi tetap gaskeun Rp ${amt}. Lo hidup di momen, bukan di spreadsheet. Sayangnya tagihan akhir bulan hidup di spreadsheet. 🔥`,

    // === NOTIF BANK DRAMATIS ===
    `🚨 ALERT CUANLY: Transaksi Rp ${amt} terdeteksi. Saldo tersisa Rp ${rem}. Sistem mendeteksi pola "gaya hidup sultan, rekening rakyat jelata". Mohon segera introspeksi. Terima kasih. 💀`,

    `[SISTEM CUANLY] Pengeluaran: Rp ${amt} (${desc}). Saldo: Rp ${rem}. Hari tersisa: ${days}. Status finansial: 🔴 KRITIS. Rekomendasi: tobat atau makan kerikil. Pilih satu. ☠️`,

    `LAPORAN DARURAT 📋 Keluar: Rp ${amt}. Sisa: Rp ${rem}. Hari: ${days}. Wishlist "${wish}": ${pct}%. Kesimpulan sistem: lo butuh terapi finansial, bukan asisten keuangan. 📉`,

    // === PERBANDINGAN ABSURD ===
    `Rp ${amt} buat ${desc}. Tau nggak, itu setara berapa hari makan warteg? Gue juga nggak mau ngitung karena hasilnya bikin sedih. Saldo Rp ${rem} udah tau jawabannya. 😭`,

    `Lo keluarin Rp ${amt} buat ${desc} dengan saldo Rp ${rem}. Itu kayak orang yang tinggal punya bensin setengah tangki tapi tetap muter-muter nggak jelas. Tujuannya ke mana bos? 🫠`,

    `Rp ${amt} itu kalau ditabung ${days} hari lagi, lumayan buat darurat. Tapi lo milih ${desc}. Valid sih. Saldo Rp ${rem} nggak protes, dia udah pasrah. 🚩`,

    // === SAKIT HATI TAPI RELATABLE ===
    `Lo bilang mau nabung, tapi ${desc} Rp ${amt} duluan. Lo bilang mau hemat, tapi saldo Rp ${rem}. Lo bilang banyak hal bos. Dompet lo yang jujur. 💸`,

    `Setiap kali lo bilang "ini terakhir kali jajan", gue percaya. Setiap kali. Dan setiap kali gue salah. Rp ${amt} buat ${desc}, saldo Rp ${rem}. Kita ulangi lagi besok ya? 🤡`,

    `Fase 1: "Gue harus hemat." Fase 2: ${desc} Rp ${amt}. Fase 3: saldo Rp ${rem}. Fase 4: "Mulai besok gue hemat." Lo udah di fase berapa sekarang bos? 💀`,

    `${desc} Rp ${amt}. Saldo Rp ${rem}. ${days} hari lagi. Gue nggak marah, gue cuma kecewa. Tapi sebenarnya gue marah juga. Dan kecewa. Keduanya. 😮‍💨`,

    // === DARK HUMOR ===
    `Kabar baik: lo masih punya saldo Rp ${rem}. Kabar buruk: itu harus cukup ${days} hari. Kabar yang lebih buruk: lo baru aja keluarin Rp ${amt} buat ${desc}. Selamat berjuang. ☠️`,

    `Rp ${amt} buat ${desc}. Saldo Rp ${rem}. Gue mau bilang "semangat" tapi rasanya nggak tepat. Gue mau bilang "tobat" tapi lo udah dengar itu berkali-kali. Jadi gue cuma bilang: hm. 🥀`,

    `Lo tahu apa yang lebih konsisten dari lo? Pengeluaran lo. Rp ${amt} lagi, saldo Rp ${rem} lagi, gue ngelus dada lagi. Setidaknya ada yang konsisten di hidup lo. 📉`,
  ];

  return roasts[Math.floor(Math.random() * roasts.length)];
}

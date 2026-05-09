Product Requirements Document (PRD): Cuanly Web Dashboard 📉💸

Document Version: 1.2 (Monochrome UI Update)

Product Name: Cuanly Dashboard

Author: Luthfi Surya (Founder)

Target Market: Gen-Z, Mahasiswa, & First-Jobbers di Indonesia

1. Executive Summary

Cuanly adalah asisten keuangan Micro-SaaS berbasis AI (WhatsApp & Telegram) dengan persona "savage/julid". Jika bot WA/TG berfungsi sebagai jalur input data yang minim hambatan (zero-friction), Cuanly Web Dashboard berfungsi sebagai pusat visualisasi data (cermin realita).
C
Pain Point: 1. Aplikasi keuangan konvensional membosankan dan terasa seperti tugas akuntansi.
2. Susah menabung untuk wishlist (konser, laptop, skincare) karena pengeluaran impulsif receh (kopi, seblak, langganan streaming).
3. Tidak sadar seberapa besar persentase uang yang "terbakar" setiap bulannya.

Solution: Dashboard visual dengan copywriting sarkas yang mengonfrontasi kebiasaan buruk pengguna secara langsung, dikemas dalam desain antarmuka yang tegas dan serius.

3. Design System & Tema Visual (Monochrome & Warning)

Desain harus terasa strict, profesional, minimalis, dan berfokus pada data angka, namun tetap memberikan efek "tamparan" melalui aksen warna warning dan copywriting yang tajam.

Theme: Clean Monochrome (Light/White dominant).

Background Utama: #F5F5F5 (Neutral 50) — Putih keabu-abuan yang bersih.

Warna Permukaan (Cards): #FFFFFF (White) — Dipadukan dengan border tipis #E5E5E5 (Neutral 200) dan shape kotak tegas (rounded-none).

Brand / Primary Action Color: #171717 (Neutral 900) — Hitam pekat untuk tombol utama, logo, dan penekanan teks penting.

Semantic / Warning Colors (Aksen):

Danger / Boncos: #EF4444 (Red 500) — Sangat krusial, HANYA digunakan untuk persentase budget yang kritis, pengeluaran terbesar di chart, dan ikon minus/pengeluaran di histori.

Safe / Income: #10B981 (Emerald 500) — Eksklusif hanya untuk angka pemasukan uang.

Warning: #F59E0B (Amber 500) — Opsional untuk pengeluaran level menengah.

Typography: Plus Jakarta Sans atau Inter. Penggunaan Huruf Kapital (Uppercase) dan spasi antar huruf (tracking-wider) sangat direkomendasikan untuk label dan heading guna menambah kesan serius layaknya dokumen bank.

4. Authentication (Ultra-Lean Auth)

Untuk mempercepat akuisisi dan mengurangi hambatan (friction) pendaftaran, Cuanly tidak menggunakan sistem register email/password standar.

Login ID: Nomor WhatsApp atau ID Telegram pengguna.

Password: PIN rahasia 6 digit.

Mekanisme: User mengetik /web di bot WA/Telegram. Bot akan membuatkan PIN 6 digit secara otomatis, menyimpannya di database, dan membalas: "Mau liat rapor merah keuangan lo? Login di cuanly.vercel.app pakai WA lo dan PIN: 882910."

5. Fitur Utama & Struktur Halaman (MVP Scope)

5.1. Halaman Login (/login)

Halaman gerbang pertama untuk menampar realita pengguna. Desain sangat minimalis dengan kotak di tengah layar.

Layout: Card melayang di tengah layar (Center aligned).

Copywriting Utama: "Siap liat realita dompet lo?"

Input Form:

Field 1: Nomor WhatsApp (e.g., 0812xxxx).

Field 2: PIN Rahasia (Input box memiliki jarak huruf yang lebar tracking-[0.5em] dan menggunakan font monospace agar terasa seperti memasukkan PIN brankas).

Action Button: Tombol "TAMPAR GUE" (Warna Hitam Pekat, Huruf Kapital).

5.2. Halaman Rapor Boncos (/dashboard)

Pusat kendali visual utama. Terdiri dari beberapa komponen/kartu (Cards) berbentuk kotak tegas (rounded-none):

Roast of the Month (Hero Section): Kotak hitam (#171717) dengan teks putih dan ikon api merah. Menampilkan pesan roasting (misal: "Gelar lo minggu ini: Donatur Tetap GoFood...").

Napas Dompet (Budget Card):

Sisa budget bulan ini (Angka super besar). Angka akan berubah menjadi Merah jika pemakaian di atas 80%.

Progress bar solid (Hitam jika aman, Merah jika kritis).

Teks info: "X hari lagi" dan "X% Terbakar".

Realita vs Ekspektasi (Wishlist Tracker):

Nama barang impian dan target harga.

Progress bar monokrom (Hitam/Abu-abu).

Savage note di dalam kotak abu-abu muda bergaris kiri hitam tebal: "Baru 15% bos. Dengan gaya idup lo sekarang, ni barang baru kebeli pas lo udah ubanan."

Top 3 Dosa Finansial (Spending Chart):

Grafik Donat (Pie Chart) warna skala abu-abu (grayscale), namun potongan pengeluaran paling besar (Top 1) diberi warna Merah Menyala.

5.3. Halaman Riwayat Dosa (/history)

Fungsi: Melihat detail ke mana saja uang mengalir.

Tampilan: Daftar (List) transaksi memanjang ke bawah dengan pembatas garis tipis.

Data Points: Tanggal, Deskripsi (Nama Jajan), Kategori, Nominal, dan Tipe. Nominal pengeluaran dicetak warna Hitam (dengan ikon panah bawah Merah), pemasukan dicetak warna Hijau (dengan ikon panah atas Hijau).

(Catatan MVP: Belum ada fitur edit/hapus di web untuk rilis pertama. Semua kontrol via bot).

5.4. Halaman Pengaturan (/settings)

Profile: Inisial Nama (Kotak besar), Nama Lengkap, dan Nomor WA pengguna. Label status: "FREE PLAN".

Update Target (Wishlist): Form input strict monokrom untuk mengganti Nama Barang dan Harga Target.

Monetization Banner: Kotak Hitam menonjol (stand out) di bagian bawah layar. Menawarkan "Upgrade Mode Tobat 🔥" dengan harga Rp 15.000/bln untuk unlimited chat dan fitur ekstra. Tombol aksi berwarna putih solid.

6. Technical Stack (The "Lean" Stack)

Tumpukan teknologi yang dipilih berfokus pada kecepatan rilis (speed-to-market), efisiensi biaya operasional (gratis di awal), dan skalabilitas.

Frontend Framework: Next.js (App Router, React 18+).

Styling: Tailwind CSS (Dipilih untuk konsistensi sistem desain monokrom).

Icons & Charts: lucide-react untuk ikon minimalis, recharts untuk visualisasi grafik donat yang interaktif.

Backend & Database: Supabase (PostgreSQL) + Drizzle ORM (Digunakan bersamaan oleh Bot Node.js dan Web Next.js).

Hosting: Vercel (Gratis, optimasi otomatis untuk Next.js).

7. Go-To-Market (GTM) & Metrik Keberhasilan

Distribusi Fitur:

Rilis silent ke 4 Alpha Testers.

Bot memberikan notifikasi pop-up organik: "Laporan mingguan lo udah jadi. Cek di /web sekarang."

Success Metrics (KPI MVP):

Activation Rate: Berapa % user bot yang mencoba login ke Web Dashboard.

Engagement (Session Length): Berapa lama user memperhatikan dashboard mereka.

Conversion Rate: Berapa % user yang melihat banner di halaman Settings dan mengeklik langganan Premium.
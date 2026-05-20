'use client';

import { MessageCircle, Send } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col justify-center items-center p-5">
      {/* Logo */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tighter text-neutral-900">CUANLY</h1>
        <div className="h-0.5 w-12 bg-neutral-900 mx-auto mt-2" />
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white border border-neutral-200 p-8 animate-fade-in-up">
        <p className="text-xs font-bold tracking-widest text-neutral-400 uppercase mb-1">Web Dashboard</p>
        <h2 className="text-xl font-extrabold text-neutral-900 mb-2 leading-snug">
          Siap liat realita<br />dompet lo?
        </h2>
        <p className="text-sm text-neutral-500 mb-8">
          Login via magic link — tanpa password, tanpa ribet.
        </p>

        {/* Step 1 */}
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="w-7 h-7 bg-neutral-900 text-white text-xs font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
              1
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900">Buka bot WA atau Telegram</p>
              <p className="text-xs text-neutral-500 mt-0.5">Cari kontak <span className="font-mono font-bold text-neutral-700">Cuanly</span> di WhatsApp atau Telegram.</p>
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-7 h-7 bg-neutral-900 text-white text-xs font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
              2
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                Ketik <span className="font-mono bg-neutral-100 px-1.5 py-0.5 text-neutral-800">/web</span>
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">Bot akan membalas dengan magic link khusus buat lo.</p>
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="w-7 h-7 bg-neutral-900 text-white text-xs font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
              3
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900">Klik link-nya</p>
              <p className="text-xs text-neutral-500 mt-0.5">Lo langsung masuk ke dashboard. Sesimpel itu.</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-200 my-6" />

        {/* CTA Buttons */}
        <div className="space-y-3">
          <a
            href="https://wa.me/6288804035810?text=/web"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2.5 bg-neutral-900 hover:bg-neutral-700 text-white font-bold text-xs tracking-widest uppercase py-4 transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            BUKA DI WHATSAPP
          </a>
          <a
            href="https://t.me/CuanlyBot?start=web"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2.5 border border-neutral-300 hover:border-neutral-900 text-neutral-700 hover:text-neutral-900 font-bold text-xs tracking-widest uppercase py-4 transition-all"
          >
            <Send className="w-4 h-4" />
            BUKA DI TELEGRAM
          </a>
        </div>
      </div>

      <p className="mt-8 text-[10px] font-bold tracking-widest text-neutral-400 uppercase">
        cuanlybot.vercel.app — Cuanly v1.2
      </p>
    </div>
  );
}

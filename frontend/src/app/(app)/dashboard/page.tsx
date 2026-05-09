'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Flame, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/* ── Types ─────────────────────────────────────────────────── */
interface DashboardData {
  user: { display_name: string | null; wa_number: string; tier: string };
  budget: { total: number; spent: number; remaining: number; pct_burned: number; days_left: number; is_critical: boolean };
  wishlist: { name: string | null; target: number; saved: number; pct: number };
  top_spending: { name: string; value: number; isTop: boolean }[];
}

const COLORS = ['#EF4444', '#737373', '#D4D4D4'];

const formatRp = (v: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v);

/* ── Component ─────────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me/dashboard')
      .then(res => {
        if (res.status === 401) { router.push('/'); return null; }
        if (!res.ok) { throw new Error('API Error'); }
        return res.json();
      })
      .then(json => { if (json && !json.error) setData(json); })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-neutral-900 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-bold tracking-widest text-neutral-400 uppercase">Memuat data...</p>
      </div>
    );
  }

  if (!data || !data.user) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-xs font-bold tracking-widest text-red-500 uppercase">Gagal memuat data / Sesi habis</p>
      <button onClick={() => router.push('/')} className="text-[10px] underline">Kembali ke Login</button>
    </div>
  );

  const { budget, wishlist, top_spending, user } = data;
  const initials = user.display_name
    ? user.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : (user.wa_number ? user.wa_number.slice(-2) : 'US');

  return (
    <div className="px-4 pt-8 pb-4 space-y-4 animate-fade-in-up">

      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tighter text-neutral-900">CUANLY</h1>
          <p className="text-[10px] font-bold tracking-widest text-neutral-400 uppercase mt-0.5">Laporan Keuangan</p>
        </div>
        <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center text-white text-sm font-bold">
          {initials}
        </div>
      </header>

      {/* ① Roast of the Month */}
      <div className="bg-neutral-900 text-white p-5">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-4 h-4 text-red-500" />
          <span className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase">Roast of the Month</span>
        </div>
        <p className="text-sm font-medium leading-relaxed text-neutral-100">
          {budget.is_critical
            ? `"Tinggal ${budget.days_left} hari lagi bos, budget lo udah ${budget.pct_burned}% habis. Lanjut jajan atau mau tobat?"`
            : `"Gelar lo minggu ini: Donatur Tetap GoFood. Rekening lo belum sempat panas, langsung lo siram ke kurir ojek."`}
        </p>
      </div>

      {/* ② Napas Dompet */}
      <div className="bg-white border border-neutral-200 p-5">
        <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-3">Napas Dompet</p>

        <p className={`text-4xl font-extrabold tracking-tighter mb-1 ${budget.is_critical ? 'text-red-500' : 'text-neutral-900'}`}>
          {formatRp(budget.remaining)}
        </p>
        <p className="text-xs text-neutral-400 mb-4">Sisa dari {formatRp(budget.total)} bulan ini</p>

        <div className="w-full h-2 bg-neutral-200 mb-2">
          <div
            className={`h-2 transition-all duration-700 ${budget.is_critical ? 'bg-red-500' : 'bg-neutral-900'}`}
            style={{ width: `${Math.min(budget.pct_burned, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-bold tracking-wider text-neutral-500 uppercase">
          <span className={budget.is_critical ? 'text-red-500' : ''}>{budget.pct_burned}% TERBAKAR</span>
          <span>{budget.days_left} HARI LAGI</span>
        </div>
      </div>

      {/* ③ Realita vs Ekspektasi */}
      {wishlist.name && (
        <div className="bg-white border border-neutral-200 p-5">
          <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-3">Realita vs Ekspektasi</p>

          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-sm font-semibold text-neutral-900">{wishlist.name}</p>
              <p className="text-xs text-neutral-400 mt-0.5">Target: {formatRp(wishlist.target)}</p>
            </div>
            <p className="text-sm font-bold text-neutral-900">{formatRp(wishlist.saved)}</p>
          </div>

          <div className="w-full h-1.5 bg-neutral-200 mb-2">
            <div
              className="h-1.5 bg-neutral-700 transition-all duration-700"
              style={{ width: `${wishlist.pct}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mb-3">{wishlist.pct}% tercapai</p>

          <div className="border-l-[3px] border-neutral-900 bg-neutral-50 p-3">
            <p className="text-xs text-neutral-600 italic leading-relaxed">
              {wishlist.pct < 20
                ? `"Baru ${wishlist.pct}% bos. Dengan gaya hidup lo sekarang, barang ini baru kebeli pas lo udah ubanan."`
                : wishlist.pct < 60
                ? `"${wishlist.pct}% progress bos. Lumayan, tapi jangan nyerah tengah jalan kayak diet lo."`
                : `"${wishlist.pct}%! Hampir bos, jangan boros dulu sekarang. Sebentar lagi!"`}
            </p>
          </div>
        </div>
      )}

      {/* ④ Top 3 Dosa Finansial */}
      {top_spending.length > 0 && (
        <div className="bg-white border border-neutral-200 p-5">
          <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-4">Top 3 Dosa Finansial</p>

          <div className="h-44 w-full mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top_spending} cx="50%" cy="50%" innerRadius={46} outerRadius={66} paddingAngle={3} dataKey="value" stroke="none">
                  {top_spending.map((_, i) => <Cell key={i} fill={COLORS[i] ?? '#D4D4D4'} />)}
                </Pie>
                <Tooltip
                  formatter={(v) => formatRp(Number(v))}
                  contentStyle={{ backgroundColor: '#FFF', border: '1px solid #E5E5E5', borderRadius: 0, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-3">
            {top_spending.map((item, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5" style={{ backgroundColor: COLORS[i] ?? '#D4D4D4' }} />
                  <span className={`text-xs font-medium ${item.isTop ? 'text-red-500 font-bold' : 'text-neutral-600'}`}>
                    {item.name}
                    {item.isTop && <span className="ml-1 text-[9px] tracking-wider text-red-400 font-bold">▲ TERBESAR</span>}
                  </span>
                </div>
                <span className={`text-xs font-bold ${item.isTop ? 'text-red-500' : 'text-neutral-700'}`}>
                  {formatRp(item.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA to History */}
      <Link
        href="/history"
        className="flex items-center justify-between w-full border border-neutral-300 hover:border-neutral-900 bg-white text-neutral-700 py-4 px-5 transition-all duration-200 group"
      >
        <span className="text-xs font-bold tracking-widest uppercase">Lihat Riwayat Dosa Lengkap</span>
        <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:translate-x-0.5 transition-transform" />
      </Link>
    </div>
  );
}

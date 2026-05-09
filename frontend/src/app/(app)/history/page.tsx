'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  category: string | null;
  raw_input: string | null;
  created_at: string;
}

const formatRp = (v: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.abs(v));

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
};

export default function HistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<'all' | 'income' | 'expense'>('all');

  useEffect(() => {
    fetch('/api/me/transactions')
      .then(res => {
        if (res.status === 401) { router.push('/'); return null; }
        return res.json();
      })
      .then(json => { if (json) setTransactions(json.transactions); })
      .finally(() => setLoading(false));
  }, [router]);

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus dosa ini bos?')) return;
    
    try {
      const res = await fetch(`/api/me/transactions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTransactions(prev => prev.filter(t => t.id !== id));
      } else {
        alert('Gagal menghapus transaksi.');
      }
    } catch (err) {
      console.error(err);
      alert('Terjadi kesalahan saat menghapus.');
    }
  };

  const filtered = transactions.filter(t => {
    const desc = (t.raw_input ?? t.category ?? '').toLowerCase();
    const matchSearch = desc.includes(search.toLowerCase()) ||
                        (t.category ?? '').toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || t.type === filter;
    return matchSearch && matchFilter;
  });

  const totalIn  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalOut = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-neutral-900 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-bold tracking-widest text-neutral-400 uppercase">Memuat riwayat...</p>
      </div>
    );
  }

  return (
    <div className="pt-8 pb-4 animate-fade-in-up">
      {/* Header */}
      <div className="px-4 mb-6">
        <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-1">
          {new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase()}
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">Riwayat Dosa</h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 divide-x divide-neutral-200 border-t border-b border-neutral-200 bg-white mb-5">
        <div className="p-4">
          <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-1">Total Masuk</p>
          <p className="text-lg font-extrabold text-emerald-600 tracking-tight">{formatRp(totalIn)}</p>
        </div>
        <div className="p-4">
          <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-1">Total Boncos</p>
          <p className="text-lg font-extrabold text-neutral-900 tracking-tight">{formatRp(totalOut)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="flex border border-neutral-300 focus-within:border-neutral-900 bg-white transition-colors">
          <div className="flex items-center pl-3">
            <Search className="w-4 h-4 text-neutral-400" />
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari transaksi..."
            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Filter */}
      <div className="px-4 flex gap-2 mb-5">
        {(['all', 'income', 'expense'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-[9px] font-bold tracking-widest uppercase transition-all duration-150 border ${
              filter === f
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-500'
            }`}
          >
            {f === 'all' ? 'SEMUA' : f === 'income' ? 'MASUK' : 'KELUAR'}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white border-t border-neutral-200">
        {filtered.length === 0 ? (
          <div className="text-center py-16 px-4">
            <p className="text-3xl mb-3">🔍</p>
            <p className="text-neutral-400 text-sm">
              {transactions.length === 0
                ? 'Belum ada transaksi. Chat bot WA/TG dulu bos!'
                : 'Tidak ada transaksi yang cocok.'}
            </p>
          </div>
        ) : (
          filtered.map((t, idx) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 px-4 py-4 ${idx < filtered.length - 1 ? 'border-b border-neutral-100' : ''}`}
            >
              <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${t.type === 'income' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                {t.type === 'income'
                  ? <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                  : <ArrowDownLeft className="w-4 h-4 text-red-500" />
                }
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 truncate">
                  {t.raw_input ?? t.category ?? 'Transaksi'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {t.category && (
                    <span className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase">{t.category}</span>
                  )}
                  <span className="text-neutral-300">·</span>
                  <span className="text-[9px] text-neutral-400">{formatDate(t.created_at)}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <p className={`font-bold text-sm flex-shrink-0 ${t.type === 'income' ? 'text-emerald-600' : 'text-neutral-900'}`}>
                  {t.type === 'income' ? '+' : '-'}{formatRp(t.amount)}
                </p>
                <button 
                  onClick={() => handleDelete(t.id)}
                  className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="Hapus Transaksi"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-center text-neutral-400 text-[10px] tracking-wider uppercase py-5 px-4">
        * Edit transaksi via bot WA/Telegram
      </p>
    </div>
  );
}

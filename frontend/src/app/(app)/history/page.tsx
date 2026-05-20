'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Search, Trash2, Pencil, X, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  category: string | null;
  description: string | null;
  raw_input: string | null;
  created_at: string;
}

const CATEGORIES = [
  'makan_minum', 'transport', 'belanja', 'hiburan', 'kesehatan',
  'fashion', 'kecantikan', 'pendidikan', 'tagihan', 'tabungan', 'sosial', 'lainnya',
];

const formatRp = (v: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.abs(v));

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
};

export default function HistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filter,       setFilter]       = useState<'all' | 'income' | 'expense'>('all');
  const [tier,         setTier]         = useState<string>('free');
  const [limit,        setLimit]        = useState<number>(20);

  // Edit modal state
  const [editTx,       setEditTx]       = useState<Transaction | null>(null);
  const [editType,     setEditType]     = useState<'expense' | 'income'>('expense');
  const [editAmount,   setEditAmount]   = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDesc,     setEditDesc]     = useState('');
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    fetch('/api/me/transactions')
      .then(res => {
        if (res.status === 401) { router.push('/'); return null; }
        return res.json();
      })
      .then(json => {
        if (json) {
          setTransactions(json.transactions);
          setTier(json.tier ?? 'free');
          setLimit(json.limit ?? 20);
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const openEdit = (t: Transaction) => {
    setEditTx(t);
    setEditType(t.type as 'expense' | 'income');
    setEditAmount(String(t.amount));
    setEditCategory(t.category ?? 'lainnya');
    setEditDesc(t.description ?? t.raw_input ?? '');
  };

  const closeEdit = () => {
    setEditTx(null);
    setSaving(false);
  };

  const handleSaveEdit = async () => {
    if (!editTx) return;
    if (!editAmount || isNaN(Number(editAmount)) || Number(editAmount) <= 0) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/me/transactions/${editTx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        editType,
          amount:      Number(editAmount),
          category:    editCategory,
          description: editDesc,
          raw_input:   editTx.raw_input,
        }),
      });

      if (res.ok) {
        setTransactions(prev => prev.map(t =>
          t.id === editTx.id
            ? { ...t, type: editType, amount: Number(editAmount), category: editCategory, description: editDesc }
            : t
        ));
        closeEdit();
      } else {
        alert('Gagal menyimpan perubahan.');
      }
    } catch (err) {
      console.error(err);
      alert('Terjadi kesalahan.');
    } finally {
      setSaving(false);
    }
  };

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

      {/* ── Edit Modal ─────────────────────────────────── */}
      {editTx && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-neutral-200">
              <div>
                <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase">Edit</p>
                <h2 className="text-base font-extrabold tracking-tight text-neutral-900">Koreksi Dosa</h2>
              </div>
              <button onClick={closeEdit} className="p-1.5 hover:bg-neutral-100 transition-colors">
                <X className="w-5 h-5 text-neutral-500" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              {/* Tipe */}
              <div>
                <label className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase block mb-2">Tipe</label>
                <div className="flex gap-2">
                  {(['expense', 'income'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setEditType(t)}
                      className={`flex-1 py-2.5 text-[10px] font-bold tracking-widest uppercase border transition-all ${
                        editType === t
                          ? t === 'expense'
                            ? 'bg-red-500 text-white border-red-500'
                            : 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-neutral-500 border-neutral-300'
                      }`}
                    >
                      {t === 'expense' ? '↓ KELUAR' : '↑ MASUK'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nominal */}
              <div>
                <label className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase block mb-1.5">Nominal (Rp)</label>
                <div className="flex border border-neutral-300 focus-within:border-neutral-900 transition-colors">
                  <span className="bg-neutral-100 border-r border-neutral-300 px-3 flex items-center text-sm font-semibold text-neutral-500">Rp</span>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={e => setEditAmount(e.target.value)}
                    className="flex-1 bg-white px-3 py-3 text-sm text-neutral-900 focus:outline-none"
                    placeholder="25000"
                  />
                </div>
              </div>

              {/* Deskripsi */}
              <div>
                <label className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase block mb-1.5">Deskripsi</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  className="w-full border border-neutral-300 focus:border-neutral-900 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none transition-colors"
                  placeholder="e.g. Kopi susu kekinian"
                />
              </div>

              {/* Kategori */}
              <div>
                <label className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase block mb-1.5">Kategori</label>
                <select
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                  className="w-full border border-neutral-300 focus:border-neutral-900 bg-white px-4 py-3 text-sm text-neutral-900 focus:outline-none transition-colors appearance-none"
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={closeEdit}
                  className="flex-1 py-3.5 text-[10px] font-bold tracking-widest uppercase border border-neutral-300 hover:border-neutral-900 text-neutral-600 transition-all"
                >
                  BATAL
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex-1 py-3.5 text-[10px] font-bold tracking-widest uppercase bg-neutral-900 hover:bg-neutral-700 disabled:bg-neutral-400 text-white transition-all flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <><Check className="w-3.5 h-3.5" /> SIMPAN</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── End Edit Modal ─────────────────────────────── */}

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
              {/* Icon */}
              <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${t.type === 'income' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                {t.type === 'income'
                  ? <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                  : <ArrowDownLeft className="w-4 h-4 text-red-500" />
                }
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 truncate">
                  {t.description ?? t.raw_input ?? t.category ?? 'Transaksi'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {t.category && (
                    <span className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase">{t.category}</span>
                  )}
                  <span className="text-neutral-300">·</span>
                  <span className="text-[9px] text-neutral-400">{formatDate(t.created_at)}</span>
                </div>
              </div>

              {/* Amount + Actions */}
              <div className="flex items-center gap-1.5">
                <p className={`font-bold text-sm flex-shrink-0 ${t.type === 'income' ? 'text-emerald-600' : 'text-neutral-900'}`}>
                  {t.type === 'income' ? '+' : '-'}{formatRp(t.amount)}
                </p>
                <button
                  onClick={() => openEdit(t)}
                  className="p-1.5 text-neutral-300 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors"
                  title="Edit Transaksi"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="Hapus Transaksi"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Free tier upsell banner ─────────────────────── */}
      {tier === 'free' && transactions.length >= limit && (
        <div className="mx-4 mt-4 bg-neutral-900 text-white p-5">
          <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-1">🔒 Free Plan</p>
          <p className="text-sm font-extrabold tracking-tight mb-1">Hanya {limit} transaksi terakhir</p>
          <p className="text-xs text-neutral-400 mb-3 leading-relaxed">
            Upgrade Premium buat akses riwayat lengkap sampai 200 transaksi + laporan mendalam.
          </p>
          <a
            href={`https://wa.me/6288804035810?text=${encodeURIComponent('/upgrade')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center bg-white text-neutral-900 font-bold text-xs tracking-widest uppercase py-3 hover:bg-neutral-100 transition-colors"
          >
            UPGRADE — Rp 15.000/bln 🔥
          </a>
        </div>
      )}
    </div>
  );
}

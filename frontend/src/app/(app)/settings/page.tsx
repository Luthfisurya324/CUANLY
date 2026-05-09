'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, LogOut, ChevronRight } from 'lucide-react';

interface UserProfile {
  display_name: string | null;
  wa_number: string;
  tier: string;
  wishlist_name: string | null;
  wishlist_target: number | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile,        setProfile]        = useState<UserProfile | null>(null);
  const [wishlistName,   setWishlistName]   = useState('');
  const [wishlistTarget, setWishlistTarget] = useState('');
  const [saved,          setSaved]          = useState(false);
  const [saving,         setSaving]         = useState(false);

  useEffect(() => {
    fetch('/api/me/dashboard')
      .then(res => {
        if (res.status === 401) { router.push('/'); return null; }
        return res.json();
      })
      .then(json => {
        if (json) {
          setProfile(json.user);
          setWishlistName(json.user.wishlist_name ?? '');
          setWishlistTarget(json.user.wishlist_target ? String(json.user.wishlist_target) : '');
        }
      });
  }, [router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch('/api/me/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wishlist_name: wishlistName, wishlist_target: wishlistTarget }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/me/settings', { method: 'DELETE' });
    router.push('/');
  };

  const initials = profile?.display_name
    ? profile.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : (profile?.wa_number.slice(-2) ?? '??');

  return (
    <div className="pt-8 pb-4 animate-fade-in-up">
      <div className="px-4 mb-6">
        <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-1">Akun</p>
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">Pengaturan</h1>
      </div>

      {/* Profile Card */}
      <div className="bg-white border-t border-b border-neutral-200 px-4 py-5 mb-4">
        <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-4">Profil</p>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-neutral-900 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xl font-extrabold tracking-wider">{initials}</span>
          </div>
          <div>
            <p className="text-base font-bold text-neutral-900">{profile?.display_name ?? 'Bos Boncos'}</p>
            <p className="text-sm text-neutral-500 mt-0.5">
              {profile?.wa_number.startsWith('62') 
                ? `+${profile.wa_number}` 
                : `ID: ${profile?.wa_number}`}
            </p>
            <div className="mt-2 inline-block border border-neutral-300 px-2 py-0.5">
              <span className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase">
                {profile?.tier === 'premium' ? '⭐ PREMIUM' : 'FREE PLAN'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Update Wishlist */}
      <div className="bg-white border-t border-b border-neutral-200 px-4 py-5 mb-4">
        <p className="text-[9px] font-bold tracking-widest text-neutral-400 uppercase mb-4">Update Target Wishlist</p>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase block">Nama Barang</label>
            <input
              type="text"
              value={wishlistName}
              onChange={e => setWishlistName(e.target.value)}
              className="w-full border border-neutral-300 focus:border-neutral-900 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none transition-colors"
              placeholder="e.g. Tiket Konser Coldplay"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold tracking-widest text-neutral-500 uppercase block">Harga Target (Rp)</label>
            <div className="flex border border-neutral-300 focus-within:border-neutral-900 transition-colors">
              <span className="bg-neutral-100 border-r border-neutral-300 px-3 flex items-center text-sm font-semibold text-neutral-500">Rp</span>
              <input
                type="number"
                value={wishlistTarget}
                onChange={e => setWishlistTarget(e.target.value)}
                className="flex-1 bg-white px-3 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none"
                placeholder="3500000"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className={`w-full py-3.5 text-[10px] font-bold tracking-widest uppercase transition-all duration-200 ${
              saved ? 'bg-emerald-600 text-white' : 'bg-neutral-900 hover:bg-neutral-700 disabled:bg-neutral-400 text-white'
            }`}
          >
            {saving ? 'MENYIMPAN...' : saved ? '✓ TERSIMPAN' : 'SIMPAN TARGET'}
          </button>
        </form>
      </div>

      {/* Menu */}
      <div className="bg-white border-t border-b border-neutral-200 mb-4 divide-y divide-neutral-100">
        {[
          { label: 'Tentang Cuanly',  sub: 'v1.2 — Monochrome Update' },
          { label: 'Privacy Policy',  sub: 'Baca sebelum complain'     },
          { label: 'Hubungi Kami',    sub: 'Lewat bot aja, bos'        },
        ].map(item => (
          <button key={item.label} className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-neutral-50 transition-colors group">
            <div>
              <p className="text-sm font-semibold text-neutral-900">{item.label}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{item.sub}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}
      </div>

      {/* Premium Banner */}
      {profile?.tier !== 'premium' && (
        <div className="mx-4 bg-neutral-900 text-white p-6 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4" />
            <p className="text-[9px] font-bold tracking-widest uppercase text-neutral-400">Premium</p>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight mb-1">UPGRADE MODE TOBAT 🔥</h2>
          <p className="text-neutral-400 text-xs mb-4 leading-relaxed">
            Unlimited chat, analisis AI lebih dalam, dan notifikasi otomatis biar lo gak boncos parah.
          </p>
          <ul className="space-y-1.5 mb-5">
            {['Unlimited pesan ke bot', 'Laporan bulanan mendalam', 'Notifikasi auto-boncos', 'Dashboard tanpa limit'].map(f => (
              <li key={f} className="flex items-center gap-2 text-xs text-neutral-300">
                <span className="w-1.5 h-1.5 bg-white flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-extrabold">Rp 15.000<span className="text-sm font-normal text-neutral-400">/bln</span></p>
              <p className="text-neutral-500 text-[10px]">Lebih murah dari seblak sebulan.</p>
            </div>
            <button className="bg-white text-neutral-900 hover:bg-neutral-100 font-bold text-xs tracking-widest uppercase px-5 py-3 transition-colors">
              UPGRADE
            </button>
          </div>
        </div>
      )}

      {/* Logout */}
      <div className="px-4 pb-2">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 border border-neutral-300 hover:border-neutral-900 text-neutral-600 hover:text-neutral-900 py-4 font-bold text-xs tracking-widest uppercase transition-all duration-200"
        >
          <LogOut className="w-4 h-4" />
          KELUAR (TOBAT)
        </button>
      </div>
    </div>
  );
}

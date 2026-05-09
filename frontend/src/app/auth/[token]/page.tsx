'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function AuthTokenPage() {
  const router = useRouter();
  const params = useParams();
  const token  = params.token as string;

  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) return;

    fetch(`/api/auth/token/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          router.replace('/dashboard');
        } else {
          setErrorMsg(data.error ?? 'Link tidak valid.');
          setStatus('error');
        }
      })
      .catch(() => {
        setErrorMsg('Koneksi error. Cek internet lo bos.');
        setStatus('error');
      });
  }, [token, router]);

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col justify-center items-center p-5">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tighter text-neutral-900">CUANLY</h1>
        <div className="h-0.5 w-12 bg-neutral-900 mx-auto mt-2" />
      </div>

      <div className="w-full max-w-sm bg-white border border-neutral-200 p-8 text-center animate-fade-in-up">
        {status === 'loading' ? (
          <>
            <div className="w-8 h-8 border-2 border-neutral-900 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm font-semibold text-neutral-700">Verifikasi link kamu...</p>
            <p className="text-xs text-neutral-400 mt-1">Sebentar ya, lagi ngecek ke database...</p>
          </>
        ) : (
          <>
            <p className="text-2xl mb-4">🚫</p>
            <p className="text-sm font-bold text-neutral-900 mb-2">Link Tidak Valid</p>
            <div className="border-l-[3px] border-red-500 bg-red-50 p-3 text-left mb-6">
              <p className="text-xs text-red-600">{errorMsg}</p>
            </div>
            <button
              onClick={() => router.push('/')}
              className="w-full bg-neutral-900 hover:bg-neutral-700 text-white font-bold text-xs tracking-widest uppercase py-3 transition-colors"
            >
              KEMBALI KE LOGIN
            </button>
            <p className="mt-4 text-xs text-neutral-400">
              Ketik <span className="font-mono font-bold text-neutral-600">/web</span> di bot WA/TG untuk link baru.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

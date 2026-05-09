'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, History, Settings } from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'DASHBOARD', icon: LayoutDashboard },
  { href: '/history',   label: 'RIWAYAT',   icon: History          },
  { href: '/settings',  label: 'PENGATURAN', icon: Settings         },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-neutral-200">
      <div className="max-w-md mx-auto flex items-center justify-around px-4 py-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-4 py-1.5 transition-all duration-150 ${
                isActive ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-[1.5px]'}`} />
              <span className={`text-[9px] font-bold tracking-widest ${isActive ? 'text-neutral-900' : 'text-neutral-400'}`}>
                {label}
              </span>
              {isActive && <span className="w-4 h-0.5 bg-neutral-900 rounded-full" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

import BottomNav from '@/components/BottomNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-neutral-100">
      <main className="relative max-w-md mx-auto w-full pb-24">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cuanly – Rapor Boncos Lo",
  description: "Asisten keuangan AI yang savage. Catat cuan, kena roast, tobat.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-100 text-neutral-900">
        {children}
      </body>
    </html>
  );
}

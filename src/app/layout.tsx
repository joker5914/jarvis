import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/nav/Navbar";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "SDR Lead Gen",
  description: "SMB prospecting dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const geist = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-geist-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Entry Accounting",
  description: "Монгол нягтлан бодох бүртгэлийн систем",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="mn" className={`h-full ${geist.variable} ${fraunces.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="h-full font-sans antialiased" style={{ backgroundColor: 'var(--ea-bg)', color: 'var(--ea-text-1)' }}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

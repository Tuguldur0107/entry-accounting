import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--ea-font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--ea-font-mono" });

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
    <html lang="mn" className={`h-full ${inter.variable} ${fraunces.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="h-full antialiased" style={{ background: 'var(--ea-bg)', color: 'var(--ea-text-1)' }}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

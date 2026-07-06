import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

// Inline script that runs before React hydration to apply the saved theme
// class to <html>. Defined here (server file, no "use client") so the template
// literal serializes to the actual JS string in the rendered HTML.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var isDark=t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(isDark){r.classList.add('dark');}r.style.colorScheme=isDark?'dark':'light';}catch(e){}})();`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="h-full font-sans antialiased">
        <ThemeProvider>
          {children}
        </ThemeProvider>
        {/* Global toast host. `theme="system"` follows the .dark class on
            <html>; richColors gives success/error their own tints. */}
        <Toaster
          position="top-right"
          theme="system"
          richColors
          closeButton
          toastOptions={{ duration: 3500 }}
        />
      </body>
    </html>
  );
}

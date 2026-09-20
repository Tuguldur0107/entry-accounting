// Нэвтрэлтийн бүлгийн ЖИЖИГ хуудасны жааз (сэргээх, баталгаажуулах, «бүртгэл
// хаалттай») — толгой/хөл нь бүртгэлийн хуудастай ИЖИЛ. Server/client аль
// алинд render хийгдэнэ.

import type { ReactNode } from "react";

import { EAMark, EAWordmark } from "@/components/auth/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon, type IconName } from "@/components/ui/icon";

export function AuthPageShell({
  title,
  icon,
  children,
}: {
  title: string;
  /** Толгойн дүрс — амжилт (success) / алдаа (error); байхгүй бол гарчиг л. */
  icon?: IconName;
  children: ReactNode;
}) {
  const tone =
    icon === "success" ? "var(--ea-success)" : icon === "error" ? "var(--ea-danger)" : "var(--ea-primary)";
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        className="ea-glass"
        style={{ borderBottom: "1px solid var(--ea-border)", padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <EAMark size={32} />
          <EAWordmark size={17} />
        </div>
        <ThemeToggle />
      </header>

      <main style={{ flex: 1, display: "grid", placeItems: "center", padding: "40px 24px" }}>
        <div
          className="ea-fade-up ea-glass"
          style={{
            width: "100%", maxWidth: 480, padding: "36px 40px",
            border: "1px solid var(--ea-border)",
            borderRadius: "var(--ea-r-xl)", boxShadow: "var(--ea-shadow-3)",
          }}
        >
          {icon ? (
            <div
              style={{
                width: 56, height: 56, borderRadius: "50%", marginBottom: 18,
                background: `color-mix(in srgb, ${tone} 12%, var(--ea-surface))`, color: tone,
                display: "grid", placeItems: "center",
                border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)`,
              }}
            >
              <Icon name={icon} size="2xl" />
            </div>
          ) : null}
          <h1 style={{ fontFamily: "var(--ea-font-display)", fontSize: 24, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
            {title}
          </h1>
          {children}
        </div>
      </main>

      <footer
        className="ea-glass"
        style={{
          padding: "20px 32px", borderTop: "1px solid var(--ea-border)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--ea-text-3)",
        }}
      >
        <span>© 2026 Entry Accounting · Бүх эрх хуулиар хамгаалагдсан</span>
        <a href="mailto:support@entry.mn" style={{ color: "var(--ea-text-3)" }}>Тусламж</a>
      </footer>
    </div>
  );
}

// Бүртгэлийн хуудас. Хаалт нь `lib/registration.ts`-д: эхний хэрэглэгч
// чөлөөтэй, дараа нь зөвхөн урилгын линкээр (`/register?invite=<token>`).
// Энэ шалгалт зөвхөн харагдах байдлын тухай — жинхэнэ хориг нь server
// action (`registerUser`) дотор байгаа тул формыг тойрч дуудсан ч хүчинтэй.
import Link from "next/link";

import { EAMark, EAWordmark } from "@/components/auth/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { registrationMode } from "@/lib/registration";

import RegisterForm from "./register-form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const mode = await registrationMode();
  if (mode === "open" || invite) return <RegisterForm />;

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
          <h1 style={{ fontFamily: "var(--ea-font-display)", fontSize: 24, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
            Бүртгэл хаалттай
          </h1>
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.7, color: "var(--ea-text-3)" }}>
            Энэ систем нэг байгууллагад зориулагдсан тул чөлөөт бүртгэл нээлттэй байдаггүй.
            Танд эрх хэрэгтэй бол байгууллагынхаа админаас <strong style={{ color: "var(--ea-text-1)" }}>урилгын линк</strong> авна уу.
          </p>
          <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7, color: "var(--ea-text-3)" }}>
            Админ нь: <strong style={{ color: "var(--ea-text-1)" }}>Удирдлага → Байгууллага → Гишүүн урих</strong>.
            Урилгын линкээр орсон хүн шууд тухайн байгууллагын бүртгэлд элсэнэ.
          </p>
          <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--ea-text-3)" }}>
            Бүртгэлтэй юу?{" "}
            <Link href="/login" style={{ fontWeight: 500, color: "var(--ea-primary)" }}>Нэвтрэх</Link>
          </div>
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

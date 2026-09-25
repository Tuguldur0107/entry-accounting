// Бүртгэлийн хуудас. Хаалт нь `lib/registration.ts`-д: эхний хэрэглэгч
// чөлөөтэй, дараа нь зөвхөн урилгын линкээр (`/register?invite=<token>`).
// Энэ шалгалт зөвхөн харагдах байдлын тухай — жинхэнэ хориг нь server
// action (`registerUser`) дотор байгаа тул формыг тойрч дуудсан ч хүчинтэй.
import Link from "next/link";

import { eq } from "drizzle-orm";

import { EAMark, EAWordmark } from "@/components/auth/brand";
import { SkillsSignedIn } from "@/components/skills/skills-signed-in";
import { ThemeToggle } from "@/components/theme-toggle";
import { auth, getActiveOrg, signOut } from "@/lib/auth";
import { featureUsable, hasFeature } from "@/lib/billing/entitlements";
import { getEntitlements } from "@/lib/billing/load";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { deploymentMode } from "@/lib/deployment-mode";
import { registrationMode } from "@/lib/registration";

import RegisterForm from "./register-form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; plan?: string }>;
}) {
  const { invite, plan } = await searchParams;
  const mode = await registrationMode();
  // «AI нягтлан» (skills) захиалга — зөвхөн SaaS (entry.mn landing-ийн CTA).
  const skills = plan === "skills" && deploymentMode() === "saas" && !invite;
  // Нэвтэрсэн хэрэглэгч «AI нягтлан» линкийг нээвэл (proxy үсэргэдэггүй —
  // lib/auth-redirect.ts) самбар руу чимээгүй оруулахгүй, сонголтоо харуулна.
  if (plan === "skills" && !invite) {
    const session = await auth();
    if (session?.user?.id) return <SignedInSkills email={session.user.email ?? null} />;
  }
  if (mode === "open" || invite) return <RegisterForm plan={skills ? "skills" : undefined} />;

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

async function SignedInSkills({ email }: { email: string | null }) {
  // Ghost session (JWT хүчинтэй ч гишүүнчлэлгүй) үед getActiveOrg шиднэ —
  // тэгвэл зөвхөн «гараад шинээр бүртгүүлэх» сонголт үлдэнэ.
  const active = await getActiveOrg().catch(() => null);
  let orgName: string | null = null;
  let hasKnowledge = false;
  let guideHref = "/";
  if (active) {
    const [ent, org] = await Promise.all([
      getEntitlements(active.orgId),
      db.query.organizations.findFirst({
        where: eq(organizations.id, active.orgId),
        columns: { name: true },
      }),
    ]);
    orgName = org?.name ?? null;
    hasKnowledge = featureUsable(ent, "knowledge");
    // skills багцын нүүр = холбох заавар; нягтлан бодох багцад AI тохиргооны MCP таб.
    guideHref = hasFeature(ent, "accounting") ? "/ai/settings?tab=mcp" : "/";
  }
  return (
    <SkillsSignedIn
      email={email}
      orgName={orgName}
      hasKnowledge={hasKnowledge}
      guideHref={guideHref}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/register?plan=skills" });
      }}
    />
  );
}

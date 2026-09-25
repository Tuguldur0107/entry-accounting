// «AI нягтлан» линкийг (`/register?plan=skills`) НЭВТЭРСЭН хэрэглэгч нээхэд —
// өмнө нь proxy самбар руу чимээгүй үсэргэдэг байв. Одоо ИЛ хэлнэ:
//   • идэвхтэй байгууллагын багцад мэдлэгийн сан аль хэдийн байвал → дахин
//     худалдан авах шаардлагагүй, холбох заавар руу
//   • байхгүй бол (эсвэл өөр хүнд зориулж) → гараад шинэ бүртгэл үүсгэх
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function SkillsSignedIn({
  email,
  orgName,
  hasKnowledge,
  guideHref,
  signOutAction,
}: {
  email: string | null;
  orgName: string | null;
  /** Идэвхтэй байгууллагын багцад мэдлэгийн сан ашиглах боломжтой эсэх. */
  hasKnowledge: boolean;
  /** Холбох заавар — skills багц бол нүүр, нягтлан бодох багц бол AI тохиргооны MCP таб. */
  guideHref: string;
  signOutAction: () => Promise<void>;
}) {
  const text = { marginTop: 14, fontSize: 14, lineHeight: 1.7, color: "var(--ea-text-3)" } as const;
  const strong = { color: "var(--ea-text-1)" } as const;
  return (
    <AuthPageShell title="AI нягтлан" icon={hasKnowledge ? "success" : undefined}>
      <p style={text}>
        Та <strong style={strong}>{email ?? "бүртгэлтэй хэрэглэгч"}</strong>-ээр нэвтэрсэн байна
        {orgName ? (
          <>
            {" "}(<strong style={strong}>{orgName}</strong>)
          </>
        ) : null}
        .
      </p>
      {hasKnowledge ? (
        <p style={text}>
          Таны одоогийн багцад AI нягтлан (мэдлэгийн сан) <strong style={strong}>аль хэдийн багтсан</strong> —
          дахин худалдан авах шаардлагагүй. Холбох заавраар өөрийн ChatGPT / Claude-д холбоно уу.
        </p>
      ) : (
        <p style={text}>
          Энэ байгууллагын багцад AI нягтлан идэвхгүй байна. Өөр и-мэйлээр тусдаа AI нягтлан бүртгэл
          үүсгэх бол гараад шинээр бүртгүүлнэ үү (24 цаг үнэгүй).
        </p>
      )}
      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        {hasKnowledge ? (
          <Link href={guideHref} className={buttonVariants({ size: "lg" })} style={{ textDecoration: "none" }}>
            <Icon name="ai" size="sm" aria-hidden />
            Холбох заавар үзэх
          </Link>
        ) : null}
        <form action={signOutAction}>
          <button
            type="submit"
            className={buttonVariants({ variant: hasKnowledge ? "outline" : "default", size: "lg" })}
            style={{ width: "100%" }}
          >
            <Icon name="signOut" size="sm" aria-hidden />
            Гараад шинэ AI нягтлан бүртгэл үүсгэх
          </button>
        </form>
        <Link
          href="/"
          style={{ marginTop: 6, textAlign: "center", fontSize: 13, color: "var(--ea-primary)", fontWeight: 500 }}
        >
          Системд буцах
        </Link>
      </div>
    </AuthPageShell>
  );
}

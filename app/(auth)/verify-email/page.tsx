// И-мэйл баталгаажуулах — линкээс (/verify-email?token=…). Нэвтрэлт
// шаардахгүй; token нэг удаа, 24 цаг. Server component шууд зарцуулна.
import Link from "next/link";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { verifyEmailToken } from "@/lib/actions/account-recovery";

export const metadata = { title: "И-мэйл баталгаажуулах — Entry Accounting" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await verifyEmailToken(token) : { error: "Линк дутуу байна — и-мэйл дэх линкийг бүтнээр нь нээнэ үү." };
  const ok = !result.error;

  return (
    <AuthPageShell
      title={ok ? "И-мэйл баталгаажлаа" : "Баталгаажуулалт амжилтгүй"}
      icon={ok ? "success" : "error"}
    >
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ea-text-3)", margin: "8px 0 20px" }}>
        {ok
          ? "Таны и-мэйл хаяг баталгаажлаа. Системээ үргэлжлүүлэн ашиглана уу."
          : result.error}
      </p>
      <div style={{ textAlign: "center", fontSize: 13 }}>
        <Link href="/" style={{ fontWeight: 500, color: "var(--ea-primary)" }}>
          Систем рүү орох
        </Link>
      </div>
    </AuthPageShell>
  );
}

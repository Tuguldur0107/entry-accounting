"use server";

// Нууц үг сэргээх + и-мэйл баталгаажуулах Server Actions.
//
// Зарчим (харилцагчийн deploy бүрд ажиллах ёстой):
//   • Баталгаажуулалт нэвтрэлтийг ХЭЗЭЭ Ч хаахгүй — зөвхөн баннер + дахин илгээх.
//     Багана нэмэгдэхээс өмнөх хэрэглэгч (preDeploy нөхөлт), урилгаар ирсэн,
//     и-мэйл тохируулаагүй deploy-д бүртгүүлсэн хүн шууд баталгаажсан.
//   • Сэргээх хүсэлт и-мэйл БАЙГАА/БАЙХГҮЙ-г ил хэлэхгүй (enumeration) — үргэлж
//     «илгээлээ»; и-мэйл ТОХИРУУЛААГҮЙ deploy-д л ил алдаа (хүлээгээд нэмэргүй).
//   • Token нэг удаагийн, хугацаатай, DB-д hash (lib/account/tokens.ts).

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/account/emails";
import { consumeAuthToken } from "@/lib/account/token-store";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { transactionalEmailConfigured } from "@/lib/email/transactional";
import { checkRateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_NOT_CONFIGURED_MSG =
  "Энэ систем и-мэйл илгээх тохиргоогүй байна — нууц үгээ байгууллагынхаа админаар сэргээлгэнэ үү (Удирдлага → Байгууллага).";

/** «Нууц үгээ мартсан» — и-мэйл байгаа бол сэргээх линк илгээнэ. */
export async function requestPasswordReset(emailInput: string): Promise<ActionResult> {
  try {
    const email = emailInput?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) return { error: "И-мэйл хаяг буруу байна" };
    if (!transactionalEmailConfigured()) return { error: EMAIL_NOT_CONFIGURED_MSG };
    // Нэг хаягт 15 минутад 3 — спам/enumeration-оос хамгаална.
    if (!checkRateLimit(`pw-reset:${email}`, 3, 15 * 60_000))
      return { error: "Хэт олон оролдлого — 15 минутын дараа дахин оролдоно уу" };

    const user = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email}`,
      columns: { id: true, email: true, name: true },
    });
    // Бүртгэлгүй бол ч амжилттай гэж хариулна (хаяг байгаа эсэхийг задлахгүй).
    if (!user) return {};
    const result = await sendPasswordResetEmail(user);
    if (result === "failed") return { error: "И-мэйл илгээгдсэнгүй — түр зуурын алдаа, дахин оролдоно уу" };
    return {};
  } catch (caught) {
    return actionError("requestPasswordReset", caught, "Хүсэлт илгээгдсэнгүй");
  }
}

/** Сэргээх линкээр шинэ нууц үг тохируулна — token нэг удаа зарцуулагдана. */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<ActionResult> {
  try {
    if (typeof input.password !== "string" || input.password.length < 8)
      return { error: "Нууц үг 8-аас доошгүй тэмдэгттэй байна" };
    const userId = await consumeAuthToken(input.token, "password_reset");
    if (!userId)
      return {
        error:
          "Сэргээх линк хүчингүй байна — хугацаа нь дууссан (1 цаг) эсвэл аль хэдийн ашиглагдсан. Дахин хүсэлт илгээнэ үү.",
      };
    const passwordHash = await bcrypt.hash(input.password, 12);
    // Линк и-мэйлээр ирсэн тул хаяг нь баталгаажсан гэж тооцно.
    await db
      .update(users)
      .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, userId));
    console.log(`[account] password reset user=${userId} at=${new Date().toISOString()}`);
    return {};
  } catch (caught) {
    return actionError("resetPassword", caught, "Нууц үг солигдсонгүй");
  }
}

/** И-мэйлийн линкээр баталгаажуулна (verify-email хуудас дуудна). */
export async function verifyEmailToken(token: string): Promise<ActionResult> {
  try {
    const userId = await consumeAuthToken(token, "email_verify");
    if (!userId)
      return {
        error:
          "Баталгаажуулах линк хүчингүй байна — хугацаа нь дууссан (24 цаг) эсвэл аль хэдийн ашиглагдсан. Нэвтрээд «Дахин илгээх» дарна уу.",
      };
    await db
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, userId));
    return {};
  } catch (caught) {
    return actionError("verifyEmailToken", caught, "Баталгаажуулалт амжилтгүй");
  }
}

/** Нэвтэрсэн хэрэглэгч баталгаажуулах и-мэйлээ дахин авна (баннерын товч). */
export async function resendVerificationEmail(): Promise<ActionResult<{ sent: boolean }>> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return { error: "Нэвтрэх шаардлагатай" };
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) return { error: "Хэрэглэгч олдсонгүй" };
    if (user.emailVerifiedAt) return { sent: false };
    if (!transactionalEmailConfigured())
      return { error: "Энэ систем и-мэйл илгээх тохиргоогүй байна — админ RESEND тохиргоог хийсний дараа баталгаажуулна" };
    if (!checkRateLimit(`verify-resend:${userId}`, 3, 15 * 60_000))
      return { error: "Хэт олон оролдлого — 15 минутын дараа дахин оролдоно уу" };
    const result = await sendVerificationEmail(user);
    if (result !== "sent") return { error: "И-мэйл илгээгдсэнгүй — дахин оролдоно уу" };
    return { sent: true };
  } catch (caught) {
    return actionError("resendVerificationEmail", caught, "И-мэйл илгээгдсэнгүй");
  }
}

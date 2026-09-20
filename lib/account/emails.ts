// Нууц үг сэргээх / и-мэйл баталгаажуулах захидлын бүтэц + илгээлт.
// Гарчигт хувийн мэдээлэл БАЙХГҮЙ; линк нэг удаагийн, хугацаатай.

import { issueAuthToken } from "@/lib/account/token-store";
import { AUTH_TOKEN_TTL_MS } from "@/lib/account/tokens";
import {
  appBaseUrl,
  sendTransactionalEmail,
  type TransactionalEmailResult,
} from "@/lib/email/transactional";

export function passwordResetUrl(raw: string): string {
  return `${appBaseUrl()}/reset-password?token=${raw}`;
}

export function emailVerifyUrl(raw: string): string {
  return `${appBaseUrl()}/verify-email?token=${raw}`;
}

export async function sendPasswordResetEmail(
  user: { id: string; email: string; name: string }
): Promise<TransactionalEmailResult> {
  const raw = await issueAuthToken(user.id, "password_reset");
  const minutes = Math.round(AUTH_TOKEN_TTL_MS.password_reset / 60_000);
  return sendTransactionalEmail({
    to: user.email,
    subject: "Entry Accounting — нууц үг сэргээх",
    text: [
      `Сайн байна уу, ${user.name}.`,
      ``,
      `Таны бүртгэлийн нууц үгийг сэргээх хүсэлт ирлээ. Доорх линкээр шинэ нууц үг тохируулна уу (${minutes} минут хүчинтэй, нэг удаа ашиглагдана):`,
      passwordResetUrl(raw),
      ``,
      `Хэрэв та энэ хүсэлтийг илгээгээгүй бол энэ захидлыг үл тоомсорлоно уу — нууц үг тань өөрчлөгдөхгүй.`,
    ].join("\n"),
  });
}

export async function sendVerificationEmail(
  user: { id: string; email: string; name: string }
): Promise<TransactionalEmailResult> {
  const raw = await issueAuthToken(user.id, "email_verify");
  const hours = Math.round(AUTH_TOKEN_TTL_MS.email_verify / 3_600_000);
  return sendTransactionalEmail({
    to: user.email,
    subject: "Entry Accounting — и-мэйл хаягаа баталгаажуулна уу",
    text: [
      `Сайн байна уу, ${user.name}.`,
      ``,
      `Entry Accounting-д бүртгүүлсэн и-мэйл хаягаа доорх линкээр баталгаажуулна уу (${hours} цаг хүчинтэй):`,
      emailVerifyUrl(raw),
      ``,
      `Хэрэв та бүртгүүлээгүй бол энэ захидлыг үл тоомсорлоно уу.`,
    ].join("\n"),
  });
}

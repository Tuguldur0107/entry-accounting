// Системийн (transactional) и-мэйл — нууц үг сэргээх, и-мэйл баталгаажуулах.
// Илгээгч = нэхэмжлэх/мэдэгдэлтэй ИЖИЛ эрэмбэ (resolveInvoiceSender, env).
// ШИДЭХГҮЙ: тохируулаагүй бол "unconfigured", алдаа бол "failed" — дуудагч
// шийднэ (харилцагчийн deploy бүр Resend тохируулсан байх албагүй).

import { resolveInvoiceSender } from "@/lib/email/sender";

export type TransactionalEmailResult = "sent" | "unconfigured" | "failed";

export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

/** И-мэйл илгээх боломжтой deploy юу (RESEND_API_KEY + илгээгч хаяг). */
export function transactionalEmailConfigured(): boolean {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    resolveInvoiceSender(null, process.env);
    return true;
  } catch {
    return false;
  }
}

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<TransactionalEmailResult> {
  if (!transactionalEmailConfigured()) return "unconfigured";
  try {
    const sender = resolveInvoiceSender(null, process.env);
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: sender.from,
      replyTo: sender.replyTo,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) {
      console.error("[email] transactional илгээгдсэнгүй:", error.message);
      return "failed";
    }
    return "sent";
  } catch (caught) {
    console.error("[email] transactional алдаа:", caught);
    return "failed";
  }
}

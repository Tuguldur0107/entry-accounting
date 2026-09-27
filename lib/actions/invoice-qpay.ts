"use server";

// Нэхэмжлэхийн НЭЭЛТТЭЙ линк дээрх «QPay-ээр төлөх» — нэвтрэлтгүй (токеноор),
// lib/qpay/arap.ts. Токен бүр баримтынхаа л intent-д хүрнэ; IP-ээр (минутад 20)
// ба нэхэмжлэхээр (цагт ARAP_QPAY_MAX_PER_HOUR шинэ QR) хязгаартай.

import { headers } from "next/headers";

import { actionError, type ActionResult } from "@/lib/action-result";
import { invoiceQpayStatus, startInvoiceQpay } from "@/lib/qpay/arap";
import type { InvoiceQpayView } from "@/lib/qpay/arap-types";
import { checkRateLimit } from "@/lib/rate-limit";

async function assertNotFlooding(kind: string) {
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`invoice-qpay:${kind}:${ip}`, kind === "start" ? 20 : 120, 60_000))
    throw new Error("Хэт олон хүсэлт — түр хүлээгээд дахин оролдоно уу");
}

export async function startInvoiceQpayPayment(token: string): Promise<ActionResult<{ intent: InvoiceQpayView }>> {
  try {
    await assertNotFlooding("start");
    return { intent: await startInvoiceQpay(String(token)) };
  } catch (caught) {
    return actionError("startInvoiceQpayPayment", caught, "QPay QR үүссэнгүй");
  }
}

export async function getInvoiceQpayPayment(
  token: string,
  intentId: string,
  check = false
): Promise<ActionResult<{ intent: InvoiceQpayView }>> {
  try {
    await assertNotFlooding(check ? "check" : "status");
    return { intent: await invoiceQpayStatus(String(token), String(intentId), !!check) };
  } catch (caught) {
    return actionError("getInvoiceQpayPayment", caught, "QPay төлөв уншигдсангүй");
  }
}

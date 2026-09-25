"use server";

// Багцаа QPay-ээр ӨӨРӨӨ төлөх — Server Actions (docs/billing/00-proposal.md §6a).
// Эрх: байгууллагын эзэн/админ (requireRole) — багцын read-only төлөвт ч ажиллана
// (requireModuleAction-ийн assertWritesAllowed-ийг ДАЙРАХГҮЙ: төлбөр нь read-only-г
// арилгах цорын ганц зам). Дэмжлэгийн сессээр төлбөр үүсгэхгүй.
// Кассын QPay-тэй ижил зарчим: диалог төлөвөө ЗӨВХӨН Entry DB-ээс уншина
// (getBillingPaymentStatus), [Шалгах] нь QPay-руу 10 секундэд нэг.

import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { currentSupportSession, requireRole } from "@/lib/auth";
import {
  cancelBillingPayment as cancelPayment,
  checkBillingPayment as checkPayment,
  createBillingPayment as createPayment,
  getBillingPayment,
  type BillingPaymentView,
} from "@/lib/billing/payment-store";

async function requireBillingManager() {
  const active = await requireRole("admin");
  if (await currentSupportSession(active.userId))
    throw new Error("Дэмжлэгийн сессээр багцын төлбөр хийх боломжгүй");
  return active;
}

export async function createBillingPayment(input: {
  planId: string;
  seats: number;
  months: number;
}): Promise<ActionResult<{ payment: BillingPaymentView }>> {
  try {
    const { orgId, userId } = await requireBillingManager();
    const payment = await createPayment(orgId, userId, input);
    return { payment };
  } catch (caught) {
    return actionError("createBillingPayment", caught, "QPay нэхэмжлэх үүссэнгүй");
  }
}

/** Диалогийн polling — ЗӨВХӨН Entry DB (QPay-д хүрэхгүй). */
export async function getBillingPaymentStatus(paymentId: string): Promise<ActionResult<{ payment: BillingPaymentView }>> {
  try {
    const { orgId } = await requireRole("admin");
    const payment = await getBillingPayment(orgId, paymentId);
    if (payment.status === "paid") revalidatePath("/", "layout");
    return { payment };
  } catch (caught) {
    return actionError("getBillingPaymentStatus", caught, "Төлбөрийн төлөв уншигдсангүй");
  }
}

/** [Шалгах] — QPay-руу гар шалгалт (10 сек-д нэг). */
export async function checkBillingPayment(paymentId: string): Promise<ActionResult<{ payment: BillingPaymentView }>> {
  try {
    const { orgId } = await requireBillingManager();
    const payment = await checkPayment(orgId, paymentId);
    if (payment.status === "paid") revalidatePath("/", "layout");
    return { payment };
  } catch (caught) {
    return actionError("checkBillingPayment", caught, "Төлбөр шалгагдсангүй");
  }
}

export async function cancelBillingPayment(paymentId: string): Promise<ActionResult<{ payment: BillingPaymentView }>> {
  try {
    const { orgId } = await requireBillingManager();
    const payment = await cancelPayment(orgId, paymentId);
    return { payment };
  } catch (caught) {
    return actionError("cancelBillingPayment", caught, "Нэхэмжлэх цуцлагдсангүй");
  }
}

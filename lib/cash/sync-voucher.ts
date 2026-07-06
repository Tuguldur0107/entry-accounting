// Plain server module (NOT "use server") so it can be imported and called
// directly from other server actions (gl.ts, cash.ts) as a normal async
// function. Exporting this from a "use server" file turned it into a server
// action reference, which did not execute when called server-to-server —
// hence GL journals never produced a draft cash document.

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { cashAccounts, cashDocuments, journalVouchers } from "@/lib/db/schema";
import { deriveCashDocumentFromVoucher } from "./gl-sync";

// When a GL voucher is posted that touches a cash/bank account's linked GL
// account, surface a DRAFT cash document. Idempotent (skips vouchers already
// linked via voucherId or already synced via sourceVoucherId — which also
// blocks the Cash→GL→Cash loop) and best-effort (never throws into the GL
// post).
export async function syncDraftCashDocumentForVoucher(voucherId: string) {
  try {
    const voucher = await db.query.journalVouchers.findFirst({
      where: eq(journalVouchers.id, voucherId),
      with: { lines: true },
    });
    if (!voucher || voucher.status !== "posted") return;
    const userId = voucher.userId;

    const existing = await db.query.cashDocuments.findFirst({
      where: and(
        eq(cashDocuments.userId, userId),
        or(
          eq(cashDocuments.voucherId, voucherId),
          eq(cashDocuments.sourceVoucherId, voucherId)
        )
      ),
      columns: { id: true },
    });
    if (existing) return;

    const accounts = await db.query.cashAccounts.findMany({
      where: eq(cashAccounts.userId, userId),
    });

    const derived = deriveCashDocumentFromVoucher({
      voucherDescription: voucher.description,
      lines: voucher.lines.map((l) => ({
        accountNumber: l.accountNumber,
        debit: Number(l.debit),
        credit: Number(l.credit),
        description: l.description,
      })),
      cashAccounts: accounts.map((a) => ({
        id: a.id,
        glAccountNumber: a.glAccountNumber,
        currency: a.currency,
        isActive: a.isActive,
      })),
    });
    if (!derived) return;

    const documentNo = `GL-${voucher.date.replaceAll("-", "")}-${crypto
      .randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

    await db.insert(cashDocuments).values({
      userId,
      documentNo,
      documentType: derived.documentType,
      date: voucher.date,
      fromCashAccountId: derived.fromCashAccountId,
      toCashAccountId: derived.toCashAccountId,
      counterAccountNumber: derived.counterAccountNumber,
      counterparty: null,
      description: derived.description,
      amount: String(derived.amount),
      currency: derived.currency,
      exchangeRate: "1",
      baseAmount: String(derived.amount),
      status: "draft",
      sourceVoucherId: voucherId,
    });

    revalidatePath("/cash");
    revalidatePath("/cash/transactions");
  } catch (error) {
    console.error("[syncDraftCashDocumentForVoucher]", error);
  }
}

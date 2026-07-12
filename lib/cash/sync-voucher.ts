// Plain server module (NOT "use server") so it can be imported and called
// directly from other server actions (gl.ts, cash.ts) as a normal async
// function. Exporting this from a "use server" file turned it into a server
// action reference, which did not execute when called server-to-server —
// hence GL journals never produced a draft cash document.

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { cashAccounts, cashDocuments, journalVouchers } from "@/lib/db/schema";
import {
  deriveCashDocumentFromVoucher,
  mainAccountOf,
  type CashAccountRef,
  type DerivedCashDocument,
} from "./gl-sync";

// GL journal lines are always in MNT (base currency), so a derived amount is
// an MNT figure. For an MNT cash account that IS the document amount; for a
// foreign-currency account the amount in currency units is unknown until the
// user supplies a rate — store baseAmount = GL figure with the rate-unknown
// sentinel (exchangeRate 0, amount 0). postCashDocument refuses to adopt such
// a draft until a rate is provided.
function draftValuesFor(
  userId: string,
  voucher: { id: string; date: string },
  derived: DerivedCashDocument
): typeof cashDocuments.$inferInsert {
  const documentNo = `GL-${voucher.date.replaceAll("-", "")}-${crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;
  const isMnt = derived.currency === "MNT";
  return {
    userId,
    documentNo,
    documentType: derived.documentType,
    date: voucher.date,
    fromCashAccountId: derived.fromCashAccountId,
    toCashAccountId: derived.toCashAccountId,
    counterAccountNumber: derived.counterAccountNumber,
    cashFlowCode: derived.cashFlowCode,
    counterparty: null,
    description: derived.description,
    amount: isMnt ? String(derived.amount) : "0",
    currency: derived.currency,
    exchangeRate: isMnt ? "1" : "0",
    baseAmount: String(derived.amount),
    status: "draft",
    sourceVoucherId: voucher.id,
  };
}

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

    await db.insert(cashDocuments).values(draftValuesFor(userId, voucher, derived));

    revalidatePath("/cash");
    revalidatePath("/cash/transactions");
  } catch (error) {
    console.error("[syncDraftCashDocumentForVoucher]", error);
  }
}

// Backfill: scan every posted voucher for the user that isn't yet tied to a
// cash document and create the missing drafts in one pass. Called when the
// cash transactions page loads so historical journals — and any posted via a
// path that didn't trigger the per-post sync — surface without a manual
// re-post. Idempotent: only unlinked vouchers produce a draft.
//
// Returns the number of drafts created (0 when nothing was missing) so the
// caller can decide whether to re-query.
export async function backfillCashDraftsForUser(userId: string): Promise<number> {
  try {
    const accounts = await db.query.cashAccounts.findMany({
      where: eq(cashAccounts.userId, userId),
    });
    if (accounts.length === 0) return 0;
    const cashRefs: CashAccountRef[] = accounts.map((a) => ({
      id: a.id,
      glAccountNumber: a.glAccountNumber,
      currency: a.currency,
      isActive: a.isActive,
    }));
    const cashGl = new Set(cashRefs.map((a) => a.glAccountNumber));

    // Voucher ids already tied to a cash document (either direction).
    const linkedDocs = await db.query.cashDocuments.findMany({
      where: eq(cashDocuments.userId, userId),
      columns: { voucherId: true, sourceVoucherId: true },
    });
    const linked = new Set<string>();
    for (const d of linkedDocs) {
      if (d.voucherId) linked.add(d.voucherId);
      if (d.sourceVoucherId) linked.add(d.sourceVoucherId);
    }

    const vouchers = await db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        eq(journalVouchers.status, "posted")
      ),
      with: { lines: true },
    });

    const inserts: (typeof cashDocuments.$inferInsert)[] = [];
    for (const voucher of vouchers) {
      if (linked.has(voucher.id)) continue;
      // Cheap pre-filter: skip vouchers that don't touch any cash gl account.
      const touchesCash = voucher.lines.some((l) =>
        cashGl.has(mainAccountOf(l.accountNumber))
      );
      if (!touchesCash) continue;

      const derived = deriveCashDocumentFromVoucher({
        voucherDescription: voucher.description,
        lines: voucher.lines.map((l) => ({
          accountNumber: l.accountNumber,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description,
        })),
        cashAccounts: cashRefs,
      });
      if (!derived) continue;
      inserts.push(draftValuesFor(userId, voucher, derived));
    }

    // Repair earlier GL-derived FX drafts written before the rate-unknown
    // sentinel existed: they hold the MNT figure as foreign units at rate 1
    // (e.g. ₮3,450,000 recorded as $3,450,000). Reset them to the sentinel so
    // posting demands a real rate. Drafts only — posted docs are immutable.
    const brokenFxDrafts = await db.query.cashDocuments.findMany({
      where: and(
        eq(cashDocuments.userId, userId),
        eq(cashDocuments.status, "draft")
      ),
      columns: {
        id: true,
        currency: true,
        exchangeRate: true,
        amount: true,
        baseAmount: true,
        sourceVoucherId: true,
      },
    });
    for (const doc of brokenFxDrafts) {
      if (
        !doc.sourceVoucherId ||
        doc.currency === "MNT" ||
        Number(doc.exchangeRate) !== 1 ||
        Number(doc.amount) !== Number(doc.baseAmount)
      )
        continue;
      await db
        .update(cashDocuments)
        .set({ amount: "0", exchangeRate: "0" })
        .where(eq(cashDocuments.id, doc.id));
    }

    if (inserts.length === 0) return 0;
    await db.insert(cashDocuments).values(inserts);
    return inserts.length;
  } catch (error) {
    console.error("[backfillCashDraftsForUser]", error);
    return 0;
  }
}

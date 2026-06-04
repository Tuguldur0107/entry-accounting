"use server";

import { db } from "@/lib/db";
import {
  bankAccounts,
  bankTransactions,
  journalVouchers,
  journalLines,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

function revalidateCash() {
  revalidatePath("/cash/transactions");
  revalidatePath("/cash/accounts");
  revalidatePath("/cash/reports");
  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

// ─── Bank Accounts ─────────────────────────────────────────────────────────────

export async function createBankAccount(data: {
  accountNumber: string;
  name: string;
  currency: string;
  openingBalance: number;
}) {
  const userId = await requireUser();
  if (!data.accountNumber.trim() || !data.name.trim())
    return { error: "Данс ба нэрийг бөглөнө үү" };

  await db.insert(bankAccounts).values({
    userId,
    accountNumber: data.accountNumber.trim(),
    name: data.name.trim(),
    currency: data.currency || "MNT",
    openingBalance: String(data.openingBalance || 0),
  });
  revalidateCash();
}

export async function toggleBankAccount(id: string, isActive: boolean) {
  const userId = await requireUser();
  await db
    .update(bankAccounts)
    .set({ isActive })
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)));
  revalidateCash();
}

export async function deleteBankAccount(id: string) {
  const userId = await requireUser();
  const txn = await db.query.bankTransactions.findFirst({
    where: and(
      eq(bankTransactions.bankAccountId, id),
      eq(bankTransactions.userId, userId)
    ),
    columns: { id: true },
  });
  if (txn) return { error: "Гүйлгээтэй данс — устгах боломжгүй" };

  await db
    .delete(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)));
  revalidateCash();
}

// ─── Bank Transactions ──────────────────────────────────────────────────────────

export type TxnInput = {
  bankAccountId: string;
  date: string;
  direction: "inflow" | "outflow";
  amount: number;
  contraAccount: string;
  cfCategory: "operating" | "investing" | "financing";
  counterparty: string;
  description: string;
  reference: string;
  status: "draft" | "posted";
};

/** GL posting lines for a cash transaction.
 *  inflow:  Dr bank / Cr contra    (мөнгө орж ирэв)
 *  outflow: Dr contra / Cr bank     (мөнгө гарав)
 */
function buildVoucherLines(
  direction: "inflow" | "outflow",
  bankAcct: string,
  contra: string,
  amount: number
) {
  const debitAcct = direction === "inflow" ? bankAcct : contra;
  const creditAcct = direction === "inflow" ? contra : bankAcct;
  return [
    {
      accountNumber: debitAcct,
      debit: String(amount),
      credit: "0",
      sortOrder: 0,
    },
    {
      accountNumber: creditAcct,
      debit: "0",
      credit: String(amount),
      sortOrder: 1,
    },
  ];
}

function validate(data: TxnInput) {
  if (!data.bankAccountId) throw new Error("Банкны данс сонгоно уу");
  if (!data.contraAccount) throw new Error("Эсрэг данс сонгоно уу");
  if (!data.description.trim()) throw new Error("Гүйлгээний утга оруулна уу");
  if (!(data.amount > 0)) throw new Error("Дүн 0-ээс их байх ёстой");
}

export async function createTransaction(data: TxnInput) {
  const userId = await requireUser();
  validate(data);

  const bank = await db.query.bankAccounts.findFirst({
    where: and(
      eq(bankAccounts.id, data.bankAccountId),
      eq(bankAccounts.userId, userId)
    ),
  });
  if (!bank) throw new Error("Банкны данс олдсонгүй");

  await db.transaction(async (tx) => {
    let voucherId: string | null = null;

    if (data.status === "posted") {
      const [voucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          date: data.date,
          description: data.description.trim(),
          status: "posted",
        })
        .returning();
      await tx.insert(journalLines).values(
        buildVoucherLines(
          data.direction,
          bank.accountNumber,
          data.contraAccount,
          data.amount
        ).map((l) => ({ ...l, voucherId: voucher.id, description: data.description.trim() }))
      );
      voucherId = voucher.id;
    }

    await tx.insert(bankTransactions).values({
      userId,
      bankAccountId: data.bankAccountId,
      date: data.date,
      direction: data.direction,
      amount: String(data.amount),
      contraAccount: data.contraAccount,
      cfCategory: data.cfCategory,
      counterparty: data.counterparty,
      description: data.description.trim(),
      reference: data.reference,
      source: "manual",
      status: data.status,
      voucherId,
    });
  });

  revalidateCash();
}

export async function postTransaction(id: string) {
  const userId = await requireUser();

  await db.transaction(async (tx) => {
    const t = await tx.query.bankTransactions.findFirst({
      where: and(eq(bankTransactions.id, id), eq(bankTransactions.userId, userId)),
      with: { bankAccount: true },
    });
    if (!t) throw new Error("Гүйлгээ олдсонгүй");
    if (t.status === "posted") return;

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        date: t.date,
        description: t.description,
        status: "posted",
      })
      .returning();
    await tx.insert(journalLines).values(
      buildVoucherLines(
        t.direction as "inflow" | "outflow",
        t.bankAccount.accountNumber,
        t.contraAccount,
        Number(t.amount)
      ).map((l) => ({ ...l, voucherId: voucher.id, description: t.description }))
    );

    await tx
      .update(bankTransactions)
      .set({ status: "posted", voucherId: voucher.id })
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.userId, userId)));
  });

  revalidateCash();
}

export async function updateTransaction(id: string, data: TxnInput) {
  const userId = await requireUser();
  validate(data);

  const bank = await db.query.bankAccounts.findFirst({
    where: and(
      eq(bankAccounts.id, data.bankAccountId),
      eq(bankAccounts.userId, userId)
    ),
  });
  if (!bank) throw new Error("Банкны данс олдсонгүй");

  await db.transaction(async (tx) => {
    const existing = await tx.query.bankTransactions.findFirst({
      where: and(eq(bankTransactions.id, id), eq(bankTransactions.userId, userId)),
      columns: { status: true },
    });
    if (!existing) throw new Error("Гүйлгээ олдсонгүй");
    if (existing.status === "posted")
      throw new Error("Бичигдсэн гүйлгээг засах боломжгүй. Сторно бичилт ашиглана уу.");

    let voucherId: string | null = null;
    if (data.status === "posted") {
      const [voucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          date: data.date,
          description: data.description.trim(),
          status: "posted",
        })
        .returning();
      await tx.insert(journalLines).values(
        buildVoucherLines(
          data.direction,
          bank.accountNumber,
          data.contraAccount,
          data.amount
        ).map((l) => ({ ...l, voucherId: voucher.id, description: data.description.trim() }))
      );
      voucherId = voucher.id;
    }

    await tx
      .update(bankTransactions)
      .set({
        bankAccountId: data.bankAccountId,
        date: data.date,
        direction: data.direction,
        amount: String(data.amount),
        contraAccount: data.contraAccount,
        cfCategory: data.cfCategory,
        counterparty: data.counterparty,
        description: data.description.trim(),
        reference: data.reference,
        status: data.status,
        voucherId,
      })
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.userId, userId)));
  });

  revalidateCash();
}

export async function deleteTransaction(id: string) {
  const userId = await requireUser();

  await db.transaction(async (tx) => {
    const existing = await tx.query.bankTransactions.findFirst({
      where: and(eq(bankTransactions.id, id), eq(bankTransactions.userId, userId)),
      columns: { status: true },
    });
    if (!existing) throw new Error("Гүйлгээ олдсонгүй");
    if (existing.status === "posted")
      throw new Error("Бичигдсэн гүйлгээг устгах боломжгүй. Сторно бичилт ашиглана уу.");

    await tx
      .delete(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.userId, userId)));
  });

  revalidateCash();
}

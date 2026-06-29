"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";

export type CashDocumentType = "receipt" | "payment" | "transfer";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

function revalidateCash() {
  revalidatePath("/cash");
  revalidatePath("/cash/transactions");
  revalidatePath("/cash/accounts");
  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function assertAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Дүн 0-ээс их байна");
}

async function assertMainAccount(userId: string, accountNumber: string) {
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.userId, userId),
      eq(chartOfAccounts.number, accountNumber),
      eq(chartOfAccounts.isEnabled, true)
    ),
  });
  if (!account) throw new Error("Идэвхтэй GL данс олдсонгүй");
}

async function requireActiveCashAccount(userId: string, id: string) {
  const account = await db.query.cashAccounts.findFirst({
    where: and(
      eq(cashAccounts.id, id),
      eq(cashAccounts.userId, userId),
      eq(cashAccounts.isActive, true)
    ),
  });
  if (!account) throw new Error("Идэвхтэй Cash данс олдсонгүй");
  return account;
}

async function cashPostingCodeBuilder(
  userId: string,
  cashFlowCode: string | null
) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);

  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);

  const defaults: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    const options = values.filter((value) => value.segmentId === segmentId);
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  if (activeSegIds.includes(8) && cashFlowCode) defaults[8] = cashFlowCode;
  if (activeSegIds.includes(9)) defaults[9] = "CA";

  return (mainAccount: string) =>
    buildSegCode(
      { ...defaults, 3: mainAccount },
      activeSegIds,
      { ...defaults, 9: "CA" }
    );
}

export async function createCashAccount(data: {
  name: string;
  accountType: "cash" | "bank";
  bankName?: string;
  accountNumber?: string;
  currency: string;
  glAccountNumber: string;
  openingBalance?: number;
}) {
  const userId = await requireUser();
  const name = data.name.trim();
  if (!name) throw new Error("Дансны нэр оруулна уу");
  if (!["cash", "bank"].includes(data.accountType))
    throw new Error("Дансны төрөл буруу байна");

  const glAccountNumber = data.glAccountNumber.trim();
  await assertMainAccount(userId, glAccountNumber);

  const openingBalance = Number(data.openingBalance ?? 0);
  if (!Number.isFinite(openingBalance))
    throw new Error("Эхний үлдэгдэл буруу байна");

  await db.insert(cashAccounts).values({
    userId,
    name,
    accountType: data.accountType,
    bankName: data.accountType === "bank" ? cleanText(data.bankName) : null,
    accountNumber:
      data.accountType === "bank" ? cleanText(data.accountNumber) : null,
    currency: data.currency.trim().toUpperCase() || "MNT",
    glAccountNumber,
    openingBalance: String(openingBalance),
  });

  revalidateCash();
}

export async function toggleCashAccount(id: string, isActive: boolean) {
  const userId = await requireUser();
  await db
    .update(cashAccounts)
    .set({ isActive })
    .where(and(eq(cashAccounts.id, id), eq(cashAccounts.userId, userId)));
  revalidateCash();
}

export async function createCashDocument(data: {
  documentType: CashDocumentType;
  date: string;
  fromCashAccountId?: string;
  toCashAccountId?: string;
  counterAccountNumber?: string;
  cashFlowCode?: string;
  counterparty?: string;
  description: string;
  amount: number;
  postNow?: boolean;
}) {
  const userId = await requireUser();
  const description = data.description.trim();
  if (!description) throw new Error("Гүйлгээний утга оруулна уу");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");
  if (!["receipt", "payment", "transfer"].includes(data.documentType))
    throw new Error("Баримтын төрөл буруу байна");
  assertAmount(data.amount);

  if (data.documentType === "receipt" && !data.toCashAccountId)
    throw new Error("Орлого хүлээн авах данс сонгоно уу");
  if (data.documentType === "payment" && !data.fromCashAccountId)
    throw new Error("Зарлага гаргах данс сонгоно уу");
  if (
    data.documentType === "transfer" &&
    (!data.fromCashAccountId || !data.toCashAccountId)
  )
    throw new Error("Шилжүүлгийн эхлэх болон хүлээн авах данс сонгоно уу");
  if (
    data.documentType === "transfer" &&
    data.fromCashAccountId === data.toCashAccountId
  )
    throw new Error("Шилжүүлгийн дансууд ижил байж болохгүй");

  const fromCashAccountId =
    data.documentType === "payment" || data.documentType === "transfer"
      ? data.fromCashAccountId!
      : null;
  const toCashAccountId =
    data.documentType === "receipt" || data.documentType === "transfer"
      ? data.toCashAccountId!
      : null;

  const [fromAccount, toAccount] = await Promise.all([
    fromCashAccountId
      ? requireActiveCashAccount(userId, fromCashAccountId)
      : null,
    toCashAccountId
      ? requireActiveCashAccount(userId, toCashAccountId)
      : null,
  ]);
  if (
    data.documentType === "transfer" &&
    fromAccount?.currency !== toAccount?.currency
  )
    throw new Error("Өөр валюттай дансны шилжүүлэгт ханшийн модуль шаардлагатай");

  const counterAccountNumber = cleanText(data.counterAccountNumber);
  if (data.documentType !== "transfer" && !counterAccountNumber)
    throw new Error("Харилцах GL данс сонгоно уу");
  if (counterAccountNumber)
    await assertMainAccount(userId, counterAccountNumber);

  const cashFlowCode = cleanText(data.cashFlowCode);
  if (cashFlowCode) {
    const cashFlow = await db.query.segmentValues.findFirst({
      where: and(
        eq(segmentValues.userId, userId),
        eq(segmentValues.segmentId, 8),
        eq(segmentValues.code, cashFlowCode),
        eq(segmentValues.isEnabled, true)
      ),
    });
    if (!cashFlow) throw new Error("Мөнгөн гүйлгээний S8 ангилал олдсонгүй");
  }

  const documentNo = `CM-${data.date.replaceAll("-", "")}-${crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;

  const [document] = await db
    .insert(cashDocuments)
    .values({
      userId,
      documentNo,
      documentType: data.documentType,
      date: data.date,
      fromCashAccountId,
      toCashAccountId,
      counterAccountNumber,
      cashFlowCode,
      counterparty: cleanText(data.counterparty),
      description,
      amount: String(data.amount),
    })
    .returning({ id: cashDocuments.id });

  if (data.postNow) await postCashDocument(document.id);
  else revalidateCash();
  return { id: document.id };
}

export async function postCashDocument(id: string) {
  const userId = await requireUser();

  const document = await db.query.cashDocuments.findFirst({
    where: and(eq(cashDocuments.id, id), eq(cashDocuments.userId, userId)),
    with: { fromAccount: true, toAccount: true },
  });
  if (!document) throw new Error("Cash баримт олдсонгүй");
  if (document.status !== "draft")
    throw new Error("Зөвхөн ноорог баримтыг батална");

  const amount = Number(document.amount);
  assertAmount(amount);

  const fromAccount = document.fromAccount;
  const toAccount = document.toAccount;
  if (fromAccount && (!fromAccount.isActive || fromAccount.userId !== userId))
    throw new Error("Гаргах Cash данс идэвхгүй байна");
  if (toAccount && (!toAccount.isActive || toAccount.userId !== userId))
    throw new Error("Хүлээн авах Cash данс идэвхгүй байна");

  const buildCode = await cashPostingCodeBuilder(
    userId,
    document.cashFlowCode
  );

  let debitAccount: string;
  let creditAccount: string;

  if (document.documentType === "receipt") {
    if (!toAccount || !document.counterAccountNumber)
      throw new Error("Орлогын баримтын дансны мэдээлэл дутуу");
    debitAccount = buildCode(toAccount.glAccountNumber);
    creditAccount = buildCode(document.counterAccountNumber);
  } else if (document.documentType === "payment") {
    if (!fromAccount || !document.counterAccountNumber)
      throw new Error("Зарлагын баримтын дансны мэдээлэл дутуу");
    debitAccount = buildCode(document.counterAccountNumber);
    creditAccount = buildCode(fromAccount.glAccountNumber);
  } else {
    if (!fromAccount || !toAccount)
      throw new Error("Шилжүүлгийн дансны мэдээлэл дутуу");
    debitAccount = buildCode(toAccount.glAccountNumber);
    creditAccount = buildCode(fromAccount.glAccountNumber);
  }

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(cashDocuments)
      .set({ status: "posted", postedAt: new Date() })
      .where(
        and(
          eq(cashDocuments.id, id),
          eq(cashDocuments.userId, userId),
          eq(cashDocuments.status, "draft")
        )
      )
      .returning({ id: cashDocuments.id });
    if (!claimed)
      throw new Error("Баримтын төлөв өөрчлөгдсөн байна");

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        date: document.date,
        description: `[${document.documentNo}] ${document.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values([
      {
        voucherId: voucher.id,
        accountNumber: debitAccount,
        debit: String(amount),
        credit: "0",
        description: document.counterparty ?? document.description,
        sortOrder: 0,
      },
      {
        voucherId: voucher.id,
        accountNumber: creditAccount,
        debit: "0",
        credit: String(amount),
        description: document.counterparty ?? document.description,
        sortOrder: 1,
      },
    ]);

    await tx
      .update(cashDocuments)
      .set({ voucherId: voucher.id })
      .where(and(eq(cashDocuments.id, id), eq(cashDocuments.userId, userId)));
  });

  revalidateCash();
}

export async function reverseCashDocument(id: string) {
  const userId = await requireUser();

  const document = await db.query.cashDocuments.findFirst({
    where: and(eq(cashDocuments.id, id), eq(cashDocuments.userId, userId)),
  });
  if (!document || document.status !== "posted" || !document.voucherId)
    throw new Error("Зөвхөн батлагдсан Cash баримтыг буцаана");

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, document.voucherId),
      eq(journalVouchers.userId, userId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(cashDocuments)
      .set({ status: "reversed" })
      .where(
        and(
          eq(cashDocuments.id, id),
          eq(cashDocuments.userId, userId),
          eq(cashDocuments.status, "posted")
        )
      )
      .returning({ id: cashDocuments.id });
    if (!claimed)
      throw new Error("Баримтын төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        date: document.date,
        description: `Сторно [${document.documentNo}] ${document.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        accountNumber: line.accountNumber,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
        sortOrder: index,
      }))
    );

    await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, voucher.id),
          eq(journalVouchers.userId, userId)
        )
      );

    await tx
      .update(cashDocuments)
      .set({ reversalVoucherId: reversal.id })
      .where(and(eq(cashDocuments.id, id), eq(cashDocuments.userId, userId)));
  });

  revalidateCash();
}

export async function deleteCashDocument(id: string) {
  const userId = await requireUser();
  const document = await db.query.cashDocuments.findFirst({
    where: and(eq(cashDocuments.id, id), eq(cashDocuments.userId, userId)),
    columns: { status: true },
  });
  if (!document) return;
  if (document.status !== "draft")
    throw new Error("Зөвхөн ноорог Cash баримтыг устгана");

  await db
    .delete(cashDocuments)
    .where(and(eq(cashDocuments.id, id), eq(cashDocuments.userId, userId)));
  revalidateCash();
}

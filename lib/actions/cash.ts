"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { db } from "@/lib/db";
import {
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  arApDocuments,
  arApSettlements,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { ALL_SEG_IDS, buildSegCode, SEG_DEFAULTS } from "@/lib/grid/segments";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import {
  loadCashTransactionOptions,
  mainAccountOf,
  toCashDocumentView,
  type CashTransactionOptions,
} from "@/lib/cash/load-options";
import type { CashDocumentView } from "@/lib/cash/types";
import { cashDocumentEffect, calculateFxRevaluation } from "@/lib/cash/reconciliation";
import { calculateSettlementExchangeEffect } from "@/lib/arap/accounting";
import {
  removeDraftMovementsForVoucher,
  syncInventoryDraftForVoucher,
} from "@/lib/inventory/sync-sources";
import {
  removeDraftAssetsForVoucher,
  syncFixedAssetDraftForVoucher,
} from "@/lib/fa/sync-sources";
import { logAuditEvent } from "@/lib/audit";

export type CashDocumentType = "receipt" | "payment" | "transfer";

// Фаз 01 multi-tenancy: бүх бичилт accountant+ эрхээр, scope нь идэвхтэй
// байгууллага (orgId); userId нь createdBy/audit утгаар үлддэг.

function revalidateCash() {
  revalidatePath("/cash");
  revalidatePath("/cash/transactions");
  revalidatePath("/cash/accounts");
  revalidatePath("/cash/reconciliation");
  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
  for (const root of ["/arap", "/receivables", "/payables"]) {
    revalidatePath(root);
    revalidatePath(`${root}/documents`);
    revalidatePath(`${root}/counterparties`);
    revalidatePath(`${root}/reports`);
    revalidatePath(`${root}/settings`);
  }
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function assertAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Дүн 0-ээс их байна");
}

async function validateArApSettlement(
  orgId: string,
  data: {
    arApDocumentId?: string;
    documentType: CashDocumentType;
    counterAccountNumber: string | null;
    amount: number;
  },
  currency: string
) {
  if (!data.arApDocumentId) return null;
  const document = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, data.arApDocumentId),
      eq(arApDocuments.organizationId, orgId)
    ),
  });
  if (!document) throw new Error("Авлага/өглөгийн баримт олдсонгүй");
  if (document.status !== "posted" && document.status !== "partially_paid")
    throw new Error("Зөвхөн батлагдсан авлага/өглөгийн баримтыг хаана");

  const expectedType =
    document.documentType === "ar_invoice" ? "receipt" : "payment";
  if (data.documentType !== expectedType)
    throw new Error("Cash гүйлгээний төрөл авлага/өглөгийн баримттай таарахгүй байна");
  if (document.currency !== currency)
    throw new Error("Cash дансны валют авлага/өглөгийн баримтын валюттай таарахгүй байна");

  const controlMain = mainAccountOf(document.controlAccountNumber);
  if (data.counterAccountNumber !== controlMain)
    throw new Error("Харилцах GL данс авлага/өглөгийн хяналтын данстай таарахгүй байна");

  const total = Number(document.totalAmount);
  const paid = Number(document.paidAmount);
  const balance = Math.round((total - paid) * 100) / 100;
  if (data.amount > balance + 0.005)
    throw new Error("Төлөх дүн авлага/өглөгийн үлдэгдлээс их байна");
  return { document, balance };
}

async function assertMainAccount(orgId: string, accountNumber: string) {
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, accountNumber),
      eq(chartOfAccounts.isEnabled, true)
    ),
  });
  if (!account) throw new Error("Идэвхтэй GL данс олдсонгүй");
}

async function requireActiveCashAccount(orgId: string, id: string) {
  const account = await db.query.cashAccounts.findFirst({
    where: and(
      eq(cashAccounts.id, id),
      eq(cashAccounts.organizationId, orgId),
      eq(cashAccounts.isActive, true)
    ),
  });
  if (!account) throw new Error("Идэвхтэй Cash данс олдсонгүй");
  return account;
}

async function cashPostingCodeBuilder(
  orgId: string,
  cashFlowCode: string | null
) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
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
  const { orgId, userId } = await requireRole("accountant");
  const name = data.name.trim();
  if (!name) throw new Error("Дансны нэр оруулна уу");
  if (!["cash", "bank"].includes(data.accountType))
    throw new Error("Дансны төрөл буруу байна");

  const glAccountNumber = data.glAccountNumber.trim();
  await assertMainAccount(orgId, glAccountNumber);

  const openingBalance = Number(data.openingBalance ?? 0);
  if (!Number.isFinite(openingBalance))
    throw new Error("Эхний үлдэгдэл буруу байна");

  await db.insert(cashAccounts).values({
    userId,
    organizationId: orgId,
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

/**
 * Кассын дансны НЭЭЛТИЙН ҮЛДЭГДЛИЙГ GL-д ноорог журналаар бичнэ.
 *
 * Данс үүсгэхэд openingBalance зөвхөн модульд бүртгэгддэг тул GL-тэй
 * тулгахад яг нээлтийн дүнгээр байнгын зөрүү үүсдэг — энэ action түүнийг
 * арилгах ГҮҮР: Дт данс / Кт эздийн өмч (сөрөг нээлтэд эсрэгээр) ноорог
 * журнал үүсгэж, хэрэглэгч шалгаад батална.
 *
 * Мөрөнд cashAccountId тэмдэглэгдсэн тул (1) тулгалтын GL тал нээлтийг
 * тоолно, (2) sync/backfill давхар кассын баримт үүсгэхгүй.
 */
export async function createCashOpeningVoucher(data: {
  cashAccountId: string;
  /** Харьцах данс — хоосон бол 41100000 (эсвэл эхний идэвхтэй 4XXXXXXX). */
  counterAccountNumber?: string;
}) {
  const { orgId, userId } = await requireRole("accountant");

  const account = await db.query.cashAccounts.findFirst({
    where: and(
      eq(cashAccounts.id, data.cashAccountId),
      eq(cashAccounts.organizationId, orgId)
    ),
  });
  if (!account) throw new Error("Кассын данс олдсонгүй");

  const opening = Number(account.openingBalance ?? 0);
  if (Math.abs(opening) < 0.005)
    throw new Error("Нээлтийн үлдэгдэл 0 тул журнал шаардлагагүй");

  // Нэг дансанд нэг л нээлтийн журнал. Давхардлын жинхэнэ хамгаалалт нь
  // externalRef — journal_vouchers-ийн (organization_id, external_ref)
  // partial unique index уралдаант давхар insert-ийг DB түвшинд хаана.
  // Тайлбар доторх [НЭЭЛТ:id] тэмдэг нь харагдац + хуучин дата.
  const marker = `[НЭЭЛТ:${account.id}]`;
  const externalRef = `cash-opening:${account.id}`;
  const existing = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      or(
        eq(journalVouchers.externalRef, externalRef),
        sql`${journalVouchers.description} LIKE ${"%" + marker + "%"}`
      )
    ),
    columns: { id: true, status: true },
  });
  if (existing)
    throw new Error(
      existing.status === "draft"
        ? "Нээлтийн журнал аль хэдийн ноорогоор үүссэн — журналын жагсаалтаас баталгаажуулна уу"
        : "Нээлтийн журнал аль хэдийн батлагдсан байна"
    );

  // Харьцах данс: default нь эздийн өмч.
  let counter = cleanText(data.counterAccountNumber);
  if (!counter) {
    const equity = await db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true),
        sql`left(${chartOfAccounts.number}, 1) = '4'`
      ),
      orderBy: (a, { asc }) => [asc(a.number)],
    });
    counter =
      equity.find((a) => a.number === "41100000")?.number ??
      equity[0]?.number ??
      null;
    if (!counter)
      throw new Error(
        "Эздийн өмчийн (4XXXXXXX) идэвхтэй данс олдсонгүй — харьцах дансаа зааж өгнө үү"
      );
  } else {
    await assertMainAccount(orgId, counter);
  }

  const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await assertPeriodOpen(orgId, today);

  const buildCode = await cashPostingCodeBuilder(orgId, null);
  const bankCode = buildCode(account.glAccountNumber);
  const counterCode = buildCode(counter);
  const amount = Math.round(Math.abs(opening) * 100) / 100;

  const voucherId = await db.transaction(async (tx) => {
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: today,
        description: `Нээлтийн үлдэгдэл — ${account.name} ${marker}`,
        status: "draft",
        externalRef,
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values([
      {
        voucherId: voucher.id,
        accountNumber: opening > 0 ? bankCode : counterCode,
        debit: String(amount),
        credit: "0",
        description: "Нээлтийн үлдэгдэл",
        sortOrder: 0,
        cashAccountId: opening > 0 ? account.id : null,
      },
      {
        voucherId: voucher.id,
        accountNumber: opening > 0 ? counterCode : bankCode,
        debit: "0",
        credit: String(amount),
        description: "Нээлтийн үлдэгдэл",
        sortOrder: 1,
        cashAccountId: opening > 0 ? null : account.id,
      },
    ]);
    return voucher.id;
  });

  revalidateCash();
  revalidatePath("/gl/journal");
  return { id: voucherId, counterAccountNumber: counter, amount };
}

export async function toggleCashAccount(id: string, isActive: boolean) {
  const { orgId } = await requireRole("accountant");
  await db
    .update(cashAccounts)
    .set({ isActive })
    .where(
      and(eq(cashAccounts.id, id), eq(cashAccounts.organizationId, orgId))
    );
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
  exchangeRate?: number;
  postNow?: boolean;
  arApDocumentId?: string;
  /** Гадаад системийн давтагдашгүй дугаар — idempotency түлхүүр. */
  externalRef?: string;
}) {
  const { orgId, userId } = await requireRole("accountant");
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
      ? requireActiveCashAccount(orgId, fromCashAccountId)
      : null,
    toCashAccountId
      ? requireActiveCashAccount(orgId, toCashAccountId)
      : null,
  ]);
  if (
    data.documentType === "transfer" &&
    fromAccount?.currency !== toAccount?.currency
  )
    throw new Error("Өөр валюттай дансны шилжүүлэгт ханшийн модуль шаардлагатай");

  const currency = (toAccount ?? fromAccount)?.currency ?? "MNT";
  const exchangeRate =
    currency === "MNT" ? 1 : Number(data.exchangeRate ?? 0);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0)
    throw new Error(`${currency} гүйлгээний ханш 0-ээс их байна`);
  const baseAmount = Math.round(data.amount * exchangeRate * 100) / 100;

  const counterAccountNumber = cleanText(data.counterAccountNumber);
  if (data.documentType !== "transfer" && !counterAccountNumber)
    throw new Error("Харилцах GL данс сонгоно уу");
  if (counterAccountNumber)
    await assertMainAccount(orgId, counterAccountNumber);

  const cashFlowCode = cleanText(data.cashFlowCode);
  if (cashFlowCode) {
    const cashFlow = await db.query.segmentValues.findFirst({
      where: and(
        eq(segmentValues.organizationId, orgId),
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

  const arApDocumentId = cleanText(data.arApDocumentId);
  await validateArApSettlement(
    orgId,
    {
      arApDocumentId: arApDocumentId ?? undefined,
      documentType: data.documentType,
      counterAccountNumber,
      amount: data.amount,
    },
    currency
  );

  const [document] = await db
    .insert(cashDocuments)
    .values({
      userId,
      organizationId: orgId,
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
      currency,
      exchangeRate: String(exchangeRate),
      baseAmount: String(baseAmount),
      arApDocumentId,
      externalRef: cleanText(data.externalRef),
    })
    .returning({ id: cashDocuments.id });

  if (data.postNow) {
    await postCashDocument(document.id);
  } else revalidateCash();
  return { id: document.id };
}

function buildSettlementPostingLines({
  voucherId,
  documentType,
  cashAccountId,
  cashAccountNumber,
  controlAccountNumber,
  baseAmount,
  historicalBaseAmount,
  fxDifference,
  fxGainAccountNumber,
  fxLossAccountNumber,
  buildCode,
  description,
}: {
  voucherId: string;
  documentType: string;
  cashDocumentType: CashDocumentType;
  cashAccountId: string | undefined;
  cashAccountNumber: string;
  controlAccountNumber: string;
  baseAmount: number;
  historicalBaseAmount: number;
  fxDifference: number;
  /** Ханшийн олз/гарзын данс — costing_account_settings-ээс (хатуу код биш). */
  fxGainAccountNumber: string;
  fxLossAccountNumber: string;
  buildCode: (accountNumber: string) => string;
  description: string;
}) {
  const isReceivable = documentType === "ar_invoice";
  const lines = isReceivable
    ? [
        {
          voucherId,
          cashAccountId,
          accountNumber: cashAccountNumber,
          debit: String(baseAmount),
          credit: "0",
          description,
          sortOrder: 0,
        },
        {
          voucherId,
          cashAccountId: null,
          accountNumber: controlAccountNumber,
          debit: "0",
          credit: String(historicalBaseAmount),
          description,
          sortOrder: 1,
        },
      ]
    : [
        {
          voucherId,
          cashAccountId: null,
          accountNumber: controlAccountNumber,
          debit: String(historicalBaseAmount),
          credit: "0",
          description,
          sortOrder: 0,
        },
        {
          voucherId,
          cashAccountId,
          accountNumber: cashAccountNumber,
          debit: "0",
          credit: String(baseAmount),
          description,
          sortOrder: 1,
        },
      ];

  if (Math.abs(fxDifference) <= 0.01) return lines;

  const isGain = isReceivable ? fxDifference > 0 : fxDifference < 0;
  lines.push({
    voucherId,
    cashAccountId: null,
    accountNumber: buildCode(isGain ? fxGainAccountNumber : fxLossAccountNumber),
    debit: isGain ? "0" : String(Math.abs(fxDifference)),
    credit: isGain ? String(Math.abs(fxDifference)) : "0",
    description: `Ханшийн ${isGain ? "олз" : "гарз"}: ${description}`,
    sortOrder: 2,
  });
  return lines;
}

// Batch-confirm drafts (month-end close): posts each id independently and
// reports per-document failures instead of aborting the whole batch, so one
// bad draft (e.g. an FX draft missing its rate) doesn't block the rest.
export async function postCashDocuments(ids: string[]) {
  const failures: { id: string; error: string }[] = [];
  let posted = 0;
  for (const id of ids) {
    try {
      await postCashDocument(id);
      posted += 1;
    } catch (caught) {
      failures.push({
        id,
        error: caught instanceof Error ? caught.message : "Батлагдсангүй",
      });
    }
  }
  return { posted, failures };
}

export async function postCashDocument(
  id: string,
  options?: { exchangeRate?: number }
) {
  const { orgId, userId } = await requireRole("accountant");

  const document = await db.query.cashDocuments.findFirst({
    where: and(
      eq(cashDocuments.id, id),
      eq(cashDocuments.organizationId, orgId)
    ),
    with: { fromAccount: true, toAccount: true },
  });
  if (!document) throw new Error("Cash баримт олдсонгүй");
  if (document.status !== "draft")
    throw new Error("Зөвхөн ноорог баримтыг батална");
  await assertPeriodOpen(orgId, document.date);

  // GL-derived draft: the ledger already has this entry. Confirming it just
  // adopts the source voucher — do NOT create a second one (double-count).
  if (document.sourceVoucherId) {
    const patch: Partial<typeof cashDocuments.$inferInsert> = {
      status: "posted",
      postedAt: new Date(),
      voucherId: document.sourceVoucherId,
    };
    // GL lines are MNT, so the draft's baseAmount is authoritative; the
    // foreign-unit amount needs a real rate before entering the subledger.
    if (document.currency !== "MNT") {
      const rate = options?.exchangeRate ?? Number(document.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0)
        throw new Error(
          `${document.currency} гүйлгээний ханш оруулж батална уу`
        );
      const baseAmount = Number(document.baseAmount);
      assertAmount(baseAmount);
      patch.exchangeRate = String(rate);
      patch.amount = String(Math.round((baseAmount / rate) * 100) / 100);
    }
    const [claimed] = await db
      .update(cashDocuments)
      .set(patch)
      .where(
        and(
          eq(cashDocuments.id, id),
          eq(cashDocuments.organizationId, orgId),
          eq(cashDocuments.status, "draft")
        )
      )
      .returning({ id: cashDocuments.id });
    // Lost race (someone else already posted it): report it instead of
    // pretending this caller's rate was applied.
    if (!claimed) throw new Error("Баримтын төлөв өөрчлөгдсөн байна");
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "post",
      entityType: "cash",
      entityId: id,
      summary: `Кассын баримт батлагдав — ${document.documentNo}, ${document.date}, дүн ${Number(document.baseAmount).toLocaleString("en-US")}₮`,
    });
    revalidateCash();
    return;
  }

  const amount = Number(document.amount);
  assertAmount(amount);
  const baseAmount = Number(document.baseAmount);
  assertAmount(baseAmount);

  const fromAccount = document.fromAccount;
  const toAccount = document.toAccount;
  if (
    fromAccount &&
    (!fromAccount.isActive || fromAccount.organizationId !== orgId)
  )
    throw new Error("Гаргах Cash данс идэвхгүй байна");
  if (toAccount && (!toAccount.isActive || toAccount.organizationId !== orgId))
    throw new Error("Хүлээн авах Cash данс идэвхгүй байна");

  const buildCode = await cashPostingCodeBuilder(
    orgId,
    document.cashFlowCode
  );

  const arApSettlement = await validateArApSettlement(
    orgId,
    {
      arApDocumentId: document.arApDocumentId ?? undefined,
      documentType: document.documentType as CashDocumentType,
      counterAccountNumber: document.counterAccountNumber,
      amount,
    },
    document.currency
  );
  const settlementExchangeEffect = arApSettlement
    ? calculateSettlementExchangeEffect({
        documentType: arApSettlement.document.documentType as
          | "ar_invoice"
          | "ap_bill",
        amount,
        documentExchangeRate: Number(arApSettlement.document.exchangeRate),
        paymentBaseAmount: baseAmount,
      })
    : null;
  const historicalBaseAmount =
    settlementExchangeEffect?.historicalBaseAmount ?? baseAmount;
  const fxDifference = settlementExchangeEffect?.difference ?? 0;
  // Ханшийн олз/гарзын данс — тохиргооноос (costing_account_settings);
  // анхны утга нь хуучин хатуу кодтой ижил тул зан төлөв өөрчлөгдөхгүй.
  // Cross-batch helper: параметрын байрлал хэвээр — одоо orgId дамжуулна.
  const costingSettings = arApSettlement
    ? await loadCostingAccountSettings(orgId)
    : null;
  if (arApSettlement && costingSettings && Math.abs(fxDifference) > 0.01) {
    const isGain =
      arApSettlement.document.documentType === "ar_invoice"
        ? fxDifference > 0
        : fxDifference < 0;
    await assertMainAccount(
      orgId,
      isGain
        ? costingSettings.fxGainAccountNumber
        : costingSettings.fxLossAccountNumber
    );
  }

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

  let postedVoucherId: string | null = null;
  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, document.date);
    const [claimed] = await tx
      .update(cashDocuments)
      .set({ status: "posted", postedAt: new Date() })
      .where(
        and(
          eq(cashDocuments.id, id),
          eq(cashDocuments.organizationId, orgId),
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
        organizationId: orgId,
        date: document.date,
        description: `[${document.documentNo}] ${document.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    const postingLines = arApSettlement
      ? buildSettlementPostingLines({
          voucherId: voucher.id,
          documentType: arApSettlement.document.documentType,
          cashDocumentType: document.documentType as CashDocumentType,
          cashAccountId:
            document.documentType === "receipt" ? toAccount?.id : fromAccount?.id,
          cashAccountNumber:
            document.documentType === "receipt" ? debitAccount : creditAccount,
          controlAccountNumber:
            document.documentType === "receipt" ? creditAccount : debitAccount,
          baseAmount,
          historicalBaseAmount,
          fxDifference,
          fxGainAccountNumber:
            costingSettings?.fxGainAccountNumber ?? "51800001",
          fxLossAccountNumber:
            costingSettings?.fxLossAccountNumber ?? "87000003",
          buildCode,
          description: document.counterparty ?? document.description,
        })
      : [
          {
        voucherId: voucher.id,
        cashAccountId:
          document.documentType === "receipt" ||
          document.documentType === "transfer"
            ? toAccount?.id
            : null,
        accountNumber: debitAccount,
        debit: String(baseAmount),
        credit: "0",
        description: document.counterparty ?? document.description,
        sortOrder: 0,
          },
          {
        voucherId: voucher.id,
        cashAccountId:
          document.documentType === "payment" ||
          document.documentType === "transfer"
            ? fromAccount?.id
            : null,
        accountNumber: creditAccount,
        debit: "0",
        credit: String(baseAmount),
        description: document.counterparty ?? document.description,
        sortOrder: 1,
          },
        ];

    await tx.insert(journalLines).values(postingLines);

    if (arApSettlement) {
      const [updatedDocument] = await tx
        .update(arApDocuments)
        .set({
          paidAmount: sql`${arApDocuments.paidAmount} + ${String(amount)}`,
          basePaidAmount: sql`${arApDocuments.basePaidAmount} + ${String(
            historicalBaseAmount
          )}`,
          status: sql`CASE WHEN ${arApDocuments.paidAmount} + ${String(
            amount
          )} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid' ELSE 'partially_paid' END`,
        })
        .where(
          and(
            eq(arApDocuments.id, arApSettlement.document.id),
            eq(arApDocuments.organizationId, orgId),
            inArray(arApDocuments.status, ["posted", "partially_paid"]),
            sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} >= ${String(
              amount
            )} - 0.005`
          )
        )
        .returning({ id: arApDocuments.id });
      if (!updatedDocument)
        throw new Error("Авлага/өглөгийн үлдэгдэл өөрчлөгдсөн байна");

      await tx.insert(arApSettlements).values({
        userId,
        organizationId: orgId,
        documentId: arApSettlement.document.id,
        cashDocumentId: id,
        settlementDate: document.date,
        amount: String(amount),
        baseAmount: String(historicalBaseAmount),
      });
    }

    await tx
      .update(cashDocuments)
      .set({ voucherId: voucher.id })
      .where(
        and(eq(cashDocuments.id, id), eq(cashDocuments.organizationId, orgId))
      );
    postedVoucherId = voucher.id;
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "post",
        entityType: "cash",
        entityId: id,
        summary: `Кассын баримт батлагдав — ${document.documentNo}, ${document.date}, дүн ${baseAmount.toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  // 14-данс хөндсөн кассын гүйлгээ (шууд бэлэн худалдан авалт г.м.) →
  // inventory-д тоо нь бөглөгдөөгүй sentinel draft (sync дотроо шийднэ).
  // Sync унавал баримт аль хэдийн батлагдсан тул алдаа шидэхгүй —
  // reconcile_modules зөрүүг илрүүлж өөрөө засна (self-healing).
  if (postedVoucherId) {
    try {
      await syncInventoryDraftForVoucher(postedVoucherId);
      await syncFixedAssetDraftForVoucher(postedVoucherId);
    } catch (caught) {
      console.error(
        `postCashDocument: subledger sync failed for voucher ${postedVoucherId}`,
        caught
      );
    }
  }

  revalidateCash();
}

export async function reverseCashDocument(id: string) {
  const { orgId, userId } = await requireRole("accountant");

  const document = await db.query.cashDocuments.findFirst({
    where: and(
      eq(cashDocuments.id, id),
      eq(cashDocuments.organizationId, orgId)
    ),
  });
  if (!document || document.status !== "posted" || !document.voucherId)
    throw new Error("Зөвхөн батлагдсан Cash баримтыг буцаана");
  await assertPeriodOpen(orgId, document.date);

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, document.voucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");
  const linkedSettlements = await db.query.arApSettlements.findMany({
    where: eq(arApSettlements.cashDocumentId, id),
    with: { document: true },
  });

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, document.date);
    const [claimed] = await tx
      .update(cashDocuments)
      .set({ status: "reversed" })
      .where(
        and(
          eq(cashDocuments.id, id),
          eq(cashDocuments.organizationId, orgId),
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
        organizationId: orgId,
        date: document.date,
        description: `Буцаалт [${document.documentNo}] ${document.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        cashAccountId: line.cashAccountId,
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
          eq(journalVouchers.organizationId, orgId)
        )
      );

    await tx
      .update(cashDocuments)
      .set({ reversalVoucherId: reversal.id })
      .where(
        and(eq(cashDocuments.id, id), eq(cashDocuments.organizationId, orgId))
      );

    for (const settlement of linkedSettlements) {
      if (settlement.organizationId !== orgId || !settlement.document)
        continue;
      const total = Number(settlement.document.totalAmount);
      const paid = Number(settlement.document.paidAmount);
      const nextPaid = Math.max(
        0,
        Math.round((paid - Number(settlement.amount)) * 100) / 100
      );
      const nextBasePaid = Math.max(
        0,
        Math.round(
          (Number(settlement.document.basePaidAmount) -
            Number(settlement.baseAmount)) *
            100
        ) / 100
      );
      const nextStatus =
        settlement.document.status === "reversed"
          ? "reversed"
          : nextPaid <= 0.005
            ? "posted"
            : nextPaid >= total - 0.005
              ? "paid"
              : "partially_paid";
      await tx
        .update(arApDocuments)
        .set({
          paidAmount: String(nextPaid),
          basePaidAmount: String(nextBasePaid),
          status: nextStatus,
        })
        .where(
          and(
            eq(arApDocuments.id, settlement.documentId),
            eq(arApDocuments.organizationId, orgId)
          )
        );
      await tx
        .delete(arApSettlements)
        .where(eq(arApSettlements.id, settlement.id));
    }
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "cash",
        entityId: id,
        summary: `Кассын баримт буцаагдав — ${document.documentNo}, ${document.date}, дүн ${Number(document.baseAmount).toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  // Эх воучер нь буцаагдсан тул түүнээс үүссэн бөглөгдөөгүй inventory
  // draft-ууд хүчингүй.
  if (document.voucherId) {
    await removeDraftMovementsForVoucher(document.voucherId);
    await removeDraftAssetsForVoucher(document.voucherId);
  }

  revalidateCash();
}

/**
 * Кассын баримт устгах. Ноорог — шууд. БАТЛАГДСАН/БУЦААГДСАН баримтыг
 * мөн устгаж болно — GL журнал(ууд) нь хамт устаж, нэхэмжлэхтэй холбоотой
 * байсан бол төлөлтийг нь буцааж (settlement rollback) нэхэмжлэхийн
 * үлдэгдэл, төлөв сэргэнэ. Период нээлттэй байх шаардлагатай.
 */
export async function deleteCashDocument(id: string) {
  const { orgId, userId } = await requireRole("accountant");
  const document = await db.query.cashDocuments.findFirst({
    where: and(
      eq(cashDocuments.id, id),
      eq(cashDocuments.organizationId, orgId)
    ),
  });
  if (!document) return;

  if (document.status === "draft") {
    await db
      .delete(cashDocuments)
      .where(
        and(eq(cashDocuments.id, id), eq(cashDocuments.organizationId, orgId))
      );
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "delete",
      entityType: "cash",
      entityId: id,
      summary: `Кассын баримт устгагдав — ${document.documentNo}, ${document.date} (өмнөх төлөв: draft)`,
    });
    revalidateCash();
    return;
  }

  await assertPeriodOpen(orgId, document.date);

  const voucherIds = [
    ...new Set(
      [document.voucherId, document.reversalVoucherId, document.sourceVoucherId].filter(
        (value): value is string => !!value
      )
    ),
  ];

  // Журналуудаас sync-ээр үүссэн ноорог (бараа, ҮХ) — журнал устахаас ӨМНӨ
  // цэвэрлэнэ (FK журнал устахад холбоос nullжиж олдохоо болино).
  for (const voucherId of voucherIds) {
    await removeDraftMovementsForVoucher(voucherId);
    await removeDraftAssetsForVoucher(voucherId);
  }

  await db.transaction(async (tx) => {
    // 1. Нэхэмжлэхийн төлөлт байсан бол буцаана — үлдэгдэл, төлөв сэргэнэ.
    const settlements = await tx.query.arApSettlements.findMany({
      where: and(
        eq(arApSettlements.organizationId, orgId),
        eq(arApSettlements.cashDocumentId, id)
      ),
    });
    const byInvoice = new Map<string, { amount: number; baseAmount: number }>();
    for (const settlement of settlements) {
      const slot = byInvoice.get(settlement.documentId) ?? {
        amount: 0,
        baseAmount: 0,
      };
      slot.amount += Number(settlement.amount);
      slot.baseAmount += Number(settlement.baseAmount ?? settlement.amount);
      byInvoice.set(settlement.documentId, slot);
    }
    for (const [invoiceId, sums] of byInvoice) {
      const invoice = await tx.query.arApDocuments.findFirst({
        where: and(
          eq(arApDocuments.id, invoiceId),
          eq(arApDocuments.organizationId, orgId)
        ),
      });
      if (!invoice) continue;
      const newPaid = Math.max(
        0,
        Math.round((Number(invoice.paidAmount) - sums.amount) * 100) / 100
      );
      const newBasePaid = Math.max(
        0,
        Math.round(
          (Number(invoice.basePaidAmount ?? invoice.paidAmount) - sums.baseAmount) *
            100
        ) / 100
      );
      const total = Number(invoice.totalAmount);
      await tx
        .update(arApDocuments)
        .set({
          paidAmount: String(newPaid),
          basePaidAmount: String(newBasePaid),
          status:
            newPaid <= 0.005
              ? "posted"
              : newPaid >= total - 0.005
                ? "paid"
                : "partially_paid",
        })
        .where(eq(arApDocuments.id, invoiceId));
    }
    if (settlements.length > 0)
      await tx
        .delete(arApSettlements)
        .where(
          and(
            eq(arApSettlements.organizationId, orgId),
            eq(arApSettlements.cashDocumentId, id)
          )
        );

    // 2. Баримт эхэлж устна (журнал руу FK-тэй тул).
    await tx
      .delete(cashDocuments)
      .where(
        and(eq(cashDocuments.id, id), eq(cashDocuments.organizationId, orgId))
      );

    // 3. Холбоотой GL журналууд (үндсэн + буцаалт + эх) хамт устна.
    for (const voucherId of voucherIds) {
      await tx
        .delete(journalVouchers)
        .where(
          and(
            eq(journalVouchers.id, voucherId),
            eq(journalVouchers.organizationId, orgId)
          )
        );
    }
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "delete",
        entityType: "cash",
        entityId: id,
        summary: `Кассын баримт устгагдав — ${document.documentNo}, ${document.date}, дүн ${Number(document.baseAmount).toLocaleString("en-US")}₮ (өмнөх төлөв: ${document.status})`,
      },
      tx
    );
  });

  revalidateCash();
}

export interface CashDocumentVoucherLine {
  accountNumber: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface CashDocumentDetail {
  voucherId: string | null;
  /** GL voucher a derived draft came from — its lines show before adoption. */
  sourceVoucherId: string | null;
  voucherDate: string | null;
  voucherDescription: string | null;
  lines: CashDocumentVoucherLine[];
  reversalVoucherId: string | null;
  reversalLines: CashDocumentVoucherLine[];
}

// Воучерын мөрүүд — гарчгийн хамт (панелийн дэлгэрэнгүйд).
async function voucherLinesFor(orgId: string, voucherId: string | null) {
  if (!voucherId)
    return { voucher: null, lines: [] as CashDocumentVoucherLine[] };
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, voucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!voucher)
    return { voucher: null, lines: [] as CashDocumentVoucherLine[] };
  return {
    voucher,
    lines: voucher.lines.map((l) => ({
      accountNumber: l.accountNumber,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description,
    })),
  };
}

export interface CashDocPanelData {
  document: CashDocumentView;
  detail: CashDocumentDetail;
  activeSegIds: number[];
  /** Үндсэн дансны код → нэр (идэвхгүй данс ч багтана — хуучин бичилтэд). */
  glNames: Record<string, string>;
  /** Сегментийн лавлах утгууд — данс дээр дарахад сегмент panel-д хэрэгтэй. */
  segmentValues: { segmentId: number; code: string; name: string }[];
  /** Холбогдсон АР/АП нэхэмжлэх (төлбөрийн баримтад). */
  linkedInvoice: {
    id: string;
    documentNo: string;
    counterpartyName: string;
    documentType: string;
    status: string;
  } | null;
}

// Алдааг throw хийхгүй — production build дээр Next.js server action-ий
// error message-ийг нууж "An error occurred..." болгодог тул код буцаана.
export type CashDocPanelResult =
  | { ok: true; data: CashDocPanelData }
  | { ok: false; code: "unauthenticated" | "not-found" };

// Cash-doc панелийн бүх өгөгдөл НЭГ дуудалтаар: баримтын толгой + холбоотой
// GL журналын Dr/Cr мөрүүд + буцаалтын журнал. GL-ээс үүссэн, хараахан
// батлагдаагүй ноорогт мөрүүд нь ЭХ воучероос ирнэ — нягтланч баталгаажуулахын
// өмнө яг тэр бичилтийг харна.
export async function getCashDocPanelData(
  documentId: string
): Promise<CashDocPanelResult> {
  let orgId: string;
  try {
    ({ orgId } = await getActiveOrg());
  } catch {
    return { ok: false, code: "unauthenticated" };
  }

  const document = await db.query.cashDocuments.findFirst({
    where: and(
      eq(cashDocuments.id, documentId),
      eq(cashDocuments.organizationId, orgId)
    ),
    with: { fromAccount: true, toAccount: true },
  });
  if (!document) return { ok: false, code: "not-found" };

  const [main, reversal, configs, accounts, segValues, linkedInvoiceRow] =
    await Promise.all([
      voucherLinesFor(orgId, document.voucherId ?? document.sourceVoucherId),
      voucherLinesFor(orgId, document.reversalVoucherId),
      db.query.segmentConfigs.findMany({
        where: eq(segmentConfigs.organizationId, orgId),
      }),
      db.query.chartOfAccounts.findMany({
        where: eq(chartOfAccounts.organizationId, orgId),
        columns: { number: true, name: true },
      }),
      db.query.segmentValues.findMany({
        where: eq(segmentValues.organizationId, orgId),
        columns: { segmentId: true, code: true, name: true },
      }),
      document.arApDocumentId
        ? db.query.arApDocuments.findFirst({
            where: and(
              eq(arApDocuments.id, document.arApDocumentId),
              eq(arApDocuments.organizationId, orgId)
            ),
            columns: { id: true, documentNo: true, documentType: true, status: true },
            with: { counterparty: { columns: { name: true } } },
          })
        : Promise.resolve(null),
    ]);

  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || configMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);

  return {
    ok: true,
    data: {
      document: toCashDocumentView(document),
      detail: {
        voucherId: document.voucherId,
        sourceVoucherId: document.sourceVoucherId,
        voucherDate: main.voucher?.date ?? null,
        voucherDescription: main.voucher?.description ?? null,
        lines: main.lines,
        reversalVoucherId: document.reversalVoucherId,
        reversalLines: reversal.lines,
      },
      activeSegIds,
      glNames: Object.fromEntries(
        accounts.map((account) => [account.number, account.name])
      ),
      segmentValues: segValues,
      linkedInvoice: linkedInvoiceRow
        ? {
            id: linkedInvoiceRow.id,
            documentNo: linkedInvoiceRow.documentNo,
            counterpartyName: linkedInvoiceRow.counterparty?.name ?? "",
            documentType: linkedInvoiceRow.documentType,
            status: linkedInvoiceRow.status,
          }
        : null,
    },
  };
}

export type CashNewPanelResult =
  | { ok: true; data: CashTransactionOptions }
  | { ok: false; code: "unauthenticated" };

// Cash-new панелийн сонголтын өгөгдөл — transactions хуудастай НЭГ ачаалагч
// (lib/cash/load-options) ашиглана.
export async function getCashNewPanelData(): Promise<CashNewPanelResult> {
  let orgId: string;
  try {
    ({ orgId } = await getActiveOrg());
  } catch {
    return { ok: false, code: "unauthenticated" };
  }
  return { ok: true, data: await loadCashTransactionOptions(orgId) };
}

function fxPostingCode(template: string | undefined, mainAccount: string) {
  // Fallback template нь SEG_DEFAULTS-аас — бичигдээгүй сегмент бүр
  // оронгийн тоогоор "0" padded (хоосон хэсэгтэй код гаргахыг хориглоно).
  const parts =
    template?.split(".").length === 10
      ? template.split(".")
      : ALL_SEG_IDS.map((id) => SEG_DEFAULTS[id] ?? "");
  parts[2] = mainAccount;
  parts[8] = "CA";
  return parts.join(".");
}

export async function postCashFxRevaluation(data: {
  cashAccountId: string;
  valuationDate: string;
  closingRate: number;
  rateSource: "mongolbank" | "tdb" | "golomt" | "manual";
  rateBasis: "official" | "mid" | "buy" | "sell";
  sourceDate?: string | null;
  sourceUrl?: string | null;
  fetchedAt?: string | null;
  manualOverrideReason?: string | null;
  gainAccountNumber: string;
  lossAccountNumber: string;
  replaceExisting?: boolean;
}) {
  const { orgId, userId } = await requireRole("accountant");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.valuationDate))
    throw new Error("Тэгшитгэлийн огноо буруу байна");
  const todayInUlaanbaatar = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (data.valuationDate > todayInUlaanbaatar)
    throw new Error("Ирээдүйн огноонд ханшийн тэгшитгэл хийхгүй");
  // Хаагдсан периодын хамгаалалт — тэгшитгэлийн журнал энэ огноогоор бичигдэнэ.
  await assertPeriodOpen(orgId, data.valuationDate);

  const closingRate = Number(data.closingRate);
  if (!Number.isFinite(closingRate) || closingRate <= 0)
    throw new Error("Хаалтын ханш 0-ээс их байна");
  if (!["mongolbank", "tdb", "golomt", "manual"].includes(data.rateSource))
    throw new Error("Ханшийн эх сурвалж буруу байна");
  if (!["official", "mid", "buy", "sell"].includes(data.rateBasis))
    throw new Error("Ханшийн төрөл буруу байна");
  if (
    data.sourceDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(data.sourceDate) ||
      data.sourceDate > data.valuationDate)
  )
    throw new Error("Ханшийн эх сурвалжийн огноо буруу байна");
  if (
    data.rateSource !== "manual" &&
    (!data.sourceDate || !cleanText(data.sourceUrl))
  )
    throw new Error("Ханшийн эх сурвалжийн нотолгоо дутуу байна");
  const fetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null;
  if (fetchedAt && Number.isNaN(fetchedAt.getTime()))
    throw new Error("Ханш татсан хугацаа буруу байна");
  const manualOverrideReason = cleanText(data.manualOverrideReason);
  if (data.rateSource === "manual" && (manualOverrideReason?.length ?? 0) < 5)
    throw new Error("Гараар оруулсан ханшийн шалтгааныг бичнэ үү");

  const gainAccountNumber = data.gainAccountNumber.trim();
  const lossAccountNumber = data.lossAccountNumber.trim();
  if (!gainAccountNumber || !lossAccountNumber)
    throw new Error("Ханшийн олз, гарзын дансыг сонгоно уу");
  if (!gainAccountNumber.startsWith("5") || !lossAccountNumber.startsWith("8"))
    throw new Error("Ханшийн олз нь орлогын, гарз нь зардлын данс байна");
  if (gainAccountNumber === lossAccountNumber)
    throw new Error("Ханшийн олз, гарзын данс ижил байж болохгүй");

  const account = await requireActiveCashAccount(orgId, data.cashAccountId);
  if (account.currency === "MNT")
    throw new Error("MNT дансанд ханшийн тэгшитгэл хийхгүй");

  const [
    activeRevaluation,
    sameDateLatest,
    documents,
    vouchers,
    gainLossAccounts,
  ] =
    await Promise.all([
      db.query.cashFxRevaluations.findFirst({
        where: and(
          eq(cashFxRevaluations.organizationId, orgId),
          eq(cashFxRevaluations.cashAccountId, account.id),
          eq(cashFxRevaluations.status, "posted")
        ),
        with: { voucher: { with: { lines: true } } },
        orderBy: [
          desc(cashFxRevaluations.valuationDate),
          desc(cashFxRevaluations.revision),
        ],
      }),
      db.query.cashFxRevaluations.findFirst({
        where: and(
          eq(cashFxRevaluations.organizationId, orgId),
          eq(cashFxRevaluations.cashAccountId, account.id),
          eq(cashFxRevaluations.valuationDate, data.valuationDate)
        ),
        columns: { revision: true },
        orderBy: [desc(cashFxRevaluations.revision)],
      }),
      db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.organizationId, orgId),
          lte(cashDocuments.date, data.valuationDate)
        ),
      }),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.organizationId, orgId),
          lte(journalVouchers.date, data.valuationDate),
          inArray(journalVouchers.status, ["posted", "reversed"])
        ),
        with: { lines: true },
        orderBy: [desc(journalVouchers.date), desc(journalVouchers.createdAt)],
      }),
      db.query.chartOfAccounts.findMany({
        where: and(
          eq(chartOfAccounts.organizationId, orgId),
          eq(chartOfAccounts.isEnabled, true),
          inArray(chartOfAccounts.number, [
            gainAccountNumber,
            lossAccountNumber,
          ])
        ),
      }),
    ]);
  const replaceTarget =
    activeRevaluation?.valuationDate === data.valuationDate
      ? activeRevaluation
      : null;
  if (replaceTarget && !data.replaceExisting)
    throw new Error("Энэ данс, огноогоор ханшийн тэгшитгэл бүртгэгдсэн байна");
  if (
    activeRevaluation &&
    activeRevaluation.valuationDate > data.valuationDate
  )
    throw new Error(
      `${activeRevaluation.valuationDate}-с өмнөх огноонд тэгшитгэл нөхөж бичихгүй`
    );

  const accountNumbers = new Set(gainLossAccounts.map((item) => item.number));
  if (
    !accountNumbers.has(gainAccountNumber) ||
    !accountNumbers.has(lossAccountNumber)
  )
    throw new Error("Сонгосон FX олз/гарзын данс идэвхгүй байна");

  const foreignBalance =
    Number(account.openingBalance) +
    documents.reduce(
      (sum, document) => sum + cashDocumentEffect(document, account.id),
      0
    );
  let carryingAmount = 0;
  let templateCode: string | undefined;
  for (const voucher of vouchers) {
    if (replaceTarget && voucher.id === replaceTarget.voucherId) continue;
    for (const line of voucher.lines) {
      if (line.cashAccountId !== account.id) continue;
      carryingAmount += Number(line.debit) - Number(line.credit);
      templateCode ??= line.accountNumber;
    }
  }

  const { revaluedAmount, adjustmentAmount } = calculateFxRevaluation(
    foreignBalance,
    closingRate,
    carryingAmount
  );
  if (Math.abs(adjustmentAmount) <= 0.01)
    throw new Error("Тэгшитгэлийн зөрүү 0 байна");

  const gainLossAccountNumber =
    adjustmentAmount > 0 ? gainAccountNumber : lossAccountNumber;
  const amount = Math.abs(adjustmentAmount);
  const cashCode = fxPostingCode(templateCode, account.glAccountNumber);
  const gainLossCode = fxPostingCode(templateCode, gainLossAccountNumber);

  const result = await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, data.valuationDate);
    if (replaceTarget) {
      const [claimed] = await tx
        .update(cashFxRevaluations)
        .set({ status: "reversed", reversedAt: new Date() })
        .where(
          and(
            eq(cashFxRevaluations.id, replaceTarget.id),
            eq(cashFxRevaluations.status, "posted")
          )
        )
        .returning({ id: cashFxRevaluations.id });
      if (!claimed)
        throw new Error("Тэгшитгэлийн төлөв өөрчлөгдсөн байна");

      const [reversal] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          organizationId: orgId,
          date: data.valuationDate,
          description: `Буцаалт: ${replaceTarget.voucher.description}`,
          status: "posted",
        })
        .returning({ id: journalVouchers.id });
      await tx.insert(journalLines).values(
        replaceTarget.voucher.lines.map((line, index) => ({
          voucherId: reversal.id,
          cashAccountId: line.cashAccountId,
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
        .where(eq(journalVouchers.id, replaceTarget.voucherId));
      await tx
        .update(cashFxRevaluations)
        .set({ reversalVoucherId: reversal.id })
        .where(eq(cashFxRevaluations.id, replaceTarget.id));
    }

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: data.valuationDate,
        description: `[FX ${account.currency}] ${account.name} @ ${closingRate}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values(
      adjustmentAmount > 0
        ? [
            {
              voucherId: voucher.id,
              cashAccountId: account.id,
              accountNumber: cashCode,
              debit: String(amount),
              credit: "0",
              description: `${account.currency} ханшийн тэгшитгэл`,
              sortOrder: 0,
            },
            {
              voucherId: voucher.id,
              cashAccountId: null,
              accountNumber: gainLossCode,
              debit: "0",
              credit: String(amount),
              description: "Валютын ханшийн бодит бус олз",
              sortOrder: 1,
            },
          ]
        : [
            {
              voucherId: voucher.id,
              cashAccountId: null,
              accountNumber: gainLossCode,
              debit: String(amount),
              credit: "0",
              description: "Валютын ханшийн гарз",
              sortOrder: 0,
            },
            {
              voucherId: voucher.id,
              cashAccountId: account.id,
              accountNumber: cashCode,
              debit: "0",
              credit: String(amount),
              description: `${account.currency} ханшийн тэгшитгэл`,
              sortOrder: 1,
            },
          ]
    );

    const [revaluation] = await tx
      .insert(cashFxRevaluations)
      .values({
        userId,
        organizationId: orgId,
        cashAccountId: account.id,
        revision: (sameDateLatest?.revision ?? 0) + 1,
        valuationDate: data.valuationDate,
        currency: account.currency,
        closingRate: String(closingRate),
        rateSource: data.rateSource,
        rateBasis: data.rateBasis,
        sourceDate: cleanText(data.sourceDate),
        sourceUrl: cleanText(data.sourceUrl),
        fetchedAt,
        manualOverrideReason,
        foreignBalance: String(foreignBalance),
        carryingAmount: String(carryingAmount),
        revaluedAmount: String(revaluedAmount),
        adjustmentAmount: String(adjustmentAmount),
        gainLossAccountNumber,
        voucherId: voucher.id,
      })
      .returning({ id: cashFxRevaluations.id });
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "fx_post",
        entityType: "cash",
        entityId: revaluation.id,
        summary: `Ханшийн тэгшитгэл бичигдэв — ${account.name} (${account.currency}), ${data.valuationDate}, зөрүү ${adjustmentAmount.toLocaleString("en-US")}₮`,
      },
      tx
    );
    return { id: revaluation.id, voucherId: voucher.id, adjustmentAmount };
  });

  revalidateCash();
  revalidatePath("/cash/reconciliation");
  return result;
}

export async function reverseCashFxRevaluation(id: string) {
  const { orgId, userId } = await requireRole("accountant");
  const revaluation = await db.query.cashFxRevaluations.findFirst({
    where: and(
      eq(cashFxRevaluations.id, id),
      eq(cashFxRevaluations.organizationId, orgId),
      eq(cashFxRevaluations.status, "posted")
    ),
    with: {
      cashAccount: true,
      voucher: { with: { lines: true } },
    },
  });
  if (!revaluation) throw new Error("Идэвхтэй тэгшитгэл олдсонгүй");

  const latest = await db.query.cashFxRevaluations.findFirst({
    where: and(
      eq(cashFxRevaluations.organizationId, orgId),
      eq(cashFxRevaluations.cashAccountId, revaluation.cashAccountId),
      eq(cashFxRevaluations.status, "posted")
    ),
    columns: { id: true },
    orderBy: [
      desc(cashFxRevaluations.valuationDate),
      desc(cashFxRevaluations.revision),
    ],
  });
  if (latest?.id !== revaluation.id)
    throw new Error("Зөвхөн хамгийн сүүлийн тэгшитгэлийг буцаана");

  // Буцаалт нь ЭХ огноогоор бичигдэх тул тэр огнооны периодыг шалгана.
  await assertPeriodOpen(orgId, revaluation.valuationDate);

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, revaluation.valuationDate);
    const [claimed] = await tx
      .update(cashFxRevaluations)
      .set({ status: "reversed", reversedAt: new Date() })
      .where(
        and(
          eq(cashFxRevaluations.id, id),
          eq(cashFxRevaluations.status, "posted")
        )
      )
      .returning({ id: cashFxRevaluations.id });
    if (!claimed) throw new Error("Тэгшитгэлийн төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: revaluation.valuationDate,
        description: `Буцаалт: ${revaluation.voucher.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });
    await tx.insert(journalLines).values(
      revaluation.voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        cashAccountId: line.cashAccountId,
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
      .where(eq(journalVouchers.id, revaluation.voucherId));
    await tx
      .update(cashFxRevaluations)
      .set({ reversalVoucherId: reversal.id })
      .where(eq(cashFxRevaluations.id, id));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "fx_reverse",
        entityType: "cash",
        entityId: id,
        summary: `Ханшийн тэгшитгэл буцаагдав — ${revaluation.cashAccount.name} (${revaluation.currency}), ${revaluation.valuationDate}, зөрүү ${Number(revaluation.adjustmentAmount).toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  revalidateCash();
}

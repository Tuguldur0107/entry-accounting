"use server";

// Кредит нэхэмжлэл (АР) / дебит нэхэмжлэх (АП) — ENT-029.
// Логик: lib/arap/credit-note.ts (ЦЭВЭР), lib/arap/credit-note-db.ts (DB);
// батлах/буцаах нь АР/АП-ийн ерөнхий замаар (lib/actions/arap.ts) — эх
// нэхэмжлэхэд тооцох, давхар шалгалт нь тэнд.

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { assertNotFuturePeriod, assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { ulaanbaatarToday } from "@/lib/periods/document-date";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  chartOfAccounts,
  counterparties,
} from "@/lib/db/schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import {
  arapLedger,
  creditDocumentTypeFor,
  documentNoPrefix,
  documentTypeLabel,
  type ArApDocumentType,
} from "@/lib/arap/document-kind";
import {
  mainAccountOfCode,
  planCreditNote,
  SALES_RETURN_CONTRA_ACCOUNT,
  type CreditRequestLine,
} from "@/lib/arap/credit-note";
import {
  loadCreditSource,
  loadCreditedByLine,
  vatLineMatcher,
} from "@/lib/arap/credit-note-db";
import { counterpartyDirectionError } from "@/lib/arap/counterparty-kind";
import { POS_SOURCE_TYPE } from "@/lib/pos/constants";
import { postArApDocument } from "@/lib/actions/arap";

export type CreditNoteSourceLineView = {
  id: string;
  lineNo: number;
  description: string;
  accountNumber: string;
  amount: number;
  quantity: number | null;
  itemId: string | null;
  unitPrice: number | null;
  isVat: boolean;
  remainingAmount: number;
  remainingQuantity: number | null;
};

export type CreditNoteSourceView = {
  id: string;
  documentNo: string;
  documentType: string;
  creditType: ArApDocumentType;
  creditTypeLabel: string;
  counterpartyName: string;
  date: string;
  currency: string;
  totalAmount: number;
  openAmount: number;
  lines: CreditNoteSourceLineView[];
  /** Кредит үүсгэх боломжгүй шалтгаан (null = боломжтой). */
  blocker: string | null;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Эх нэхэмжлэх кредит баримт авч болох эсэх — UI ба action НЭГ дүрэм. */
function sourceBlocker(source: {
  documentType: string;
  status: string;
  sourceType: string | null;
  purchaseOrderId: string | null;
}): string | null {
  if (!creditDocumentTypeFor(source.documentType))
    return "[CREDIT_SOURCE_TYPE] Кредит/дебит баримт зөвхөн авлагын нэхэмжлэл эсвэл өглөгийн нэхэмжлэхээс үүснэ";
  if (source.sourceType === POS_SOURCE_TYPE)
    return "[POS_SOURCED] POS борлуулалтын буцаалтыг Бараа материал → Борлуулалт дээрээс хийнэ";
  if (source.purchaseOrderId)
    return "[CREDIT_PO_LINKED] Захиалгатай (PO) нэхэмжлэхийн дебит нэхэмжлэх одоогоор дэмжигдэхгүй — PO-гийн дутуу хаалттай (ENT-064) хамт хийгдэнэ";
  if (!["posted", "partially_paid", "paid"].includes(source.status))
    return "[CREDIT_SOURCE_STATUS] Эх нэхэмжлэх батлагдсан байх ёстой";
  return null;
}

async function loadSourceView(orgId: string, userId: string, sourceDocumentId: string) {
  const loaded = await loadCreditSource(orgId, sourceDocumentId);
  if (!loaded) throw new Error("[CREDIT_SOURCE_NOT_FOUND] Эх нэхэмжлэх олдсонгүй");
  const { source, lines } = loaded;
  const creditType = creditDocumentTypeFor(source.documentType);
  const isVat = await vatLineMatcher(orgId, userId, source.documentType);
  const credited = await loadCreditedByLine(orgId, source.id, null);
  const counterparty = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.id, source.counterpartyId), eq(counterparties.organizationId, orgId)),
    columns: { name: true },
  });
  const view: CreditNoteSourceView = {
    id: source.id,
    documentNo: source.documentNo,
    documentType: source.documentType,
    creditType: creditType ?? "ar_credit_note",
    creditTypeLabel: documentTypeLabel(creditType ?? "ar_credit_note"),
    counterpartyName: counterparty?.name ?? "",
    date: source.date,
    currency: source.currency,
    totalAmount: Number(source.totalAmount),
    openAmount: round2(Number(source.totalAmount) - Number(source.paidAmount)),
    lines: lines.map((line, index) => {
      const done = credited.get(line.id) ?? { amount: 0, quantity: 0 };
      return {
        id: line.id,
        lineNo: index + 1,
        description: line.description,
        accountNumber: line.accountNumber,
        amount: line.amount,
        quantity: line.quantity,
        itemId: line.itemId,
        unitPrice: line.unitPrice,
        isVat: isVat(line.accountNumber),
        remainingAmount: round2(line.amount - done.amount),
        remainingQuantity:
          line.quantity != null ? Math.round((line.quantity - done.quantity) * 10_000) / 10_000 : null,
      };
    }),
    blocker: sourceBlocker(source),
  };
  return { view, loaded, credited, isVat };
}

/** Кредит/дебит баримтын диалог ба AI-д: эх нэхэмжлэхийн мөр бүрийн үлдэгдэл. */
export async function getCreditNoteSource(
  sourceDocumentId: string
): Promise<ActionResult<{ source: CreditNoteSourceView }>> {
  try {
    const { orgId, userId } = await getActiveOrg();
    const { view } = await loadSourceView(orgId, userId, sourceDocumentId);
    await requireModuleAction(arapLedger(view.documentType), "read");
    return { source: view };
  } catch (caught) {
    return actionError("getCreditNoteSource", caught, "Эх нэхэмжлэх уншигдсангүй");
  }
}

export type CreateCreditNoteInput = {
  sourceDocumentId: string;
  /** Өгөөгүй бол Улаанбаатарын өнөөдөр. */
  date?: string;
  /** Буцаалтын шалтгаан — баримтын утгад орно. */
  reason?: string;
  /** Хоосон бол бүх мөрийн үлдэгдэл (бүтэн буцаалт). */
  lines?: CreditRequestLine[];
  postNow?: boolean;
  /** Гадаад системийн давтагдашгүй дугаар — ижил ref дахин үүсгэхгүй. */
  externalRef?: string;
};

async function createCreditNoteCore(input: CreateCreditNoteInput) {
  const { orgId, userId } = await getActiveOrg();
  const { view, loaded, credited, isVat } = await loadSourceView(orgId, userId, input.sourceDocumentId);
  const { source } = loaded;
  const creditType = creditDocumentTypeFor(source.documentType);
  await requireModuleAction(arapLedger(source.documentType), input.postNow ? "post" : "write");
  if (view.blocker || !creditType) throw new Error(view.blocker ?? "[CREDIT_SOURCE_TYPE] Эх баримтын төрөл буруу");

  const externalRef = input.externalRef?.trim() || null;
  if (externalRef) {
    const existing = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, externalRef)),
      columns: { id: true, documentNo: true, sourceDocumentId: true },
    });
    if (existing) {
      if (existing.sourceDocumentId !== source.id)
        throw new Error(`[CONFLICT] "${externalRef}" лавлагаатай өөр баримт бүртгэгдсэн (${existing.documentNo})`);
      return { id: existing.id, documentNo: existing.documentNo, dedup: true as const };
    }
  }

  const date = input.date?.trim() || ulaanbaatarToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Огноо буруу байна");
  if (date < source.date)
    throw new Error(`[CREDIT_DATE] Буцаалтын огноо эх нэхэмжлэхийн огнооноос (${source.date}) өмнө байж болохгүй`);
  await assertPeriodOpen(orgId, date);
  if (input.postNow) assertNotFuturePeriod(date);

  const counterparty = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.id, source.counterpartyId),
      eq(counterparties.organizationId, orgId),
      eq(counterparties.isActive, true)
    ),
    columns: { name: true, counterpartyType: true },
  });
  if (!counterparty) throw new Error("Идэвхтэй харилцагч олдсонгүй");
  const directionError = counterpartyDirectionError(creditType, counterparty.counterpartyType, counterparty.name);
  if (directionError) throw new Error(directionError);

  const plan = planCreditNote({
    sourceType: source.documentType,
    sourceStatus: source.status,
    sourceLines: loaded.lines,
    credited,
    request: input.lines,
    isVatLine: isVat,
  });

  // Дансууд идэвхтэй эсэх — D-CN-1-ийн contra данс байгууллагад байхгүй бол
  // ЗОХИОХГҮЙ, ил мессежээр зогсоно.
  for (const main of new Set(plan.lines.map((line) => mainAccountOfCode(line.accountNumber)))) {
    const account = await db.query.chartOfAccounts.findFirst({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.number, main),
        eq(chartOfAccounts.isEnabled, true)
      ),
      columns: { id: true },
    });
    if (!account)
      throw new Error(
        main === SALES_RETURN_CONTRA_ACCOUNT
          ? `[ACCOUNT_NOT_FOUND] ${main} «Борлуулалтын хөнгөлөлт (contra)» данс идэвхгүй — Тохиргоо → Ерөнхий журнал → «Стандарт данс нэмэх»-ээр нэмнэ үү`
          : `[ACCOUNT_NOT_FOUND] ${main} идэвхтэй GL данс олдсонгүй`
      );
  }

  const reason = input.reason?.trim();
  const description = `${documentTypeLabel(creditType)} — ${source.documentNo}${reason ? `: ${reason}` : ""}`;
  const documentNo = `${documentNoPrefix(creditType)}-${date.replaceAll("-", "")}-${crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;

  let createdId = "";
  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, date);
    const [document] = await tx
      .insert(arApDocuments)
      .values({
        userId,
        organizationId: orgId,
        documentNo,
        documentType: creditType,
        counterpartyId: source.counterpartyId,
        date,
        dueDate: date,
        // Эх нэхэмжлэхийн валют, ханшаар — тооцоонд ханшийн зөрүү үүсэхгүй.
        currency: source.currency,
        exchangeRate: source.exchangeRate,
        controlAccountNumber: source.controlAccountNumber,
        description,
        totalAmount: String(plan.total),
        paidAmount: "0",
        baseTotalAmount: String(round2(plan.total * Number(source.exchangeRate))),
        basePaidAmount: "0",
        status: "draft",
        externalRef,
        sourceDocumentId: source.id,
      })
      .returning({ id: arApDocuments.id });
    await tx.insert(arApDocumentLines).values(
      plan.lines.map((line, index) => ({
        documentId: document.id,
        accountNumber: line.accountNumber,
        description: line.description || description,
        amount: String(line.amount),
        itemId: line.itemId,
        quantity: line.quantity != null ? String(line.quantity) : null,
        warehouseId: line.warehouseId,
        unitPrice: line.unitPrice != null ? String(line.unitPrice) : null,
        sourceLineId: line.sourceLineId,
        sortOrder: index,
      }))
    );
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "create",
        entityType: "arap",
        entityId: document.id,
        summary: `${documentTypeLabel(creditType)} үүсэв — ${documentNo} (эх ${source.documentNo}), ${date}, дүн ${plan.total.toLocaleString("en-US")} ${source.currency}${reason ? `, шалтгаан: ${reason}` : ""}`,
      },
      tx
    );
    createdId = document.id;
  });

  let postError: string | undefined;
  if (input.postNow) {
    const posted = await postArApDocument(createdId);
    postError = posted.error;
  }
  for (const root of ["/arap", "/receivables", "/payables"]) revalidatePath(root);
  return { id: createdId, documentNo, total: plan.total, postError };
}

/**
 * Эх нэхэмжлэхээс кредит нэхэмжлэл / дебит нэхэмжлэх үүсгэнэ (ноорог;
 * `postNow` бол батална). Батлахад эх нэхэмжлэхийн үлдэгдэлд автоматаар
 * тооцогдоно. Батлах алхам унавал ноорог хадгалагдсан хэвээр `postError`.
 */
export async function createCreditNote(
  input: CreateCreditNoteInput
): Promise<
  ActionResult<{ id: string; documentNo: string; total?: number; postError?: string; dedup?: true }>
> {
  try {
    return await createCreditNoteCore(input);
  } catch (caught) {
    return actionError("createCreditNote", caught, "Кредит баримт үүссэнгүй");
  }
}

// Кредит нэхэмжлэл / дебит нэхэмжлэхийн DB давхарга (ENT-029) — "use server"
// БИШ: lib/actions/arap.ts (батлах/буцаах) ба lib/actions/arap-credit-note.ts
// (үүсгэх) хоёул дуудна. Эрхийн шалгалт дуудагчид.

import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  arApSettlements,
} from "@/lib/db/schema";
import { calculateBaseAmount } from "@/lib/arap/accounting";
import { arapLedger } from "@/lib/arap/document-kind";
import {
  creditApplicationAmount,
  mainAccountOfCode,
  sumCreditedByLine,
  type CreditSourceLine,
  type CreditedSoFar,
} from "@/lib/arap/credit-note";
import { loadVatSettings } from "@/lib/vat/settings";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | DbTx;

/** Эх нэхэмжлэх + мөрүүд (кредит төлөвлөгчийн оролт). */
export async function loadCreditSource(
  orgId: string,
  sourceDocumentId: string,
  executor: DbLike = db
) {
  const source = await executor.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, sourceDocumentId),
      eq(arApDocuments.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!source) return null;
  const lines: CreditSourceLine[] = source.lines.map((line) => ({
    id: line.id,
    accountNumber: line.accountNumber,
    description: line.description,
    amount: Number(line.amount),
    quantity: line.quantity != null ? Number(line.quantity) : null,
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
  }));
  return { source, lines };
}

/**
 * Эх нэхэмжлэхийн мөр бүрд БАТЛАГДСАН (ноорог, буцаагдсан биш) кредит
 * баримтуудаар буцаагдсан дүн/тоо. `excludeDocumentId` — батлагдаж буй
 * баримт өөрөө.
 */
export async function loadCreditedByLine(
  orgId: string,
  sourceDocumentId: string,
  excludeDocumentId: string | null,
  executor: DbLike = db
): Promise<CreditedSoFar> {
  const rows = await executor
    .select({
      sourceLineId: arApDocumentLines.sourceLineId,
      amount: arApDocumentLines.amount,
      quantity: arApDocumentLines.quantity,
      itemId: arApDocumentLines.itemId,
    })
    .from(arApDocumentLines)
    .innerJoin(arApDocuments, eq(arApDocuments.id, arApDocumentLines.documentId))
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.sourceDocumentId, sourceDocumentId),
        notInArray(arApDocuments.status, ["draft", "reversed"]),
        excludeDocumentId ? ne(arApDocuments.id, excludeDocumentId) : undefined
      )
    );
  return sumCreditedByLine(
    rows.map((row) => ({
      sourceLineId: row.sourceLineId,
      amount: Number(row.amount),
      // Үнийн хөнгөлөлтийн мөр (бараагүй) тоо хасахгүй.
      quantity: row.itemId && row.quantity != null ? Number(row.quantity) : null,
    }))
  );
}

/** Дэвтрийн НӨАТ-ын данс (АР — гаралтын, АП — оролтын) таних функц. */
export async function vatLineMatcher(
  orgId: string,
  userId: string,
  documentType: string
): Promise<(accountNumber: string) => boolean> {
  const settings = await loadVatSettings(orgId, userId);
  const vatMain =
    arapLedger(documentType) === "ar"
      ? settings.outputVatAccountNumber
      : settings.inputVatAccountNumber;
  return (accountNumber) => mainAccountOfCode(accountNumber) === vatMain;
}

/** Идэвхтэй (буцаагдаагүй) кредит баримтын дугаарууд — эх нэхэмжлэхийг хамгаална. */
export async function activeCreditDocumentNos(
  orgId: string,
  sourceDocumentId: string
): Promise<string[]> {
  const rows = await db
    .select({ documentNo: arApDocuments.documentNo })
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.sourceDocumentId, sourceDocumentId),
        ne(arApDocuments.status, "reversed")
      )
    );
  return rows.map((row) => row.documentNo);
}

/**
 * Батлах транзакц дотор: кредит баримтыг эх нэхэмжлэхийн нээлттэй үлдэгдэлд
 * тооцно (D-CN-3). Эх мөрийг `for update`-ээр түгжиж давхар тооцохоос
 * сэргийлнэ. Settlement хос нь кредит баримтын ӨӨРИЙН журналтай (voucherId) —
 * мөнгө хөдлөхгүй, GL-д нэмэлт бичилт үгүй (кредитийн журнал аль хэдийн Кт
 * хяналтын данс). Тооцсон дүнг буцаана.
 */
export async function applyCreditToSourceInTx(
  tx: DbTx,
  args: {
    orgId: string;
    userId: string;
    credit: {
      id: string;
      totalAmount: number;
      exchangeRate: number;
      date: string;
      sourceDocumentId: string;
    };
    voucherId: string;
  }
): Promise<number> {
  const { orgId, userId, credit } = args;
  const [source] = await tx
    .select({
      id: arApDocuments.id,
      status: arApDocuments.status,
      totalAmount: arApDocuments.totalAmount,
      paidAmount: arApDocuments.paidAmount,
      exchangeRate: arApDocuments.exchangeRate,
    })
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.id, credit.sourceDocumentId),
        eq(arApDocuments.organizationId, orgId)
      )
    )
    .for("update");
  if (!source) throw new Error("[CREDIT_SOURCE_NOT_FOUND] Эх нэхэмжлэх олдсонгүй");
  const amount = creditApplicationAmount(credit.totalAmount, {
    totalAmount: Number(source.totalAmount),
    paidAmount: Number(source.paidAmount),
    status: source.status,
  });
  if (amount <= 0) return 0;
  const amountText = String(amount);
  // Кредит нь эх нэхэмжлэхийн ханшаар (createCreditNote шаардана) тул base
  // дүн хоёр талд ижил — ханшийн зөрүү үүсэхгүй.
  const baseText = String(calculateBaseAmount(amount, Number(source.exchangeRate)));

  for (const documentId of [source.id, credit.id]) {
    const [updated] = await tx
      .update(arApDocuments)
      .set({
        paidAmount: sql`${arApDocuments.paidAmount} + ${amountText}`,
        basePaidAmount: sql`${arApDocuments.basePaidAmount} + ${baseText}`,
        status: sql`CASE WHEN ${arApDocuments.paidAmount} + ${amountText} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid' ELSE 'partially_paid' END`,
      })
      .where(
        and(
          eq(arApDocuments.id, documentId),
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.status, ["posted", "partially_paid"]),
          sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} >= ${amountText} - 0.005`
        )
      )
      .returning({ id: arApDocuments.id });
    if (!updated)
      throw new Error(
        "[CREDIT_APPLY_CONFLICT] Үлдэгдэл өөрчлөгдсөн байна — хуудсаа шинэчлээд дахин оролдоно уу"
      );
  }

  await tx.insert(arApSettlements).values(
    [source.id, credit.id].map((documentId) => ({
      userId,
      organizationId: orgId,
      documentId,
      cashDocumentId: null,
      voucherId: args.voucherId,
      settlementDate: credit.date,
      amount: amountText,
      baseAmount: baseText,
    }))
  );
  return amount;
}

/**
 * Кредит баримтын ӨӨРИЙН тооцоог (voucherId = баримтын журнал) буцаана —
 * эх нэхэмжлэх ба кредит баримтын paidAmount/статус сэргэж settlement
 * мөрүүд устна (reverseArApOffset-тэй ижил атом SQL).
 */
export async function undoOwnCreditApplicationInTx(
  tx: DbTx,
  orgId: string,
  voucherId: string
): Promise<void> {
  const settlements = await tx
    .select()
    .from(arApSettlements)
    .where(
      and(
        eq(arApSettlements.organizationId, orgId),
        eq(arApSettlements.voucherId, voucherId)
      )
    );
  for (const settlement of settlements) {
    const amountText = String(settlement.amount);
    const baseText = String(settlement.baseAmount ?? settlement.amount);
    await tx
      .update(arApDocuments)
      .set({
        paidAmount: sql`GREATEST(${arApDocuments.paidAmount} - ${amountText}, 0)`,
        basePaidAmount: sql`GREATEST(COALESCE(${arApDocuments.basePaidAmount}, ${arApDocuments.paidAmount}) - ${baseText}, 0)`,
        status: sql`CASE
          WHEN ${arApDocuments.status} NOT IN ('posted', 'partially_paid', 'paid') THEN ${arApDocuments.status}
          WHEN ${arApDocuments.paidAmount} - ${amountText} <= 0.005 THEN 'posted'
          WHEN ${arApDocuments.paidAmount} - ${amountText} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid'
          ELSE 'partially_paid' END`,
      })
      .where(
        and(
          eq(arApDocuments.id, settlement.documentId),
          eq(arApDocuments.organizationId, orgId)
        )
      );
    await tx.delete(arApSettlements).where(eq(arApSettlements.id, settlement.id));
  }
}

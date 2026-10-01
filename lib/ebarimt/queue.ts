// eBarimt илгээлтийн дараалал — DB давхарга ("use server" БИШ: action, worker,
// cron, script дөрвүүл дуудна). docs/pos/03-ebarimt-integration-plan.md §4.4.
//
// Борлуулалтын commit-ийн ДАРАА enqueue хийгдэнэ; энд ХЭЗЭЭ Ч шидэхгүй —
// борлуулалт илгээлтээс болж унахгүй (алдаа лог руу, submission failed).

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  cashAccounts,
  cashDocuments,
  inventoryCategories,
  inventoryItems,
  posEbarimtSubmissions,
  posPaymentMethods,
  posSales,
  posSettings,
  type PosSettings,
} from "@/lib/db/schema";
import { toItemVatMode } from "@/lib/inventory/load-data";
import { loadVatSettings } from "@/lib/vat/settings";
import type { PaymentKind } from "@/lib/pos/constants";

import { EBARIMT_ERRORS, EBARIMT_POS_CREDIT_PAYMENTS_SINCE, backoffMs, type SubmissionKind } from "./constants";
import { categoryClassificationMap, ebarimtReadiness, type EbarimtReadiness } from "./readiness";
import { fetchPosApiHealth } from "./client";
import { lookupTaxpayerByTin } from "./lookup";
import { isMerchantRegistered } from "./posapi-info";
import { buildEbarimtReceipt, EbarimtError, stripReceiptSecrets, withCreditInvoice } from "./receipt";
import { arapBillIdSuffix } from "./arap-receipt";
import { buildInvoicePaymentReceipt, invoicePaymentBillIdSuffix, invoicePaymentCodeOf } from "./invoice-payment";
import { loadArapInvoiceForEbarimt } from "./arap-load";
import type {
  ArapPaymentEbarimtRow,
  EbarimtDeleteRequest,
  EbarimtReceiptRequest,
  EbarimtSaleInput,
  EbarimtSettingsInput,
  EbarimtStatusSummary,
  EbarimtSubmissionView,
} from "./types";

type DbHandle = typeof db;

/**
 * Илгээлтийн эх — POS борлуулалт ЭСВЭЛ АР нэхэмжлэх (docs/pos/05 Шат 1–2).
 * Нэг submission-д яг нэг нь; төлөвийг (`ebarimtStatus` / ДДТД) тэр эх дээр бичнэ.
 */
export interface EbarimtTarget {
  saleId: string | null;
  arapDocumentId: string | null;
}

export function targetOf(row: { saleId: string | null; arapDocumentId?: string | null }): EbarimtTarget {
  return { saleId: row.saleId ?? null, arapDocumentId: row.arapDocumentId ?? null };
}

/** ТЕГ-д бүртгэлтэй дүн (MNT) — numeric баганад string. */
type ReportedAmounts = { ebarimtTotal: string | null; ebarimtVat: string | null; ebarimtCityTax: string | null };
const ZERO_AMOUNTS: ReportedAmounts = { ebarimtTotal: "0.00", ebarimtVat: "0.00", ebarimtCityTax: "0.00" };

/**
 * Илгээсэн receipt-ийн дүн → ТЕГ-д бүртгэлтэй дүн. receipt байхгүй (хуучин мөр,
 * давхар enqueue-ийн settle) бол undefined — өмнөх утгыг ДАРАХГҮЙ.
 */
function reportedAmountsOf(payload: Record<string, unknown> | null | undefined): ReportedAmounts | undefined {
  const request = payload?.request as Record<string, unknown> | undefined;
  if (!request || typeof request !== "object") return undefined;
  const amount = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  };
  return {
    ebarimtTotal: amount(request.totalAmount),
    ebarimtVat: amount(request.totalVAT),
    ebarimtCityTax: amount(request.totalCityTax),
  };
}

/**
 * Эх баримтын eBarimt талбарууд — НЭГ UPDATE (дүн, ДДТД, засварын төлөв хамт; хагас
 * бичигдэхгүй). `onlyOpen` — sent/cancelled-ийг дарахгүй (алдааны үед).
 * `ebarimtCorrection` зөвхөн POS-д, `ebarimtCustomerTin` зөвхөн АР-д (POS-д борлуулах
 * мөчид бичигдсэн).
 */
async function setTargetEbarimt(
  target: EbarimtTarget,
  patch: {
    ebarimtStatus: string;
    ebarimtId?: string | null;
    ebarimtDate?: string | null;
    ebarimtType?: string | null;
    ebarimtCorrection?: "pending" | "failed" | null;
    ebarimtCustomerTin?: string | null;
  } & Partial<ReportedAmounts>,
  onlyOpen = false
): Promise<void> {
  const { ebarimtCorrection, ebarimtCustomerTin, ...common } = patch;
  if (target.saleId) {
    await db
      .update(posSales)
      .set(ebarimtCorrection === undefined ? common : { ...common, ebarimtCorrection })
      .where(
        onlyOpen
          ? and(eq(posSales.id, target.saleId), or(isNull(posSales.ebarimtStatus), inArray(posSales.ebarimtStatus, ["pending", "failed"])))
          : eq(posSales.id, target.saleId)
      );
  } else if (target.arapDocumentId) {
    await db
      .update(arApDocuments)
      .set(ebarimtCustomerTin === undefined ? common : { ...common, ebarimtCustomerTin })
      .where(
        onlyOpen
          ? and(
              eq(arApDocuments.id, target.arapDocumentId),
              or(isNull(arApDocuments.ebarimtStatus), inArray(arApDocuments.ebarimtStatus, ["pending", "failed"]))
            )
          : eq(arApDocuments.id, target.arapDocumentId)
      );
  }
}

/**
 * Буцаалтын ТЕГ-ийн засвар (cancel submission) явцад / амжилтгүй — POS
 * борлуулалтад л (АР-ын цуцлалт илгээгдэхгүй, docs/pos/05 Q5). Шидэхгүй.
 */
async function setSaleCorrection(saleId: string, correction: "pending" | "failed" | null, handle: DbHandle = db) {
  // pending/failed зөвхөн ТЕГ-д БҮРТГЭЛТЭЙ (sent) баримтад — засах зүйлгүй (илгээгээгүй,
  // гараар, цуцлагдсан) баримтад «Засвар» тэмдэг тавихгүй; цэвэрлэх нь үргэлж.
  await handle
    .update(posSales)
    .set({ ebarimtCorrection: correction })
    .where(correction ? and(eq(posSales.id, saleId), eq(posSales.ebarimtStatus, "sent")) : eq(posSales.id, saleId));
}

/**
 * Нэхэмжлэхийн тохиргоо (POS тохиргоо → eBarimt → Нэхэмжлэх) — АР нэхэмжлэх ба
 * POS «Зээлээр» борлуулалт НЭГ эх (`withCreditInvoice`). АР-ын асаах товчоос
 * үл хамаарна: зээлийн борлуулалт eBarimt асаалттай л бол нэхэмжлэх болж явна.
 */
export function invoiceSettingsOf(row: PosSettings): { paymentCode: string; bankAccountNo: string; iBan: string } {
  return {
    paymentCode: row.ebarimtArapPaymentCode,
    bankAccountNo: row.ebarimtArapBankAccountNo,
    iBan: row.ebarimtArapIban,
  };
}

export function settingsInputOf(row: PosSettings): EbarimtSettingsInput {
  return {
    enabled: row.ebarimtEnabled,
    merchantTin: row.ebarimtMerchantTin,
    branchNo: row.ebarimtBranchNo,
    districtCode: row.ebarimtDistrictCode,
    posNo: row.ebarimtPosNo,
    posApiUrl: row.ebarimtPosApiUrl,
    mode: row.ebarimtMode === "browser" ? "browser" : "server",
  };
}

/**
 * Борлуулалтыг ЦЭВЭР оролт болгоно: үлдсэн (буцаагдаагүй) тоо/дүн, барааны
 * ангилал (хоосон бол бүлгийнх), төлбөрийн хэлбэрийн eBarimt код.
 * Буцаалтын мөр (isReturn) өөрөө баримт биш — null.
 */
export async function loadSaleForEbarimt(
  orgId: string,
  saleId: string,
  handle: DbHandle = db
): Promise<EbarimtSaleInput | null> {
  const sale = await handle.query.posSales.findFirst({
    where: and(eq(posSales.id, saleId), eq(posSales.organizationId, orgId)),
    with: {
      lines: {
        with: {
          item: {
            columns: {
              name: true,
              unit: true,
              barcode: true,
              barcodeType: true,
              vatMode: true,
              categoryCode: true,
              ebarimtClassificationCode: true,
              ebarimtTaxProductCode: true,
            },
          },
        },
        orderBy: (line, { asc }) => [asc(line.sortOrder)],
      },
      payments: { with: { method: { columns: { name: true, kind: true, ebarimtCode: true } } } },
    },
  });
  if (!sale || sale.isReturn) return null;
  const returns = await handle.query.posSales.findMany({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.originalSaleId, saleId)),
    columns: { id: true },
    with: { lines: { columns: { originalLineId: true, quantity: true } } },
  });
  const returnedByLine = new Map<string, number>();
  for (const ret of returns)
    for (const line of ret.lines)
      if (line.originalLineId)
        returnedByLine.set(line.originalLineId, (returnedByLine.get(line.originalLineId) ?? 0) + Number(line.quantity));

  // Ангилал олон түвшинтэй — өвөг рүү өгсөж өвлөхийн тулд байгууллагын БҮХ
  // ангиллыг (жижиг лавлах) ачаална (readiness.ts-тэй ИЖИЛ дүрэм).
  const hasCategory = sale.lines.some((line) => !!line.item?.categoryCode);
  const categories = hasCategory
    ? await handle.query.inventoryCategories.findMany({
        where: eq(inventoryCategories.organizationId, orgId),
        columns: { id: true, code: true, name: true, parentId: true, ebarimtClassificationCode: true },
      })
    : [];
  const categoryClassification = categoryClassificationMap(categories);
  const vat = await loadVatSettings(orgId);

  return {
    saleId: sale.id,
    documentNo: sale.documentNo,
    isVatPayer: vat.isVatPayer,
    customerTin: sale.ebarimtCustomerTin,
    consumerNo: sale.ebarimtConsumerNo,
    total: Number(sale.total),
    lines: sale.lines.map((line) => {
      const sold = Number(line.quantity);
      const returned = returnedByLine.get(line.id) ?? 0;
      const remaining = Math.max(0, sold - returned);
      const share = sold > 0 ? remaining / sold : 0;
      return {
        itemName: line.description || line.item?.name || "",
        barcode: line.item?.barcode ?? null,
        barcodeType: line.item?.barcodeType ?? null,
        unit: line.item?.unit ?? "ш",
        vatMode: toItemVatMode(line.vatMode),
        classificationCode:
          line.item?.ebarimtClassificationCode?.trim() ||
          (line.item?.categoryCode ? categoryClassification.get(line.item.categoryCode) ?? null : null),
        taxProductCode: line.item?.ebarimtTaxProductCode ?? null,
        quantity: remaining,
        lineTotal: Math.round(Number(line.lineTotal) * share * 100) / 100,
        vatAmount: Math.round(Number(line.vatAmount) * share * 100) / 100,
        cityTaxAmount: Math.round(Number(line.cityTaxAmount) * share * 100) / 100,
      };
    }),
    payments: sale.payments.map((payment) => ({
      kind: (payment.method?.kind ?? "cash") as PaymentKind,
      methodName: payment.method?.name ?? "",
      ebarimtCode: payment.method?.ebarimtCode ?? null,
      baseAmount: Number(payment.baseAmount) - Number(payment.changeGiven),
      reference: payment.reference,
    })),
  };
}

/**
 * Дараалалд мөр нэмнэ (partial unique index давхардлыг хаана). Шидэхгүй.
 * Буцаана: шинэ submission-ийн id; давхардсан / унасан бол null.
 */
export async function enqueueEbarimt(
  orgId: string,
  saleId: string,
  kind: SubmissionKind,
  handle: DbHandle = db
): Promise<string | null> {
  try {
    // Багц: eBarimt боломжгүй бол дараалалд ОРУУЛАХГҮЙ — борлуулалт зогсохгүй
    // (docs/billing §4; хуучин `sent` баримтын цуцлалт ч мөн алгасна).
    const { getEntitlements } = await import("@/lib/billing/load");
    const ent = await getEntitlements(orgId);
    if (!ent.features.ebarimt) {
      console.warn(`[ebarimt] багцад ороогүй — org=${orgId} sale=${saleId} ${kind} алгаслаа`);
      return null;
    }
    const [row] = await handle
      .insert(posEbarimtSubmissions)
      .values({ organizationId: orgId, saleId, kind, status: "pending", nextAttemptAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: posEbarimtSubmissions.id });
    // Буцаалтын засвар дараалалд — ДДТД хүчинтэй хэвээр ч ТЕГ-ийн дүн хуучирсан.
    if (row && kind === "cancel") await setSaleCorrection(saleId, "pending", handle);
    return row?.id ?? null;
  } catch (error) {
    console.error("[ebarimt] enqueue унав:", saleId, kind, error);
    return null;
  }
}

/**
 * АР нэхэмжлэхийг дараалалд (docs/pos/05 Шат 2). Шидэхгүй. Нөхцөл: eBarimt +
 * «АР нэхэмжлэх» асаалттай, server горим, багцад eBarimt, баримт ar_invoice +
 * батлагдсан + илгээгдээгүй. Нөхцөл таарахгүй бол чимээгүй null (нягтлан бодох
 * ажлыг ХЭЗЭЭ Ч зогсоохгүй).
 */
export async function enqueueArapInvoiceEbarimt(orgId: string, documentId: string): Promise<string | null> {
  try {
    const settings = await db.query.posSettings.findFirst({ where: eq(posSettings.organizationId, orgId) });
    if (!settings?.ebarimtEnabled || !settings.ebarimtArapEnabled || settings.ebarimtMode !== "server") return null;
    const doc = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.id, documentId), eq(arApDocuments.organizationId, orgId)),
      columns: { documentType: true, status: true, ebarimtStatus: true, sourceType: true },
    });
    // POS-оос үүссэн АР нь POS-ийн баримтаараа явна — давхар илгээхгүй.
    if (!doc || doc.documentType !== "ar_invoice" || doc.sourceType === "pos") return null;
    if (doc.status === "draft" || doc.status === "reversed" || doc.ebarimtStatus === "sent") return null;
    const { getEntitlements } = await import("@/lib/billing/load");
    if (!(await getEntitlements(orgId)).features.ebarimt) return null;
    const [row] = await db
      .insert(posEbarimtSubmissions)
      .values({ organizationId: orgId, arapDocumentId: documentId, kind: "send", status: "pending", nextAttemptAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: posEbarimtSubmissions.id });
    await setTargetEbarimt({ saleId: null, arapDocumentId: documentId }, { ebarimtStatus: "pending" }, true);
    return row?.id ?? null;
  } catch (error) {
    console.error("[ebarimt] АР enqueue унав:", documentId, error);
    return null;
  }
}

/** АР нэхэмжлэхийн failed илгээлтийг дахин pending (гар «Дахин илгээх»); байхгүй бол шинээр. */
export async function requeueArapInvoiceEbarimt(orgId: string, documentId: string): Promise<void> {
  const existing = await db.query.posEbarimtSubmissions.findFirst({
    where: and(
      eq(posEbarimtSubmissions.organizationId, orgId),
      eq(posEbarimtSubmissions.arapDocumentId, documentId),
      eq(posEbarimtSubmissions.kind, "send")
    ),
    orderBy: [desc(posEbarimtSubmissions.createdAt)],
  });
  if (existing && (existing.status === "pending" || existing.status === "claimed")) return;
  if (existing && existing.status === "failed") {
    await db
      .update(posEbarimtSubmissions)
      .set({ status: "pending", nextAttemptAt: new Date(), lastError: null, payload: null, updatedAt: new Date() })
      .where(eq(posEbarimtSubmissions.id, existing.id));
    await setTargetEbarimt({ saleId: null, arapDocumentId: documentId }, { ebarimtStatus: "pending" }, true);
    return;
  }
  await enqueueArapInvoiceEbarimt(orgId, documentId);
}

/**
 * Нэхэмжлэхийн ТӨЛӨЛТИЙН СКАННЕР (docs/pos/05 Шат 3) — worker-ийн тик бүрд.
 * Авлагын төлөлт 6 газраас үүсдэг тул газар бүрд hook биш: ТЕГ-д бүртгэлтэй
 * (`sent`, *_INVOICE) нэхэмжлэхийн КАССЫН баримттай (касс / банк / хуулга / QPay
 * линк — батлагдсан) settlement бүрийг НЭГ удаа `payment` дараалалд оруулна.
 * Кассгүй хаалт (харилцан суутгал Q8, ECL хасалт, кредит нэхэмжлэл) ОРОХГҮЙ.
 * Нэг нэхэмжлэхэд нэг удаад нэг идэвхтэй төлөлт (arap_active_ux) — дараагийнх
 * нь өмнөх нь дуусмагц дараагийн тикэд. Хэзээ ч шидэхгүй.
 *
 * POS «Зээлээр» борлуулалт ч мөн (2026-10-01): POS-оос үүссэн АР нэхэмжлэх
 * (`sourceType=pos`) — eBarimt нэхэмжлэх нь борлуулалт дээр (`pos_sales.ebarimt*`,
 * *_INVOICE, sent) тул тэндээс шалгана. Борлуулах мөчийн бэлэн/карт хэсэг ч
 * settlement тул төлөлтийн баримт болно (нэхэмжлэх НӨАТ-ын тайланд орсон —
 * `invoiceId`-тай баримт давхар тусгагдахгүй, спек 3.0.1 §6). АР-ын асаах
 * товчноос үл хамаарна; `EBARIMT_POS_CREDIT_PAYMENTS_SINCE`-ээс хойшх төлөлт л.
 */
export async function enqueueArapInvoicePayments(limit = 50): Promise<number> {
  try {
    const orgs = await db.query.posSettings.findMany({
      where: and(eq(posSettings.ebarimtEnabled, true), eq(posSettings.ebarimtMode, "server")),
      columns: { organizationId: true, ebarimtArapEnabled: true },
    });
    if (orgs.length === 0) return 0;
    const { getEntitlements } = await import("@/lib/billing/load");
    const posAllowed: string[] = [];
    const arapAllowed: string[] = [];
    for (const org of orgs) {
      if (!(await getEntitlements(org.organizationId)).features.ebarimt) continue;
      posAllowed.push(org.organizationId);
      if (org.ebarimtArapEnabled) arapAllowed.push(org.organizationId);
    }
    if (posAllowed.length === 0) return 0;
    const invoiceTypes = ["B2B_INVOICE", "B2C_INVOICE"];
    // АР модулийн нэхэмжлэх: ДДТД нь баримт дээр.
    const arapInvoiceSent = arapAllowed.length
      ? and(
          inArray(arApSettlements.organizationId, arapAllowed),
          eq(arApDocuments.ebarimtStatus, "sent"),
          inArray(arApDocuments.ebarimtType, invoiceTypes)
        )
      : sql`false`;
    // POS «Зээлээр»: ДДТД нь борлуулалт дээр.
    const posInvoiceSent = and(
      inArray(arApSettlements.organizationId, posAllowed),
      eq(arApDocuments.sourceType, "pos"),
      gte(arApSettlements.createdAt, EBARIMT_POS_CREDIT_PAYMENTS_SINCE),
      sql`exists (select 1 from pos_sales s
                   where s.id = ${arApDocuments.sourceId}
                     and s.ebarimt_status = 'sent'
                     and s.ebarimt_type in ('B2B_INVOICE', 'B2C_INVOICE'))`
    );

    const candidates = await db
      .selectDistinctOn([arApSettlements.documentId], {
        id: arApSettlements.id,
        documentId: arApSettlements.documentId,
        organizationId: arApSettlements.organizationId,
      })
      .from(arApSettlements)
      .innerJoin(arApDocuments, eq(arApDocuments.id, arApSettlements.documentId))
      .innerJoin(cashDocuments, eq(cashDocuments.id, arApSettlements.cashDocumentId))
      .where(
        and(
          eq(arApDocuments.documentType, "ar_invoice"),
          or(arapInvoiceSent, posInvoiceSent),
          eq(cashDocuments.status, "posted"),
          sql`${arApSettlements.amount} > 0`,
          sql`not exists (select 1 from pos_ebarimt_submissions p where p.arap_settlement_id = ${arApSettlements.id})`,
          sql`not exists (select 1 from pos_ebarimt_submissions p
                           where p.arap_document_id = ${arApSettlements.documentId}
                             and p.kind = 'payment' and p.status in ('pending', 'claimed'))`
        )
      )
      .orderBy(arApSettlements.documentId, arApSettlements.createdAt, arApSettlements.id)
      .limit(limit);

    let queued = 0;
    for (const candidate of candidates) {
      const [row] = await db
        .insert(posEbarimtSubmissions)
        .values({
          organizationId: candidate.organizationId,
          arapDocumentId: candidate.documentId,
          arapSettlementId: candidate.id,
          kind: "payment",
          status: "pending",
          nextAttemptAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: posEbarimtSubmissions.id });
      if (row) queued += 1;
    }
    return queued;
  } catch (error) {
    console.error("[ebarimt] төлөлтийн сканнер унав:", error);
    return 0;
  }
}

/**
 * Амжилтгүй төлөлтийн баримтыг дахин pending (гар «Дахин илгээх»). Тэр
 * нэхэмжлэхийн өөр төлөлт явж байвал шидэнэ (нэг удаад нэг) — дуудагч action
 * алдааг `{ error }` болгоно.
 */
export async function requeueArapPaymentEbarimt(orgId: string, submissionId: string): Promise<{ documentId: string }> {
  const row = await db.query.posEbarimtSubmissions.findFirst({
    where: and(eq(posEbarimtSubmissions.id, submissionId), eq(posEbarimtSubmissions.organizationId, orgId)),
    columns: { id: true, kind: true, status: true, arapDocumentId: true, arapSettlementId: true },
  });
  if (!row || row.kind !== "payment" || !row.arapDocumentId) throw new Error("Төлөлтийн eBarimt илгээлт олдсонгүй");
  if (row.status !== "failed") throw new Error("Зөвхөн амжилтгүй болсон төлөлтийг дахин илгээнэ");
  if (!row.arapSettlementId) throw new Error("Төлөлт Entry-д устгагдсан — дахин илгээхгүй");
  const busy = await db.query.posEbarimtSubmissions.findFirst({
    where: and(
      eq(posEbarimtSubmissions.arapDocumentId, row.arapDocumentId),
      eq(posEbarimtSubmissions.kind, "payment"),
      inArray(posEbarimtSubmissions.status, ["pending", "claimed"])
    ),
    columns: { id: true },
  });
  if (busy) throw new Error("Энэ нэхэмжлэхийн өөр төлөлт ТЕГ-д илгээгдэж байна — хэдэн минутын дараа дахин оролдоно уу");
  await db
    .update(posEbarimtSubmissions)
    .set({ status: "pending", nextAttemptAt: new Date(), lastError: null, payload: null, updatedAt: new Date() })
    .where(eq(posEbarimtSubmissions.id, row.id));
  return { documentId: row.arapDocumentId };
}


/**
 * Панель: нэхэмжлэхийн төлөлт бүрийн eBarimt төлөв + ТЕГ-д хараахан ороогүй
 * (дараалалд ороогүй) кассын төлөлтийн тоо. Шидэхгүй.
 */
export async function loadArapPaymentEbarimt(
  orgId: string,
  documentId: string,
  /** POS «Зээлээр»: сканнер үүнээс хойшх төлөлтийг л авна — өмнөхийг «дараалалд орж байна» гэж тоолохгүй. */
  options: { since?: Date } = {}
): Promise<{ payments: ArapPaymentEbarimtRow[]; unqueued: number }> {
  const rows = await db
    .select({
      submissionId: posEbarimtSubmissions.id,
      status: posEbarimtSubmissions.status,
      settlementId: posEbarimtSubmissions.arapSettlementId,
      amount: arApSettlements.amount,
      settlementDate: arApSettlements.settlementDate,
      payload: posEbarimtSubmissions.payload,
      ddtd: sql<string | null>`${posEbarimtSubmissions.response} ->> 'id'`,
      sentAt: posEbarimtSubmissions.sentAt,
      lastError: posEbarimtSubmissions.lastError,
    })
    .from(posEbarimtSubmissions)
    .leftJoin(arApSettlements, eq(arApSettlements.id, posEbarimtSubmissions.arapSettlementId))
    .where(
      and(
        eq(posEbarimtSubmissions.organizationId, orgId),
        eq(posEbarimtSubmissions.arapDocumentId, documentId),
        eq(posEbarimtSubmissions.kind, "payment")
      )
    )
    .orderBy(posEbarimtSubmissions.createdAt);
  const [unqueued] = await db
    .select({ count: sql<number>`count(*)` })
    .from(arApSettlements)
    .innerJoin(cashDocuments, eq(cashDocuments.id, arApSettlements.cashDocumentId))
    .where(
      and(
        eq(arApSettlements.organizationId, orgId),
        eq(arApSettlements.documentId, documentId),
        eq(cashDocuments.status, "posted"),
        options.since ? gte(arApSettlements.createdAt, options.since) : undefined,
        sql`${arApSettlements.amount} > 0`,
        sql`not exists (select 1 from pos_ebarimt_submissions p where p.arap_settlement_id = ${arApSettlements.id})`
      )
    );
  return {
    payments: rows.map((row) => {
      const request = (row.payload as { request?: EbarimtReceiptRequest } | null)?.request;
      return {
        submissionId: row.submissionId,
        status: row.status,
        amount: row.amount !== null ? Number(row.amount) : typeof request?.totalAmount === "number" ? request.totalAmount : null,
        settlementDate: row.settlementDate,
        ddtd: row.status === "sent" ? row.ddtd : null,
        sentAt: row.sentAt?.toISOString() ?? null,
        lastError: row.status === "sent" ? null : row.lastError,
        orphaned: row.status === "sent" && !row.settlementId,
      };
    }),
    unqueued: Number(unqueued?.count ?? 0),
  };
}

/** АР нэхэмжлэхийн илгээлтийн түүх (панель) — шинэ нь эхэндээ. */
export async function loadSubmissionsForArapDocument(orgId: string, documentId: string) {
  const rows = await db.query.posEbarimtSubmissions.findMany({
    where: and(eq(posEbarimtSubmissions.organizationId, orgId), eq(posEbarimtSubmissions.arapDocumentId, documentId)),
    orderBy: [desc(posEbarimtSubmissions.createdAt)],
    columns: { id: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Failed мөрийг дахин pending болгоно (гар «Дахин илгээх»); байхгүй бол шинээр. */
export async function requeueEbarimt(orgId: string, saleId: string, kind: SubmissionKind = "send"): Promise<void> {
  const existing = await db.query.posEbarimtSubmissions.findFirst({
    where: and(
      eq(posEbarimtSubmissions.organizationId, orgId),
      eq(posEbarimtSubmissions.saleId, saleId),
      eq(posEbarimtSubmissions.kind, kind)
    ),
    orderBy: [desc(posEbarimtSubmissions.createdAt)],
  });
  if (existing && (existing.status === "pending" || existing.status === "claimed")) return;
  if (existing && existing.status === "failed") {
    await db
      .update(posEbarimtSubmissions)
      .set({ status: "pending", nextAttemptAt: new Date(), lastError: null, payload: null, updatedAt: new Date() })
      .where(eq(posEbarimtSubmissions.id, existing.id));
    // Засварыг дахин илгээхэд баримт `sent` хэвээр (хуучин ДДТД хүчинтэй) — зөвхөн
    // засварын төлөв; «pending» болговол ТЕГ-д бүртгэлтэй дүн жагсаалтаас алга болно.
    if (kind === "cancel") await setSaleCorrection(saleId, "pending");
  } else {
    // Шинэ мөр орсон үед л enqueueEbarimt өөрөө засварын төлөв тавина (орохгүй бол —
    // багцад eBarimt байхгүй г.м. — тэмдэг үүрд үлдэхгүй).
    await enqueueEbarimt(orgId, saleId, kind);
  }
  if (kind === "cancel") return;
  await db
    .update(posSales)
    .set({ ebarimtStatus: "pending" })
    .where(and(eq(posSales.id, saleId), eq(posSales.organizationId, orgId)));
}

export interface PreparedSubmission extends EbarimtTarget {
  id: string;
  orgId: string;
  kind: SubmissionKind;
  attempts: number;
  settings: EbarimtSettingsInput;
  /**
   * kind=send: илгээх баримт. kind=cancel (буцаалтын дараа): БҮТЭН буцаалт →
   * `cancel` (DELETE, албан спек §6); ХЭСЭГЧИЛСЭН → `request` нь `inactiveId`-тай
   * засварын бичилт (§5 — сугалаа дахин олгохгүй). Хоёулаа зэрэг ХЭЗЭЭ Ч байхгүй.
   */
  request: EbarimtReceiptRequest | null;
  cancel: EbarimtDeleteRequest | null;
}

/**
 * `billIdSuffix`-ийн засварын дугаар = энэ борлуулалтын ӨМНӨХ (энэ submission-оос
 * эрт үүссэн) submission-ийн тоо. Оролдлогын тооноос ХАМААРАХГҮЙ тул нэг
 * submission-ийн дахин илгээлт бүрд ижил (PosAPI давхардлыг таних), харин
 * дараагийн бичилт (inactiveId засвар, цуцлагдсаны дараах дахин илгээлт) бүрд өөр.
 */
async function editIndexOf(submission: {
  id: string;
  saleId: string | null;
  arapDocumentId?: string | null;
  organizationId: string;
  createdAt: Date;
}): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(posEbarimtSubmissions)
    .where(
      and(
        eq(posEbarimtSubmissions.organizationId, submission.organizationId),
        submission.arapDocumentId
          ? eq(posEbarimtSubmissions.arapDocumentId, submission.arapDocumentId)
          : eq(posEbarimtSubmissions.saleId, submission.saleId ?? ""),
        or(
          lt(posEbarimtSubmissions.createdAt, submission.createdAt),
          and(eq(posEbarimtSubmissions.createdAt, submission.createdAt), lt(posEbarimtSubmissions.id, submission.id))
        )
      )
    );
  return Math.min(Number(row?.count ?? 0), 99);
}

/**
 * Submission-ийг илгээхэд бэлтгэнэ (payload үүсгэж хадгална). Payload үүсэхгүй
 * бол ([EBARIMT_*]) submission failed → null.
 */
export async function prepareSubmission(
  submission: {
    id: string;
    organizationId: string;
    saleId: string | null;
    arapDocumentId?: string | null;
    arapSettlementId?: string | null;
    kind: string;
    attempts: number;
    createdAt: Date;
  },
  settingsRow: PosSettings
): Promise<PreparedSubmission | null> {
  if (submission.arapDocumentId && submission.kind === "payment")
    return prepareArapPaymentSubmission({ ...submission, arapDocumentId: submission.arapDocumentId }, settingsRow);
  if (submission.arapDocumentId) return prepareArapSubmission({ ...submission, arapDocumentId: submission.arapDocumentId }, settingsRow);
  const saleId = submission.saleId ?? "";
  const settings = settingsInputOf(settingsRow);
  const kind = submission.kind === "cancel" ? "cancel" : "send";
  // PosAPI дуудалгүй хаах — давхар enqueue, эсвэл ТЕГ-д бүртгэх зүйл үлдээгүй.
  const settle = async (saleStatus: "cancelled" | null) => {
    const now = new Date();
    await db
      .update(posEbarimtSubmissions)
      .set({ status: "sent", sentAt: now, updatedAt: now, lastError: null })
      .where(eq(posEbarimtSubmissions.id, submission.id));
    // ТЕГ-д очоогүй ч бүгд буцаагдсан → ТЕГ-д бүртгэлтэй дүн 0 (preDeploy нөхөлттэй ижил);
    // засах зүйлгүй цуцлалт — засварын төлөв хаагдана. НЭГ UPDATE.
    if (saleStatus || kind === "cancel")
      await db
        .update(posSales)
        .set({
          ...(saleStatus ? { ebarimtStatus: saleStatus, ...ZERO_AMOUNTS } : {}),
          ...(kind === "cancel" ? { ebarimtCorrection: null } : {}),
        })
        .where(eq(posSales.id, saleId));
    return null;
  };
  try {
    const sale = await db.query.posSales.findFirst({
      where: eq(posSales.id, saleId),
      columns: { ebarimtId: true, ebarimtDate: true, ebarimtStatus: true },
    });
    if (!sale) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Борлуулалт олдсонгүй");
    const loaded = await loadSaleForEbarimt(submission.organizationId, saleId);
    if (!loaded) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Буцаалтын баримт өөрөө илгээгдэхгүй");
    // Буцаалт бүр loadSaleForEbarimt-д тооцогддог тул хожуу илгээгдэх баримт
    // ч үлдсэн мөрөөр л явна.
    const hasRemaining = loaded.lines.some((line) => line.quantity > 1e-9);
    const alreadySent = !!sale.ebarimtId && sale.ebarimtStatus === "sent";

    let request: EbarimtReceiptRequest | null = null;
    let cancel: EbarimtDeleteRequest | null = null;
    if (kind === "send") {
      if (alreadySent) return settle(null); // давхар enqueue
      if (!hasRemaining) return settle("cancelled"); // илгээхээс өмнө бүгд буцаагдсан
      // «Зээлээр» хэсэгтэй бол НЭХЭМЖЛЭХ — нэхэмжлэхийн код/данс (дутуу бол [EBARIMT_SETTINGS]).
      const input = withCreditInvoice(loaded, invoiceSettingsOf(settingsRow));
      request = buildEbarimtReceipt(input, settings, { edit: await editIndexOf(submission) });
    } else if (!alreadySent) {
      // Эх нь ТЕГ-д очоогүй байхад буцаагдав — цуцлах/засах зүйл алга; хүлээгдэж
      // буй илгээлт (байвал) буцаалтыг тооцсон үлдсэн мөрөөр өөрөө явна.
      return settle(hasRemaining ? null : "cancelled");
    } else if (hasRemaining) {
      // ХЭСЭГЧИЛСЭН буцаалт — албан спек §5: inactiveId = сүүлийн ДДТД, шинэ
      // бичилт эхийг орлоно, сугалаа ДАХИН олгогдохгүй (DELETE + шинэ бол
      // үйлчлүүлэгч хоёр дахь сугалаа авах зөрчил байсан).
      request = buildEbarimtReceipt(withCreditInvoice(loaded, invoiceSettingsOf(settingsRow)), settings, {
        inactiveId: sale.ebarimtId,
        edit: Math.max(1, await editIndexOf(submission)),
      });
    } else {
      // БҮТЭН буцаалт — §6 DELETE.
      if (!sale.ebarimtDate)
        throw new EbarimtError(EBARIMT_ERRORS.notSent, "Цуцлах баримтын огноо байхгүй");
      cancel = { id: sale.ebarimtId!, date: sale.ebarimtDate };
    }
    await db
      .update(posEbarimtSubmissions)
      .set({ payload: { ...(request ? { request } : {}), ...(cancel ? { cancel } : {}) }, updatedAt: new Date() })
      .where(eq(posEbarimtSubmissions.id, submission.id));
    return { id: submission.id, orgId: submission.organizationId, saleId, arapDocumentId: null, kind, attempts: submission.attempts, settings, request, cancel };
  } catch (error) {
    await markFailed(submission.id, { saleId, arapDocumentId: null }, error, { terminal: error instanceof EbarimtError });
    return null;
  }
}

/**
 * АР нэхэмжлэх → eBarimt нэхэмжлэх (docs/pos/05 Шат 2). Зөвхөн «send»:
 * цуцлах/засах (кредит нэхэмжлэл, Q5) ЭНД ХИЙГДЭХГҮЙ; төлөлт — тусдаа
 * `payment` (prepareArapPaymentSubmission). Аль хэдийн `sent` бол дуудалгүй хаана.
 */
async function prepareArapSubmission(
  submission: { id: string; organizationId: string; arapDocumentId: string; kind: string; attempts: number; createdAt: Date },
  settingsRow: PosSettings
): Promise<PreparedSubmission | null> {
  const target: EbarimtTarget = { saleId: null, arapDocumentId: submission.arapDocumentId };
  try {
    if (submission.kind !== "send")
      throw new EbarimtError(EBARIMT_ERRORS.notSent, "АР нэхэмжлэхийн цуцлалт/засвар албан урсгал тодорхойгүй (docs/pos/05 Q5) — ТЕГ-т гараар");
    const doc = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.id, submission.arapDocumentId), eq(arApDocuments.organizationId, submission.organizationId)),
      columns: { ebarimtId: true, ebarimtStatus: true },
    });
    if (!doc) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Нэхэмжлэх олдсонгүй");
    if (doc.ebarimtId && doc.ebarimtStatus === "sent") {
      const now = new Date();
      await db
        .update(posEbarimtSubmissions)
        .set({ status: "sent", sentAt: now, updatedAt: now, lastError: null })
        .where(eq(posEbarimtSubmissions.id, submission.id));
      return null;
    }
    const settings = settingsInputOf(settingsRow);
    const input = await loadArapInvoiceForEbarimt(submission.organizationId, submission.arapDocumentId, settingsRow);
    const request = buildEbarimtReceipt(input, settings, {
      billIdSuffix: arapBillIdSuffix(submission.arapDocumentId, await editIndexOf({ ...submission, saleId: null })),
    });
    await db
      .update(posEbarimtSubmissions)
      .set({ payload: { request }, updatedAt: new Date() })
      .where(eq(posEbarimtSubmissions.id, submission.id));
    return { id: submission.id, orgId: submission.organizationId, ...target, kind: "send", attempts: submission.attempts, settings, request, cancel: null };
  } catch (error) {
    await markFailed(submission.id, target, error, { terminal: error instanceof EbarimtError });
    return null;
  }
}

/** PosAPI дуудалгүй хаана — төлөлт устгагдсан / нэхэмжлэх ТЕГ-д хүчингүй. */
async function closeWithoutSending(submissionId: string, reason: string): Promise<null> {
  const now = new Date();
  await db
    .update(posEbarimtSubmissions)
    .set({ status: "cancelled", lastError: reason, updatedAt: now })
    .where(eq(posEbarimtSubmissions.id, submissionId));
  return null;
}

/**
 * ТЕГ-д бүртгэлтэй нэхэмжлэх (ДДТД + илгээсэн хүсэлт). АР модулийнх — баримт
 * дээр, хүсэлт нь тэр баримтын сүүлийн амжилттай «send». POS «Зээлээр»
 * (`sourceType=pos`) — борлуулалт дээр (*_INVOICE), хүсэлт нь сүүлийн амжилттай
 * хүсэлттэй submission (хэсэгчилсэн буцаалтын `inactiveId` засвар бол түүнийх —
 * ТЕГ-д одоо хүчинтэй нэхэмжлэх). Бүртгэлгүй / нэхэмжлэх биш бол null.
 */
async function loadSentInvoice(
  orgId: string,
  documentId: string,
  doc: { ebarimtId: string | null; ebarimtStatus: string | null; sourceType: string; sourceId: string | null }
): Promise<{ id: string; request: EbarimtReceiptRequest | null } | null> {
  const requestOf = (payload: unknown) => (payload as { request?: EbarimtReceiptRequest } | null)?.request ?? null;
  if (doc.sourceType === "pos") {
    if (!doc.sourceId) return null;
    const sale = await db.query.posSales.findFirst({
      where: and(eq(posSales.id, doc.sourceId), eq(posSales.organizationId, orgId)),
      columns: { ebarimtId: true, ebarimtStatus: true, ebarimtType: true },
    });
    if (!sale?.ebarimtId || sale.ebarimtStatus !== "sent" || !sale.ebarimtType?.endsWith("_INVOICE")) return null;
    const rows = await db.query.posEbarimtSubmissions.findMany({
      where: and(eq(posEbarimtSubmissions.saleId, doc.sourceId), eq(posEbarimtSubmissions.status, "sent")),
      orderBy: [desc(posEbarimtSubmissions.sentAt)],
      columns: { payload: true },
      limit: 10,
    });
    const latest = rows.map((row) => requestOf(row.payload)).find((request) => request !== null) ?? null;
    return { id: sale.ebarimtId, request: latest };
  }
  if (!doc.ebarimtId || doc.ebarimtStatus !== "sent") return null;
  const invoiceSubmission = await db.query.posEbarimtSubmissions.findFirst({
    where: and(
      eq(posEbarimtSubmissions.arapDocumentId, documentId),
      eq(posEbarimtSubmissions.kind, "send"),
      eq(posEbarimtSubmissions.status, "sent")
    ),
    orderBy: [desc(posEbarimtSubmissions.sentAt)],
    columns: { payload: true },
  });
  return { id: doc.ebarimtId, request: requestOf(invoiceSubmission?.payload) };
}

/**
 * Нэхэмжлэхийн ТӨЛӨЛТ (docs/pos/05 Шат 3) → `invoiceId`-тай төлбөрийн баримт.
 * Мөр нь ТЕГ-д ИЛГЭЭГДСЭН нэхэмжлэхийн хүсэлтээс (Entry-ийн одоогийн мөрөөс биш —
 * ТЕГ-д бүртгэлтэйтэй тулгагдана), дүн нь settlement-ийнх. Төлөлт устгагдсан
 * (касс буцаасан) бол илгээхгүй хаана.
 */
async function prepareArapPaymentSubmission(
  submission: {
    id: string;
    organizationId: string;
    arapDocumentId: string;
    arapSettlementId?: string | null;
    attempts: number;
  },
  settingsRow: PosSettings
): Promise<PreparedSubmission | null> {
  const target: EbarimtTarget = { saleId: null, arapDocumentId: submission.arapDocumentId };
  try {
    if (!submission.arapSettlementId)
      return closeWithoutSending(submission.id, "Төлөлт Entry-д устгагдсан (касс/хуулга буцаасан) — ТЕГ-д илгээгдээгүй");
    const [settlement] = await db
      .select({
        id: arApSettlements.id,
        documentId: arApSettlements.documentId,
        amount: arApSettlements.amount,
        cashStatus: cashDocuments.status,
        externalRef: cashDocuments.externalRef,
        accountType: cashAccounts.accountType,
      })
      .from(arApSettlements)
      .innerJoin(cashDocuments, eq(cashDocuments.id, arApSettlements.cashDocumentId))
      .leftJoin(cashAccounts, eq(cashAccounts.id, cashDocuments.toCashAccountId))
      .where(and(eq(arApSettlements.id, submission.arapSettlementId), eq(arApSettlements.organizationId, submission.organizationId)));
    if (!settlement || settlement.documentId !== submission.arapDocumentId)
      return closeWithoutSending(submission.id, "Төлөлт олдсонгүй — ТЕГ-д илгээгдээгүй");
    if (settlement.cashStatus !== "posted")
      return closeWithoutSending(submission.id, "Кассын баримт батлагдаагүй / буцаагдсан — ТЕГ-д илгээгдээгүй");

    const doc = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.id, submission.arapDocumentId), eq(arApDocuments.organizationId, submission.organizationId)),
      columns: { ebarimtId: true, ebarimtStatus: true, sourceType: true, sourceId: true },
    });
    if (!doc) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Нэхэмжлэх олдсонгүй");
    const invoice = await loadSentInvoice(submission.organizationId, submission.arapDocumentId, doc);
    if (!invoice) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Нэхэмжлэх ТЕГ-д бүртгэгдээгүй — эхлээд нэхэмжлэхийг илгээнэ");
    const invoiceRequest = invoice.request;
    if (!invoiceRequest)
      throw new EbarimtError(EBARIMT_ERRORS.notSent, "ТЕГ-д илгээсэн нэхэмжлэхийн мэдээлэл олдсонгүй — ТЕГ-д гараар бүртгэнэ");

    const request = buildInvoicePaymentReceipt({
      invoiceRequest,
      invoiceId: invoice.id,
      amount: Number(settlement.amount),
      paymentCode: invoicePaymentCodeOf({ accountType: settlement.accountType, externalRef: settlement.externalRef }),
      billIdSuffix: invoicePaymentBillIdSuffix(settlement.id),
    });
    await db
      .update(posEbarimtSubmissions)
      .set({ payload: { request }, updatedAt: new Date() })
      .where(eq(posEbarimtSubmissions.id, submission.id));
    return {
      id: submission.id,
      orgId: submission.organizationId,
      ...target,
      kind: "payment",
      attempts: submission.attempts,
      settings: settingsInputOf(settingsRow),
      request,
      cancel: null,
    };
  } catch (error) {
    await markFailed(submission.id, target, error, { terminal: error instanceof EbarimtError });
    return null;
  }
}

/**
 * Амжилт: submission sent + борлуулалтын eBarimt талбарууд. Сугалаа ба QR
 * ХАДГАЛАГДАХГҮЙ (албан спек §5 хориглодог) — хариу jsonb ч
 * `stripReceiptSecrets`-ээр дамжина; тэдгээр нь дуудагчид ТҮР л буцна.
 */
export async function markSent(
  submissionId: string,
  target: EbarimtTarget,
  kind: SubmissionKind,
  response: Record<string, unknown>,
  result: { id: string | null; date: string | null; type: string | null }
): Promise<void> {
  const now = new Date();
  const [sent] = await db
    .update(posEbarimtSubmissions)
    .set({
      status: "sent",
      response: stripReceiptSecrets(response),
      sentAt: now,
      updatedAt: now,
      lastError: null,
      attempts: sql`${posEbarimtSubmissions.attempts} + 1`,
    })
    .where(eq(posEbarimtSubmissions.id, submissionId))
    .returning({ payload: posEbarimtSubmissions.payload });
  // Төлөлтийн баримт: нэхэмжлэхийн ДДТД/дүн/төлөв ХӨНДӨГДӨХГҮЙ — ТЕГ-д бүртгэлтэй
  // нэхэмжлэх хэвээр; төлөлтийн ДДТД нь submission-ий response-д.
  if (kind === "payment") return;
  // Засвар амжсан → засварын төлөв цэвэр (дүн, ДДТД-тэй НЭГ UPDATE-д). Хэрэв засвар
  // явж байх үед дахин буцаалт хийгдсэн бол (дараалалд орж чадаагүй) ТЕГ-ийн дүн
  // Entry-ийн үлдсэн дүнтэй зөрж жагсаалтад «ТЕГ-тэй зөрсөн» болж ил гарна.
  const correction = kind === "cancel" ? { ebarimtCorrection: null } : {};
  if (kind === "cancel" && !result.id) {
    // Бүтэн цуцлагдсан — ДДТД хүчингүй, ТЕГ-д бүртгэлтэй дүн 0.
    await setTargetEbarimt(target, { ebarimtStatus: "cancelled", ...ZERO_AMOUNTS, ...correction });
    return;
  }
  // Хэсэгчилсэн буцаалтын засвар (inactiveId) → ДДТД ШИНЭЧЛЭГДЭНЭ — дараагийн
  // засвар энэ сүүлийн ДДТД-г inactiveId болгоно (гинж). ТЕГ-д бүртгэлтэй дүн =
  // ЭНЭ receipt-ийнх (засварын дараа үлдсэн дүн) — жагсаалт/тайлан үүнийг уншина.
  const request = sent?.payload?.request as Record<string, unknown> | undefined;
  await setTargetEbarimt(target, {
    ebarimtStatus: "sent",
    ebarimtId: result.id,
    ebarimtDate: result.date,
    ebarimtType: result.type,
    ...reportedAmountsOf(sent?.payload),
    ...correction,
    // АР: ТЕГ-д очсон ТТД (харилцагчийн одоогийн ТТД биш).
    ...(target.arapDocumentId && request
      ? { ebarimtCustomerTin: typeof request.customerTin === "string" ? request.customerTin : null }
      : {}),
  });
}

/**
 * Алдаа: оролдлого +1, backoff; terminal (payload үүсэхгүй) эсвэл дээд тоо
 * хүрсэн бол failed — гар «Дахин илгээх» хүртэл зогсоно.
 * Буцаана: одоогийн оролдлогын тоо (мэдэгдлийн босгод).
 */
export async function markFailed(
  submissionId: string,
  target: EbarimtTarget,
  error: unknown,
  options: { terminal?: boolean; response?: Record<string, unknown>; maxAttempts?: number } = {}
): Promise<number> {
  const message = error instanceof Error ? error.message : String(error);
  const row = await db.query.posEbarimtSubmissions.findFirst({
    where: eq(posEbarimtSubmissions.id, submissionId),
    columns: { attempts: true, kind: true },
  });
  const attempts = (row?.attempts ?? 0) + 1;
  const max = options.maxAttempts ?? 20;
  const stop = options.terminal || attempts >= max;
  const now = new Date();
  await db
    .update(posEbarimtSubmissions)
    .set({
      status: stop ? "failed" : "pending",
      attempts,
      lastError: message.slice(0, 2000),
      response: options.response ? stripReceiptSecrets(options.response) : undefined,
      nextAttemptAt: stop ? now : new Date(now.getTime() + backoffMs(attempts)),
      updatedAt: now,
    })
    .where(eq(posEbarimtSubmissions.id, submissionId));
  // Төлөлтийн алдаа нэхэмжлэхийн (ТЕГ-д бүртгэлтэй) төлөвийг ХӨНДӨХГҮЙ — панелийн
  // төлөлтийн жагсаалт + мэдэгдлээр ил.
  if (row?.kind !== "payment") await setTargetEbarimt(target, { ebarimtStatus: stop ? "failed" : "pending" }, true);
  // Засварын алдаа: баримт `sent` хэвээр тул дээрх onlyOpen хөндөхгүй — засварын
  // төлөвөөр ил гаргана (чимээгүй үлдэхгүй).
  if (row?.kind === "cancel" && target.saleId) await setSaleCorrection(target.saleId, stop ? "failed" : "pending");
  return attempts;
}

/** Хугацаа нь болсон pending мөрүүд (server горимтой, идэвхтэй байгууллагууд). */
export async function claimDueSubmissions(limit = 50): Promise<
  { submission: typeof posEbarimtSubmissions.$inferSelect; settings: PosSettings }[]
> {
  // НӨАТ төлөгч бус байгууллага ч илгээнэ (НӨАТ 0, сугалаатай) — хасахгүй.
  const orgs: PosSettings[] = await db.query.posSettings.findMany({
    where: and(eq(posSettings.ebarimtEnabled, true), eq(posSettings.ebarimtMode, "server")),
  });
  if (orgs.length === 0) return [];
  const rows = await db.query.posEbarimtSubmissions.findMany({
    where: and(
      inArray(posEbarimtSubmissions.organizationId, orgs.map((org) => org.organizationId)),
      eq(posEbarimtSubmissions.status, "pending"),
      lte(posEbarimtSubmissions.nextAttemptAt, new Date())
    ),
    orderBy: [posEbarimtSubmissions.createdAt],
    limit,
  });
  const byOrg = new Map(orgs.map((org) => [org.organizationId, org]));
  return rows.map((submission) => ({ submission, settings: byOrg.get(submission.organizationId)! }));
}

/** Browser горимд кассын дэлгэц илгээх мөрүүд (payload бэлэн). */
export async function listPendingForBrowser(orgId: string, settingsRow: PosSettings, limit = 20): Promise<EbarimtSubmissionView[]> {
  const rows = await db.query.posEbarimtSubmissions.findMany({
    where: and(
      eq(posEbarimtSubmissions.organizationId, orgId),
      eq(posEbarimtSubmissions.status, "pending"),
      // Browser горим (кассын PC) — зөвхөн POS; АР нэхэмжлэх server горимд л.
      isNotNull(posEbarimtSubmissions.saleId),
      lte(posEbarimtSubmissions.nextAttemptAt, new Date())
    ),
    with: { sale: { columns: { documentNo: true } } },
    orderBy: [posEbarimtSubmissions.createdAt],
    limit,
  });
  const views: EbarimtSubmissionView[] = [];
  for (const row of rows) {
    const prepared = await prepareSubmission(row, settingsRow);
    if (!prepared) continue;
    views.push({
      id: row.id,
      saleId: row.saleId ?? "",
      documentNo: row.sale?.documentNo ?? "",
      kind: prepared.kind,
      status: "pending",
      attempts: row.attempts,
      lastError: row.lastError,
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      sentAt: null,
      payload: prepared.request,
      cancel: prepared.cancel,
    });
  }
  return views;
}

export async function loadSubmissionsForSale(orgId: string, saleId: string): Promise<EbarimtSubmissionView[]> {
  const rows = await db.query.posEbarimtSubmissions.findMany({
    where: and(eq(posEbarimtSubmissions.organizationId, orgId), eq(posEbarimtSubmissions.saleId, saleId)),
    with: { sale: { columns: { documentNo: true } } },
    orderBy: [desc(posEbarimtSubmissions.createdAt)],
  });
  return rows.map((row) => {
    const payload = (row.payload ?? {}) as { request?: EbarimtReceiptRequest; cancel?: EbarimtDeleteRequest };
    return {
      id: row.id,
      saleId: row.saleId ?? "",
      documentNo: row.sale?.documentNo ?? "",
      kind: row.kind === "cancel" ? "cancel" : "send",
      status: (["pending", "sent", "failed", "cancelled"].includes(row.status) ? row.status : "pending") as EbarimtSubmissionView["status"],
      attempts: row.attempts,
      lastError: row.lastError,
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      payload: payload.request ?? null,
      cancel: payload.cancel ?? null,
    };
  });
}

/**
 * Идэвхжүүлэхийн ӨМНӨХ бэлэн байдал — барааны ангилалын код, НӨАТ-гүй/0%-ийн
 * татварын код, төлбөрийн хэлбэрийн код (docs/deployment/ebarimt.md §3).
 * Зөвхөн ИДЭВХТЭЙ мөрийг шалгана — архивласан бараа зарагдахгүй.
 */
export async function loadEbarimtReadiness(orgId: string): Promise<EbarimtReadiness> {
  const [items, categories, methods, settings] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
      columns: {
        name: true,
        categoryCode: true,
        vatMode: true,
        ebarimtClassificationCode: true,
        ebarimtTaxProductCode: true,
      },
    }),
    db.query.inventoryCategories.findMany({
      where: eq(inventoryCategories.organizationId, orgId),
      columns: { id: true, code: true, name: true, parentId: true, ebarimtClassificationCode: true },
    }),
    db.query.posPaymentMethods.findMany({
      where: and(eq(posPaymentMethods.organizationId, orgId), eq(posPaymentMethods.isActive, true)),
      columns: { name: true, ebarimtCode: true, kind: true },
    }),
    db.query.posSettings.findFirst({
      where: eq(posSettings.organizationId, orgId),
      columns: { ebarimtArapPaymentCode: true, ebarimtArapBankAccountNo: true, ebarimtMode: true },
    }),
  ]);

  return ebarimtReadiness({
    items: items.map((item) => ({
      name: item.name,
      categoryCode: item.categoryCode,
      vatMode: toItemVatMode(item.vatMode),
      ebarimtClassificationCode: item.ebarimtClassificationCode,
      ebarimtTaxProductCode: item.ebarimtTaxProductCode,
    })),
    categories,
    paymentMethods: methods,
    invoice: settings
      ? { paymentCode: settings.ebarimtArapPaymentCode, bankAccountNo: settings.ebarimtArapBankAccountNo }
      : null,
    mode: settings?.ebarimtMode === "browser" ? "browser" : "server",
  });
}

/** Самбар / health / Console-ийн тойм. */
export async function ebarimtStatusSummary(orgId: string, settingsRow: PosSettings, todayUb: string): Promise<EbarimtStatusSummary> {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${posEbarimtSubmissions.status} = 'pending')`,
      failed: sql<number>`count(*) filter (where ${posEbarimtSubmissions.status} = 'failed')`,
      lastSentAt: sql<Date | null>`max(${posEbarimtSubmissions.sentAt})`,
    })
    .from(posEbarimtSubmissions)
    .where(eq(posEbarimtSubmissions.organizationId, orgId));
  const [sentToday] = await db
    .select({ count: sql<number>`count(*)` })
    .from(posSales)
    .where(and(eq(posSales.organizationId, orgId), eq(posSales.ebarimtStatus, "sent"), gte(posSales.date, todayUb)));
  const lastFailed = await db.query.posEbarimtSubmissions.findFirst({
    where: and(eq(posEbarimtSubmissions.organizationId, orgId), eq(posEbarimtSubmissions.status, "failed")),
    orderBy: [desc(posEbarimtSubmissions.updatedAt)],
    columns: { lastError: true },
  });
  // PosAPI-ийн хувилбар — сүүлийн амжилттай хариуны `version` (сүлжээ хөндөхгүй).
  const [lastVersion] = await db
    .select({ version: sql<string | null>`${posEbarimtSubmissions.response} ->> 'version'` })
    .from(posEbarimtSubmissions)
    .where(and(eq(posEbarimtSubmissions.organizationId, orgId), eq(posEbarimtSubmissions.status, "sent"), sql`${posEbarimtSubmissions.response} ? 'version'`))
    .orderBy(desc(posEbarimtSubmissions.sentAt))
    .limit(1);
  return {
    enabled: settingsRow.ebarimtEnabled,
    mode: settingsRow.ebarimtMode === "browser" ? "browser" : "server",
    pending: Number(counts?.pending ?? 0),
    failed: Number(counts?.failed ?? 0),
    sentToday: Number(sentToday?.count ?? 0),
    lastSentAt: counts?.lastSentAt ? new Date(counts.lastSentAt).toISOString() : null,
    lastError: lastFailed?.lastError ?? null,
    // Амьд PosAPI-ийн мэдээллийг ACTION давхарга (getEbarimtStatus) нэмнэ —
    // /api/health энэ тоймыг байгууллага бүрд дууддаг тул энд сүлжээ хөндөхгүй.
    posApi: null,
    posApiVersion: lastVersion?.version?.trim() || null,
    merchant: null,
  };
}

export { posPaymentMethods };

/**
 * Тойм + PosAPI-ийн амьд байдал (`/rest/info`, ≤5 сек, шидэхгүй) — тохиргооны
 * таб, AI/MCP статус. Server горимд л сүлжээ хөндөнө (browser горимд PosAPI
 * кассын PC дээр — серверээс хүрэхгүй).
 */
export async function ebarimtStatusWithPosApi(
  orgId: string,
  settingsRow: PosSettings,
  todayUb: string
): Promise<EbarimtStatusSummary> {
  const summary = await ebarimtStatusSummary(orgId, settingsRow, todayUb);
  if (summary.mode !== "server" || !settingsRow.ebarimtPosApiUrl.trim()) return summary;
  const [health, merchant] = await Promise.all([
    fetchPosApiHealth(settingsRow.ebarimtPosApiUrl),
    // ТЕГ-ийн бүртгэл (НХАТ төлөгч / чөлөөлөгдөх төсөл) — лавлах хүрэхгүй бол null, шидэхгүй.
    settingsRow.ebarimtMerchantTin.trim()
      ? lookupTaxpayerByTin(settingsRow.ebarimtMerchantTin).then(
          (info) => ({ name: info.name, vatPayer: info.vatPayer, cityPayer: info.cityPayer, freeProject: info.freeProject }),
          () => null
        )
      : Promise.resolve(null),
  ]);
  if (!health) return { ...summary, merchant };
  return {
    ...summary,
    merchant,
    posApi: { ...health, merchantRegistered: isMerchantRegistered(health, settingsRow.ebarimtMerchantTin) },
  };
}

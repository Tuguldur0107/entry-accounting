// eBarimt илгээлтийн дараалал — DB давхарга ("use server" БИШ: action, worker,
// cron, script дөрвүүл дуудна). docs/pos/03-ebarimt-integration-plan.md §4.4.
//
// Борлуулалтын commit-ийн ДАРАА enqueue хийгдэнэ; энд ХЭЗЭЭ Ч шидэхгүй —
// борлуулалт илгээлтээс болж унахгүй (алдаа лог руу, submission failed).

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
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

import { EBARIMT_ERRORS, backoffMs, type SubmissionKind } from "./constants";
import { categoryClassificationMap, ebarimtReadiness, type EbarimtReadiness } from "./readiness";
import { fetchPosApiHealth } from "./client";
import { lookupTaxpayerByTin } from "./lookup";
import { isMerchantRegistered } from "./posapi-info";
import { buildEbarimtReceipt, EbarimtError, stripReceiptSecrets } from "./receipt";
import { arapBillIdSuffix } from "./arap-receipt";
import { loadArapInvoiceForEbarimt } from "./arap-load";
import type {
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

/** Эх баримтын eBarimt талбарууд. `onlyOpen` — sent/cancelled-ийг дарахгүй (алдааны үед). */
async function setTargetEbarimt(
  target: EbarimtTarget,
  patch: { ebarimtStatus: string; ebarimtId?: string | null; ebarimtDate?: string | null; ebarimtType?: string | null },
  onlyOpen = false
): Promise<void> {
  if (target.saleId) {
    await db
      .update(posSales)
      .set(patch)
      .where(
        onlyOpen
          ? and(eq(posSales.id, target.saleId), or(isNull(posSales.ebarimtStatus), inArray(posSales.ebarimtStatus, ["pending", "failed"])))
          : eq(posSales.id, target.saleId)
      );
  } else if (target.arapDocumentId) {
    await db
      .update(arApDocuments)
      .set(patch)
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
  } else {
    await enqueueEbarimt(orgId, saleId, kind);
  }
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
    kind: string;
    attempts: number;
    createdAt: Date;
  },
  settingsRow: PosSettings
): Promise<PreparedSubmission | null> {
  if (submission.arapDocumentId) return prepareArapSubmission({ ...submission, arapDocumentId: submission.arapDocumentId }, settingsRow);
  const saleId = submission.saleId ?? "";
  const settings = settingsInputOf(settingsRow);
  const kind: SubmissionKind = submission.kind === "cancel" ? "cancel" : "send";
  // PosAPI дуудалгүй хаах — давхар enqueue, эсвэл ТЕГ-д бүртгэх зүйл үлдээгүй.
  const settle = async (saleStatus: "cancelled" | null) => {
    const now = new Date();
    await db
      .update(posEbarimtSubmissions)
      .set({ status: "sent", sentAt: now, updatedAt: now, lastError: null })
      .where(eq(posEbarimtSubmissions.id, submission.id));
    if (saleStatus)
      await db.update(posSales).set({ ebarimtStatus: saleStatus }).where(eq(posSales.id, saleId));
    return null;
  };
  try {
    const sale = await db.query.posSales.findFirst({
      where: eq(posSales.id, saleId),
      columns: { ebarimtId: true, ebarimtDate: true, ebarimtStatus: true },
    });
    if (!sale) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Борлуулалт олдсонгүй");
    const input = await loadSaleForEbarimt(submission.organizationId, saleId);
    if (!input) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Буцаалтын баримт өөрөө илгээгдэхгүй");
    // Буцаалт бүр loadSaleForEbarimt-д тооцогддог тул хожуу илгээгдэх баримт
    // ч үлдсэн мөрөөр л явна.
    const hasRemaining = input.lines.some((line) => line.quantity > 1e-9);
    const alreadySent = !!sale.ebarimtId && sale.ebarimtStatus === "sent";

    let request: EbarimtReceiptRequest | null = null;
    let cancel: EbarimtDeleteRequest | null = null;
    if (kind === "send") {
      if (alreadySent) return settle(null); // давхар enqueue
      if (!hasRemaining) return settle("cancelled"); // илгээхээс өмнө бүгд буцаагдсан
      request = buildEbarimtReceipt(input, settings, { edit: await editIndexOf(submission) });
    } else if (!alreadySent) {
      // Эх нь ТЕГ-д очоогүй байхад буцаагдав — цуцлах/засах зүйл алга; хүлээгдэж
      // буй илгээлт (байвал) буцаалтыг тооцсон үлдсэн мөрөөр өөрөө явна.
      return settle(hasRemaining ? null : "cancelled");
    } else if (hasRemaining) {
      // ХЭСЭГЧИЛСЭН буцаалт — албан спек §5: inactiveId = сүүлийн ДДТД, шинэ
      // бичилт эхийг орлоно, сугалаа ДАХИН олгогдохгүй (DELETE + шинэ бол
      // үйлчлүүлэгч хоёр дахь сугалаа авах зөрчил байсан).
      request = buildEbarimtReceipt(input, settings, {
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
 * цуцлах/засах (кредит нэхэмжлэл, Q5) болон төлөлт (Q1) албан урсгал
 * тодорхойгүй тул ЭНД ХИЙГДЭХГҮЙ. Аль хэдийн `sent` бол дуудалгүй хаана.
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
  await db
    .update(posEbarimtSubmissions)
    .set({
      status: "sent",
      response: stripReceiptSecrets(response),
      sentAt: now,
      updatedAt: now,
      lastError: null,
      attempts: sql`${posEbarimtSubmissions.attempts} + 1`,
    })
    .where(eq(posEbarimtSubmissions.id, submissionId));
  if (kind === "cancel" && !result.id) {
    // Бүтэн цуцлагдсан — ДДТД хүчингүй.
    await setTargetEbarimt(target, { ebarimtStatus: "cancelled" });
    return;
  }
  // Хэсэгчилсэн буцаалтын засвар (inactiveId) → ДДТД ШИНЭЧЛЭГДЭНЭ — дараагийн
  // засвар энэ сүүлийн ДДТД-г inactiveId болгоно (гинж).
  await setTargetEbarimt(target, { ebarimtStatus: "sent", ebarimtId: result.id, ebarimtDate: result.date, ebarimtType: result.type });
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
    columns: { attempts: true },
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
  await setTargetEbarimt(target, { ebarimtStatus: stop ? "failed" : "pending" }, true);
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
  const [items, categories, methods] = await Promise.all([
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
      columns: { name: true, ebarimtCode: true },
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

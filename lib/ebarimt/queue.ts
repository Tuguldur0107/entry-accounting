// eBarimt илгээлтийн дараалал — DB давхарга ("use server" БИШ: action, worker,
// cron, script дөрвүүл дуудна). docs/pos/03-ebarimt-integration-plan.md §4.4.
//
// Борлуулалтын commit-ийн ДАРАА enqueue хийгдэнэ; энд ХЭЗЭЭ Ч шидэхгүй —
// борлуулалт илгээлтээс болж унахгүй (алдаа лог руу, submission failed).

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  inventoryCategories,
  inventoryItems,
  posEbarimtSubmissions,
  posPaymentMethods,
  posSales,
  posSettings,
  type PosSettings,
} from "@/lib/db/schema";
import { toItemVatMode } from "@/lib/inventory/load-data";
import { isOrgVatPayer, loadVatSettings } from "@/lib/vat/settings";
import type { PaymentKind } from "@/lib/pos/constants";

import { EBARIMT_ERRORS, backoffMs, type SubmissionKind } from "./constants";
import { ebarimtReadiness, type EbarimtReadiness } from "./readiness";
import { fetchPosApiHealth } from "./client";
import { isMerchantRegistered } from "./posapi-info";
import { buildEbarimtReceipt, EbarimtError, stripReceiptSecrets } from "./receipt";
import type {
  EbarimtDeleteRequest,
  EbarimtReceiptRequest,
  EbarimtSaleInput,
  EbarimtSettingsInput,
  EbarimtStatusSummary,
  EbarimtSubmissionView,
} from "./types";

type DbHandle = typeof db;

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

  const categoryCodes = [...new Set(sale.lines.map((line) => line.item?.categoryCode).filter((code): code is string => !!code))];
  const categories = categoryCodes.length
    ? await handle.query.inventoryCategories.findMany({
        where: and(eq(inventoryCategories.organizationId, orgId), inArray(inventoryCategories.code, categoryCodes)),
        columns: { code: true, ebarimtClassificationCode: true },
      })
    : [];
  const categoryClassification = new Map(categories.map((category) => [category.code, category.ebarimtClassificationCode]));
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
        unit: line.item?.unit ?? "ш",
        vatMode: toItemVatMode(line.vatMode),
        classificationCode:
          line.item?.ebarimtClassificationCode?.trim() ||
          (line.item?.categoryCode ? categoryClassification.get(line.item.categoryCode) ?? null : null),
        taxProductCode: line.item?.ebarimtTaxProductCode ?? null,
        quantity: remaining,
        lineTotal: Math.round(Number(line.lineTotal) * share * 100) / 100,
        vatAmount: Math.round(Number(line.vatAmount) * share * 100) / 100,
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
      return false;
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

export interface PreparedSubmission {
  id: string;
  orgId: string;
  saleId: string;
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
 * Submission-ийг илгээхэд бэлтгэнэ (payload үүсгэж хадгална). Payload үүсэхгүй
 * бол ([EBARIMT_*]) submission failed → null.
 */
export async function prepareSubmission(
  submission: { id: string; organizationId: string; saleId: string; kind: string; attempts: number },
  settingsRow: PosSettings
): Promise<PreparedSubmission | null> {
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
      await db.update(posSales).set({ ebarimtStatus: saleStatus }).where(eq(posSales.id, submission.saleId));
    return null;
  };
  try {
    const sale = await db.query.posSales.findFirst({
      where: eq(posSales.id, submission.saleId),
      columns: { ebarimtId: true, ebarimtDate: true, ebarimtStatus: true },
    });
    if (!sale) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Борлуулалт олдсонгүй");
    const input = await loadSaleForEbarimt(submission.organizationId, submission.saleId);
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
      request = buildEbarimtReceipt(input, settings);
    } else if (!alreadySent) {
      // Эх нь ТЕГ-д очоогүй байхад буцаагдав — цуцлах/засах зүйл алга; хүлээгдэж
      // буй илгээлт (байвал) буцаалтыг тооцсон үлдсэн мөрөөр өөрөө явна.
      return settle(hasRemaining ? null : "cancelled");
    } else if (hasRemaining) {
      // ХЭСЭГЧИЛСЭН буцаалт — албан спек §5: inactiveId = сүүлийн ДДТД, шинэ
      // бичилт эхийг орлоно, сугалаа ДАХИН олгогдохгүй (DELETE + шинэ бол
      // үйлчлүүлэгч хоёр дахь сугалаа авах зөрчил байсан).
      request = buildEbarimtReceipt(input, settings, { inactiveId: sale.ebarimtId });
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
    return { id: submission.id, orgId: submission.organizationId, saleId: submission.saleId, kind, attempts: submission.attempts, settings, request, cancel };
  } catch (error) {
    await markFailed(submission.id, submission.saleId, error, { terminal: error instanceof EbarimtError });
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
  saleId: string,
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
    await db.update(posSales).set({ ebarimtStatus: "cancelled" }).where(eq(posSales.id, saleId));
    return;
  }
  // Хэсэгчилсэн буцаалтын засвар (inactiveId) → ДДТД ШИНЭЧЛЭГДЭНЭ — дараагийн
  // засвар энэ сүүлийн ДДТД-г inactiveId болгоно (гинж).
  await db
    .update(posSales)
    .set({ ebarimtStatus: "sent", ebarimtId: result.id, ebarimtDate: result.date, ebarimtType: result.type })
    .where(eq(posSales.id, saleId));
}

/**
 * Алдаа: оролдлого +1, backoff; terminal (payload үүсэхгүй) эсвэл дээд тоо
 * хүрсэн бол failed — гар «Дахин илгээх» хүртэл зогсоно.
 * Буцаана: одоогийн оролдлогын тоо (мэдэгдлийн босгод).
 */
export async function markFailed(
  submissionId: string,
  saleId: string,
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
  await db
    .update(posSales)
    .set({ ebarimtStatus: stop ? "failed" : "pending" })
    .where(and(eq(posSales.id, saleId), or(isNull(posSales.ebarimtStatus), inArray(posSales.ebarimtStatus, ["pending", "failed"]))));
  return attempts;
}

/** Хугацаа нь болсон pending мөрүүд (server горимтой, идэвхтэй байгууллагууд). */
export async function claimDueSubmissions(limit = 50): Promise<
  { submission: typeof posEbarimtSubmissions.$inferSelect; settings: PosSettings }[]
> {
  const enabledOrgs = await db.query.posSettings.findMany({
    where: and(eq(posSettings.ebarimtEnabled, true), eq(posSettings.ebarimtMode, "server")),
  });
  // НӨАТ төлөгч бус болсон байгууллагыг ТЕГ-ийн илгээлтээс ХАСНА (тоо цөөн — loop зүгээр).
  const orgs: PosSettings[] = [];
  for (const org of enabledOrgs)
    if (await isOrgVatPayer(org.organizationId)) orgs.push(org);
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
      saleId: row.saleId,
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
      saleId: row.saleId,
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
      columns: { code: true, name: true, ebarimtClassificationCode: true },
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
  const health = await fetchPosApiHealth(settingsRow.ebarimtPosApiUrl);
  if (!health) return summary;
  return {
    ...summary,
    posApi: { ...health, merchantRegistered: isMerchantRegistered(health, settingsRow.ebarimtMerchantTin) },
  };
}

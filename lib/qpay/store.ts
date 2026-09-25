// QPay intent-ийн DB давхарга ("use server" БИШ — action, webhook route,
// createPosSale транзакц гурвуул дуудна). Цэвэр дүрэм intent.ts-д.
// docs/pos/04-qpay-integration-plan.md §3.3–3.5.

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { decryptSecret } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import { cashAccounts, posPaymentMethods, posQpayIntents, posSales, users, type PosQpayIntent, type PosSettings } from "@/lib/db/schema";
import { ensureAccountsExist, seedCreatorUserId } from "@/lib/costing/master-data";
import { QPAY_ERRORS, QPAY_PAID_UNFINALIZED_MINUTES, QPAY_WEBHOOK_PATH, type QpayIntentStatus } from "./constants";
import { QpayError, type QpayClientConfig } from "./client";
import { amountMatches, canTransition, clampInvoiceTtl } from "./intent";
import { qpayReadiness, type QpayReadiness } from "./readiness";
import { planQpaySeed } from "./seed";
import { QPAY_PROVIDER } from "./constants";
import type { QpayIntentView, QpayStatusSummary } from "./types";

type Executor = Pick<typeof db, "update" | "select" | "insert" | "query" | "execute">;

/** NEXT_PUBLIC_APP_URL — webhook хүрэх нийтийн URL; байхгүй бол null (polling нөөц). */
export function publicAppUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return value && /^https?:\/\//.test(value) ? value : null;
}

/**
 * QPAY_PARTNER_KEY — Partner API-ийн (автомат мерчант бүртгэл, lib/qpay/partner.ts)
 * түлхүүр; байхгүй бол consent / гар зам л. Энд (partner.ts-д биш) — store
 * ↔ partner импортын тойрог үүсгэхгүй.
 */
export function qpayPartnerKey(): string | null {
  const value = process.env.QPAY_PARTNER_KEY?.trim();
  return value && value.length >= 16 ? value : null;
}

export function qpayPartnerConfigured(): boolean {
  return qpayPartnerKey() !== null;
}

export function qpayWebhookUrl(intentId?: string): string | null {
  const base = publicAppUrl();
  if (!base) return null;
  return `${base}${QPAY_WEBHOOK_PATH}${intentId ? `?intent=${encodeURIComponent(intentId)}` : ""}`;
}

/** Тохиргооноос клиентийн config — key тайлагдахгүй / байхгүй бол QpayError. */
export function resolveQpayConfig(settings: PosSettings): QpayClientConfig {
  const apiKey = settings.qpayApiKeyEnc ? decryptSecret(settings.qpayApiKeyEnc) : null;
  if (!apiKey) throw new QpayError(QPAY_ERRORS.notConfigured, "QPay API key тохируулаагүй (Тохиргоо → QPay)");
  return { apiUrl: settings.qpayApiUrl, apiKey };
}

export function resolveQpayWebhookSecret(settings: Pick<PosSettings, "qpayWebhookSecretEnc">): string | null {
  return settings.qpayWebhookSecretEnc ? decryptSecret(settings.qpayWebhookSecretEnc) : null;
}

export async function loadQpayReadiness(
  orgId: string,
  settings: PosSettings,
  options: { seedOnEnable?: boolean } = {}
): Promise<QpayReadiness> {
  const methods = await db.query.posPaymentMethods.findMany({
    where: eq(posPaymentMethods.organizationId, orgId),
    columns: { name: true, kind: true, provider: true, cashAccountId: true, isActive: true },
  });
  return qpayReadiness({
    apiUrl: settings.qpayApiUrl,
    apiKeySet: !!settings.qpayApiKeyEnc,
    webhookSecretSet: !!settings.qpayWebhookSecretEnc,
    publicUrl: publicAppUrl(),
    paymentMethods: methods,
    seedOnEnable: options.seedOnEnable,
  });
}

/**
 * QPay асаахад «QPay» хэлбэр (ewallet, provider qpay) + «QPay түр данс» (банк,
 * GL 11000099)-ыг АВТОМАТААР бүрдүүлнэ — ratified-seed (ensurePosSettings-тэй
 * ижил): байгааг хөндөхгүй, зөвхөн дутууг нэмнэ; идемпотент. Шийдвэр ЦЭВЭР
 * `planQpaySeed` (тесттэй). Буцаах `notes` нь хэрэглэгчид ил (feedback).
 */
export async function ensureQpayPaymentMethod(orgId: string, creatorUserId?: string): Promise<string[]> {
  const [methods, accounts] = await Promise.all([
    db.query.posPaymentMethods.findMany({
      where: eq(posPaymentMethods.organizationId, orgId),
      columns: { id: true, code: true, kind: true, provider: true, cashAccountId: true, isActive: true },
    }),
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.organizationId, orgId),
      columns: { id: true, name: true, accountType: true, currency: true, isActive: true },
    }),
  ]);
  const plan = planQpaySeed({ methods, cashAccounts: accounts });
  if (!plan.createAccount && !plan.createMethod && !plan.updateMethod) return plan.notes;
  const userId = await seedCreatorUserId(orgId, creatorUserId);

  let accountId: string | null = plan.createMethod?.cashAccountId ?? plan.updateMethod?.cashAccountId ?? null;
  if (plan.createAccount) {
    await ensureAccountsExist(orgId, [plan.createAccount.glAccountNumber], async () => userId);
    const [account] = await db
      .insert(cashAccounts)
      .values({
        userId,
        organizationId: orgId,
        name: plan.createAccount.name,
        accountType: "bank",
        bankName: "QPay",
        currency: "MNT",
        glAccountNumber: plan.createAccount.glAccountNumber,
        openingBalance: "0",
      })
      .returning({ id: cashAccounts.id });
    accountId = account.id;
  }
  if (plan.createMethod) {
    const maxSort = methods.length; // сүүлд, харин «Зээлээр» (90)-ээс өмнө
    await db
      .insert(posPaymentMethods)
      .values({
        userId,
        organizationId: orgId,
        code: plan.createMethod.code,
        name: plan.createMethod.name,
        kind: "ewallet",
        provider: QPAY_PROVIDER,
        cashAccountId: accountId,
        currency: "MNT",
        requiresReference: false,
        allowsChange: false,
        allowsRefund: false,
        // eBarimt код ЗОХИОХГҮЙ (plan T1: QPay-ийн албан код ТЕГ-ээс тодорхойгүй) — хэрэглэгч оноож болно.
        ebarimtCode: null,
        sortOrder: Math.min(10 + maxSort, 89),
      })
      .onConflictDoNothing();
  } else if (plan.updateMethod) {
    const patch: Partial<typeof posPaymentMethods.$inferInsert> = {};
    if ("cashAccountId" in plan.updateMethod) patch.cashAccountId = accountId;
    if (plan.updateMethod.isActive) patch.isActive = true;
    if (Object.keys(patch).length > 0)
      await db.update(posPaymentMethods).set(patch).where(and(eq(posPaymentMethods.id, plan.updateMethod.id), eq(posPaymentMethods.organizationId, orgId)));
  }
  return plan.notes;
}

export function toIntentView(row: PosQpayIntent & { sale?: { documentNo: string } | null; cashierName?: string | null }): QpayIntentView {
  const snapshot = row.cartSnapshot as { lines?: unknown[] } | null;
  return {
    id: row.id,
    status: row.status as QpayIntentStatus,
    amount: Number(row.amount),
    qpayInvoiceId: row.qpayInvoiceId,
    qrText: row.qrText,
    qrImage: row.qrImage,
    urls: row.urls ?? [],
    paymentId: row.paymentId,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
    saleId: row.saleId,
    saleDocumentNo: row.sale?.documentNo ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    cashierName: row.cashierName ?? "",
    lineCount: Array.isArray(snapshot?.lines) ? snapshot!.lines!.length : 0,
  };
}

export async function loadIntent(orgId: string, intentId: string): Promise<PosQpayIntent | null> {
  const row = await db.query.posQpayIntents.findFirst({
    where: and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.organizationId, orgId)),
  });
  return row ?? null;
}

export async function loadIntentView(orgId: string, intentId: string): Promise<QpayIntentView | null> {
  const row = await db.query.posQpayIntents.findFirst({
    where: and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.organizationId, orgId)),
    with: { sale: { columns: { documentNo: true } } },
  });
  return row ? toIntentView(row) : null;
}

/** Хугацаа дууссан `open` intent-үүдийг Entry DB-д (сүлжээгүй) expired болгоно. */
export async function expireStaleIntents(orgId: string, now = new Date()): Promise<string[]> {
  const rows = await db
    .update(posQpayIntents)
    .set({ status: "expired", qrImage: null, updatedAt: now })
    .where(and(eq(posQpayIntents.organizationId, orgId), eq(posQpayIntents.status, "open"), lt(posQpayIntents.expiresAt, now)))
    .returning({ id: posQpayIntents.id, qpayInvoiceId: posQpayIntents.qpayInvoiceId });
  return rows.map((row) => row.qpayInvoiceId).filter((id): id is string => !!id);
}

/**
 * Төлөгдсөн гэж тэмдэглэнэ — ИДЕМПОТЕНТ: зөвхөн `open` мөр `paid` болно;
 * аль хэдийн paid/finalized бол `changed: false`. Дүн зөрвөл `failed`
 * (мөнгө орсон ч борлуулалт бүртгэгдэхгүй — гараар шийднэ).
 */
export async function markIntentPaid(
  orgId: string,
  intentId: string,
  paid: { paidAmount: number | null; paymentId: string | null; paidAt: Date | null; source: "webhook" | "check" }
): Promise<{ changed: boolean; status: QpayIntentStatus; reason?: string }> {
  const intent = await loadIntent(orgId, intentId);
  if (!intent) return { changed: false, status: "failed", reason: "intent олдсонгүй" };
  const status = intent.status as QpayIntentStatus;
  if (status !== "open") return { changed: false, status };
  const now = new Date();
  // Dashboard дүнг мэдээлэхгүй байж болно (Quick QR) — null бол PAID статус л дохио.
  if (paid.paidAmount != null && !amountMatches(Number(intent.amount), paid.paidAmount)) {
    await db
      .update(posQpayIntents)
      .set({
        status: "failed",
        lastError: `[${QPAY_ERRORS.amountMismatch}] Төлсөн дүн ${paid.paidAmount} ≠ ${Number(intent.amount)}`,
        paidAmount: String(paid.paidAmount),
        paymentId: paid.paymentId,
        updatedAt: now,
      })
      .where(and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.status, "open")));
    return { changed: true, status: "failed", reason: "дүн зөрсөн" };
  }
  const rows = await db
    .update(posQpayIntents)
    .set({
      status: "paid",
      paidAmount: paid.paidAmount == null ? String(Number(intent.amount)) : String(paid.paidAmount),
      paymentId: paid.paymentId,
      paidAt: paid.paidAt ?? now,
      lastError: null,
      updatedAt: now,
    })
    .where(and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.status, "open")))
    .returning({ id: posQpayIntents.id });
  return { changed: rows.length > 0, status: rows.length > 0 ? "paid" : ((await loadIntent(orgId, intentId))?.status as QpayIntentStatus) };
}

/**
 * Транзакц ДОТОР `paid` → `finalized` + saleId — createPosSale-тай нэг commit.
 * 0 мөр = аль хэдийн finalize хийгдсэн / төлөгдөөгүй → ШИДНЭ (давхар борлуулалт үгүй).
 */
export async function finalizeIntentInTx(tx: Executor, orgId: string, intentId: string, saleId: string): Promise<void> {
  const rows = await tx
    .update(posQpayIntents)
    .set({ status: "finalized", saleId, qrImage: null, updatedAt: new Date() })
    .where(
      and(
        eq(posQpayIntents.id, intentId),
        eq(posQpayIntents.organizationId, orgId),
        eq(posQpayIntents.status, "paid"),
        isNull(posQpayIntents.saleId)
      )
    )
    .returning({ id: posQpayIntents.id });
  if (rows.length === 0)
    throw new QpayError(QPAY_ERRORS.alreadyFinalized, "QPay төлбөр аль хэдийн борлуулалтад холбогдсон эсвэл төлөгдөөгүй");
}

export async function setIntentStatus(
  orgId: string,
  intentId: string,
  to: QpayIntentStatus,
  patch: Partial<Pick<PosQpayIntent, "lastError" | "qpayInvoiceId" | "qrText" | "qrImage" | "urls" | "lastCheckAt">> = {}
): Promise<PosQpayIntent | null> {
  const intent = await loadIntent(orgId, intentId);
  if (!intent) return null;
  const from = intent.status as QpayIntentStatus;
  if (from !== to && !canTransition(from, to)) return intent;
  const [row] = await db
    .update(posQpayIntents)
    .set({ status: to, ...patch, ...(to !== "open" && to !== "paid" ? { qrImage: null } : {}), updatedAt: new Date() })
    .where(and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.organizationId, orgId)))
    .returning();
  return row ?? intent;
}

/** Төлөгдсөн ч бүртгэгдээгүй + нээлттэй intent-үүд (жагсаалтын «QPay хүлээгдэж буй»). */
export async function listPendingIntents(orgId: string): Promise<QpayIntentView[]> {
  await expireStaleIntents(orgId);
  const rows = await db.query.posQpayIntents.findMany({
    where: and(eq(posQpayIntents.organizationId, orgId), sql`${posQpayIntents.status} in ('open', 'paid', 'failed')`),
    orderBy: [desc(posQpayIntents.createdAt)],
    limit: 100,
  });
  const cashierIds = [...new Set(rows.map((row) => row.cashierUserId).filter((id): id is string => !!id))];
  const cashiers = cashierIds.length
    ? await db.query.users.findMany({ where: sql`${users.id} in ${cashierIds}`, columns: { id: true, name: true } })
    : [];
  const nameOf = new Map(cashiers.map((user) => [user.id, user.name ?? ""]));
  return rows.map((row) => toIntentView({ ...row, cashierName: row.cashierUserId ? nameOf.get(row.cashierUserId) ?? "" : "" }));
}

export async function qpayStatusSummary(orgId: string, settings: PosSettings, todayUb: string): Promise<QpayStatusSummary> {
  // Raw `sql` template-д Date объект ШУУД параметр болохгүй (postgres драйвер
  // string/Buffer шаардана) — ISO текст + ::timestamptz. tests/sql-date-params.test.ts
  const cutoff = new Date(Date.now() - QPAY_PAID_UNFINALIZED_MINUTES * 60_000);
  const [counts] = await db
    .select({
      open: sql<number>`count(*) filter (where ${posQpayIntents.status} = 'open')`,
      paidUnfinalized: sql<number>`count(*) filter (where ${posQpayIntents.status} = 'paid' and ${posQpayIntents.saleId} is null and ${posQpayIntents.paidAt} < ${cutoff.toISOString()}::timestamptz)`,
    })
    .from(posQpayIntents)
    .where(eq(posQpayIntents.organizationId, orgId));
  const [finalized] = await db
    .select({ n: sql<number>`count(*)` })
    .from(posQpayIntents)
    .innerJoin(posSales, eq(posSales.id, posQpayIntents.saleId))
    .where(and(eq(posQpayIntents.organizationId, orgId), eq(posQpayIntents.status, "finalized"), gte(posSales.date, todayUb)));
  return {
    enabled: settings.qpayEnabled,
    configured: !!settings.qpayApiKeyEnc && !!settings.qpayWebhookSecretEnc,
    apiUrl: settings.qpayApiUrl,
    merchantId: settings.qpayMerchantId,
    webhookUrl: qpayWebhookUrl(),
    invoiceTtlSec: clampInvoiceTtl(settings.qpayInvoiceTtlSec),
    partnerConfigured: qpayPartnerConfigured(),
    provisionedAt: settings.qpayProvisionedAt ? settings.qpayProvisionedAt.toISOString() : null,
    openIntents: Number(counts?.open ?? 0),
    paidUnfinalized: Number(counts?.paidUnfinalized ?? 0),
    finalizedToday: Number(finalized?.n ?? 0),
  };
}

/** `/api/health` + attention — байгууллага тус бүрийн `paid`-boловч-бүртгэгдээгүй тоо. */
export async function countPaidUnfinalized(orgId: string, olderThanMinutes = QPAY_PAID_UNFINALIZED_MINUTES): Promise<{ count: number; oldestMinutes: number | null }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const [row] = await db
    .select({
      n: sql<number>`count(*)`,
      oldest: sql<Date | null>`min(${posQpayIntents.paidAt})`,
    })
    .from(posQpayIntents)
    .where(
      and(
        eq(posQpayIntents.organizationId, orgId),
        eq(posQpayIntents.status, "paid"),
        isNull(posQpayIntents.saleId),
        lt(posQpayIntents.paidAt, cutoff)
      )
    );
  const oldest = row?.oldest ? new Date(row.oldest) : null;
  return {
    count: Number(row?.n ?? 0),
    oldestMinutes: oldest ? Math.floor((Date.now() - oldest.getTime()) / 60_000) : null,
  };
}


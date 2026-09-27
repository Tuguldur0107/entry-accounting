// Авлагын нэхэмжлэхийг QPay-ээр төлөх — харилцагч нэхэмжлэхийн НЭЭЛТТЭЙ линк
// (`/invoice/[token]`) дээр «QPay-ээр төлөх» дарахад нээлттэй үлдэгдлээр QR
// үүснэ (product owner 2026-09-27: шимтгэлийг байгууллага даана, зөвхөн бүтэн
// үлдэгдлээр). POS-ийн intent машин (pos_qpay_intents, purpose = "arap"),
// webhook, хоцорсон төлбөр, «Буцаах» бүгд НЭГ зам.
//
// Төлөгдмөгц ХҮН хүлээхгүй (сагс байхгүй — нэхэмжлэх аль хэдийн батлагдсан):
// орлогын кассын баримт Дт QPay түр данс / Кт Авлага (`externalRef
// qpay-arap:<intent>` — давтан webhook идемпотент). Бүртгэж чадахгүй бол
// (харилцагч өөр замаар аль хэдийн төлсөн г.м.) intent `paid` + шалтгаан хэвээр
// → баннер + attention мэдэгдэл → «Буцаах» / «Бүртгэх». Мөнгө ЧИМЭЭГҮЙ үлдэхгүй.

import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";

import { createCashDocument } from "@/lib/actions/cash";
import { logAuditEvent } from "@/lib/audit";
import { runAsOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { arApDocuments, arApInvoiceSends, cashDocuments, memberships, posQpayIntents } from "@/lib/db/schema";
import { parseSegParts } from "@/lib/grid/segments";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { ulaanbaatarNow } from "@/lib/pos/sale-math";

import { cancelDashboardInvoice, checkDashboardPayment, createDashboardInvoice } from "./client";
import type { InvoiceQpayView } from "./arap-types";
import { QPAY_ERRORS, QPAY_INVOICE_TTL_MAX_SEC, type QpayIntentStatus } from "./constants";
import { checkAllowed, invoiceAmountOf, isExpired } from "./intent";
import { withQpayKeyRecovery } from "./partner";
import { loadQpayClearingAccount } from "./refund";
import { expireStaleIntents, loadQpayReadiness, markIntentPaid, qpayWebhookUrl } from "./store";

export const QPAY_ARAP_PURPOSE = "arap";
/** Нэг нэхэмжлэхэд цагт үүсгэх шинэ QR-ын дээд тоо (нээлттэй хуудас — хуурамч дуудлагаас). */
export const ARAP_QPAY_MAX_PER_HOUR = 10;

const fmt = (value: number) => value.toLocaleString("en-US");

export type { InvoiceQpayView } from "./arap-types";

/** Нээлттэй линкийн токеноос идэвхтэй send + нэхэмжлэх. Хүчингүй бол алдаа. */
async function loadSendDocument(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Линк буруу");
  const send = await db.query.arApInvoiceSends.findFirst({
    where: and(eq(arApInvoiceSends.token, token), isNull(arApInvoiceSends.revokedAt)),
  });
  if (!send) throw new Error("Линк хүчингүй болсон");
  if (send.expiresAt && send.expiresAt.getTime() < Date.now()) throw new Error("Линкний хугацаа дууссан");
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, send.documentId), eq(arApDocuments.organizationId, send.organizationId)),
  });
  if (!document) throw new Error("Нэхэмжлэх олдсонгүй");
  return { send, document };
}

/** Байгууллагын эзэн — webhook / нээлттэй хуудас сессгүй тул бичилтийг эзний нэрээр. */
async function systemActor(orgId: string): Promise<string> {
  const owner = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")),
    orderBy: [asc(memberships.createdAt)],
    columns: { userId: true },
  });
  if (!owner) throw new Error("Байгууллагын эзэн олдсонгүй");
  return owner.userId;
}

const openBalanceOf = (document: typeof arApDocuments.$inferSelect) =>
  Math.round((Number(document.totalAmount) - Number(document.paidAmount)) * 100) / 100;

/** Нэхэмжлэх QPay-ээр төлөгдөх боломжтой эсэх — нээлттэй хуудас товчоо харуулах эсэхэд. */
export async function invoiceQpayAvailable(orgId: string, document: typeof arApDocuments.$inferSelect): Promise<boolean> {
  if (document.documentType !== "ar_invoice" || document.currency !== "MNT") return false;
  if (!["posted", "partially_paid"].includes(document.status) || !invoiceAmountOf(openBalanceOf(document))) return false;
  const settings = await ensurePosSettings(orgId);
  if (!settings.qpayEnabled) return false;
  return (await loadQpayReadiness(orgId, settings)).ready;
}

function toView(row: typeof posQpayIntents.$inferSelect): InvoiceQpayView {
  return {
    intentId: row.id,
    status: row.status as QpayIntentStatus,
    amount: Number(row.amount),
    qrText: row.qrText,
    qrImage: row.qrImage,
    urls: row.urls ?? [],
    expiresAt: row.expiresAt.toISOString(),
    paid: row.status === "paid" || row.status === "finalized",
  };
}

/**
 * «QPay-ээр төлөх» — нээлттэй үлдэгдлээр QR. Хугацаа нь дуусаагүй, дүн нь
 * тохирох QR байвал ДАХИН ашиглана (шинэ нэхэмжлэх үүсгэхгүй); цагт
 * ARAP_QPAY_MAX_PER_HOUR-аас их шинэ QR үүсгэхгүй.
 */
export async function startInvoiceQpay(token: string): Promise<InvoiceQpayView> {
  const { send, document } = await loadSendDocument(token);
  const orgId = send.organizationId;
  if (document.documentType !== "ar_invoice") throw new Error("Зөвхөн авлагын нэхэмжлэхийг QPay-ээр төлнө");
  if (document.currency !== "MNT") throw new Error("QPay зөвхөн ₮-өөр — валютын нэхэмжлэхийг дансаар төлнө үү");
  if (!["posted", "partially_paid"].includes(document.status)) throw new Error("Нэхэмжлэх бүрэн төлөгдсөн байна");
  const amount = invoiceAmountOf(openBalanceOf(document));
  if (!amount) throw new Error("Төлөх үлдэгдэл алга");

  const settings = await ensurePosSettings(orgId);
  if (!settings.qpayEnabled || !(await loadQpayReadiness(orgId, settings)).ready)
    throw new Error("Энэ байгууллага QPay-ээр төлбөр хүлээн авдаггүй — дансаар шилжүүлнэ үү");

  await expireStaleIntents(orgId);
  const recent = await db.query.posQpayIntents.findMany({
    where: and(
      eq(posQpayIntents.organizationId, orgId),
      eq(posQpayIntents.arApDocumentId, document.id),
      gte(posQpayIntents.createdAt, new Date(Date.now() - 60 * 60_000))
    ),
    orderBy: [desc(posQpayIntents.createdAt)],
  });
  const reusable = recent.find(
    (row) => row.status === "open" && row.qpayInvoiceId && Number(row.amount) === amount && !isExpired({ status: "open", expiresAt: row.expiresAt }, new Date())
  );
  if (reusable) return toView(reusable);
  const paidPending = recent.find((row) => row.status === "paid");
  if (paidPending) return toView(paidPending);
  if (recent.length >= ARAP_QPAY_MAX_PER_HOUR) throw new Error("Хэт олон оролдлого — түр хүлээгээд дахин оролдоно уу");

  const actor = await systemActor(orgId);
  const now = new Date();
  const [row] = await db
    .insert(posQpayIntents)
    .values({
      organizationId: orgId,
      purpose: QPAY_ARAP_PURPOSE,
      arApDocumentId: document.id,
      cashierUserId: null,
      amount: String(amount),
      cartSnapshot: { arApDocumentId: document.id, documentNo: document.documentNo },
      status: "open",
      expiresAt: new Date(now.getTime() + QPAY_INVOICE_TTL_MAX_SEC * 1000),
    })
    .returning();
  try {
    const invoice = await withQpayKeyRecovery(orgId, settings, actor, (config) =>
      createDashboardInvoice(config, {
        senderInvoiceNo: row.id,
        amount,
        description: `${document.documentNo} нэхэмжлэх`,
        callbackUrl: qpayWebhookUrl(row.id),
      })
    );
    const [updated] = await db
      .update(posQpayIntents)
      .set({
        qpayInvoiceId: invoice.invoiceId,
        qrText: invoice.qrText || null,
        qrImage: invoice.qrImage,
        urls: invoice.urls,
        updatedAt: new Date(),
      })
      .where(eq(posQpayIntents.id, row.id))
      .returning();
    await logAuditEvent({
      userId: actor,
      organizationId: orgId,
      action: "create",
      entityType: "pos_qpay_intent",
      entityId: row.id,
      summary: `Нэхэмжлэхийн QPay QR ${invoice.invoiceId} — ${document.documentNo}, ${fmt(amount)}₮ (нээлттэй линк)`,
    });
    return toView(updated ?? row);
  } catch (error) {
    await db
      .update(posQpayIntents)
      .set({ status: "failed", lastError: error instanceof Error ? error.message : "dashboard", updatedAt: new Date() })
      .where(eq(posQpayIntents.id, row.id));
    throw new Error("QPay QR үүссэнгүй — түр хүлээгээд дахин оролдоно уу эсвэл дансаар шилжүүлнэ үү");
  }
}

/**
 * Нээлттэй хуудасны төлөв — Entry DB-ээс (QPay-г polling ХИЙХГҮЙ). `check`
 * бол [Шалгах] — dashboard payments/check ≤ 1/10 сек (POS-той ижил хязгаар).
 */
export async function invoiceQpayStatus(token: string, intentId: string, check = false): Promise<InvoiceQpayView> {
  const { send, document } = await loadSendDocument(token);
  const orgId = send.organizationId;
  let row = await db.query.posQpayIntents.findFirst({
    where: and(
      eq(posQpayIntents.id, intentId),
      eq(posQpayIntents.organizationId, orgId),
      eq(posQpayIntents.arApDocumentId, document.id)
    ),
  });
  if (!row) throw new Error("QPay төлбөр олдсонгүй");
  const now = new Date();
  if (check && row.status === "open" && row.qpayInvoiceId && checkAllowed(row.lastCheckAt, now)) {
    await db.update(posQpayIntents).set({ lastCheckAt: now }).where(eq(posQpayIntents.id, row.id));
    const settings = await ensurePosSettings(orgId);
    const actor = await systemActor(orgId);
    const invoiceId = row.qpayInvoiceId;
    const result = await withQpayKeyRecovery(orgId, settings, actor, (config) => checkDashboardPayment(config, invoiceId));
    if (result.paid) {
      const marked = await markIntentPaid(orgId, row.id, { paidAmount: result.paidAmount, paymentId: null, paidAt: now, source: "check" });
      if (marked.changed && marked.status === "paid") await settleArapIntent(orgId, row.id);
    }
  } else if (row.status === "open" && isExpired({ status: "open", expiresAt: row.expiresAt }, now)) {
    const invoiceIds = await expireStaleIntents(orgId);
    if (invoiceIds.length > 0) {
      const settings = await ensurePosSettings(orgId);
      const actor = await systemActor(orgId);
      for (const invoiceId of invoiceIds)
        await withQpayKeyRecovery(orgId, settings, actor, (config) => cancelDashboardInvoice(config, invoiceId)).catch(() => undefined);
    }
  }
  row = (await db.query.posQpayIntents.findFirst({ where: eq(posQpayIntents.id, intentId) })) ?? row;
  return toView(row);
}

/**
 * Төлөгдсөн нэхэмжлэхийн intent → орлогын кассын баримт (Дт QPay түр данс /
 * Кт Авлага), батлагдсан. Шидэхгүй — бүртгэж чадаагүй бол `paid` + шалтгаан
 * (баннер / мэдэгдэл) хэвээр үлдэж, буцаах эсвэл дахин «Бүртгэх»-ээр шийднэ.
 */
export async function settleArapIntent(orgId: string, intentId: string): Promise<{ ok: boolean; reason?: string }> {
  const intent = await db.query.posQpayIntents.findFirst({
    where: and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.organizationId, orgId)),
  });
  if (!intent || intent.purpose !== QPAY_ARAP_PURPOSE) return { ok: false, reason: "нэхэмжлэхийн QPay биш" };
  if (intent.status !== "paid" || intent.cashDocumentId) return { ok: intent.status === "finalized" };
  const fail = async (reason: string) => {
    // Зөвхөн paid хэвээр бол — зэрэгцээ ажил аль хэдийн finalized болгосон бол алдаа наахгүй.
    await db
      .update(posQpayIntents)
      .set({ lastError: reason, updatedAt: new Date() })
      .where(and(eq(posQpayIntents.id, intent.id), eq(posQpayIntents.status, "paid")));
    return { ok: false, reason };
  };
  try {
    // Webhook + [Шалгах] зэрэг ирвэл хоёр дахь нь externalRef-ийн unique
    // index-т мөргөлдөнө — өмнө үүссэн баримтыг л холбоно (давхар орлого үгүй).
    const externalRef = `qpay-arap:${intent.id}`;
    const linkExisting = async () => {
      const existing = await db.query.cashDocuments.findFirst({
        where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.externalRef, externalRef)),
        columns: { id: true, status: true, documentNo: true },
      });
      if (!existing) return null;
      if (existing.status !== "posted")
        return await fail(`Орлогын баримт ${existing.documentNo} батлагдаагүй — Мөнгөн хөрөнгөөс батална уу`);
      await db
        .update(posQpayIntents)
        .set({ status: "finalized", cashDocumentId: existing.id, lastError: null, qrImage: null, updatedAt: new Date() })
        .where(and(eq(posQpayIntents.id, intent.id), eq(posQpayIntents.status, "paid")));
      return { ok: true };
    };
    const linked = await linkExisting();
    if (linked) return linked;
    const document = intent.arApDocumentId
      ? await db.query.arApDocuments.findFirst({
          where: and(eq(arApDocuments.id, intent.arApDocumentId), eq(arApDocuments.organizationId, orgId)),
        })
      : null;
    if (!document) return await fail(`[${QPAY_ERRORS.intentRequired}] Нэхэмжлэх олдсонгүй — «Буцаах»-аар шийднэ үү`);
    const paid = Number(intent.paidAmount ?? intent.amount);
    const balance = openBalanceOf(document);
    // Зөвхөн нээлттэй үлдэгдэл хүртэл (≤ 1₮ бөөрөнхийллийн зөрүү) — илүү бол
    // харилцагч өөр замаар аль хэдийн төлсөн: давхар бүртгэхгүй, буцаана.
    if (!["posted", "partially_paid"].includes(document.status) || paid > balance + 1)
      return await fail(
        `[QPAY_ARAP_OVERPAID] ${document.documentNo}-ийн үлдэгдэл ${fmt(balance)}₮ < QPay ${fmt(paid)}₮ — харилцагч өөр замаар төлсөн байж болзошгүй; «Буцаах»-аар шийднэ үү`
      );
    const clearing = await loadQpayClearingAccount(orgId);
    const actor = await systemActor(orgId);
    const amount = Math.min(paid, balance);
    const result = await runAsOrg({ userId: actor, orgId }, () =>
      createCashDocument({
        documentType: "receipt",
        date: ulaanbaatarNow().date,
        toCashAccountId: clearing.id,
        counterAccountNumber: parseSegParts(document.controlAccountNumber, [3])[3] ?? document.controlAccountNumber,
        description: `${document.documentNo} QPay төлөлт (нэхэмжлэхийн линк)`,
        amount,
        arApDocumentId: document.id,
        postNow: true,
        externalRef,
      })
    );
    if (result.error || !result.id) return (await linkExisting()) ?? (await fail(`Орлогын баримт бүртгэгдсэнгүй: ${result.error ?? "тодорхойгүй"}`));
    await db
      .update(posQpayIntents)
      .set({ status: "finalized", cashDocumentId: result.id, lastError: null, qrImage: null, updatedAt: new Date() })
      .where(and(eq(posQpayIntents.id, intent.id), eq(posQpayIntents.status, "paid")));
    await logAuditEvent({
      userId: actor,
      organizationId: orgId,
      action: "finalize",
      entityType: "pos_qpay_intent",
      entityId: intent.id,
      summary: `Нэхэмжлэх ${document.documentNo} QPay-ээр төлөгдлөө — ${fmt(amount)}₮`,
    });
    return { ok: true };
  } catch (error) {
    return await fail(error instanceof Error ? error.message : "Орлогын баримт бүртгэгдсэнгүй");
  }
}

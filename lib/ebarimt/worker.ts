// eBarimt worker — server горимд PosAPI руу илгээнэ (ticker / cron route / gar).
// Идемпотент: submission нэг л удаа sent болно; олон instance зэрэг ажиллахад
// нэг мөрийг хоёр удаа илгээхээс `pending → claimed` шилжилтээр хамгаална.
// docs/pos/03-ebarimt-integration-plan.md §4.4.

import { and, eq, sql } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { posEbarimtSubmissions, posSales, posSettings } from "@/lib/db/schema";

import { posApiDeleteReceipt, posApiPutReceipt, posApiSendData } from "./client";
import { EBARIMT_ALERT_AFTER_ATTEMPTS, EBARIMT_MAX_ATTEMPTS } from "./constants";
import { claimDueSubmissions, markFailed, markSent, prepareSubmission, type PreparedSubmission } from "./queue";
import { EbarimtError, receiptResponseOutcome } from "./receipt";
import type { EbarimtReceiptResponse } from "./types";
import { isOrgVatPayer } from "@/lib/vat/settings";

export interface EbarimtWorkerResult {
  claimed: number;
  sent: number;
  failed: number;
  errors: { submissionId: string; error: string }[];
}

let running = false;

/** Нэг мөрийг атомаар «claimed» болгоно — өөр instance авчихсан бол false. */
async function claim(submissionId: string): Promise<boolean> {
  const [row] = await db
    .update(posEbarimtSubmissions)
    .set({ status: "claimed", updatedAt: new Date() })
    .where(and(eq(posEbarimtSubmissions.id, submissionId), eq(posEbarimtSubmissions.status, "pending")))
    .returning({ id: posEbarimtSubmissions.id });
  return !!row;
}

async function release(submissionId: string): Promise<void> {
  await db
    .update(posEbarimtSubmissions)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(posEbarimtSubmissions.id, submissionId), eq(posEbarimtSubmissions.status, "claimed")));
}

export function resultOf(response: EbarimtReceiptResponse, type: string | null) {
  return {
    id: typeof response.id === "string" ? response.id : null,
    lottery: typeof response.lottery === "string" ? response.lottery : null,
    qrData: typeof response.qrData === "string" ? response.qrData : null,
    date: typeof response.date === "string" ? response.date : null,
    type,
  };
}

/** Бэлтгэсэн submission-ийг PosAPI-д илгээж үр дүнг бичнэ (server + browser хоёуланд нийтлэг). */
export async function applyPosApiResponse(
  prepared: Pick<PreparedSubmission, "id" | "saleId" | "kind" | "request">,
  response: EbarimtReceiptResponse,
  stage: "send" | "cancel"
): Promise<{ ok: boolean; attempts: number }> {
  const raw = response as Record<string, unknown>;
  if (stage === "cancel") {
    const status = typeof response.status === "string" ? response.status.toUpperCase() : "";
    const ok = status !== "ERROR" && (raw.httpStatus == null || Number(raw.httpStatus) < 400);
    if (!ok) {
      const attempts = await markFailed(prepared.id, prepared.saleId, new EbarimtError("EBARIMT_REJECTED", response.message ?? "Цуцлах хүсэлт татгалзагдав"), { response: raw, maxAttempts: EBARIMT_MAX_ATTEMPTS });
      return { ok: false, attempts };
    }
    if (!prepared.request) {
      await markSent(prepared.id, prepared.saleId, "cancel", raw, { id: null, lottery: null, qrData: null, date: null, type: null });
      return { ok: true, attempts: 0 };
    }
    return { ok: true, attempts: 0 };
  }
  const outcome = receiptResponseOutcome(response);
  if (!outcome.ok) {
    const attempts = await markFailed(prepared.id, prepared.saleId, new EbarimtError("EBARIMT_REJECTED", outcome.message), { response: raw, maxAttempts: EBARIMT_MAX_ATTEMPTS });
    return { ok: false, attempts };
  }
  await markSent(prepared.id, prepared.saleId, prepared.kind, raw, resultOf(response, prepared.request?.type ?? null));
  return { ok: true, attempts: 0 };
}

async function alertIfNeeded(orgId: string, saleId: string, attempts: number, error: string): Promise<void> {
  if (attempts !== EBARIMT_ALERT_AFTER_ATTEMPTS) return;
  const sale = await db.query.posSales.findFirst({ where: eq(posSales.id, saleId), columns: { userId: true, documentNo: true } });
  if (!sale) return;
  // Аудит → мэдэгдлийн гүүр (lib/notifications/rules.ts: pos_sale × ebarimt_failed).
  await logAuditEvent({
    userId: sale.userId,
    organizationId: orgId,
    action: "ebarimt_failed",
    entityType: "pos_sale",
    entityId: saleId,
    summary: `eBarimt илгээлт ${attempts} удаа амжилтгүй — ${sale.documentNo}: ${error.slice(0, 300)}`,
  });
}

/** Нэг submission-ийг бүрэн боловсруулна (claim → prepare → PosAPI → бичих). */
export async function processSubmission(
  submission: typeof posEbarimtSubmissions.$inferSelect,
  settingsRow: typeof posSettings.$inferSelect
): Promise<"sent" | "failed" | "skipped"> {
  if (!(await claim(submission.id))) return "skipped";
  const prepared = await prepareSubmission(submission, settingsRow);
  if (!prepared) {
    // prepare нь хоёр шалтгаанаар null өгдөг: (а) аль хэдийн илгээгдсэн
    // (давхар enqueue — PosAPI дуудалгүй sent болгосон), (б) payload үүсэхгүй
    // ([EBARIMT_*] → failed). Тоолуурт эдгээрийг ЯЛГАНА.
    const after = await db.query.posEbarimtSubmissions.findFirst({
      where: eq(posEbarimtSubmissions.id, submission.id),
      columns: { status: true },
    });
    return after?.status === "sent" ? "skipped" : "failed";
  }
  try {
    if (prepared.cancel) {
      const cancelResponse = await posApiDeleteReceipt(prepared.settings.posApiUrl, prepared.cancel);
      const cancelResult = await applyPosApiResponse(prepared, cancelResponse, "cancel");
      if (!cancelResult.ok) {
        await alertIfNeeded(prepared.orgId, prepared.saleId, cancelResult.attempts, String(cancelResponse.message ?? ""));
        return "failed";
      }
      if (!prepared.request) return "sent";
    }
    const response = await posApiPutReceipt(prepared.settings.posApiUrl, prepared.request!);
    const result = await applyPosApiResponse(prepared, response, "send");
    if (!result.ok) {
      await alertIfNeeded(prepared.orgId, prepared.saleId, result.attempts, String(response.message ?? ""));
      return "failed";
    }
    return "sent";
  } catch (error) {
    // Сүлжээ / timeout — дахин оролдоно (backoff).
    const attempts = await markFailed(prepared.id, prepared.saleId, error, { maxAttempts: EBARIMT_MAX_ATTEMPTS });
    await alertIfNeeded(prepared.orgId, prepared.saleId, attempts, error instanceof Error ? error.message : String(error));
    return "failed";
  }
}

/** Хугацаа нь болсон бүх pending мөрийг илгээнэ. Хэзээ ч шидэхгүй. */
export async function processPendingEbarimt(limit = 50): Promise<EbarimtWorkerResult> {
  const result: EbarimtWorkerResult = { claimed: 0, sent: 0, failed: 0, errors: [] };
  if (running) return result;
  running = true;
  try {
    const due = await claimDueSubmissions(limit);
    for (const { submission, settings } of due) {
      result.claimed += 1;
      try {
        const outcome = await processSubmission(submission, settings);
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "failed") result.failed += 1;
      } catch (error) {
        result.errors.push({ submissionId: submission.id, error: error instanceof Error ? error.message : String(error) });
        await release(submission.id).catch(() => undefined);
      }
    }
  } catch (error) {
    result.errors.push({ submissionId: "", error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
  return result;
}

/** Өдөр бүр — PosAPI-ийн дотоод санд үлдсэнийг ТЕГ рүү түлхүүлнэ (server горим). */
export async function runEbarimtSendData(): Promise<{ organizations: number; errors: string[] }> {
  const enabledOrgs = await db.query.posSettings.findMany({
    where: and(eq(posSettings.ebarimtEnabled, true), eq(posSettings.ebarimtMode, "server")),
  });
  // НӨАТ төлөгч бус болсон байгууллагыг ТЕГ рүү sendData-аас ХАСНА.
  const orgs: typeof enabledOrgs = [];
  for (const org of enabledOrgs)
    if (await isOrgVatPayer(org.organizationId)) orgs.push(org);
  const errors: string[] = [];
  for (const org of orgs) {
    try {
      await posApiSendData(org.ebarimtPosApiUrl);
    } catch (error) {
      errors.push(`${org.organizationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { organizations: orgs.length, errors };
}

/** Claimed-аар гацсан (instance унасан) мөрүүдийг 10 минутын дараа буцааж pending болгоно. */
export async function releaseStaleClaims(): Promise<number> {
  const rows = await db
    .update(posEbarimtSubmissions)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(posEbarimtSubmissions.status, "claimed"), sql`${posEbarimtSubmissions.updatedAt} < now() - interval '10 minutes'`))
    .returning({ id: posEbarimtSubmissions.id });
  return rows.length;
}

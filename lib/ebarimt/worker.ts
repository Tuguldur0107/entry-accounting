// eBarimt worker — server горимд PosAPI руу илгээнэ (ticker / cron route / gar).
// Идемпотент: submission нэг л удаа sent болно; олон instance зэрэг ажиллахад
// нэг мөрийг хоёр удаа илгээхээс `pending → claimed` шилжилтээр хамгаална.
// docs/pos/03-ebarimt-integration-plan.md §4.4.

import { and, eq, sql } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { posEbarimtSubmissions, posSales, posSettings } from "@/lib/db/schema";

import { posApiDeleteReceipt, posApiPutReceipt, posApiSendData } from "./client";
import { EBARIMT_ALERT_AFTER_ATTEMPTS, EBARIMT_ERRORS, EBARIMT_MAX_ATTEMPTS } from "./constants";
import { claimDueSubmissions, markFailed, markSent, prepareSubmission, type PreparedSubmission } from "./queue";
import { EbarimtError, receiptResponseOutcome } from "./receipt";
import type { EbarimtReceiptResponse, EbarimtSaleResult } from "./types";

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

/**
 * PosAPI-ийн хариу → ТҮР үр дүн (баримтыг НЭГ удаа хэвлэхэд). Сугалаа/QR энд л
 * амьдарна — DB-д бичигдэхгүй (markSent stripReceiptSecrets).
 */
export function resultOf(response: EbarimtReceiptResponse, type: string | null): EbarimtSaleResult {
  return {
    ebarimtId: typeof response.id === "string" ? response.id : null,
    ebarimtLottery: typeof response.lottery === "string" ? response.lottery : null,
    ebarimtQrData: typeof response.qrData === "string" ? response.qrData : null,
    ebarimtDate: typeof response.date === "string" ? response.date : null,
    ebarimtType: type as EbarimtSaleResult["ebarimtType"],
    ebarimtStatus: "sent",
  };
}

export interface ApplyResult {
  ok: boolean;
  attempts: number;
  /** Амжилттай илгээлтийн түр үр дүн (цуцлалтад null). */
  result: EbarimtSaleResult | null;
}

/** Бэлтгэсэн submission-ийг PosAPI-д илгээж үр дүнг бичнэ (server + browser хоёуланд нийтлэг). */
export async function applyPosApiResponse(
  prepared: Pick<PreparedSubmission, "id" | "saleId" | "kind" | "request">,
  response: EbarimtReceiptResponse,
  stage: "send" | "cancel"
): Promise<ApplyResult> {
  const raw = response as Record<string, unknown>;
  if (stage === "cancel") {
    const status = typeof response.status === "string" ? response.status.toUpperCase() : "";
    const ok = status !== "ERROR" && (raw.httpStatus == null || Number(raw.httpStatus) < 400);
    if (!ok) {
      const attempts = await markFailed(prepared.id, prepared.saleId, new EbarimtError(
          "EBARIMT_REJECTED",
          `${response.message ?? "Цуцлах хүсэлт татгалзагдав"} — ТЕГ: DELETE зөвхөн B2C_RECEIPT, иргэн баталгаажуулаагүй баримтад; баталгаажсан бол иргэн Ebarimt апп-аас зөвшөөрөх хүртэл «Баталгаажаагүй буцаалт»; B2B/нэхэмжлэх бол ТЕГ-тэй тохирно (docs/integrations/01 P1-3)`
        ), { response: raw, maxAttempts: EBARIMT_MAX_ATTEMPTS });
      return { ok: false, attempts, result: null };
    }
    await markSent(prepared.id, prepared.saleId, "cancel", raw, { id: null, date: null, type: null });
    return { ok: true, attempts: 0, result: null };
  }
  const outcome = receiptResponseOutcome(response);
  if (!outcome.ok) {
    const attempts = await markFailed(prepared.id, prepared.saleId, new EbarimtError("EBARIMT_REJECTED", outcome.message), { response: raw, maxAttempts: EBARIMT_MAX_ATTEMPTS });
    return { ok: false, attempts, result: null };
  }
  const result = resultOf(response, prepared.request?.type ?? null);
  await markSent(prepared.id, prepared.saleId, prepared.kind, raw, {
    id: result.ebarimtId,
    date: result.ebarimtDate,
    type: result.ebarimtType,
  });
  return { ok: true, attempts: 0, result };
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

export interface ProcessOutcome {
  outcome: "sent" | "failed" | "skipped";
  /** Амжилттай илгээлтийн түр үр дүн — зөвхөн дуудагч хэвлэхэд, DB-д ҮГҮЙ. */
  result: EbarimtSaleResult | null;
}

/** Нэг submission-ийг бүрэн боловсруулна (claim → prepare → PosAPI → бичих). */
export async function processSubmission(
  submission: typeof posEbarimtSubmissions.$inferSelect,
  settingsRow: typeof posSettings.$inferSelect
): Promise<ProcessOutcome> {
  if (!(await claim(submission.id))) return { outcome: "skipped", result: null };
  const prepared = await prepareSubmission(submission, settingsRow);
  if (!prepared) {
    // prepare нь хоёр шалтгаанаар null өгдөг: (а) PosAPI дуудалгүй хаасан
    // (давхар enqueue, бүгд буцаагдсан, эх нь илгээгдээгүй — sent), (б) payload
    // үүсэхгүй ([EBARIMT_*] → failed). Тоолуурт эдгээрийг ЯЛГАНА.
    const after = await db.query.posEbarimtSubmissions.findFirst({
      where: eq(posEbarimtSubmissions.id, submission.id),
      columns: { status: true },
    });
    return { outcome: after?.status === "sent" ? "skipped" : "failed", result: null };
  }
  try {
    if (prepared.cancel) {
      // Бүтэн буцаалт — DELETE (§6). request ХЭЗЭЭ Ч зэрэг байхгүй.
      const cancelResponse = await posApiDeleteReceipt(prepared.settings.posApiUrl, prepared.cancel);
      const cancelResult = await applyPosApiResponse(prepared, cancelResponse, "cancel");
      if (!cancelResult.ok) {
        await alertIfNeeded(prepared.orgId, prepared.saleId, cancelResult.attempts, String(cancelResponse.message ?? ""));
        return { outcome: "failed", result: null };
      }
      return { outcome: "sent", result: null };
    }
    // Шинэ баримт, эсвэл хэсэгчилсэн буцаалтын засвар (inactiveId-тай) — хоёулаа POST.
    const response = await posApiPutReceipt(prepared.settings.posApiUrl, prepared.request!);
    const applied = await applyPosApiResponse(prepared, response, "send");
    if (!applied.ok) {
      await alertIfNeeded(prepared.orgId, prepared.saleId, applied.attempts, String(response.message ?? ""));
      return { outcome: "failed", result: null };
    }
    return { outcome: "sent", result: applied.result };
  } catch (error) {
    // Сүлжээ / timeout — дахин оролдоно (backoff). Timeout нь ДАВХАР ДДТД-ийн
    // эрсдэлтэй (хүсэлт хүрсэн байж болзошгүй) — lastError-д ил, дараагийн
    // оролдлого ижил billIdSuffix-тэй явж PosAPI давхардлыг таних ёстой.
    const failure =
      error instanceof EbarimtError && error.code === EBARIMT_ERRORS.posApiTimeout
        ? new EbarimtError(
            error.code,
            `${error.message.replace(/^\[[^\]]+\] /, "")}. ${
              prepared.request
                ? `ДАВХАР ДДТД-ийн ЭРСДЭЛ: дахин илгээхэд ижил billIdSuffix=${prepared.request.billIdSuffix} явна — PosAPI үүгээр давхардлыг таних ёстой; ТЕГ-ийн баримтыг гараар тулгана`
                : `Цуцлах хүсэлт (ДДТД ${prepared.cancel?.id ?? "?"}) дахин илгээгдэнэ — DELETE давтагдахад давхар баримт үүсэхгүй`
            } (docs/integrations/01 §2 P0-3)`
          )
        : error;
    const attempts = await markFailed(prepared.id, prepared.saleId, failure, { maxAttempts: EBARIMT_MAX_ATTEMPTS });
    await alertIfNeeded(prepared.orgId, prepared.saleId, attempts, failure instanceof Error ? failure.message : String(failure));
    return { outcome: "failed", result: null };
  }
}

/**
 * Борлуулалт батлагдмагц ШУУД илгээж, хариуг (сугалаа/QR-тай) баримт хэвлэхэд
 * ТҮР буцаана — DB-д хадгалахгүй тул зөвхөн энэ мөчид л гарна. `timeoutMs`
 * хэтэрвэл null (баримт QR-гүй хэвлэгдэнэ); илгээлт нь ард үргэлжилж дуусна,
 * дуусахгүй бол claim 10 минутын дараа чөлөөлөгдөж worker дахин оролдоно.
 * Хэзээ ч шидэхгүй — борлуулалт илгээлтээс болж унахгүй (§4.4).
 */
export async function sendSubmissionNow(
  submissionId: string,
  settingsRow: typeof posSettings.$inferSelect,
  timeoutMs: number
): Promise<EbarimtSaleResult | null> {
  try {
    const submission = await db.query.posEbarimtSubmissions.findFirst({ where: eq(posEbarimtSubmissions.id, submissionId) });
    if (!submission) return null;
    const work = processSubmission(submission, settingsRow).catch((error) => {
      console.error("[ebarimt] шууд илгээлт:", error);
      return { outcome: "failed", result: null } as ProcessOutcome;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const winner = await Promise.race([work, timeout]);
    if (timer) clearTimeout(timer);
    return winner && winner.outcome === "sent" ? winner.result : null;
  } catch (error) {
    console.error("[ebarimt] шууд илгээлт:", error);
    return null;
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
        const { outcome } = await processSubmission(submission, settings);
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
  const orgs = await db.query.posSettings.findMany({
    where: and(eq(posSettings.ebarimtEnabled, true), eq(posSettings.ebarimtMode, "server")),
  });
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

"use server";

// eBarimt 3.0 Server Actions — docs/pos/03-ebarimt-integration-plan.md §4.
// Тохиргооны шалгалт, гар «Дахин илгээх», ТЕГ-ийн лавлах, browser горимын
// илгээлт (кассын дэлгэц localhost:7080-д өөрөө хандаж хариуг сервер рүү
// бичнэ). Бүгд ActionResult (§ lib/action-result.ts) — client-д алдаа МОНГОЛООР.

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { requireModuleAction } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { posEbarimtSubmissions, posSales } from "@/lib/db/schema";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { todayInUlaanbaatar } from "@/lib/periods/selection";
import { isOrgVatPayer } from "@/lib/vat/settings";
import { posApiInfo, posApiSendData } from "@/lib/ebarimt/client";
import { EBARIMT_ERRORS } from "@/lib/ebarimt/constants";
import { lookupBranchInfo, lookupTinByRegNo, type BranchInfoEntry, type TinInfo } from "@/lib/ebarimt/lookup";
import { EbarimtError, ebarimtSettingsProblems } from "@/lib/ebarimt/receipt";
import {
  ebarimtStatusSummary,
  listPendingForBrowser,
  loadSubmissionsForSale,
  requeueEbarimt,
  settingsInputOf,
} from "@/lib/ebarimt/queue";
import { applyPosApiResponse, processPendingEbarimt } from "@/lib/ebarimt/worker";
import type {
  EbarimtReceiptResponse,
  EbarimtStatusSummary,
  EbarimtSubmissionView,
} from "@/lib/ebarimt/types";

function revalidateEbarimt() {
  revalidatePath("/inventory/sales");
  revalidatePath("/inventory/pos");
  revalidatePath("/inventory");
}

/** Тохиргооны байдал + PosAPI-ийн хүрэлцээ + дарааллын тоолуур (тохиргооны таб, самбар). */
export async function getEbarimtStatus(): Promise<
  ActionResult<{ status: EbarimtStatusSummary; problems: string[] }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const settings = await ensurePosSettings(orgId, userId);
    const status = await ebarimtStatusSummary(orgId, settings, todayInUlaanbaatar());
    const problems = ebarimtSettingsProblems(settingsInputOf(settings));
    if (!(await isOrgVatPayer(orgId)))
      problems.unshift(
        "Байгууллага НӨАТ төлөгчөөр бүртгэгдээгүй — eBarimt идэвхгүй (Тохиргоо → НӨАТ)"
      );
    return { status, problems };
  } catch (caught) {
    return actionError("getEbarimtStatus", caught, "eBarimt-ийн байдал уншигдсангүй");
  }
}

/** PosAPI-ийн `GET /rest/info` — «Холболт шалгах» товч. */
export async function testEbarimtConnection(): Promise<
  ActionResult<{ info: Record<string, unknown> }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const settings = await ensurePosSettings(orgId, userId);
    const problems = ebarimtSettingsProblems(settingsInputOf(settings));
    if (problems.length > 0) throw new EbarimtError(EBARIMT_ERRORS.settings, problems.join("; "));
    const info = await posApiInfo(settings.ebarimtPosApiUrl);
    return { info };
  } catch (caught) {
    return actionError("testEbarimtConnection", caught, "PosAPI-тай холбогдсонгүй");
  }
}

/** Гараар «Дахин илгээх» — failed мөрийг pending болгоод шууд нэг оролдоно. */
export async function resendEbarimt(
  saleId: string,
  kind: "send" | "cancel" = "send"
): Promise<ActionResult<{ status: string | null }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const sale = await db.query.posSales.findFirst({
      where: and(eq(posSales.id, saleId), eq(posSales.organizationId, orgId)),
      columns: { id: true, documentNo: true, ebarimtStatus: true },
    });
    if (!sale) throw new Error("Борлуулалт олдсонгүй");
    if (sale.ebarimtStatus === "sent" && kind === "send")
      throw new Error("Энэ борлуулалт аль хэдийн ТЕГ-д илгээгдсэн");
    const settings = await ensurePosSettings(orgId, userId);
    if (!settings.ebarimtEnabled || !(await isOrgVatPayer(orgId)))
      throw new EbarimtError(EBARIMT_ERRORS.disabled, "eBarimt унтраалттай байна");
    await requeueEbarimt(orgId, saleId, kind);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "ebarimt_resend",
      entityType: "pos_sale",
      entityId: saleId,
      summary: `eBarimt дахин илгээх хүсэлт — ${sale.documentNo} (${kind === "cancel" ? "цуцлах" : "баримт"})`,
    });
    if (settings.ebarimtMode !== "browser") await processPendingEbarimt(5);
    const updated = await db.query.posSales.findFirst({
      where: eq(posSales.id, saleId),
      columns: { ebarimtStatus: true },
    });
    revalidateEbarimt();
    return { status: updated?.ebarimtStatus ?? null };
  } catch (caught) {
    return actionError("resendEbarimt", caught, "eBarimt дахин илгээгдсэнгүй");
  }
}

/** Борлуулалтын илгээлтийн түүх (панель). */
export async function getEbarimtSubmissions(
  saleId: string
): Promise<ActionResult<{ submissions: EbarimtSubmissionView[] }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { submissions: await loadSubmissionsForSale(orgId, saleId) };
  } catch (caught) {
    return actionError("getEbarimtSubmissions", caught, "Илгээлтийн түүх уншигдсангүй");
  }
}

/** РД → ТТД + нэр (B2B баримт, харилцагчийн карт). */
export async function lookupEbarimtTin(regNo: string): Promise<ActionResult<{ info: TinInfo }>> {
  try {
    await requireModuleAction(POS_MODULE_KEY, "read");
    return { info: await lookupTinByRegNo(regNo) };
  } catch (caught) {
    return actionError("lookupEbarimtTin", caught, "ТТД олдсонгүй");
  }
}

/** Дүүргийн кодын лавлах (тохиргооны сонголт). */
export async function getEbarimtBranchInfo(): Promise<ActionResult<{ branches: BranchInfoEntry[] }>> {
  try {
    await requireModuleAction(POS_MODULE_KEY, "read");
    return { branches: await lookupBranchInfo() };
  } catch (caught) {
    return actionError("getEbarimtBranchInfo", caught, "Дүүргийн лавлах уншигдсангүй");
  }
}

/** PosAPI-ийн дотоод санд үлдсэнийг ТЕГ рүү түлхэх (тохиргооны товч). */
export async function pushEbarimtData(): Promise<ActionResult<{ result: Record<string, unknown> }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const settings = await ensurePosSettings(orgId, userId);
    if (!settings.ebarimtEnabled || !(await isOrgVatPayer(orgId)))
      throw new EbarimtError(EBARIMT_ERRORS.disabled, "eBarimt унтраалттай байна");
    return { result: await posApiSendData(settings.ebarimtPosApiUrl) };
  } catch (caught) {
    return actionError("pushEbarimtData", caught, "sendData дуудлага амжилтгүй");
  }
}

// ── Browser горим (кассын PC-ийн localhost:7080) ───────────────────────────
//
// Сервер PosAPI-д хүрэхгүй тохиолдолд кассын дэлгэц өөрөө илгээнэ:
//   1) getEbarimtOutbox — бэлтгэгдсэн payload-ууд
//   2) кассын браузер fetch("http://localhost:7080/rest/receipt", …)
//   3) recordEbarimtResponse — хариуг сервер рүү бичнэ (шалгалт server талд)

export async function getEbarimtOutbox(): Promise<
  ActionResult<{ posApiUrl: string; items: EbarimtSubmissionView[] }>
> {
  try {
    // Унших эрхээр ч дуудагдана (кассын дэлгэц нээгдсэн бүрд polling) —
    // илгээх эрхгүй бол ХООСОН дараалал, алдаа биш. Бичилт нь
    // recordEbarimtResponse дээр "write" эрхээр шалгагдана.
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const settings = await ensurePosSettings(orgId, userId);
    // НӨАТ төлөгч бус болсон бол browser горимд ч илгээх дараалал ХООСОН.
    if (!settings.ebarimtEnabled || settings.ebarimtMode !== "browser" || !(await isOrgVatPayer(orgId)))
      return { posApiUrl: settings.ebarimtPosApiUrl, items: [] };
    return { posApiUrl: settings.ebarimtPosApiUrl, items: await listPendingForBrowser(orgId, settings) };
  } catch (caught) {
    return actionError("getEbarimtOutbox", caught, "Илгээх дараалал уншигдсангүй");
  }
}

export async function recordEbarimtResponse(input: {
  submissionId: string;
  stage: "send" | "cancel";
  response: EbarimtReceiptResponse;
}): Promise<ActionResult<{ ok: boolean }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const submission = await db.query.posEbarimtSubmissions.findFirst({
      where: and(
        eq(posEbarimtSubmissions.id, input.submissionId),
        eq(posEbarimtSubmissions.organizationId, orgId)
      ),
    });
    if (!submission) throw new Error("Илгээлтийн мөр олдсонгүй");
    const payload = (submission.payload ?? {}) as { request?: { type?: string } };
    const result = await applyPosApiResponse(
      {
        id: submission.id,
        saleId: submission.saleId,
        kind: submission.kind === "cancel" ? "cancel" : "send",
        request: (payload.request ?? null) as never,
      },
      input.response,
      input.stage
    );
    revalidateEbarimt();
    return { ok: result.ok };
  } catch (caught) {
    return actionError("recordEbarimtResponse", caught, "eBarimt-ийн хариу бичигдсэнгүй");
  }
}

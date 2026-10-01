"use server";

// eBarimt 3.0 Server Actions — docs/pos/03-ebarimt-integration-plan.md §4.
// Тохиргооны шалгалт, гар «Дахин илгээх», ТЕГ-ийн лавлах, browser горимын
// илгээлт (кассын дэлгэц localhost:7080-д өөрөө хандаж хариуг сервер рүү
// бичнэ). Бүгд ActionResult (§ lib/action-result.ts) — client-д алдаа МОНГОЛООР.

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { requireAnyModuleAction, requireModuleAction } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { organizationProfile, posEbarimtSubmissions, posSales } from "@/lib/db/schema";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { todayInUlaanbaatar } from "@/lib/periods/selection";
import { posApiBankAccounts, posApiInfo, posApiSendData } from "@/lib/ebarimt/client";
import { EBARIMT_ERRORS, EBARIMT_INLINE_SEND_TIMEOUT_MS } from "@/lib/ebarimt/constants";
import {
  lookupTaxpayerByTin,
  lookupTinByRegNo,
  type TinInfo,
} from "@/lib/ebarimt/lookup";
import { MERCHANT_TIN_RE } from "@/lib/ebarimt/constants";
import { ORG_REGISTER_RE } from "@/lib/pos/ebarimt-buyer";
import { EbarimtError, ebarimtSettingsProblems } from "@/lib/ebarimt/receipt";
import {
  ebarimtStatusWithPosApi,
  listPendingForBrowser,
  loadEbarimtReadiness,
  loadSubmissionsForSale,
  requeueEbarimt,
  settingsInputOf,
} from "@/lib/ebarimt/queue";
import { applyPosApiResponse, processPendingEbarimt, sendSubmissionNow } from "@/lib/ebarimt/worker";
import type { EbarimtReadiness } from "@/lib/ebarimt/readiness";
import type {
  PosApiBankAccount,
  EbarimtReceiptResponse,
  EbarimtStatusSummary,
  EbarimtSubmissionView,
} from "@/lib/ebarimt/types";

function revalidateEbarimt() {
  revalidatePath("/inventory/sales");
  revalidatePath("/inventory/pos-settings");
  revalidatePath("/inventory/pos");
  revalidatePath("/inventory");
}

/**
 * Тохиргооны байдал + PosAPI-ийн хүрэлцээ + дарааллын тоолуур (тохиргооны таб,
 * самбар). `problems` нь МЕРЧАНТЫН тохиргоо, `readiness` нь бараа / төлбөрийн
 * хэлбэрийн КОДЫН бэлэн байдал — хоёулаа цэвэрлэгдтэл switch асаахгүй
 * (docs/deployment/ebarimt.md §3).
 */
export async function getEbarimtStatus(): Promise<
  ActionResult<{
    status: EbarimtStatusSummary;
    problems: string[];
    readiness: EbarimtReadiness;
    /** Компанийн мэдээллийн регистр (7 орон) — мерчантын ТТД-г ТЕГ-ээс татах эх. */
    companyRegisterNo: string | null;
  }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const settings = await ensurePosSettings(orgId, userId);
    const [status, readiness, profile] = await Promise.all([
      ebarimtStatusWithPosApi(orgId, settings, todayInUlaanbaatar()),
      loadEbarimtReadiness(orgId),
      db.query.organizationProfile.findFirst({
        where: eq(organizationProfile.organizationId, orgId),
        columns: { registerNo: true },
      }),
    ]);
    const register = profile?.registerNo?.trim() ?? "";
    const companyRegisterNo = ORG_REGISTER_RE.test(register) ? register : null;
    const problems = ebarimtSettingsProblems(settingsInputOf(settings));
    return { status, problems, readiness, companyRegisterNo };
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

/**
 * Мерчантын ТЕГ-д бүртгэлтэй банкны данс (PosAPI `/rest/bankAccounts?tin=`) —
 * «АР нэхэмжлэх»-ийн данс сонгоход. Server горимд л (серверээс PosAPI-д хүрнэ).
 */
export async function listEbarimtBankAccounts(): Promise<ActionResult<{ accounts: PosApiBankAccount[] }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const settings = await ensurePosSettings(orgId, userId);
    if (settings.ebarimtMode !== "server") throw new Error("Данс татах нь «Сервер» горимд л — кассын PC-ийн PosAPI-аас гараар хуулна уу");
    if (!MERCHANT_TIN_RE.test(settings.ebarimtMerchantTin.trim())) throw new Error("Эхлээд мерчантын ТТД-г тохируулна уу");
    const accounts = await posApiBankAccounts(settings.ebarimtPosApiUrl, settings.ebarimtMerchantTin);
    if (accounts.length === 0)
      throw new Error("PosAPI-д бүртгэлтэй данс алга — Цахим татварын системд дансаа бүртгээд, PosAPI-аас баримт илгээж (sendData) шинэчилнэ үү");
    return { accounts };
  } catch (caught) {
    return actionError("listEbarimtBankAccounts", caught, "Банкны данс татагдсангүй");
  }
}

/**
 * Баримтын цонхны «Дахин илгээх» (server горим): борлуулалт дөнгөж батлагдаад
 * eBarimt амжилтгүй / хүлээгдэж байхад кассчин ХЭВЛЭХЭЭС ӨМНӨ дахин оролдоно.
 * Амжилттай бол сугалаа/QR-ийг ТҮР буцаана (DB-д хадгалахгүй — албан спек §5),
 * үгүй бол ТЕГ/PosAPI-ийн алдааны текст. Backoff-ыг хүлээхгүй.
 */
export async function sendPosSaleEbarimtNow(saleId: string): Promise<
  ActionResult<{
    status: "sent" | "pending" | "failed";
    ebarimtId: string | null;
    ebarimtLottery: string | null;
    ebarimtQrData: string | null;
    /** ТЕГ/PosAPI-ийн алдааны текст (sent биш үед) — `error` нь ActionResult-ийнх. */
    reason: string | null;
  }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const sale = await db.query.posSales.findFirst({
      where: and(eq(posSales.id, saleId), eq(posSales.organizationId, orgId)),
      columns: { id: true, documentNo: true, ebarimtId: true, ebarimtStatus: true, nonVat: true },
    });
    if (!sale) throw new Error("Борлуулалт олдсонгүй");
    if (sale.nonVat) throw new Error("НӨАТ-гүй борлуулалт eBarimt-д илгээгдэхгүй");
    if (sale.ebarimtStatus === "sent")
      return { status: "sent", ebarimtId: sale.ebarimtId, ebarimtLottery: null, ebarimtQrData: null, reason: null };
    const settings = await ensurePosSettings(orgId, userId);
    if (!settings.ebarimtEnabled) throw new EbarimtError(EBARIMT_ERRORS.disabled, "eBarimt унтраалттай байна");
    if (settings.ebarimtMode === "browser")
      throw new Error("Browser горимд кассын компьютер PosAPI-д өөрөө илгээнэ — PosAPI ажиллаж байгаа эсэхийг шалгана уу");
    // Failed бол pending болгоно (байхгүй бол шинээр) — дараа нь ШУУД илгээнэ.
    await requeueEbarimt(orgId, saleId, "send");
    const submission = await db.query.posEbarimtSubmissions.findFirst({
      where: and(
        eq(posEbarimtSubmissions.organizationId, orgId),
        eq(posEbarimtSubmissions.saleId, saleId),
        eq(posEbarimtSubmissions.kind, "send")
      ),
      orderBy: [desc(posEbarimtSubmissions.createdAt)],
      columns: { id: true, status: true },
    });
    if (!submission) throw new Error("eBarimt-ийн илгээлт олдсонгүй");
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "ebarimt_resend",
      entityType: "pos_sale",
      entityId: saleId,
      summary: `eBarimt дахин илгээх (баримтын цонх) — ${sale.documentNo}`,
    });
    // claimed = ард аль хэдийн илгээж байна — давхар дуудахгүй, хариуг хүлээнэ.
    const outcome =
      submission.status === "claimed"
        ? { status: "pending" as const, result: null, error: "Илгээж байна — хэдэн секундын дараа дахин дарна уу" }
        : await sendSubmissionNow(submission.id, settings, EBARIMT_INLINE_SEND_TIMEOUT_MS);
    revalidateEbarimt();
    return {
      status: outcome.status,
      ebarimtId: outcome.result?.ebarimtId ?? null,
      ebarimtLottery: outcome.result?.ebarimtLottery ?? null,
      ebarimtQrData: outcome.result?.ebarimtQrData ?? null,
      reason: outcome.error,
    };
  } catch (caught) {
    return actionError("sendPosSaleEbarimtNow", caught, "eBarimt илгээгдсэнгүй");
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
      columns: { id: true, documentNo: true, ebarimtStatus: true, nonVat: true },
    });
    if (!sale) throw new Error("Борлуулалт олдсонгүй");
    if (sale.nonVat && kind === "send")
      throw new Error("НӨАТ-гүй борлуулалт eBarimt-д илгээгдэхгүй (НӨАТ задлаагүй тул баримтын дүн зөрнө)");
    if (sale.ebarimtStatus === "sent" && kind === "send")
      throw new Error("Энэ борлуулалт аль хэдийн ТЕГ-д илгээгдсэн");
    const settings = await ensurePosSettings(orgId, userId);
    if (!settings.ebarimtEnabled)
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

/** Харилцагчийн картын ТЕГ лавлах — ТТД (11–14) эсвэл байгууллагын регистр (7). */
export interface CounterpartyTaxpayerLookup {
  tin: string;
  name: string;
  vatPayer: boolean | null;
  cityPayer: boolean | null;
  freeProject: boolean | null;
}

/**
 * Харилцагчийн картын «ТЕГ-ээс лавлах»: ТТД өгвөл `getInfo` (нэр, НӨАТ төлөгч);
 * зөвхөн байгууллагын регистр (7 орон) байвал `getTinInfo` → ТТД → нэр. Иргэний
 * РД-аар лавлахгүй (`lookupTinByRegNo` өөрөө татгалзана — ХХМХ 4.1.11). Лавлах
 * хүрэхгүй (Монголын IP л) бол алдаа МОНГОЛООР — хадгалалт үүнээс хамаарахгүй.
 */
export async function lookupCounterpartyTaxpayer(input: {
  tin?: string | null;
  registerNo?: string | null;
}): Promise<ActionResult<CounterpartyTaxpayerLookup>> {
  try {
    await requireAnyModuleAction([
      ["ar", "read"],
      ["ap", "read"],
    ]);
    const tin = (input.tin ?? "").replace(/[\s-]/g, "");
    const registerNo = (input.registerNo ?? "").trim();
    if (MERCHANT_TIN_RE.test(tin)) {
      const info = await lookupTaxpayerByTin(tin);
      return { tin, name: info.name, vatPayer: info.vatPayer, cityPayer: info.cityPayer, freeProject: info.freeProject };
    }
    if (tin) throw new Error("ТТД 11–14 оронтой тоо байна");
    if (!ORG_REGISTER_RE.test(registerNo))
      throw new Error("ТТД (11–14 орон) эсвэл байгууллагын регистр (7 орон) оруулна уу — иргэний РД-аар лавлахгүй");
    const found = await lookupTinByRegNo(registerNo);
    return {
      tin: found.tin,
      name: found.name,
      vatPayer: found.vatPayer,
      cityPayer: found.cityPayer ?? null,
      freeProject: found.freeProject ?? null,
    };
  } catch (caught) {
    return actionError("lookupCounterpartyTaxpayer", caught, "ТЕГ-ийн лавлах амжилтгүй");
  }
}

/** PosAPI-ийн дотоод санд үлдсэнийг ТЕГ рүү түлхэх (тохиргооны товч). */
export async function pushEbarimtData(): Promise<ActionResult<{ result: Record<string, unknown> }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const settings = await ensurePosSettings(orgId, userId);
    if (!settings.ebarimtEnabled)
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
    if (!settings.ebarimtEnabled || settings.ebarimtMode !== "browser")
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
        arapDocumentId: submission.arapDocumentId,
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

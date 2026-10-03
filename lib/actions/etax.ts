"use server";

// eTax («Цахим татварын систем») — docs/dev/etax.md. Холболт/байгууллага/маягтын холболт
// admin+; тайлан бэлтгэх, ТЕГ-д ХАДГАЛАХ (илгээхгүй), төлөв шинэчлэх `tax:write`; ТЕГ-д
// ИЛГЭЭХ ба тушаасан/хүлээн авсан/буцаасан гэж бүртгэх нь батлах шинжтэй — `tax:post`.
// API: АЛБАН спек docs/integrations/etax/00-etax-api-spec.md. Нууцын УТГА хариу/аудитад ХЭЗЭЭ Ч орохгүй.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { etaxConnections } from "@/lib/db/schema";
import { isItcEnvironment } from "@/lib/itc/auth";
import { ETAX_FORMS, ETAX_STATUS_LABELS, ETAX_SUBMISSION_STATUSES, isEtaxFormKey, type EtaxFormKey, type EtaxSubmissionStatus } from "@/lib/itc/etax/constants";
import {
  checkEtaxConnection,
  listEtaxSubmissionRows,
  loadEtaxConnectionRow,
  loadEtaxOverview,
  prepareSubmission,
  toEtaxConnectionView,
  transitionEtaxSubmission,
} from "@/lib/itc/etax/store";
import { isPostingTransition } from "@/lib/itc/etax/submission";
import {
  fetchEtaxSheetTemplates,
  fetchEtaxTemplate,
  loadEtaxReportChoices,
  refreshTaxStatus,
  saveEtaxMapping,
  saveEtaxSheetMappings,
  saveSheetsToTax,
  saveSubmissionToTax,
  submitSubmissionToTax,
  syncEtaxOrg,
} from "@/lib/itc/etax/tax-flow";
import type { EtaxConnectionView, EtaxMappingView, EtaxOverview, EtaxReportChoice, EtaxSubmissionView } from "@/lib/itc/etax/types";

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const formOf = (value: unknown): EtaxFormKey => {
  if (!isEtaxFormKey(value)) throw new Error("Маягт буруу (vat / pit / cit)");
  return value;
};

function revalidate() {
  revalidatePath("/tax/etax");
  revalidatePath("/tax/vat");
}

/** Тохиргоо (нууц утгагүй). Тохируулаагүй бол null. */
export async function getEtaxConnection(): Promise<ActionResult<{ connection: EtaxConnectionView | null }>> {
  try {
    const { orgId } = await requireRole("admin");
    const row = await loadEtaxConnectionRow(orgId);
    return { connection: row ? toEtaxConnectionView(row) : null };
  } catch (caught) {
    return actionError("getEtaxConnection", caught, "eTax холболтыг уншиж чадсангүй");
  }
}

/** Хадгалах — нууц үг ХООСОН бол хуучнаа хөндөхгүй (write-only), анх холбоход заавал. */
export async function saveEtaxConnection(input: {
  environment: string;
  username: string;
  password?: string | null;
  isEnabled: boolean;
}): Promise<ActionResult<{ connection: EtaxConnectionView }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    if (!isItcEnvironment(input.environment)) throw new Error("Орчноо сонгоно уу (бодит / туршилтын)");
    const username = cleanText(input.username);
    if (!username) throw new Error("ITC-ийн нэвтрэх нэрээ оруулна уу");
    const password = cleanText(input.password);
    const existing = await loadEtaxConnectionRow(orgId);
    if (!existing && !password) throw new Error("Анх холбоход нууц үг заавал");

    const patch = {
      environment: input.environment,
      username,
      isEnabled: !!input.isEnabled,
      userId,
      updatedAt: new Date(),
      lastCheckError: null,
      ...(password ? { passwordEnc: encryptSecret(password) } : {}),
    };
    let id: string;
    if (existing) {
      await db.update(etaxConnections).set(patch).where(eq(etaxConnections.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await db
        .insert(etaxConnections)
        .values({ ...patch, organizationId: orgId, passwordEnc: encryptSecret(password) })
        .returning({ id: etaxConnections.id });
      id = created.id;
    }
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: existing ? "update" : "create",
      entityType: "etax_connection",
      entityId: id,
      summary: `eTax холболт ${existing ? "шинэчлэгдэв" : "үүсгэгдэв"} — ${input.environment}, ${input.isEnabled ? "идэвхтэй" : "идэвхгүй"}${password ? "; нууц үг" : ""}`,
    });
    revalidate();
    const saved = await loadEtaxConnectionRow(orgId);
    if (!saved) throw new Error("eTax холболт хадгалагдсангүй");
    return { connection: toEtaxConnectionView(saved) };
  } catch (caught) {
    return actionError("saveEtaxConnection", caught, "eTax холболт хадгалагдсангүй");
  }
}

/** ITC Keycloak-д нэвтэрч шалгана — ТЕГ рүү юу ч илгээхгүй. */
export async function testEtaxConnection(): Promise<ActionResult<{ expiresAt: string; connection: EtaxConnectionView }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const { expiresAt } = await checkEtaxConnection(orgId);
    const row = await loadEtaxConnectionRow(orgId);
    if (!row) throw new Error("eTax холболт олдсонгүй");
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "check",
      entityType: "etax_connection",
      entityId: row.id,
      summary: `eTax нэвтрэлт амжилттай — ${row.environment}`,
    });
    revalidate();
    return { expiresAt, connection: toEtaxConnectionView(row) };
  } catch (caught) {
    // Алдааг lastCheckError-д хадгалсан — хуудас шинэчлэгдэнэ.
    revalidate();
    return actionError("testEtaxConnection", caught, "eTax нэвтрэлт амжилтгүй");
  }
}

export async function deleteEtaxConnection(): Promise<ActionResult<{ ok: true }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const existing = await loadEtaxConnectionRow(orgId);
    if (!existing) throw new Error("eTax холболт байхгүй");
    await db.delete(etaxConnections).where(eq(etaxConnections.id, existing.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "delete",
      entityType: "etax_connection",
      entityId: existing.id,
      summary: "eTax холболт устгагдав (илгээлтийн түүх хэвээр)",
    });
    revalidate();
    return { ok: true };
  } catch (caught) {
    return actionError("deleteEtaxConnection", caught, "eTax холболт устгагдсангүй");
  }
}

/** Тайланг eTax-д бэлтгэх — ноорог үүсгэнэ/шинэчилнэ (tax:write). `periodCode` маягтын тайлант үе. */
/** AI/MCP унших: холболт + маягт бүрийн бэлэн байдал + тушаах ёстой үе — `tax:read`. Нууц утгагүй. */
export async function getEtaxOverview(): Promise<ActionResult<EtaxOverview>> {
  try {
    const { orgId } = await requireModuleAction("tax", "read");
    return await loadEtaxOverview(orgId);
  } catch (caught) {
    return actionError("getEtaxOverview", caught, "eTax-ийн байдлыг уншиж чадсангүй");
  }
}

/** AI/MCP унших: илгээлтийн түүх (шүүлт DB-д) — `tax:read`. */
export async function listEtaxSubmissions(input: {
  form?: string | null;
  periodCode?: string | null;
  status?: string | null;
  limit?: number | null;
}): Promise<ActionResult<{ submissions: EtaxSubmissionView[] }>> {
  try {
    const { orgId } = await requireModuleAction("tax", "read");
    const form = cleanText(input.form);
    const status = cleanText(input.status);
    if (form && !isEtaxFormKey(form)) throw new Error("Маягт буруу (vat / pit / cit)");
    if (status && !(ETAX_SUBMISSION_STATUSES as readonly string[]).includes(status)) throw new Error(`Төлөв буруу (${ETAX_SUBMISSION_STATUSES.join(" / ")})`);
    const submissions = await listEtaxSubmissionRows(orgId, {
      form: form ? (form as EtaxFormKey) : undefined,
      periodCode: cleanText(input.periodCode) || undefined,
      status: status ? (status as EtaxSubmissionStatus) : undefined,
      limit: input.limit ?? undefined,
    });
    return { submissions };
  } catch (caught) {
    return actionError("listEtaxSubmissions", caught, "eTax илгээлтүүдийг уншиж чадсангүй");
  }
}

export async function prepareEtaxReturn(input: {
  form: string;
  periodCode: string;
}): Promise<ActionResult<{ submission: EtaxSubmissionView; created: boolean; revertedToDraft: boolean }>> {
  try {
    const form = formOf(input.form);
    const { orgId, userId } = await requireModuleAction("tax", "write");
    const result = await prepareSubmission(orgId, userId, form, cleanText(input.periodCode));
    const { validation } = result.submission;
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: result.created ? "create" : "update",
      entityType: "etax_submission",
      entityId: result.submission.id,
      summary: `${ETAX_FORMS[form].label} ${result.submission.periodCode} eTax-д ${result.created ? "бэлтгэгдэв" : "дахин бодогдов"}${result.revertedToDraft ? " — дүн зөрсөн тул ноорог руу буцав" : ""}; алдаа ${validation?.errors.length ?? 0}, анхааруулга ${validation?.warnings.length ?? 0}`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("prepareEtaxReturn", caught, "Тайланг eTax-д бэлтгэж чадсангүй");
  }
}

/** @deprecated — `prepareEtaxReturn({ form: "vat", periodCode })`. */
export async function prepareEtaxVatReturn(periodCode: string) {
  return prepareEtaxReturn({ form: "vat", periodCode });
}

/**
 * Төлөв шилжүүлэх: ready/draft/cancelled → tax:write; submitted/accepted/rejected
 * (ТЕГ-тэй харьцсан бүртгэл) → tax:post.
 */
export async function setEtaxSubmissionStatus(input: {
  id: string;
  to: string;
  taxReference?: string | null;
  note?: string | null;
}): Promise<ActionResult<{ submission: EtaxSubmissionView }>> {
  try {
    if (!(ETAX_SUBMISSION_STATUSES as readonly string[]).includes(input.to)) throw new Error("Төлөв буруу");
    const to = input.to as EtaxSubmissionStatus;
    const { orgId, userId } = await requireModuleAction("tax", isPostingTransition(to) ? "post" : "write");
    const id = cleanText(input.id);
    if (!id) throw new Error("Илгээлт сонгоно уу");
    const { submission, from } = await transitionEtaxSubmission(orgId, userId, {
      id,
      to,
      taxReference: input.taxReference,
      note: input.note,
    });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: to === "submitted" ? "post" : to === "cancelled" ? "cancel" : "update",
      entityType: "etax_submission",
      entityId: submission.id,
      summary: `${ETAX_FORMS[submission.form].label} ${submission.periodCode}: «${ETAX_STATUS_LABELS[from]}» → «${ETAX_STATUS_LABELS[to]}»${submission.taxReference && to === "submitted" ? ` (ТЕГ №${submission.taxReference})` : ""}`,
    });
    revalidate();
    return { submission };
  } catch (caught) {
    return actionError("setEtaxSubmissionStatus", caught, "eTax илгээлтийн төлөв өөрчлөгдсөнгүй");
  }
}

// ── eTax API (албан спек §3) ────────────────────────────────────────────────

/** §3.2 — ITC хэрэглэгчийн байгууллагуудаас регистрээр сонгож entId хадгална (admin+). */
export async function syncEtaxOrganization(): Promise<ActionResult<{ connection: EtaxConnectionView; orgCount: number }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const result = await syncEtaxOrg(orgId);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "sync",
      entityType: "etax_connection",
      entityId: orgId,
      summary: `eTax байгууллага татагдав — entId ${result.connection.entId}, ${result.connection.entName ?? ""} (${result.orgCount} байгууллагаас)`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("syncEtaxOrganization", caught, "ТЕГ-ээс байгууллагын мэдээлэл татаж чадсангүй");
  }
}

/** §3.3 — тушаах жагсаалтын татварын төрөл × маягт (холболтын сонголт, admin+). */
export async function getEtaxReportChoices(): Promise<ActionResult<{ choices: EtaxReportChoice[] }>> {
  try {
    const { orgId } = await requireRole("admin");
    return { choices: await loadEtaxReportChoices(orgId) };
  } catch (caught) {
    return actionError("getEtaxReportChoices", caught, "ТЕГ-ийн тушаах жагсаалтыг татаж чадсангүй");
  }
}

/** §3.7 — маягтын загвар татаж нүдний жагсаалтыг холболтод хадгална (admin+). */
export async function fetchEtaxFormTemplate(input: {
  form: string;
  taxTypeId: number;
  formNo: number;
  taxTypeName?: string | null;
  periodCode: string;
}): Promise<ActionResult<{ mapping: EtaxMappingView }>> {
  try {
    const form = formOf(input.form);
    const { orgId, userId } = await requireRole("admin");
    const mapping = await fetchEtaxTemplate(orgId, userId, { ...input, form });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "etax_form_mapping",
      entityId: orgId,
      summary: `eTax маягтын загвар татагдав — ${mapping.reportCode ?? mapping.formNo} (${mapping.taxTypeName ?? mapping.taxTypeId}), ${mapping.templateCells.length} нүд`,
    });
    revalidate();
    return { mapping };
  } catch (caught) {
    return actionError("fetchEtaxFormTemplate", caught, "Маягтын загварыг ТЕГ-ээс татаж чадсангүй");
  }
}

/** Нүдний холболт хадгалах (admin+). */
export async function saveEtaxFormMapping(input: { form: string; cells: Record<string, string | null> }): Promise<ActionResult<{ mapping: EtaxMappingView }>> {
  try {
    const form = formOf(input.form);
    const { orgId, userId } = await requireRole("admin");
    const mapping = await saveEtaxMapping(orgId, userId, form, input.cells);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "etax_form_mapping",
      entityId: orgId,
      summary: `eTax маягтын нүдний холболт хадгалагдав — ${Object.values(mapping.cells).filter(Boolean).length} талбар${mapping.problems.length ? `; дутуу ${mapping.problems.length}` : ""}`,
    });
    revalidate();
    return { mapping };
  } catch (caught) {
    return actionError("saveEtaxFormMapping", caught, "Маягтын холболт хадгалагдсангүй");
  }
}

/** §3.9 — ТЕГ-д ХАДГАЛАХ (илгээхгүй, reportNo авна) — tax:write. */
export async function saveEtaxSubmissionToTax(input: { id: string }): Promise<ActionResult<{ submission: EtaxSubmissionView; message: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction("tax", "write");
    const result = await saveSubmissionToTax(orgId, userId, cleanText(input.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "etax_submission",
      entityId: result.submission.id,
      summary: `${ETAX_FORMS[result.submission.form].label} ${result.submission.periodCode} ТЕГ-д хадгалагдав — reportNo ${result.submission.reportNo}`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("saveEtaxSubmissionToTax", caught, "ТЕГ-д хадгалж чадсангүй");
  }
}

/** §3.10 — ТЕГ-д ИЛГЭЭХ (батлах шинжтэй) — tax:post. */
export async function submitEtaxSubmissionToTax(input: { id: string }): Promise<ActionResult<{ submission: EtaxSubmissionView; message: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction("tax", "post");
    const result = await submitSubmissionToTax(orgId, userId, cleanText(input.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "post",
      entityType: "etax_submission",
      entityId: result.submission.id,
      summary: `${ETAX_FORMS[result.submission.form].label} ${result.submission.periodCode} ТЕГ-д илгээгдэв — reportNo ${result.submission.reportNo}${result.message ? `; «${result.message}»` : ""}`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("submitEtaxSubmissionToTax", caught, "ТЕГ-д илгээж чадсангүй");
  }
}

/** §3.4 — ТЕГ-ийн төлөв шинэчлэх (хүлээн авсан / буцаасан) — tax:write. */
export async function refreshEtaxSubmissionStatus(input: { id: string }): Promise<ActionResult<{ submission: EtaxSubmissionView; found: boolean }>> {
  try {
    const { orgId, userId } = await requireModuleAction("tax", "write");
    const result = await refreshTaxStatus(orgId, cleanText(input.id));
    if (result.found)
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: "sync",
        entityType: "etax_submission",
        entityId: result.submission.id,
        summary: `${ETAX_FORMS[result.submission.form].label} ${result.submission.periodCode} ТЕГ-ийн төлөв: ${result.submission.taxStatusName ?? result.submission.taxStatusId ?? "—"} → «${ETAX_STATUS_LABELS[result.submission.status]}»`,
      });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("refreshEtaxSubmissionStatus", caught, "ТЕГ-ийн төлөв шинэчлэгдсэнгүй");
  }
}

// ── Хавсралт мэдээ (спек §3.11–§3.15) ───────────────────────────────────────

/** §3.11–§3.12 — ТЕГ-д хадгалсан тайлангийн мэдээний загваруудыг татна (admin+). */
export async function fetchEtaxSheetTemplatesAction(input: { submissionId: string }): Promise<ActionResult<{ mapping: EtaxMappingView }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const mapping = await fetchEtaxSheetTemplates(orgId, userId, cleanText(input.submissionId));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "etax_form_mapping",
      entityId: orgId,
      summary: `eTax мэдээний загвар татагдав — ${mapping.sheetTemplates.map((t) => t.sheetCode).join(", ") || "мэдээгүй"}`,
    });
    revalidate();
    return { mapping };
  } catch (caught) {
    return actionError("fetchEtaxSheetTemplatesAction", caught, "Мэдээний загварыг ТЕГ-ээс татаж чадсангүй");
  }
}

/** Мэдээний холболт хадгалах (admin+). */
export async function saveEtaxSheetMappingsAction(input: { form: string; sheets: unknown[] }): Promise<ActionResult<{ mapping: EtaxMappingView }>> {
  try {
    const form = formOf(input.form);
    const { orgId, userId } = await requireRole("admin");
    const mapping = await saveEtaxSheetMappings(orgId, userId, form, Array.isArray(input.sheets) ? input.sheets : []);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "etax_form_mapping",
      entityId: orgId,
      summary: `eTax мэдээний холболт хадгалагдав — эхтэй ${mapping.sheets.filter((m) => m.source).length}/${mapping.sheets.length}${mapping.sheetProblems.length ? `; дутуу ${mapping.sheetProblems.length}` : ""}`,
    });
    revalidate();
    return { mapping };
  } catch (caught) {
    return actionError("saveEtaxSheetMappingsAction", caught, "Мэдээний холболт хадгалагдсангүй");
  }
}

/** §3.14–§3.15 — мэдээг Entry-ийн задаргаагаар ТЕГ-д бичих (илгээхгүй) — tax:write. */
export async function saveEtaxSheetsToTax(input: { id: string }): Promise<ActionResult<{ submission: EtaxSubmissionView; summary: Record<string, number> }>> {
  try {
    const { orgId, userId } = await requireModuleAction("tax", "write");
    const result = await saveSheetsToTax(orgId, userId, cleanText(input.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "etax_submission",
      entityId: result.submission.id,
      summary: `${ETAX_FORMS[result.submission.form].label} ${result.submission.periodCode} хавсралт мэдээ ТЕГ-д бичигдэв — ${Object.entries(result.summary)
        .map(([code, n]) => `${code}: ${n} мөр`)
        .join(", ")}`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("saveEtaxSheetsToTax", caught, "Хавсралт мэдээг ТЕГ-д бичиж чадсангүй");
  }
}

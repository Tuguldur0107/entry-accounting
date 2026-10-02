"use server";

// eTax («Цахим татварын систем») — docs/dev/etax.md. Холболт хадгалах/шалгах/устгах
// admin+; тайлан бэлтгэх (ноорог, бэлэн, хүчингүй) `tax:write`; ТЕГ-д тушаасан /
// хүлээн авсан / буцаасан гэж бүртгэх нь батлах шинжтэй — `tax:post`. ТЕГ рүү юу ч
// илгээхгүй (албан API спек ирээгүй). Нууцын УТГА хариу/аудитад ХЭЗЭЭ Ч орохгүй.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { etaxConnections } from "@/lib/db/schema";
import { isItcEnvironment } from "@/lib/itc/auth";
import { ETAX_FORMS, ETAX_STATUS_LABELS, ETAX_SUBMISSION_STATUSES, type EtaxSubmissionStatus } from "@/lib/itc/etax/constants";
import {
  checkEtaxConnection,
  loadEtaxConnectionRow,
  prepareVatSubmission,
  toEtaxConnectionView,
  transitionEtaxSubmission,
} from "@/lib/itc/etax/store";
import { isPostingTransition } from "@/lib/itc/etax/submission";
import type { EtaxConnectionView, EtaxSubmissionView } from "@/lib/itc/etax/types";

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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

/** НӨАТ-ын тайланг eTax-д бэлтгэх — ноорог үүсгэнэ/шинэчилнэ (tax:write). */
export async function prepareEtaxVatReturn(
  periodCode: string
): Promise<ActionResult<{ submission: EtaxSubmissionView; created: boolean; revertedToDraft: boolean }>> {
  try {
    const { orgId, userId } = await requireModuleAction("tax", "write");
    const result = await prepareVatSubmission(orgId, userId, periodCode);
    const { validation } = result.submission;
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: result.created ? "create" : "update",
      entityType: "etax_submission",
      entityId: result.submission.id,
      summary: `${ETAX_FORMS.vat.label} ${periodCode} eTax-д ${result.created ? "бэлтгэгдэв" : "дахин бодогдов"}${result.revertedToDraft ? " — дүн зөрсөн тул ноорог руу буцав" : ""}; алдаа ${validation?.errors.length ?? 0}, анхааруулга ${validation?.warnings.length ?? 0}`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("prepareEtaxVatReturn", caught, "НӨАТ-ын тайланг eTax-д бэлтгэж чадсангүй");
  }
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

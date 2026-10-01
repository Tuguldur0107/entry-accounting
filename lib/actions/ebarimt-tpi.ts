"use server";

// ТЕГ-ийн eBarimt TPI холболт + нэхэмжлэхийн үлдэгдлийн тулгалт —
// docs/dev/ebarimt-tax-reconcile.md. Тохиргоо хадгалах/шалгах/устгах admin+,
// гараар татах нь авлагын бичих эрх, унших нь авлагын унших эрх. ЗӨВХӨН унших
// холболт — ТЕГ-д юу ч бичихгүй. Нууцын УТГА хариу/аудитад ХЭЗЭЭ Ч орохгүй.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ebarimtTpiConnections } from "@/lib/db/schema";
import {
  loadEbarimtTaxChecks,
  loadTpiConnectionRow,
  syncEbarimtTaxReceipts,
  testTpiConnection,
  toTpiConnectionView,
  type TaxSyncResult,
} from "@/lib/ebarimt/tax-sync";
import type { EbarimtTaxCheckRow, EbarimtTpiConnectionView, TaxCheckSummary } from "@/lib/ebarimt/tax-reconcile";
import { isItcEnvironment } from "@/lib/itc/auth";

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function revalidate() {
  revalidatePath("/inventory/pos-settings");
  revalidatePath("/receivables/ebarimt");
  revalidatePath("/tax/ebarimt");
}

/** Тохиргоо (нууц утгагүй). Тохируулаагүй бол null. */
export async function getEbarimtTpiConnection(): Promise<ActionResult<{ connection: EbarimtTpiConnectionView | null }>> {
  try {
    const { orgId } = await requireRole("admin");
    const row = await loadTpiConnectionRow(orgId);
    return { connection: row ? toTpiConnectionView(row) : null };
  } catch (caught) {
    return actionError("getEbarimtTpiConnection", caught, "ТЕГ-ийн TPI холболтыг уншиж чадсангүй");
  }
}

/**
 * Хадгалах — нууц үг / X-API-KEY ХООСОН бол хуучнаа хөндөхгүй (write-only),
 * анх холбоход нууц үг заавал. X-API-KEY-гүй бол серверийн env ITC_TPI_API_KEY.
 * Нэвтрэх нэр / орчин солигдвол татлагын явц ЭХНЭЭС (өөр татвар төлөгчийн өгөгдөл холилдохгүй).
 */
export async function saveEbarimtTpiConnection(input: {
  environment: string;
  username: string;
  password?: string | null;
  apiKey?: string | null;
  /** true бол хадгалсан X-API-KEY-г устгаж серверийн env-ийг хэрэглэнэ. */
  clearApiKey?: boolean;
  isEnabled: boolean;
}): Promise<ActionResult<{ connection: EbarimtTpiConnectionView }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    if (!isItcEnvironment(input.environment)) throw new Error("Орчноо сонгоно уу (staging / production)");
    const username = cleanText(input.username);
    if (!username) throw new Error("ITC-ийн нэвтрэх нэрээ оруулна уу");
    const password = cleanText(input.password);
    const apiKey = cleanText(input.apiKey);
    const existing = await loadTpiConnectionRow(orgId);
    if (!existing && !password) throw new Error("Анх холбоход нууц үг заавал");
    const identityChanged = !!existing && (existing.username !== username || existing.environment !== input.environment);

    const patch = {
      environment: input.environment,
      username,
      isEnabled: !!input.isEnabled,
      userId,
      updatedAt: new Date(),
      ...(password ? { passwordEnc: encryptSecret(password) } : {}),
      ...(apiKey ? { apiKeyEnc: encryptSecret(apiKey) } : input.clearApiKey ? { apiKeyEnc: null } : {}),
      // Өөр хэрэглэгч/орчин → өмнөх явц, алдаа хүчингүй.
      ...(identityChanged ? { syncFrom: null, syncedThrough: null, lastCheckSummary: null } : {}),
      lastSyncError: null,
    };
    let id: string;
    if (existing) {
      await db.update(ebarimtTpiConnections).set(patch).where(eq(ebarimtTpiConnections.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await db
        .insert(ebarimtTpiConnections)
        .values({ ...patch, organizationId: orgId, passwordEnc: encryptSecret(password) })
        .returning({ id: ebarimtTpiConnections.id });
      id = created.id;
    }
    const changedSecrets = [password && "нууц үг", apiKey && "X-API-KEY", input.clearApiKey && !apiKey && "X-API-KEY устгасан"].filter(Boolean);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: existing ? "update" : "create",
      entityType: "ebarimt_tpi_connection",
      entityId: id,
      summary: `ТЕГ-ийн eBarimt TPI холболт ${existing ? "шинэчлэгдэв" : "үүсгэгдэв"} — ${input.environment}, ${input.isEnabled ? "идэвхтэй" : "идэвхгүй"}${identityChanged ? ", нэвтрэх нэр/орчин солигдож татлага эхнээс" : ""}${changedSecrets.length ? `; ${changedSecrets.join(", ")}` : ""}`,
    });
    revalidate();
    const saved = await loadTpiConnectionRow(orgId);
    if (!saved) throw new Error("ТЕГ-ийн TPI холболт хадгалагдсангүй");
    return { connection: toTpiConnectionView(saved) };
  } catch (caught) {
    return actionError("saveEbarimtTpiConnection", caught, "ТЕГ-ийн TPI холболт хадгалагдсангүй");
  }
}

/** Нэвтэрч өнөөдрийн нэхэмжлэхийг асууна — юу ч хадгалахгүй. */
/** `invoicesToday: null` — бодит орчинд 01:00–07:00-оос гадуур тул зөвхөн нэвтрэлтийг шалгав. */
export async function testEbarimtTpiConnection(): Promise<ActionResult<{ invoicesToday: number | null; skipped: number }>> {
  try {
    const { orgId } = await requireRole("admin");
    return await testTpiConnection(orgId);
  } catch (caught) {
    return actionError("testEbarimtTpiConnection", caught, "ТЕГ-ийн TPI-тэй холбогдож чадсангүй");
  }
}

/** Одоо татах (хуваарийг хүлээхгүй) — нэг удаад ≤ 31 өдөр, үлдсэнийг хуваарьт татлага үргэлжлүүлнэ. */
export async function syncEbarimtTaxNow(): Promise<ActionResult<TaxSyncResult>> {
  try {
    const { orgId, userId } = await requireModuleAction("ar", "write");
    const result = await syncEbarimtTaxReceipts(orgId);
    const row = await loadTpiConnectionRow(orgId);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "sync",
      entityType: "ebarimt_tpi_connection",
      entityId: row?.id ?? orgId,
      summary: `ТЕГ-ээс eBarimt нэхэмжлэх татав — ${result.days.length} өдөр (${result.days[0] ?? "—"} … ${result.days.at(-1) ?? "—"}), нэхэмжлэх ${result.invoices}, төлбөрийн баримт ${result.payments}; зөрүүтэй ${result.summary.problems}`,
    });
    revalidate();
    return result;
  } catch (caught) {
    return actionError("syncEbarimtTaxNow", caught, "ТЕГ-ээс татаж чадсангүй");
  }
}

export async function deleteEbarimtTpiConnection(): Promise<ActionResult<{ ok: true }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const row = await loadTpiConnectionRow(orgId);
    if (!row) return { ok: true };
    await db.delete(ebarimtTpiConnections).where(eq(ebarimtTpiConnections.id, row.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "delete",
      entityType: "ebarimt_tpi_connection",
      entityId: row.id,
      summary: "ТЕГ-ийн eBarimt TPI холболт устгагдав (нууц мэдээлэл хамт устсан; татсан баримт тулгалтад үлдэнэ)",
    });
    revalidate();
    return { ok: true };
  } catch (caught) {
    return actionError("deleteEbarimtTpiConnection", caught, "ТЕГ-ийн TPI холболт устгагдсангүй");
  }
}

/** Тулгалтын жагсаалт (амьд). */
export async function getEbarimtTaxChecks(): Promise<
  ActionResult<{ connection: EbarimtTpiConnectionView | null; rows: EbarimtTaxCheckRow[]; summary: TaxCheckSummary }>
> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    return await loadEbarimtTaxChecks(orgId);
  } catch (caught) {
    return actionError("getEbarimtTaxChecks", caught, "ТЕГ-ийн тулгалтыг уншиж чадсангүй");
  }
}

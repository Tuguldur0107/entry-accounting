"use server";

// ТЕГ-ийн eBarimt TPI холболт + нэхэмжлэхийн үлдэгдлийн тулгалт —
// docs/dev/ebarimt-tax-reconcile.md. Тохиргоо хадгалах/шалгах/устгах admin+,
// гараар татах нь авлагын бичих эрх, унших нь авлагын унших эрх. ЗӨВХӨН унших
// холболт — ТЕГ-д юу ч бичихгүй. Нууцын УТГА хариу/аудитад ХЭЗЭЭ Ч орохгүй.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { arApDocuments, ebarimtTpiConnections } from "@/lib/db/schema";
import {
  loadEbarimtPurchaseChecks,
  syncEbarimtTaxPurchases,
  type PurchaseSyncResult,
} from "@/lib/ebarimt/purchase-sync";
import { syncEbarimtCustomsDeclarations, type CustomsSyncResult } from "@/lib/ebarimt/customs-sync";
import { normalizePurchaseDdtd, type EbarimtPurchaseCheckRow } from "@/lib/ebarimt/purchase-reconcile";
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
      summary: `ТЕГ-ээс борлуулалтын eBarimt татав — ${result.days.length} өдөр (${result.days[0] ?? "—"} … ${result.days.at(-1) ?? "—"}), бүх баримт ${result.receipts}, нэхэмжлэх ${result.invoices}, төлбөрийн баримт ${result.payments}; зөрүүтэй ${result.summary.problems}`,
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

// ── Гаалийн мэдүүлэг (tpiDeclaration) — docs/dev/ebarimt-tax-reconcile.md §10 ──────

/** Гаалийн мэдүүлгийг одоо татах (≤ 16 × 7 хоног, үлдсэнийг хуваарьт татлага). */
export async function syncEbarimtCustomsNow(): Promise<ActionResult<CustomsSyncResult>> {
  try {
    const { orgId, userId } = await requireModuleAction("ap", "write");
    const result = await syncEbarimtCustomsDeclarations(orgId);
    const row = await loadTpiConnectionRow(orgId);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "sync",
      entityType: "ebarimt_tpi_connection",
      entityId: row?.id ?? orgId,
      summary: `Гаалийн мэдүүлэг татав — ${result.ranges[0]?.startDate ?? "—"} … ${result.ranges.at(-1)?.endDate ?? "—"}, мэдүүлэг ${result.declarations}`,
    });
    revalidatePath("/payables/ebarimt");
    return result;
  } catch (caught) {
    return actionError("syncEbarimtCustomsNow", caught, "Гаалийн мэдүүлэг татаж чадсангүй");
  }
}

// ── Худалдан авалт (getSaleListERP) — docs/dev/ebarimt-tax-reconcile.md §7 ──────

/** Худалдан авалтыг одоо татах (≤ 4 × 31 хоног, үлдсэнийг хуваарьт татлага). */
export async function syncEbarimtPurchasesNow(): Promise<ActionResult<PurchaseSyncResult>> {
  try {
    const { orgId, userId } = await requireModuleAction("ap", "write");
    const result = await syncEbarimtTaxPurchases(orgId);
    const row = await loadTpiConnectionRow(orgId);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "sync",
      entityType: "ebarimt_tpi_connection",
      entityId: row?.id ?? orgId,
      summary: `ТЕГ-ээс худалдан авалтын eBarimt татав — ${result.ranges[0]?.startDate ?? "—"} … ${result.ranges.at(-1)?.endDate ?? "—"}, баримт ${result.receipts}; зөрүүтэй ${result.summary.problems}`,
    });
    revalidatePath("/payables/ebarimt");
    return result;
  } catch (caught) {
    return actionError("syncEbarimtPurchasesNow", caught, "ТЕГ-ээс худалдан авалт татаж чадсангүй");
  }
}

/** Худалдан авалтын тулгалт (амьд) + холболтын төлөв. */
export async function getEbarimtPurchaseChecks(): Promise<
  ActionResult<{
    connection: EbarimtTpiConnectionView | null;
    rows: EbarimtPurchaseCheckRow[];
    summary: TaxCheckSummary;
    syncFrom: string | null;
    syncedThrough: string | null;
  }>
> {
  try {
    const { orgId } = await requireModuleAction("ap", "read");
    const row = await loadTpiConnectionRow(orgId);
    const checks = await loadEbarimtPurchaseChecks(orgId);
    return { connection: row ? toTpiConnectionView(row) : null, ...checks };
  } catch (caught) {
    return actionError("getEbarimtPurchaseChecks", caught, "Худалдан авалтын тулгалтыг уншиж чадсангүй");
  }
}

/**
 * Өглөгийн нэхэмжлэхэд нийлүүлэгчийн eBarimt-ийн ДДТД холбох (`ddtd` null = салгах).
 * ДДТД 33 оронтой; байгууллагад НЭГ ДДТД нэг л өглөгт. Журнал хөндөхгүй (мета өгөгдөл)
 * тул хаагдсан үед ч болно; аудитад үлдэнэ.
 */
export async function linkApEbarimtReceipt(input: { documentId: string; ddtd: string | null }): Promise<ActionResult<{ ddtd: string | null }>> {
  try {
    const { orgId, userId } = await requireModuleAction("ap", "write");
    const doc = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.id, input.documentId), eq(arApDocuments.organizationId, orgId)),
      columns: { id: true, documentNo: true, documentType: true, status: true, supplierEbarimtId: true },
    });
    if (!doc) throw new Error("Өглөгийн нэхэмжлэх олдсонгүй");
    if (doc.documentType !== "ap_bill") throw new Error("eBarimt-ийн ДДТД зөвхөн өглөгийн нэхэмжлэхэд холбогдоно");
    if (doc.status === "reversed") throw new Error("Буцаагдсан нэхэмжлэхэд ДДТД холбохгүй");
    const raw = input.ddtd?.trim() ?? "";
    const ddtd = raw ? normalizePurchaseDdtd(raw) : null;
    if (raw && !ddtd) throw new Error("ДДТД 33 оронтой тоо байна");
    if (ddtd === doc.supplierEbarimtId) return { ddtd };
    if (ddtd) {
      const other = await db.query.arApDocuments.findFirst({
        where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.supplierEbarimtId, ddtd)),
        columns: { documentNo: true },
      });
      if (other) throw new Error(`Энэ ДДТД аль хэдийн ${other.documentNo}-д холбогдсон`);
    }
    try {
      await db.update(arApDocuments).set({ supplierEbarimtId: ddtd }).where(eq(arApDocuments.id, doc.id));
    } catch (caught) {
      if ((caught as { code?: string; cause?: { code?: string } })?.code === "23505" || (caught as { cause?: { code?: string } })?.cause?.code === "23505")
        throw new Error("Энэ ДДТД өөр өглөгт холбогдсон байна");
      throw caught;
    }
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: ddtd ? "ebarimt_link" : "ebarimt_unlink",
      entityType: "arap",
      entityId: doc.id,
      summary: ddtd
        ? `${doc.documentNo}: нийлүүлэгчийн eBarimt ДДТД ${ddtd} холбов${doc.supplierEbarimtId ? ` (өмнө ${doc.supplierEbarimtId})` : ""}`
        : `${doc.documentNo}: нийлүүлэгчийн eBarimt ДДТД ${doc.supplierEbarimtId} салгав`,
    });
    revalidatePath("/payables/ebarimt");
    revalidatePath("/payables/documents");
    return { ddtd };
  } catch (caught) {
    return actionError("linkApEbarimtReceipt", caught, "ДДТД холбогдсонгүй");
  }
}

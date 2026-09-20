"use server";

// Дэмжлэгийн сессээс ГАРАХ — топбарын баннерын товч. Орох нь
// /support/enter route (Console-ийн линк), удирдлага нь Entry Console-д.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { auth, currentSupportSession } from "@/lib/auth";
import {
  SUPPORT_AUDIT_ENTITY,
  SUPPORT_COOKIE,
  supportAuditSummary,
} from "@/lib/platform/support";
import { endSupportSession } from "@/lib/platform/support-store";

export async function exitSupportSession(): Promise<ActionResult> {
  try {
    return await exitSupportSessionCore();
  } catch (caught) {
    return actionError("exitSupportSession", caught, "Дэмжлэгийн сессээс гарсангүй");
  }
}

async function exitSupportSessionCore(): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");

  const row = await currentSupportSession(userId);
  const jar = await cookies();
  jar.delete(SUPPORT_COOKIE);

  if (row) {
    await endSupportSession({ id: row.id });
    await logAuditEvent({
      userId,
      organizationId: row.organizationId,
      action: "support_exited",
      entityType: SUPPORT_AUDIT_ENTITY,
      entityId: row.id,
      summary: supportAuditSummary({
        email: row.email,
        role: row.role,
        reason: row.reason,
        issuedBy: row.issuedBy,
      }),
    });
  }
  revalidatePath("/", "layout");
  return {};
}

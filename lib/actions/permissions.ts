"use server";

// Гишүүдийн модулийн эрхийн удирдлага (Тохиргоо → Хэрэглэгчдийн эрх).
// Зөвхөн admin+ тохируулна; owner/admin гишүүнд override үйлчлэхгүй
// (үргэлж бүрэн) тул тэдний мөрийг хадгалахыг хориглоно.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { APP_MODULE_DEFS } from "@/lib/constants/app-modules";
import {
  PERMISSION_LEVELS,
  serializePermissions,
  type ModulePermissions,
  type PermissionLevel,
} from "@/lib/permissions";
import { logAuditEvent } from "@/lib/audit";
import { actionError, type ActionResult } from "@/lib/action-result";

export async function saveMemberPermissions(
  membershipId: string,
  permissions: Record<string, string>
): Promise<ActionResult> {
  try {
    const { orgId, userId } = await requireRole("admin");

    const membership = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.id, membershipId),
        eq(memberships.organizationId, orgId)
      ),
      columns: { id: true, role: true, userId: true },
    });
    if (!membership) return { error: "Гишүүн олдсонгүй" };
    if (membership.role === "owner" || membership.role === "admin")
      return {
        error:
          "Эзэмшигч, админ үргэлж бүрэн эрхтэй — нарийн эрх нягтлан, үзэгч гишүүнд л тохирно",
      };

    // Зөвхөн танигдсан модуль + түвшинг хадгална (fail-safe).
    const validKeys = new Set(APP_MODULE_DEFS.map((def) => def.key));
    const cleaned: ModulePermissions = {};
    for (const [key, value] of Object.entries(permissions)) {
      if (!validKeys.has(key)) continue;
      if (!(PERMISSION_LEVELS as string[]).includes(value)) continue;
      cleaned[key] = value as PermissionLevel;
    }

    await db
      .update(memberships)
      .set({ permissions: serializePermissions(cleaned) })
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.organizationId, orgId)
        )
      );

    // Эрхийн өөрчлөлт — мэдрэг үйлдэл тул аудитын мөрөнд бичнэ.
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "permissions",
      entityType: "membership",
      entityId: membershipId,
      summary: `Гишүүний модулийн эрх өөрчлөгдөв — ${Object.entries(cleaned)
        .map(([key, level]) => `${key}:${level}`)
        .join(", ") || "default"}`,
    });

    // Навигацийн харагдац (none модуль нуугдана) layout-д уншигддаг.
    revalidatePath("/", "layout");
    return {};
  } catch (caught) {
    return actionError(
      "saveMemberPermissions",
      caught,
      "Эрхийн тохиргоо хадгалагдсангүй"
    );
  }
}

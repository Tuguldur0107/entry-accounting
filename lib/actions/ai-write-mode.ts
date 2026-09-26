"use server";

// /ai хуудасны «Шууд бичих» горим — MCP / REST-ээс ирэх бичилтийн горим
// (lib/ai/write-mode.ts). Хэрэглэгч × байгууллага бүрд тусдаа.

import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { isAiWriteMode } from "@/lib/ai/write-mode";
import { storeAiWriteMode } from "@/lib/ai/write-mode-store";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";

export async function saveAiWriteMode(mode: string): Promise<ActionResult> {
  try {
    return await saveAiWriteModeCore(mode);
  } catch (caught) {
    return actionError("saveAiWriteMode", caught, "Горим хадгалагдсангүй");
  }
}

async function saveAiWriteModeCore(mode: string) {
  // «Шууд бичих» нь бичилтийг вэбийн баталгаажуулалтгүй батлах тул бичих эрхтэй л сонгоно.
  const { userId, orgId } = await requireModuleAction("ai", "write");
  if (!isAiWriteMode(mode)) throw new Error("Горим буруу байна");
  await storeAiWriteMode(userId, orgId, mode);
  await logAuditEvent({
    userId,
    organizationId: orgId,
    entityType: "settings",
    entityId: `ai_write_mode:${userId}`,
    action: "ai_write_mode",
    summary: `AI бичилтийн горим: ${mode === "post" ? "Шууд бичих" : "Ноорог"}`,
  });
  revalidatePath("/settings/ai");
  return {};
}

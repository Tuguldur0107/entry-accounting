"use server";

// Периодын өртгийн тооцооллыг ажиллуулах.
// Тооцоолол нь ЦУВАА (C2 → дараагийн C1) тул үргэлж БҮХ периодыг дахин
// боддог — хэсэгчлэн шинэчлэх нь буруу үр дүн өгнө.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { runPeriodicCosting } from "@/lib/costing/period-run";

export type RecalculateResult =
  | {
      ok: true;
      calculated: number;
      blocked: number;
      scopeCount: number;
      periodCodes: string[];
    }
  | { ok: false; code: "unauthenticated" | "failed"; message?: string };

export async function recalculatePeriodicCosting(): Promise<RecalculateResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };

  try {
    const summary = await runPeriodicCosting(userId);
    revalidatePath("/costing");
    revalidatePath("/costing/reports");
    revalidatePath("/costing/control");
    return {
      ok: true,
      calculated: summary.calculated,
      blocked: summary.blocked,
      scopeCount: summary.scopeCount,
      periodCodes: summary.periodCodes,
    };
  } catch (caught) {
    return {
      ok: false,
      code: "failed",
      message: caught instanceof Error ? caught.message : "Тооцоолол амжилтгүй",
    };
  }
}

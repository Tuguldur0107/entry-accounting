"use server";

// Нүүрний анхны туршилтын («Өөрийн компаниа 15 минутад Entry-д») картыг хаах — хэрэглэгчийн түвшинд
// (бүх байгууллага, бүх төхөөрөмж). lib/onboarding/first-run.ts.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function dismissWelcome(): Promise<ActionResult<{ ok: true }>> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return { error: "Нэвтрэх шаардлагатай" };
    await db.update(users).set({ welcomeDismissedAt: new Date() }).where(eq(users.id, userId));
    revalidatePath("/");
    return { ok: true };
  } catch (caught) {
    return actionError("dismissWelcome", caught, "Хааж чадсангүй");
  }
}

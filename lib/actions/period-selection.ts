"use server";

// Периодын сонголтыг cookie-д хадгалах — PeriodFilter component дуудна.
// Хадгалсны дараа component router.refresh() хийж бүх server component
// шинэ сонголтоор дахин ачаална.

import { cookies } from "next/headers";

import { isPeriodCode } from "@/lib/periods/period";
import { isPeriodScope } from "@/lib/periods/scope";
import { PERIOD_COOKIE } from "@/lib/periods/selection";

export async function savePeriodSelection(
  periodCode: string,
  scope: string
): Promise<{ ok: boolean }> {
  if (!isPeriodCode(periodCode) || !isPeriodScope(scope))
    return { ok: false };

  (await cookies()).set(PERIOD_COOKIE, `${periodCode}:${scope}`, {
    path: "/",
    sameSite: "lax",
    // 1 жил — сонголт нь нууц биш UI төлөв.
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}

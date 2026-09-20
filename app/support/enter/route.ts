// Дэмжлэгийн линкээр ОРОХ — Console-ийн «Байгууллагад нэвтрэх» товч энд ирнэ.
//
// Нэвтрэлт: ЭНЭ зам proxy.ts-ийн matcher дотор тул нэвтрээгүй бол NextAuth
// эхлээд /login?callbackUrl=… руу чиглүүлж, оператор ӨӨРИЙН дансаар нэвтэрсний
// дараа буцаж ирнэ. Линк нь ТЭР нэг хэрэглэгчид уягдсан (userId) — өөр хүн
// линкийг олсон ч ашиглаж чадахгүй.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/audit";
import { auth } from "@/lib/auth";
import {
  SUPPORT_AUDIT_ENTITY,
  SUPPORT_COOKIE,
  supportAuditSummary,
  supportCookieMaxAge,
} from "@/lib/platform/support";
import { startSupportSession } from "@/lib/platform/support-store";

function fail(request: Request, message: string): NextResponse {
  const url = new URL("/support/denied", request.url);
  url.searchParams.set("reason", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return fail(request, "Линк дутуу байна");

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail(request, "Нэвтрэх шаардлагатай");

  let row;
  try {
    row = await startSupportSession(token, userId);
  } catch (caught) {
    return fail(request, caught instanceof Error ? caught.message : "Линк хүчингүй");
  }
  if (!row.endsAt) return fail(request, "Сесс эхлээгүй байна");

  const jar = await cookies();
  jar.set(SUPPORT_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: supportCookieMaxAge(row.endsAt),
  });

  // Харилцагч өөрийн /settings/audit дээрээ ХЭН, ХЭЗЭЭ, ЯМАР эрхээр орсныг
  // хардаг — дэмжлэгийн хандалт чимээгүй болохгүй.
  await logAuditEvent({
    userId,
    organizationId: row.organizationId,
    action: "support_entered",
    entityType: SUPPORT_AUDIT_ENTITY,
    entityId: row.id,
    summary: supportAuditSummary({
      email: row.email,
      role: row.role,
      reason: row.reason,
      issuedBy: row.issuedBy,
    }),
  });

  return NextResponse.redirect(new URL("/", request.url));
}

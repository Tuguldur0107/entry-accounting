// Бүртгэлийн хаалт — «эхний хэрэглэгч чөлөөтэй, дараа нь зөвхөн урилгаар».
//
// Харилцагчийн апп нээлттэй интернэтэд байдаг тул /register-ийг хязгаарлахгүй
// бол хэн ч бүртгүүлж чадна. Дата нь `organizationId`-аар тусгаарлагдсан тул
// гаднын хүн харилцагчийн дансыг ХАРАХГҮЙ, гэхдээ хог бүртгэл үүсэх ба
// ажилтнууд өөрсдөө бүртгүүлээд ХООСОН компанид ороод эргэлзэх эрсдэлтэй.
//
// Тиймээс:
//   users хүснэгт хоосон  → нээлттэй (апп шинээр босоход эзэн нь бүртгүүлнэ)
//   нэг ч хэрэглэгч байвал → зөвхөн /register?invite=<token> (lib/actions/org.ts
//                            дахь inviteMember-ийн олгосон линк)
//
// Нийтийн демо зэрэг зориуд нээлттэй байлгах шаардлагатай бол
// `ENTRY_OPEN_REGISTRATION=1` орчны хувьсагчаар дахин нээнэ.
//
// SaaS горимд (ENTRY_DEPLOYMENT_MODE=saas — Entry-ийн үндсэн сервис) бүртгэл
// ҮРГЭЛЖ нээлттэй: шинэ харилцагч бүр өөрөө бүртгүүлж өөрийн байгууллагаа
// (tenant) үүсгэнэ. Дээрх хаалт зөвхөн эх код авсан харилцагчийн тусдаа
// сервист (dedicated) үйлчилнэ — lib/deployment-mode.ts.
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { deploymentMode, resolveRegistrationMode } from "@/lib/deployment-mode";

export type RegistrationMode = "open" | "invite";

/** Орчны хувьсагчаар зориуд нээлттэй болгосон эсэх. */
export function openRegistrationForced(): boolean {
  const value = (process.env.ENTRY_OPEN_REGISTRATION ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** `open` = хэн ч бүртгүүлж болно · `invite` = зөвхөн хүчинтэй урилгын линкээр. */
export async function registrationMode(): Promise<RegistrationMode> {
  const mode = deploymentMode();
  if (mode === "saas" || openRegistrationForced())
    return resolveRegistrationMode({ mode, forcedOpen: openRegistrationForced(), userCount: 1 });
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return resolveRegistrationMode({
    mode,
    forcedOpen: false,
    userCount: row?.count ?? 0,
  });
}

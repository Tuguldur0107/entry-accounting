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
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export type RegistrationMode = "open" | "invite";

/** Орчны хувьсагчаар зориуд нээлттэй болгосон эсэх. */
export function openRegistrationForced(): boolean {
  const value = (process.env.ENTRY_OPEN_REGISTRATION ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** `open` = хэн ч бүртгүүлж болно · `invite` = зөвхөн хүчинтэй урилгын линкээр. */
export async function registrationMode(): Promise<RegistrationMode> {
  if (openRegistrationForced()) return "open";
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return (row?.count ?? 0) === 0 ? "open" : "invite";
}

// Харилцагчийн КОД — Veritech-ийн "Харилцагчийн код"-той ижил утга: РД/ТТД-ээс
// ТУСДАА, байгууллага дотор давтагдашгүй богино танигдахуун (ж: 10001, SUP-042).
// Гараар оноогдоно (автомат дугаарлалт ХИЙХГҮЙ — product owner-ийн шийдвэр
// хүртэл), хоосон байж болно. Хоосон код нь давхардал тооцогдохгүй (partial
// unique index).

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { counterparties } from "@/lib/db/schema";

export const COUNTERPARTY_CODE_MAX_LENGTH = 32;

/** ЦЭВЭР: trim + доторх зайг нэг болгож ТОМ үсэгт шилжүүлнэ; хоосон → null. */
export function normalizeCounterpartyCode(
  code: string | null | undefined
): string | null {
  const value = (code ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!value) return null;
  if (value.length > COUNTERPARTY_CODE_MAX_LENGTH)
    throw new Error(
      `Харилцагчийн код ${COUNTERPARTY_CODE_MAX_LENGTH} тэмдэгтээс урт байж болохгүй`
    );
  return value;
}

/** Байгууллага дотор давхардаагүй эсэхийг шалгана — давхардвал ойлгомжтой алдаа. */
export async function assertCounterpartyCodeAvailable(
  orgId: string,
  code: string | null,
  excludeId?: string
) {
  if (!code) return;
  const taken = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.organizationId, orgId),
      eq(counterparties.code, code),
      ...(excludeId ? [ne(counterparties.id, excludeId)] : [])
    ),
    columns: { id: true, name: true },
  });
  if (taken)
    throw new Error(
      `«${code}» кодтой харилцагч аль хэдийн бүртгэлтэй (${taken.name}). Өөр код ононо уу.`
    );
}

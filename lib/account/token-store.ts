// Нэг удаагийн token-ийн DB давхарга ("use server" БИШ — action, бүртгэл,
// server component гурвуул шууд дуудна). Цэвэр дүрэм lib/account/tokens.ts.

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { authTokens } from "@/lib/db/schema";
import {
  expiryFor,
  generateRawToken,
  hashToken,
  isTokenUsable,
  isWellFormedToken,
  type AuthTokenKind,
} from "@/lib/account/tokens";

/**
 * Шинэ token олгоно — тухайн хэрэглэгчийн ижил төрлийн ХУУЧИН token-уудыг
 * хүчингүй болгоно (сүүлийн линк л ажиллана: алдагдсан хуучин линк хаагдана).
 * Буцаах утга нь raw token — ЗӨВХӨН и-мэйлийн линкэд.
 */
export async function issueAuthToken(
  userId: string,
  kind: AuthTokenKind,
  now: Date = new Date()
): Promise<string> {
  const raw = generateRawToken();
  await db.transaction(async (tx) => {
    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt))
      );
    await tx.insert(authTokens).values({
      userId,
      kind,
      tokenHash: hashToken(raw),
      expiresAt: expiryFor(kind, now),
    });
  });
  return raw;
}

/**
 * Token-ийг АТОМИК зарцуулна: хүчинтэй бол usedAt тавиад userId буцаана,
 * үгүй бол null. Хоёр зэрэг хүсэлт ирэхэд нэг нь л амжилттай (update … where
 * used_at is null).
 */
export async function consumeAuthToken(
  raw: unknown,
  kind: AuthTokenKind,
  now: Date = new Date()
): Promise<string | null> {
  if (!isWellFormedToken(raw)) return null;
  const row = await db.query.authTokens.findFirst({
    where: eq(authTokens.tokenHash, hashToken(raw)),
    columns: { id: true, userId: true, kind: true, expiresAt: true, usedAt: true },
  });
  if (!isTokenUsable(row, kind, now)) return null;
  const [claimed] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.id, row!.id), isNull(authTokens.usedAt)))
    .returning({ userId: authTokens.userId });
  return claimed?.userId ?? null;
}

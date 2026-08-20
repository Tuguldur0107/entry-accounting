"use server";

// MCP холболтын Personal Access Token удирдлага (Тохиргоо → MCP холболт).
// Token нь `eak_` угтвартай 48 тэмдэгт; DB-д зөвхөн sha256 hash хадгалагдана
// тул үүсгэх мөчид НЭГ л удаа бүтнээрээ буцна — дахин харагдахгүй.

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";
import { MAX_TOKENS_PER_USER } from "@/lib/mcp/constants";

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрээгүй байна");
  return userId;
}

export interface ApiTokenView {
  id: string;
  name: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Дуусах огноо (YYYY-MM-DD) — null бол хугацаагүй. */
  expiresAt: string | null;
  /** Хугацаа нь дууссан эсэх — ийм token-оор нэвтрэх боломжгүй. */
  expired: boolean;
}

/** Token-ий хугацааны зөвшөөрөгдсөн сонголтууд (хоногоор). */
const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

function fmtTime(value: Date | null): string | null {
  if (!value) return null;
  return value
    .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
    .slice(0, 16);
}

/** Хэрэглэгчийн бүх token (hash-гүй, зөвхөн танилтын мэдээлэл). */
export async function listApiTokens(): Promise<ApiTokenView[]> {
  const userId = await requireUserId();
  const rows = await db.query.apiTokens.findMany({
    where: eq(apiTokens.userId, userId),
    orderBy: [desc(apiTokens.createdAt)],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenHint: row.tokenHint,
    createdAt: fmtTime(row.createdAt)!,
    lastUsedAt: fmtTime(row.lastUsedAt),
    expiresAt: row.expiresAt ? fmtTime(row.expiresAt)!.slice(0, 10) : null,
    expired: !!row.expiresAt && row.expiresAt.getTime() < Date.now(),
  }));
}

/**
 * Шинэ token үүсгэнэ — бүтэн утга нь ЗӨВХӨН энэ хариунд байна.
 * expiryDays: 30 | 90 | 365 хоног, null/өгөөгүй бол хугацаагүй (CLI клиент
 * гэнэт тасрахаас сэргийлж default нь хугацаагүй).
 *
 * Алдааг ШИДЭХГҮЙ, { error } утгаар буцаана — Next.js production дээр
 * server action-ы шидсэн алдааны мессежийг нууж (React #441) хэрэглэгчид
 * ойлгомжгүй болгодог тул хүлээгдэх алдаа заавал утгаар буцах ёстой.
 */
export async function createApiToken(
  name: string,
  expiryDays?: number | null
): Promise<{ token?: string; error?: string }> {
  try {
    // Фаз 01 (Шат 6): token нь ИДЭВХТЭЙ байгууллагад уягдана — MCP клиент
    // энэ token-оор зөвхөн тэр org-ийн дата руу ханддаг. admin+ эрх шаардана.
    const { orgId, userId } = await requireRole("admin");

    const trimmed = typeof name === "string" ? name.trim().slice(0, 60) : "";
    if (!trimmed)
      return { error: "Token-д нэр өгнө үү (жишээ нь: Claude Code)" };

    const days = expiryDays ?? null;
    if (
      days !== null &&
      !TOKEN_EXPIRY_DAYS.includes(days as (typeof TOKEN_EXPIRY_DAYS)[number])
    )
      return {
        error:
          "Хугацааны сонголт буруу байна (30/90/365 хоног эсвэл хугацаагүй)",
      };
    const expiresAt =
      days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const token = `eak_${randomBytes(24).toString("hex")}`;

    // Тоолох + insert хоёрыг зэрэгцээ хүсэлтээс хамгаална — advisory lock
    // (key 6; 1–5 нь бусад модульд эзлэгдсэн) нэг хэрэглэгчийн token үүсгэлтийг
    // цуваа болгож max хязгаарыг race-гүй сахиулна.
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${userId}), 6)`
      );
      const existing = await tx.query.apiTokens.findMany({
        where: eq(apiTokens.userId, userId),
        columns: { id: true },
      });
      if (existing.length >= MAX_TOKENS_PER_USER)
        throw new Error(
          `Дээд тал нь ${MAX_TOKENS_PER_USER} token — хуучнаас нь устгаад дахин үүсгэнэ үү`
        );

      await tx.insert(apiTokens).values({
        userId,
        organizationId: orgId,
        name: trimmed,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        tokenHint: token.slice(-4),
        expiresAt,
      });
    });

    revalidatePath("/ai/settings");
    return { token };
  } catch (caught) {
    return {
      error:
        caught instanceof Error ? caught.message : "Token үүсгэж чадсангүй",
    };
  }
}

/** Token-ыг хүчингүй болгоно — тухайн холболт шууд тасарна. */
export async function revokeApiToken(
  id: string
): Promise<{ error?: string }> {
  try {
    const userId = await requireUserId();
    await db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
    revalidatePath("/ai/settings");
    return {};
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : "Устгаж чадсангүй",
    };
  }
}

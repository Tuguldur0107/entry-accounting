"use server";

// MCP холболтын Personal Access Token удирдлага (Тохиргоо → MCP холболт).
// Token нь `eak_` угтвартай 48 тэмдэгт; DB-д зөвхөн sha256 hash хадгалагдана
// тул үүсгэх мөчид НЭГ л удаа бүтнээрээ буцна — дахин харагдахгүй.

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";

const MAX_TOKENS_PER_USER = 5;

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
}

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
  }));
}

/** Шинэ token үүсгэнэ — бүтэн утга нь ЗӨВХӨН энэ хариунд байна. */
export async function createApiToken(name: string): Promise<{ token: string }> {
  const userId = await requireUserId();

  const trimmed = typeof name === "string" ? name.trim().slice(0, 60) : "";
  if (!trimmed) throw new Error("Token-д нэр өгнө үү (жишээ нь: Claude Code)");

  const existing = await db.query.apiTokens.findMany({
    where: eq(apiTokens.userId, userId),
    columns: { id: true },
  });
  if (existing.length >= MAX_TOKENS_PER_USER)
    throw new Error(
      `Дээд тал нь ${MAX_TOKENS_PER_USER} token — хуучнаас нь устгаад дахин үүсгэнэ үү`
    );

  const token = `eak_${randomBytes(24).toString("hex")}`;
  await db.insert(apiTokens).values({
    userId,
    name: trimmed,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenHint: token.slice(-4),
  });

  revalidatePath("/ai/settings");
  return { token };
}

/** Token-ыг хүчингүй болгоно — тухайн холболт шууд тасарна. */
export async function revokeApiToken(id: string) {
  const userId = await requireUserId();
  await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
  revalidatePath("/ai/settings");
}

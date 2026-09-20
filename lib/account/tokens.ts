// Нэг удаагийн нууц token-ийн ЦЭВЭР логик (тесттэй, DB-гүй) — нууц үг
// сэргээх линк, и-мэйл баталгаажуулах линк хоёуланд ашиглагдана.
//
// Дүрэм: DB-д зөвхөн sha256 hash хадгална (API token-той ИЖИЛ зарчим —
// DB алдагдсан ч линк хүчинтэй болохгүй); raw token зөвхөн и-мэйлээр
// хэрэглэгчид очно; хугацаатай, нэг удаа ашиглагдана.

import { createHash, randomBytes } from "node:crypto";

export type AuthTokenKind = "password_reset" | "email_verify";

/** Хугацаа (мс) — сэргээх линк богино, баталгаажуулах линк урт. */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  password_reset: 60 * 60_000, // 1 цаг
  email_verify: 24 * 60 * 60_000, // 24 цаг
};

/** 32 байт = 64 hex тэмдэгт — таах боломжгүй, URL-д аюулгүй. */
export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** URL-аас ирсэн token-ий хэлбэр зөв үү (64 hex) — DB руу очихын өмнө. */
export function isWellFormedToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw);
}

export type AuthTokenRow = {
  kind: string;
  expiresAt: Date;
  usedAt: Date | null;
};

/** Мөр нь тухайн зорилгоор, хугацаа дуусаагүй, ашиглагдаагүй үү. */
export function isTokenUsable(
  row: AuthTokenRow | null | undefined,
  kind: AuthTokenKind,
  now: Date = new Date()
): boolean {
  if (!row) return false;
  if (row.kind !== kind) return false;
  if (row.usedAt) return false;
  return row.expiresAt.getTime() > now.getTime();
}

export function expiryFor(kind: AuthTokenKind, now: Date = new Date()): Date {
  return new Date(now.getTime() + AUTH_TOKEN_TTL_MS[kind]);
}

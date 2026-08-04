// OAuth 2.1 authorization server-ийн ЦӨМ — claude.ai / Cowork-ийн custom
// connector "Connect" урсгалд зориулагдсан:
//
//   1. Клиент /.well-known/oauth-authorization-server metadata уншина
//   2. POST /api/oauth/register  (RFC 7591 dynamic client registration)
//   3. Хэрэглэгчийг /oauth/authorize руу илгээнэ (нэвтрэлт + зөвшөөрөл)
//      → authorization code (PKCE S256 заавал)
//   4. POST /api/oauth/token — code + verifier → access/refresh token
//   5. MCP хүсэлтүүд Bearer access token-оор ирнэ (lib/mcp/server.ts)
//
// Бүх нууц sha256 hash-аараа хадгалагдана; refresh рotation-тэй.

import { createHash, randomBytes } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { oauthClients, oauthCodes, oauthTokens } from "@/lib/db/schema";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 минут
const ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 хоног
export const ACCESS_TTL_SECONDS = ACCESS_TTL_MS / 1000;

export function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** PKCE S256: base64url(sha256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  return b64url(createHash("sha256").update(verifier).digest()) === challenge;
}

// ── Клиент ──────────────────────────────────────────────────────────────────

export async function registerOAuthClient(input: {
  name: string;
  redirectUris: string[];
}) {
  const [client] = await db
    .insert(oauthClients)
    .values({
      name: input.name.slice(0, 120),
      redirectUris: JSON.stringify(input.redirectUris),
    })
    .returning();
  return client;
}

export async function findOAuthClient(clientId: string) {
  // UUID биш утга өгвөл DB алдаа шидэхээс сэргийлнэ.
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const client = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.id, clientId),
  });
  return client ?? null;
}

export function clientRedirectUris(client: { redirectUris: string }): string[] {
  try {
    const parsed = JSON.parse(client.redirectUris);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

// ── Authorization code ──────────────────────────────────────────────────────

export async function createAuthCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = `eac_${randomBytes(32).toString("hex")}`;
  await db.insert(oauthCodes).values({
    codeHash: sha256hex(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function issueTokens(userId: string, clientId: string): Promise<IssuedTokens> {
  const accessToken = `eoat_${randomBytes(32).toString("hex")}`;
  const refreshToken = `eort_${randomBytes(32).toString("hex")}`;
  await db.insert(oauthTokens).values({
    userId,
    clientId,
    accessTokenHash: sha256hex(accessToken),
    refreshTokenHash: sha256hex(refreshToken),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_MS),
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
}

export type TokenExchangeResult =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; error: string; description: string };

/** authorization_code grant — code нэг л удаа хэрэглэгдэнэ. */
export async function exchangeAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri?: string;
  codeVerifier: string;
}): Promise<TokenExchangeResult> {
  const row = await db.query.oauthCodes.findFirst({
    where: eq(oauthCodes.codeHash, sha256hex(input.code)),
  });
  // Code-ыг ОЛДМОГЦ устгана — дахин ашиглалт (replay) боломжгүй.
  if (row)
    await db.delete(oauthCodes).where(eq(oauthCodes.id, row.id));

  if (!row || row.expiresAt.getTime() < Date.now())
    return {
      ok: false,
      error: "invalid_grant",
      description: "Code хүчингүй эсвэл хугацаа нь дууссан",
    };
  if (row.clientId !== input.clientId)
    return { ok: false, error: "invalid_grant", description: "client_id таарахгүй" };
  if (input.redirectUri && row.redirectUri !== input.redirectUri)
    return { ok: false, error: "invalid_grant", description: "redirect_uri таарахгүй" };
  if (!input.codeVerifier || !verifyPkce(input.codeVerifier, row.codeChallenge))
    return { ok: false, error: "invalid_grant", description: "PKCE шалгалт амжилтгүй" };

  return { ok: true, tokens: await issueTokens(row.userId, row.clientId) };
}

/** refresh_token grant — rotation: хуучин мөр устаж шинэ хос гарна. */
export async function refreshOAuthTokens(input: {
  refreshToken: string;
  clientId?: string;
}): Promise<TokenExchangeResult> {
  const row = await db.query.oauthTokens.findFirst({
    where: eq(oauthTokens.refreshTokenHash, sha256hex(input.refreshToken)),
  });
  if (!row)
    return { ok: false, error: "invalid_grant", description: "Refresh token хүчингүй" };
  if (input.clientId && row.clientId !== input.clientId)
    return { ok: false, error: "invalid_grant", description: "client_id таарахгүй" };

  await db.delete(oauthTokens).where(eq(oauthTokens.id, row.id));
  return { ok: true, tokens: await issueTokens(row.userId, row.clientId) };
}

// ── Resource server тал ─────────────────────────────────────────────────────

/** Bearer access token → userId. Хугацаа дууссан/олдоогүй бол null. */
export async function resolveOAuthAccessToken(token: string): Promise<string | null> {
  const row = await db.query.oauthTokens.findFirst({
    where: eq(oauthTokens.accessTokenHash, sha256hex(token)),
    columns: { id: true, userId: true, accessExpiresAt: true },
  });
  if (!row || row.accessExpiresAt.getTime() < Date.now()) return null;
  void (async () => {
    try {
      await db
        .update(oauthTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(oauthTokens.id, row.id));
      // Хугацаа дууссан хуучин мөрүүдийг зэрэг цэвэрлэнэ (access дууссанаас
      // хойш refresh хийгээгүй 60 хоног өнгөрсөн бол).
      await db
        .delete(oauthTokens)
        .where(
          and(
            lt(oauthTokens.accessExpiresAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000))
          )
        );
    } catch {
      // Цэвэрлэгээ амжилтгүй байсан ч хүсэлтэд нөлөөлөхгүй.
    }
  })();
  return row.userId;
}

/** CORS — well-known/register/token endpoint-уудыг browser клиентээс уншина. */
export const OAUTH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
} as const;

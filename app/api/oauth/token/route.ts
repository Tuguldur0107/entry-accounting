// OAuth token endpoint — authorization_code (PKCE) болон refresh_token
// grant. Хариултууд RFC 6749-ийн алдааны форматтай.

import {
  exchangeAuthCode,
  OAUTH_CORS_HEADERS,
  refreshOAuthTokens,
  type TokenExchangeResult,
} from "@/lib/oauth/server";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** form-urlencoded ЭСВЭЛ JSON body-г нэг мөр болгож уншина. */
async function readParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      return Object.fromEntries(
        Object.entries(body ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
    } catch {
      return {};
    }
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

function tokenResponse(result: TokenExchangeResult): Response {
  if (!result.ok)
    return Response.json(
      { error: result.error, error_description: result.description },
      { status: 400, headers: OAUTH_CORS_HEADERS }
    );
  return Response.json(
    {
      access_token: result.tokens.accessToken,
      token_type: "bearer",
      expires_in: result.tokens.expiresIn,
      refresh_token: result.tokens.refreshToken,
      scope: "mcp",
    },
    { headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const params = await readParams(request);

  // Code/refresh token таах оролдлогоос хамгаална: клиент (эсвэл IP) бүрд
  // 5 минутад 30 хүсэлт.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`oauth-token:${params.client_id || ip}`, 30, 5 * 60_000))
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Хэт олон хүсэлт — түр хүлээгээд дахин оролдоно уу",
      },
      { status: 429, headers: OAUTH_CORS_HEADERS }
    );

  if (params.grant_type === "authorization_code") {
    return tokenResponse(
      await exchangeAuthCode({
        code: params.code ?? "",
        clientId: params.client_id ?? "",
        redirectUri: params.redirect_uri,
        codeVerifier: params.code_verifier ?? "",
      })
    );
  }

  if (params.grant_type === "refresh_token") {
    return tokenResponse(
      await refreshOAuthTokens({
        refreshToken: params.refresh_token ?? "",
        clientId: params.client_id,
      })
    );
  }

  return Response.json(
    {
      error: "unsupported_grant_type",
      error_description: "authorization_code эсвэл refresh_token дэмжигдэнэ",
    },
    { status: 400, headers: OAUTH_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

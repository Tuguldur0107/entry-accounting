// RFC 8414 — OAuth authorization server metadata. MCP клиентүүд заримдаа
// resource-ийн path-тай хувилбарыг (/.well-known/oauth-authorization-server/
// api/mcp) дууддаг тул optional catch-all-аар хоёуланд нь хариулна.
// proxy.ts-ийн matcher .well-known-ийг алгасдаг (login redirect орохгүй).

import { OAUTH_CORS_HEADERS } from "@/lib/oauth/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    },
    { headers: OAUTH_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

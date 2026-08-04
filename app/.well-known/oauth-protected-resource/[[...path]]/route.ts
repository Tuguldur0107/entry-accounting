// RFC 9728 — protected resource metadata. MCP клиент 401 авмагц эндээс
// authorization server-ээ олно. Path-тай хувилбар (/.well-known/
// oauth-protected-resource/api/mcp) нь тухайн resource-ийн URI-г заана.

import { OAUTH_CORS_HEADERS } from "@/lib/oauth/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const origin = new URL(request.url).origin;
  const { path } = await params;
  const resource =
    path && path.length > 0 ? `${origin}/${path.join("/")}` : origin;
  return Response.json(
    {
      resource,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    },
    { headers: OAUTH_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

// RFC 7591 — dynamic client registration. claude.ai / Cowork "Connect"
// дарахад өөрийгөө клиентээр бүртгүүлнэ. Public client (нууцгүй, PKCE
// заавал) тул client_secret олгохгүй.

import { OAUTH_CORS_HEADERS, registerOAuthClient } from "@/lib/oauth/server";

export const runtime = "nodejs";

function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    // https заавал; локал хөгжүүлэлтэд localhost-ийн http-г зөвшөөрнө.
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: {
    redirect_uris?: unknown;
    client_name?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "JSON задлагдсангүй" },
      { status: 400, headers: OAUTH_CORS_HEADERS }
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter(
        (uri): uri is string => typeof uri === "string" && isValidRedirectUri(uri)
      )
    : [];
  if (redirectUris.length === 0) {
    return Response.json(
      {
        error: "invalid_redirect_uri",
        error_description: "Дор хаяж нэг зөв redirect_uri шаардлагатай",
      },
      { status: 400, headers: OAUTH_CORS_HEADERS }
    );
  }

  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim()
      : "MCP клиент";

  const client = await registerOAuthClient({ name, redirectUris });

  return Response.json(
    {
      client_id: client.id,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: OAUTH_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

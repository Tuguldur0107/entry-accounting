// RFC 7591 — dynamic client registration. claude.ai / Cowork "Connect"
// дарахад өөрийгөө клиентээр бүртгүүлнэ. Public client (нууцгүй, PKCE
// заавал) тул client_secret олгохгүй.

import { OAUTH_CORS_HEADERS, registerOAuthClient } from "@/lib/oauth/server";

export const runtime = "nodejs";

// Аюултай scheme-үүд — browser дотор код ажиллуулж чадна.
const BLOCKED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
]);

function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (BLOCKED_SCHEMES.has(url.protocol)) return false;
    // http зөвхөн loopback-д (RFC 8252 native app). https болон native
    // app-ийн private-use scheme (claude:// гэх мэт) зөвшөөрөгдөнө —
    // Cowork/desktop клиентүүд custom scheme callback ашигладаг.
    if (url.protocol === "http:")
      return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return true;
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
    // Ямар URI няцаагдсаныг серверийн логт үлдээнэ — клиент бүр өөр
    // callback хэлбэртэй тул дараагийн оношилгоонд хэрэгтэй.
    console.error("OAuth DCR rejected redirect_uris:", body.redirect_uris);
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

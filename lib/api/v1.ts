// REST API v1 — гадаад системүүд (ERP, CRM, POS, n8n/Make, өөрийн скрипт)
// MCP клиент биш ч Entry-тэй холбогдох зам. Tools = чатын agent болон
// MCP-тэй ЯГ ИЖИЛ давхарга (lib/ai/tools.ts + custom/) — ноорог-first,
// 10 сая ₮ хязгаар, периодын хамгаалалт, externalRef idempotency бүгд
// үйлчилнэ. Нэвтрэлт: ижил Bearer token (eak_ PAT эсвэл eoat_ OAuth).
//
//   GET  /api/v1/tools          — tool жагсаалт + JSON schema
//   POST /api/v1/tools/<name>   — body = tool input → { ok, result, action?, code? }

import { runAsOrg } from "@/lib/auth";
import { allAiTools, executeAiTool } from "@/lib/ai/tools";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { resolveApiToken, writeModeOf } from "@/lib/mcp/server";
import { publicOrigin, type TokenContext } from "@/lib/oauth/server";
import { APP_VERSION } from "@/lib/version";

const VERSION_HEADER = { "X-Entry-Version": APP_VERSION };

export function bearerToken(request: Request): string {
  const header = (request.headers.get("authorization") ?? "").trim();
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, "").trim();
  return /^e(ak|oat)_/.test(header) ? header : "";
}

export async function authenticate(request: Request): Promise<TokenContext | null> {
  return resolveApiToken(bearerToken(request));
}

export function unauthorized(request: Request): Response {
  const origin = publicOrigin(request);
  return Response.json(
    {
      ok: false,
      code: "UNAUTHORIZED",
      error:
        "Token буруу эсвэл хүчингүй — Тохиргоо → AI туслах → MCP холболт хэсгээс үүсгэнэ үү",
    },
    {
      status: 401,
      headers: {
        ...VERSION_HEADER,
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
      },
    }
  );
}

export function listTools(): Response {
  return Response.json(
    {
      ok: true,
      version: APP_VERSION,
      tools: allAiTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        endpoint: `/api/v1/tools/${tool.name}`,
      })),
    },
    { headers: VERSION_HEADER }
  );
}

/** "Алдаа: [CODE] текст" → { code, message }. */
function parseError(text: string): { code: string; message: string } {
  const body = text.replace(/^Алдаа:\s*/, "");
  const match = /^\[([A-Z_]+)\]\s*([\s\S]*)$/.exec(body);
  return match
    ? { code: match[1], message: match[2] }
    : { code: "TOOL_ERROR", message: body };
}

export async function callTool(
  context: TokenContext,
  name: string,
  request: Request
): Promise<Response> {
  if (!allAiTools().some((tool) => tool.name === name))
    return Response.json(
      { ok: false, code: "TOOL_NOT_FOUND", error: `"${name}" гэдэг tool байхгүй — GET /api/v1/tools` },
      { status: 404, headers: VERSION_HEADER }
    );
  if (!checkAiRateLimit(context.userId))
    return Response.json(
      { ok: false, code: "RATE_LIMITED", error: "Хэт олон хүсэлт — 1 минут хүлээгээд дахин оролдоно уу" },
      { status: 429, headers: { ...VERSION_HEADER, "Retry-After": "60" } }
    );

  let input: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      return Response.json(
        { ok: false, code: "BAD_JSON", error: "Request body JSON задлагдсангүй" },
        { status: 400, headers: VERSION_HEADER }
      );
    }
  }

  const mode = await writeModeOf(context);
  const result = await runAsOrg(context, () =>
    executeAiTool(context.userId, name, input, mode)
  );
  if (result.resultText.startsWith("Алдаа:")) {
    const { code, message } = parseError(result.resultText);
    return Response.json(
      { ok: false, code, error: message },
      // Validation/бизнесийн алдаа — 422; дотоод алдаа — 500.
      { status: message.startsWith("Дотоод алдаа") ? 500 : 422, headers: VERSION_HEADER }
    );
  }
  return Response.json(
    {
      ok: true,
      result: result.resultText,
      action: result.action ?? null,
      dedup: result.dedup ?? false,
      mode,
    },
    { headers: VERSION_HEADER }
  );
}

// MCP серверийн ЦӨМ — хоёр route хуваалцана:
//   /api/mcp           Bearer header-тэй (Claude Code CLI)
//   /api/mcp/[token]   Token нь URL-д (claude.ai / Cowork-ийн custom
//                      connector — тэнд header тохируулах боломжгүй)
//
// Streamable HTTP, STATELESS горим — хүсэлт бүр бие даасан JSON-RPC POST,
// хариу нь энгийн application/json. Tools = чатын agent-тай ЯГ ИЖИЛ давхарга
// (lib/ai/tools.ts) — ноорог-first, 10 сая ₮ хязгаар, периодын хамгаалалт
// бүгд үйлчилнэ. Server action доторх auth()/getActiveOrg() дуудлагууд
// runAsOrg()-ийн ачаар token-ий эзний session + token-д уягдсан байгууллага
// мэт ажиллана (lib/auth.ts).

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { runAsOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiSettings, apiTokens } from "@/lib/db/schema";
import {
  publicOrigin,
  resolveOAuthAccessToken,
  type TokenContext,
} from "@/lib/oauth/server";
import {
  DEFAULT_AI_WRITE_MODE,
  isAiWriteMode,
  type AiWriteMode,
} from "@/lib/ai/models";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";

const PROTOCOL_VERSION = "2025-06-18";
/** Нэг JSON-RPC batch POST-д зөвшөөрөх дуудлагын дээд тоо. */
const MAX_BATCH_REQUESTS = 20;
const SERVER_INFO = {
  name: "entry-accounting",
  title: "Entry Accounting",
  version: "1.0.0",
};

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Түлхий token → {userId, orgId}. Хоёр төрлийг хүлээнэ:
 *   eak_...  Personal Access Token (Тохиргоо → MCP холболт)
 *   eoat_... OAuth access token (custom connector-ийн Connect урсгал)
 * Фаз 01 (Шат 6): token үүсэх мөчийн идэвхтэй байгууллагад уягдсан —
 * бүх хандалт тэр org-ийн scope-д явна.
 */
export async function resolveApiToken(
  token: string
): Promise<TokenContext | null> {
  if (!token) return null;
  if (token.startsWith("eoat_")) return resolveOAuthAccessToken(token);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.tokenHash, tokenHash),
    columns: { id: true, userId: true, organizationId: true, expiresAt: true },
  });
  if (!row) return null;
  // Хугацаа нь дууссан token — буруу token-той ижил хандлагаар татгалзана.
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  // Backfill-ээр бүх token org-той; org-гүй мөр — хүчингүй token.
  if (!row.organizationId) return null;
  const context: TokenContext = { userId: row.userId, orgId: row.organizationId };
  // Хяналтын мэдээлэл — амжилтыг хүлээлгүй үргэлжлүүлнэ.
  void (async () => {
    try {
      await db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokens.id, row.id));
    } catch {
      // lastUsedAt тэмдэглэгээ амжилтгүй байсан ч хүсэлтэд нөлөөлөхгүй.
    }
  })();
  return context;
}

/** Хэрэглэгчийн сонгосон бичилтийн горим (чатын toggle-тэй нэг тохиргоо) — org бүрд тусдаа. */
async function writeModeOf(context: TokenContext): Promise<AiWriteMode> {
  const settings = await db.query.aiSettings.findFirst({
    where: and(
      eq(aiSettings.userId, context.userId),
      eq(aiSettings.organizationId, context.orgId)
    ),
    columns: { writeMode: true },
  });
  return settings && isAiWriteMode(settings.writeMode)
    ? settings.writeMode
    : DEFAULT_AI_WRITE_MODE;
}

async function handleRequest(
  context: TokenContext,
  message: JsonRpcRequest
): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const method = message.method ?? "";

  // Notification (id байхгүй) — хариу шаардахгүй.
  if (message.id === undefined && method.startsWith("notifications/"))
    return null;

  switch (method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion:
          typeof requested === "string" ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Монгол нягтлан бодох бүртгэлийн систем. Бичилт үүсгэх tools нь " +
          "ноорог-first: хэрэглэгч 'Шууд бичих' горим сонгосон үед л тэнцсэн, " +
          "10 сая ₮ хүртэлх бичилт шууд батлагдана. Данс, харилцагч, бараа " +
          "нэрээ мэдэхгүй бол эхлээд list_* tools-оор шалгана.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: AI_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call": {
      // Чатын route-тай ИЖИЛ хэрэглэгч-бүрийн sliding-window хязгаар — MCP
      // клиент tool-давхаргыг хязгааргүй цохихоос хамгаална. HTTP 500 биш
      // JSON-RPC алдаагаар буцаана (клиент retry-гээ өөрөө удирдана).
      if (!checkAiRateLimit(context.userId))
        return rpcError(
          id,
          -32000,
          "Хэт олон хүсэлт — 1 минут хүлээгээд дахин оролдоно уу"
        );
      const name = String(message.params?.name ?? "");
      const args = message.params?.arguments ?? {};
      const mode = await writeModeOf(context);
      // runAsOrg: fn доторх auth() нь token-ий эзнээр, getActiveOrg() нь
      // token-д уягдсан байгууллагаар хариулна (гишүүнчлэл ДАХИН шалгагдана).
      const result = await runAsOrg(context, () =>
        executeAiTool(context.userId, name, args, mode)
      );
      return rpcResult(id, {
        content: [{ type: "text", text: result.resultText }],
        isError: result.resultText.startsWith("Алдаа:"),
      });
    }
    default:
      return rpcError(id, -32601, `"${method}" метод дэмжигдэхгүй`);
  }
}

/** Танигдсан хэрэглэгчийн JSON-RPC POST body-г бүрэн боловсруулна. */
export async function handleMcpPost(
  context: TokenContext,
  request: Request
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "JSON задлагдсангүй"), {
      status: 400,
    });
  }

  try {
    if (Array.isArray(body)) {
      // Хязгааргүй batch массив нэг POST-оор серверийг дарахаас сэргийлнэ.
      if (body.length > MAX_BATCH_REQUESTS)
        return Response.json(
          rpcError(
            null,
            -32600,
            `Batch хэт урт (${body.length}) — нэг хүсэлтэд дээд тал нь ${MAX_BATCH_REQUESTS} дуудлага`
          ),
          { status: 400 }
        );
      const responses = [];
      for (const entry of body) {
        const response = await handleRequest(context, entry as JsonRpcRequest);
        if (response) responses.push(response);
      }
      if (responses.length === 0) return new Response(null, { status: 202 });
      return Response.json(responses);
    }

    const response = await handleRequest(context, body as JsonRpcRequest);
    // Notification — 202 Accepted, биегүй.
    if (!response) return new Response(null, { status: 202 });
    return Response.json(response);
  } catch (caught) {
    console.error("MCP error:", caught);
    return Response.json(
      rpcError(
        (body as JsonRpcRequest)?.id ?? null,
        -32603,
        "Дотоод алдаа гарлаа"
      ),
      { status: 500 }
    );
  }
}

export function mcpUnauthorized(request: Request): Response {
  // resource_metadata заавар — OAuth чадвартай клиент (claude.ai custom
  // connector) эндээс authorization server-ээ олж Connect урсгалаа эхлүүлнэ.
  const origin = publicOrigin(request);
  return Response.json(
    {
      error:
        "Token буруу эсвэл хүчингүй — Тохиргоо → MCP холболт хэсгээс шинээр үүсгэнэ үү",
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
      },
    }
  );
}

// Server-initiated stream дэмжихгүй (stateless) — спекийн дагуу 405.
export function mcpMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

// Session байхгүй тул устгах зүйлгүй — амжилттай гэж хариулна.
export function mcpDeleteOk(): Response {
  return new Response(null, { status: 200 });
}

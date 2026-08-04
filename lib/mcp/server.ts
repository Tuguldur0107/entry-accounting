// MCP серверийн ЦӨМ — хоёр route хуваалцана:
//   /api/mcp           Bearer header-тэй (Claude Code CLI)
//   /api/mcp/[token]   Token нь URL-д (claude.ai / Cowork-ийн custom
//                      connector — тэнд header тохируулах боломжгүй)
//
// Streamable HTTP, STATELESS горим — хүсэлт бүр бие даасан JSON-RPC POST,
// хариу нь энгийн application/json. Tools = чатын agent-тай ЯГ ИЖИЛ давхарга
// (lib/ai/tools.ts) — ноорог-first, 10 сая ₮ хязгаар, периодын хамгаалалт
// бүгд үйлчилнэ. Server action доторх auth() дуудлагууд runAsUser()-ийн
// ачаар token-ий эзний session мэт ажиллана (lib/auth.ts).

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { runAsUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiSettings, apiTokens } from "@/lib/db/schema";
import {
  DEFAULT_AI_WRITE_MODE,
  isAiWriteMode,
  type AiWriteMode,
} from "@/lib/ai/models";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";

const PROTOCOL_VERSION = "2025-06-18";
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

/** Түлхий token → userId (sha256 тулгалт + lastUsedAt тэмдэглэнэ). */
export async function resolveApiToken(token: string): Promise<string | null> {
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.tokenHash, tokenHash),
    columns: { id: true, userId: true },
  });
  if (!row) return null;
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
  return row.userId;
}

/** Хэрэглэгчийн сонгосон бичилтийн горим (чатын toggle-тэй нэг тохиргоо). */
async function writeModeOf(userId: string): Promise<AiWriteMode> {
  const settings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.userId, userId),
    columns: { writeMode: true },
  });
  return settings && isAiWriteMode(settings.writeMode)
    ? settings.writeMode
    : DEFAULT_AI_WRITE_MODE;
}

async function handleRequest(
  userId: string,
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
      const name = String(message.params?.name ?? "");
      const args = message.params?.arguments ?? {};
      const mode = await writeModeOf(userId);
      const result = await runAsUser(userId, () =>
        executeAiTool(userId, name, args, mode)
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
  userId: string,
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
      const responses = [];
      for (const entry of body) {
        const response = await handleRequest(userId, entry as JsonRpcRequest);
        if (response) responses.push(response);
      }
      if (responses.length === 0) return new Response(null, { status: 202 });
      return Response.json(responses);
    }

    const response = await handleRequest(userId, body as JsonRpcRequest);
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

export function mcpUnauthorized(): Response {
  return Response.json(
    {
      error:
        "Token буруу эсвэл хүчингүй — Тохиргоо → MCP холболт хэсгээс шинээр үүсгэнэ үү",
    },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
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

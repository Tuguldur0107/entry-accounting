// MCP endpoint — Bearer header хувилбар (Claude Code CLI):
//
//   claude mcp add --transport http --scope user entry-accounting \
//     https://<domain>/api/mcp --header "Authorization: Bearer <token>"
//
// Цөм логик lib/mcp/server.ts-д — /api/mcp/[token] хувилбартай хуваалцана.

import {
  handleMcpPost,
  mcpDeleteOk,
  mcpMethodNotAllowed,
  mcpUnauthorized,
  resolveApiToken,
} from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const header = (request.headers.get("authorization") ?? "").trim();
  // "Bearer <token>" стандарт; зарим MCP клиент угтваргүй түүхий token
  // явуулдаг тул манай өөрийн форматтай (eak_/eoat_) утгыг мөн хүлээж авна.
  const token = /^bearer\s+/i.test(header)
    ? header.replace(/^bearer\s+/i, "").trim()
    : /^e(ak|oat)_/.test(header)
      ? header
      : "";
  const userId = await resolveApiToken(token);
  if (!userId) return mcpUnauthorized(request);
  return handleMcpPost(userId, request);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpDeleteOk();
}

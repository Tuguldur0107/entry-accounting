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
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const userId = await resolveApiToken(token);
  if (!userId) return mcpUnauthorized();
  return handleMcpPost(userId, request);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpDeleteOk();
}

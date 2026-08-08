// MCP endpoint — token нь URL-д багтсан хувилбар:
//
//   https://<domain>/api/mcp/<token>
//
// claude.ai / Cowork-ийн "Add custom connector" хэсэг header тохируулах
// боломж олгодоггүй тул энэ хэлбэрээр холбоно. Token URL-д явж байгаа тул
// холбоосыг НУУЦ мэт хадгална — алдагдвал Тохиргоо → MCP холболт хэсгээс
// хүчингүй болгоход л хангалттай. Цөм логик lib/mcp/server.ts-д.

import {
  handleMcpPost,
  mcpDeleteOk,
  mcpMethodNotAllowed,
  mcpUnauthorized,
  resolveApiToken,
} from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const context = await resolveApiToken(token);
  if (!context) return mcpUnauthorized(request);
  return handleMcpPost(context, request);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpDeleteOk();
}

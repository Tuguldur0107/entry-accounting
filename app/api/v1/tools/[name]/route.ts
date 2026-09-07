// POST /api/v1/tools/<name> — нэг tool гүйцэтгэнэ (Bearer token, body = input).
// Жишээ:
//   curl -X POST https://<domain>/api/v1/tools/create_counterparty \
//     -H "Authorization: Bearer eak_..." -H "Content-Type: application/json" \
//     -d '{"name":"Хаан банк ХХК","counterpartyType":"supplier"}'
import { authenticate, callTool, unauthorized } from "@/lib/api/v1";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const context = await authenticate(request);
  if (!context) return unauthorized(request);
  const { name } = await params;
  return callTool(context, name, request);
}

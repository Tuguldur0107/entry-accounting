// GET /api/v1/tools — гадаад интеграцид зориулсан tool жагсаалт (Bearer token).
import { authenticate, listTools, unauthorized } from "@/lib/api/v1";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await authenticate(request);
  if (!context) return unauthorized(request);
  return listTools();
}

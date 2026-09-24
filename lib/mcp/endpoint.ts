// MCP холболтын нийтийн хаяг — «AI нягтлан»-ы холбох заавар, тохиргооны хуудас.
// NEXT_PUBLIC_APP_URL (production-д app.entry.mn) давамгайлна; байхгүй бол
// хүсэлтийн host-оос (preview / локал).
import { headers } from "next/headers";

export async function mcpEndpointUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return `${configured}/api/mcp`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/mcp`;
}

// Хавсралт нээх / татах — GET /api/attachments/<id>[?download=1].
//
// Загвар: app/api/arap/[documentId]/pdf/route.ts (нэвтрэлт → org шалгалт →
// binary Response). proxy.ts нь `/api`-г алгасдаг тул нэвтрэлтийг route
// ӨӨРӨӨ шалгана; query нь ЗААВАЛ organizationId-аар шүүгдэнэ (IDOR —
// зөвхөн UUID-гаар хайвал өөр байгууллагын файл гарах эрсдэлтэй).
//
// Гэрээ: docs/procurement/01-implementation-contract.md §7.

import { and, eq } from "drizzle-orm";

import {
  isInlineAttachmentType,
  isUuidLike,
} from "@/lib/attachments/constants";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentAttachments } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Content-Disposition — кирилл файлын нэр ASCII толгойд орохгүй тул
 * RFC 5987-ийн `filename*=UTF-8''…` хэлбэрийг ХАМТ явуулна (ASCII нь
 * хуучин браузерын fallback).
 */
function contentDisposition(name: string, inline: boolean): string {
  const ascii = Array.from(name)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0x7e && char !== '"' && char !== "\\"
        ? char
        : "_";
    })
    .join("");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return new Response("Нэвтрэх шаардлагатай", { status: 401 });

  const { id } = await params;
  if (!isUuidLike(id))
    return new Response("Хавсралт олдсонгүй", { status: 404 });

  const attachment = await db.query.documentAttachments.findFirst({
    where: and(
      eq(documentAttachments.id, id),
      eq(documentAttachments.organizationId, active.orgId)
    ),
    columns: { name: true, mediaType: true, data: true },
  });
  if (!attachment)
    return new Response("Хавсралт олдсонгүй", { status: 404 });

  const forceDownload =
    new URL(request.url).searchParams.get("download") === "1";
  const inline = !forceDownload && isInlineAttachmentType(attachment.mediaType);
  const bytes = Buffer.from(attachment.data, "base64");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mediaType,
      "Content-Disposition": contentDisposition(attachment.name, inline),
      "Content-Length": String(bytes.byteLength),
      // Хэрэглэгчийн файлыг браузер өөр төрлөөр "тааварлахыг" хориглоно.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

// Хавсралт нээх / татах — GET /api/attachments/<id>[?download=1].
//
// Загвар: app/api/arap/[documentId]/pdf/route.ts (нэвтрэлт → org шалгалт →
// binary Response). proxy.ts нь `/api`-г алгасдаг тул нэвтрэлтийг route
// ӨӨРӨӨ шалгана; query нь ЗААВАЛ organizationId-аар шүүгдэнэ (IDOR —
// зөвхөн UUID-гаар хайвал өөр байгууллагын файл гарах эрсдэлтэй).
//
// Байгууллагын шалгалт ХАНГАЛТТАЙ БИШ: `proc` модулийн эрхгүй гишүүн
// захиалгын хавсралтыг татаж болохгүй тул объектын төрлөөс модулийн
// түлхүүр (`attachmentModuleKeyOf` — ЦОРЫН ГАНЦ зураглал) гаргаж
// `requireModuleAction(…, "read")` дайруулна.
//
// Гэрээ: docs/procurement/01-implementation-contract.md §7.

import { and, eq } from "drizzle-orm";

import {
  attachmentModuleKeyOf,
  isInlineAttachmentType,
  isUuidLike,
} from "@/lib/attachments/constants";
import { getActiveOrg, requireModuleAction } from "@/lib/auth";
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

  // Эхлээд ЗӨВХӨН метадата (`data` БАЙХГҮЙ) — эрхгүй хэрэглэгчийн хүсэлтэд
  // 8MB base64-ыг memory-д ачаалахгүй (listAttachments-тай ижил хэв маяг).
  const meta = await db.query.documentAttachments.findFirst({
    where: and(
      eq(documentAttachments.id, id),
      eq(documentAttachments.organizationId, active.orgId)
    ),
    columns: { name: true, mediaType: true, entityType: true },
  });
  if (!meta) return new Response("Хавсралт олдсонгүй", { status: 404 });

  const moduleKey = attachmentModuleKeyOf(meta.entityType);
  if (!moduleKey)
    return new Response("Хавсралт дэмжигдээгүй объект", { status: 404 });
  try {
    await requireModuleAction(moduleKey, "read");
  } catch (caught) {
    return new Response(
      caught instanceof Error ? caught.message : "Эрх хүрэлцэхгүй байна",
      { status: 403 }
    );
  }

  const file = await db.query.documentAttachments.findFirst({
    where: and(
      eq(documentAttachments.id, id),
      eq(documentAttachments.organizationId, active.orgId)
    ),
    columns: { data: true },
  });
  if (!file) return new Response("Хавсралт олдсонгүй", { status: 404 });

  const forceDownload =
    new URL(request.url).searchParams.get("download") === "1";
  const inline = !forceDownload && isInlineAttachmentType(meta.mediaType);
  const bytes = Buffer.from(file.data, "base64");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": meta.mediaType,
      "Content-Disposition": contentDisposition(meta.name, inline),
      "Content-Length": String(bytes.byteLength),
      // Хэрэглэгчийн файлыг браузер өөр төрлөөр "тааварлахыг" хориглоно.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

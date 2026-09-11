// Хавсралт хуулах — multipart POST /api/attachments.
//
// Server action-ы body 1MB-аар хязгаарлагдсан (next.config.ts-д
// serverActions.bodySizeLimit байхгүй) тул 8MB файл ЗААВАЛ route handler-аар
// явна. Загвар: app/api/arap/ebarimt/route.ts (formData задлалт, хэмжээ/
// төрлийн шалгалт, base64 хувиргалт, org нэвтрэлт).
//
// proxy.ts-ийн matcher `/api`-г алгасдаг тул энэ route НЭВТРЭЛТЭЭ ӨӨРӨӨ
// шалгана (getActiveOrg + requireModuleAction).
//
// Гэрээ: docs/procurement/01-implementation-contract.md §7.

import { and, eq } from "drizzle-orm";

import {
  ATTACHMENT_MAX_BYTES,
  attachmentExtensionOf,
  attachmentKindLabel,
  attachmentModuleKeyOf,
  isInlineAttachmentType,
  isUuidLike,
  resolveAttachmentMediaType,
} from "@/lib/attachments/constants";
import { logAuditEvent } from "@/lib/audit";
import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  documentAttachments,
  goodsReceipts,
  purchaseOrders,
} from "@/lib/db/schema";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Нэг хэрэглэгч минутад хуулах файлын дээд тоо (in-memory, нэг процесст). */
const UPLOAD_RATE_LIMIT = 30;

function errorJson(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * Тухайн объект БАЙГУУЛЛАГАД хамаарах эсэх. entityId нь polymorphic тул
 * FK байхгүй — дурын UUID-д "orphan" хавсралт үүсэхээс ингэж сэргийлнэ.
 * Буцах утга нь аудитын тайлбарт хэрэглэх баримтын дугаар.
 */
async function findEntityLabel(
  entityType: string,
  entityId: string,
  orgId: string
): Promise<string | null> {
  if (entityType === PO_BUSINESS_OBJECT) {
    const row = await db.query.purchaseOrders.findFirst({
      where: and(
        eq(purchaseOrders.id, entityId),
        eq(purchaseOrders.organizationId, orgId)
      ),
      columns: { documentNo: true },
    });
    return row?.documentNo ?? null;
  }
  if (entityType === "goods_receipt") {
    const row = await db.query.goodsReceipts.findFirst({
      where: and(
        eq(goodsReceipts.id, entityId),
        eq(goodsReceipts.organizationId, orgId)
      ),
      columns: { documentNo: true },
    });
    return row?.documentNo ?? null;
  }
  return null;
}

/**
 * Файлын эхний байтууд зарласан төрөлтэй таарах эсэх. Зөвхөн браузерт
 * INLINE үзүүлдэг төрлүүдэд (PDF/зураг) шалгана — эндээс өөр агуулгыг
 * inline үзүүлэх нь content-sniffing/XSS эрсдэл (Office файлууд нь
 * `attachment` болж татагддаг тул шалгалт шаардлагагүй).
 */
function matchesMagicBytes(mediaType: string, bytes: Buffer): boolean {
  if (mediaType === "application/pdf")
    return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  if (mediaType === "image/png")
    return (
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes.subarray(1, 4).toString("latin1") === "PNG"
    );
  if (mediaType === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === "image/gif")
    return bytes.subarray(0, 4).toString("latin1") === "GIF8";
  if (mediaType === "image/webp")
    return (
      bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
      bytes.subarray(8, 12).toString("latin1") === "WEBP"
    );
  return true;
}

/**
 * Файлын нэрийг цэвэрлэнэ — хяналтын тэмдэгт, хашилт, замын зураас хасна
 * (нэр нь Content-Disposition толгойд шууд орно). Кирилл нэр ХЭВЭЭР
 * хадгалагдана — татах route нь RFC 5987 `filename*`-ээр буцаана.
 */
function safeFileName(raw: string, mediaType: string): string {
  // Array.from нь code point-оор явна — 200 тэмдэгтээр таслахад surrogate
  // хагасалж (кирилл/emoji нэр) encodeURIComponent унахаас сэргийлнэ.
  const cleaned = Array.from(raw)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      const unsafe =
        code < 0x20 ||
        code === 0x7f ||
        char === '"' ||
        char === "\\" ||
        char === "/";
      return unsafe ? "_" : char;
    })
    .slice(0, 200)
    .join("")
    .trim();
  if (cleaned && cleaned.replace(/_/g, "") !== "") return cleaned;
  const ext = attachmentExtensionOf(mediaType);
  return ext ? `хавсралт.${ext}` : "хавсралт";
}

export async function POST(request: Request) {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await getActiveOrg());
  } catch {
    return errorJson("Нэвтрэх шаардлагатай", 401);
  }

  if (!checkRateLimit(`attach:${userId}`, UPLOAD_RATE_LIMIT, 60_000))
    return errorJson("Хэт олон файл хуулж байна — хэсэг хүлээнэ үү", 429);

  let file: File | null = null;
  let entityType = "";
  let entityId = "";
  let kind = "other";
  try {
    const form = await request.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
    const entityTypeRaw = form.get("entityType");
    const entityIdRaw = form.get("entityId");
    const kindRaw = form.get("kind");
    if (typeof entityTypeRaw === "string") entityType = entityTypeRaw.trim();
    if (typeof entityIdRaw === "string") entityId = entityIdRaw.trim();
    // `kind` нь DB-д чөлөөт текст (жагсаалт кодод хаалттай БИШ) — зөвхөн
    // урт хязгаарлана.
    if (typeof kindRaw === "string" && kindRaw.trim())
      kind = kindRaw.trim().slice(0, 40);
  } catch {
    return errorJson("Файл уншигдсангүй");
  }

  const moduleKey = attachmentModuleKeyOf(entityType);
  if (!moduleKey) return errorJson("Хавсралт дэмжигдээгүй объект");
  if (!isUuidLike(entityId)) return errorJson("Баримт олдсонгүй", 404);

  try {
    await requireModuleAction(moduleKey, "write");
  } catch (caught) {
    return errorJson(
      caught instanceof Error ? caught.message : "Эрх хүрэлцэхгүй байна",
      403
    );
  }

  if (!file) return errorJson("Файл сонгоно уу");
  if (file.size > ATTACHMENT_MAX_BYTES)
    return errorJson("Файл 8MB-с ихгүй байх ёстой", 413);
  const mediaType = resolveAttachmentMediaType(file.name, file.type);
  if (!mediaType)
    return errorJson("PDF, зураг, Excel эсвэл Word файл оруулна уу");

  const entityLabel = await findEntityLabel(entityType, entityId, orgId);
  if (entityLabel === null) return errorJson("Баримт олдсонгүй", 404);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0) return errorJson("Файл хоосон байна");
  // file.size нь client-ийн мэдээлэл — бодит байтаар ДАХИН шалгана.
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES)
    return errorJson("Файл 8MB-с ихгүй байх ёстой", 413);
  if (isInlineAttachmentType(mediaType) && !matchesMagicBytes(mediaType, bytes))
    return errorJson("Файлын агуулга нь заасан төрөлтэй таарахгүй байна");

  const name = safeFileName(file.name, mediaType);
  let inserted: { id: string; createdAt: Date } | undefined;
  try {
    [inserted] = await db
      .insert(documentAttachments)
      .values({
        userId,
        organizationId: orgId,
        entityType,
        entityId,
        kind,
        name,
        mediaType,
        sizeBytes: bytes.byteLength,
        data: bytes.toString("base64"),
      })
      .returning({
        id: documentAttachments.id,
        createdAt: documentAttachments.createdAt,
      });
  } catch (caught) {
    console.error("attachment upload failed:", caught);
    return errorJson("Хавсралт хадгалж чадсангүй", 500);
  }
  if (!inserted) return errorJson("Хавсралт хадгалж чадсангүй", 500);

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "attach",
    entityType,
    entityId,
    summary: `${entityLabel}: ${name} · ${attachmentKindLabel(kind)}`,
  });

  return Response.json({
    id: inserted.id,
    name,
    kind,
    mediaType,
    sizeBytes: bytes.byteLength,
    createdAt: inserted.createdAt.toISOString(),
  });
}

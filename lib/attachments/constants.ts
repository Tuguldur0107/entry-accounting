// Хавсралтын НЭГДСЭН тогтмолууд — цэвэр (plain) модуль, "use server" БИШ.
//
// Client component (<AttachmentList>), server action (lib/actions/attachments.ts)
// болон route handler (app/api/attachments/**) ГУРВУУЛАА эндээс уншина —
// хэмжээ, зөвшөөрөгдсөн media type, төрлийн шошго хоёр газар зэрэг
// бичигдэхийг хориглоно (docs/procurement/01-implementation-contract.md §7).

import {
  PO_BUSINESS_OBJECT,
  PROCUREMENT_MODULE_KEY,
} from "@/lib/procurement/constants";

/** Файлын дээд хэмжээ — eBarimt хуулах route-тай ИЖИЛ хязгаар (8MB). */
export const ATTACHMENT_MAX_BYTES = 8_000_000;

/**
 * Зөвшөөрөгдсөн media type → файлын өргөтгөлүүд.
 *
 * ЗӨВХӨН PDF / зураг / Excel / Word (00-proposal.md §3.6a). SVG, HTML,
 * XML зэрэг скрипт агуулах боломжтой төрөл ХОРИОТОЙ — файлыг браузерт
 * inline үзүүлдэг тул XSS-ийн эрсдэлтэй.
 */
const MEDIA_TYPE_EXTENSIONS: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/msword": ["doc"],
};

/**
 * `<input type="file" accept>` — өргөтгөл ба MIME хоёуланг нь заана
 * (зарим OS зөвхөн өргөтгөлөөр шүүдэг). Жагсаалтаас АВТОМАТААР гарна
 * тул шалгалттай хэзээ ч зөрөхгүй.
 */
export const ATTACHMENT_ACCEPT = [
  ...Object.values(MEDIA_TYPE_EXTENSIONS).flat().map((ext) => `.${ext}`),
  ...Object.keys(MEDIA_TYPE_EXTENSIONS),
].join(",");

/** Хавсралтын төрөл → монгол шошго (лавлах; `kind` нь DB-д чөлөөт текст). */
export const ATTACHMENT_KIND_LABELS: Record<string, string> = {
  quotation: "Үнийн санал",
  proforma: "Проформа",
  contract: "Гэрээ",
  invoice: "Нэхэмжлэх",
  packing_list: "Савлагааны жагсаалт",
  bill_of_lading: "Тээврийн баримт",
  customs_declaration: "Гаалийн мэдүүлэг",
  certificate: "Гарал үүслийн гэрчилгээ",
  other: "Бусад",
};

/** Худалдан авалтын захиалгад санал болгох төрлүүд (сонгогчийн дараалал). */
export const PO_ATTACHMENT_KINDS: readonly { value: string; label: string }[] = [
  "quotation",
  "proforma",
  "contract",
  "invoice",
  "packing_list",
  "bill_of_lading",
  "customs_declaration",
  "certificate",
  "other",
].map((value) => ({ value, label: ATTACHMENT_KIND_LABELS[value] ?? value }));

/** Танигдахгүй `kind`-ийг түүхий чигээр нь үзүүлнэ (жагсаалт хаалттай биш). */
export function attachmentKindLabel(kind: string): string {
  return ATTACHMENT_KIND_LABELS[kind] ?? kind;
}

/** "512KB" / "3.4MB" — AI чатын хавсралтын чиптэй ИЖИЛ формат. */
export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Зөвшөөрөгдсөн төрөл эсэх (client урьдчилсан шалгалт + route хоёуланд). */
export function isAllowedAttachmentType(mediaType: string): boolean {
  return Object.hasOwn(MEDIA_TYPE_EXTENSIONS, mediaType);
}

/**
 * Файлын media type — зарим OS .xlsx/.docx-д хоосон MIME өгдөг тул
 * өргөтгөлөөс нөхнө (components/ai/ai-chat-view.tsx resolveMediaType хэв маяг).
 * Зөвшөөрөгдөөгүй бол null.
 */
export function resolveAttachmentMediaType(
  fileName: string,
  fileType: string
): string | null {
  if (fileType && isAllowedAttachmentType(fileType)) return fileType;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!ext) return null;
  for (const [mediaType, extensions] of Object.entries(MEDIA_TYPE_EXTENSIONS))
    if (extensions.includes(ext)) return mediaType;
  return null;
}

/** Түүх нэрлэхэд хэрэглэх үндсэн өргөтгөл. */
export function attachmentExtensionOf(mediaType: string): string | null {
  return MEDIA_TYPE_EXTENSIONS[mediaType]?.[0] ?? null;
}

/**
 * Браузерт ШУУД (inline) үзүүлж болох төрөл — PDF ба зураг. Бусад
 * (Excel/Word) нь `attachment` болж татагдана.
 */
export function isInlineAttachmentType(mediaType: string): boolean {
  return mediaType === "application/pdf" || mediaType.startsWith("image/");
}

/**
 * Хавсралт дэмждэг объектын төрөл → эрхийн модулийн түлхүүр.
 * (Аудитын entityType-тай ИЖИЛ утгууд — гэрээ §5.)
 */
export const ATTACHMENT_ENTITY_MODULE_KEYS: Record<string, string> = {
  [PO_BUSINESS_OBJECT]: PROCUREMENT_MODULE_KEY,
  goods_receipt: PROCUREMENT_MODULE_KEY,
};

/** Дэмжигдээгүй объектод хавсралт хамааруулахгүй — null буцаана. */
export function attachmentModuleKeyOf(entityType: string): string | null {
  return ATTACHMENT_ENTITY_MODULE_KEYS[entityType] ?? null;
}

/**
 * UUID хэлбэрийн шалгалт — id/entityId-ийг Postgres-ийн uuid багана руу
 * хүргэхээс өмнө (буруу текст DB-ийн cast алдаа болж хэрэглэгчид
 * ойлгомжгүй мессеж үүсгэхээс сэргийлнэ).
 */
export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

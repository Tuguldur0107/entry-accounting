// П24 — eBarimt/PDF баримтаас АП нооргийн өгөгдөл задлах ЦЭВЭР тал:
// vision моделийн prompt + хариултын parse/validate (DB-гүй, тесттэй).
// Route (app/api/arap/ebarimt) энэ моделийн үр дүнг create_arap_invoice
// tool-д дамжуулж НООРОГ АП үүсгэнэ — draft-first §9, ДДТД-гээр idempotent.

export type EbarimtLine = {
  description: string;
  /** НӨАТ ОРСОН дүн (eBarimt-ийн үнэ бүгд inclusive). */
  amount: number;
};

export type EbarimtExtraction = {
  supplierName: string;
  /** ТТД — 7 оронтой тоо (олдохгүй бол null). */
  supplierRegisterNo: string | null;
  /** ДДТД (билл ID) — idempotency түлхүүр (олдохгүй бол null). */
  ddtd: string | null;
  /** Баримтын огноо YYYY-MM-DD. */
  date: string;
  /** НӨАТ орсон нийт дүн. */
  totalAmount: number;
  /** НӨАТ-ын дүн (0 = НӨАТ-гүй баримт). */
  vatAmount: number;
  lines: EbarimtLine[];
};

export const EBARIMT_EXTRACTION_PROMPT = `Чи Монголын нягтлан бодох системийн баримт уншигч. Хавсаргасан eBarimt (НӨАТ-ын баримт), нэхэмжлэх эсвэл худалдан авалтын баримтаас дараах мэдээллийг задалж ЗӨВХӨН JSON буцаа (өөр текст, markdown код блок бичихгүй):

{
  "supplierName": "Худалдагч байгууллагын нэр (ХХК/ТӨХК дагавартай нь)",
  "supplierRegisterNo": "ТТД буюу татвар төлөгчийн 7 оронтой дугаар, олдохгүй бол null",
  "ddtd": "ДДТД (Баримтын дугаар, ихэвчлэн урт тоон дараалал), олдохгүй бол null",
  "date": "Баримтын огноо YYYY-MM-DD",
  "totalAmount": 0,
  "vatAmount": 0,
  "lines": [{ "description": "Барааны/үйлчилгээний нэр", "amount": 0 }]
}

Дүрэм:
- totalAmount = НӨАТ ОРСОН эцсийн дүн; vatAmount = баримтад бичигдсэн НӨАТ (байхгүй бол 0)
- lines дүнгүүд мөн НӨАТ орсон; 20-оос олон мөртэй бол гол мөрүүдийг нэгтгэ
- Тоог зөвхөн цифрээр (мянгачлал, ₮ тэмдэггүй)
- Уншигдахгүй/олдохгүй талбарт null (тоон талбарт 0) тавь — таамаглаж зохиохгүй`;

const MAX_LINES = 30;
/** Мөрийн нийлбэр ба нийт дүнгийн зөвшөөрөх зөрүү (бөөрөнхийлөл). */
const LINE_SUM_TOLERANCE = 1;

function asAmount(value: unknown): number | null {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[^\d.-]/g, ""))
        : NaN;
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Моделийн хариуг задалж шалгана. Markdown код блок, өмнөх/хойнох текстийг
 * тэсвэрлэнэ; мөрүүд нийтэд тохирохгүй бол нэг нэгдсэн мөр болгоно
 * (баримт унших нь ноорог — хэрэглэгч панель дээрээ засна).
 */
export function parseEbarimtExtraction(
  raw: string
): { data: EbarimtExtraction } | { error: string } {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { error: "Баримтаас бүтэцтэй мэдээлэл гарсангүй" };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return { error: "Баримтын задаргаа уншигдсангүй (JSON алдаатай)" };
  }

  const supplierName = cleanText(parsed.supplierName);
  if (!supplierName) return { error: "Худалдагчийн нэр олдсонгүй" };

  const date = cleanText(parsed.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { error: "Баримтын огноо олдсонгүй" };

  const totalAmount = asAmount(parsed.totalAmount);
  if (!totalAmount || totalAmount <= 0)
    return { error: "Баримтын нийт дүн олдсонгүй" };

  const vatRaw = asAmount(parsed.vatAmount) ?? 0;
  const vatAmount = vatRaw > 0 && vatRaw < totalAmount ? vatRaw : 0;

  const registerRaw = cleanText(parsed.supplierRegisterNo);
  const supplierRegisterNo = /^\d{7,8}$/.test(registerRaw) ? registerRaw : null;

  const ddtdRaw = cleanText(parsed.ddtd).replace(/\s+/g, "");
  const ddtd = /^[\dA-Za-z-]{8,64}$/.test(ddtdRaw) ? ddtdRaw : null;

  let lines: EbarimtLine[] = Array.isArray(parsed.lines)
    ? (parsed.lines as unknown[])
        .map((line) => {
          const item = (line ?? {}) as Record<string, unknown>;
          const amount = asAmount(item.amount);
          if (!amount || amount <= 0) return null;
          return {
            description: cleanText(item.description) || "Худалдан авалт",
            amount,
          };
        })
        .filter((line): line is EbarimtLine => line !== null)
        .slice(0, MAX_LINES)
    : [];

  const lineSum = lines.reduce((sum, line) => sum + line.amount, 0);
  if (lines.length === 0 || Math.abs(lineSum - totalAmount) > LINE_SUM_TOLERANCE)
    lines = [{ description: "Худалдан авалт (eBarimt)", amount: totalAmount }];

  return {
    data: {
      supplierName,
      supplierRegisterNo,
      ddtd,
      date,
      totalAmount,
      vatAmount,
      lines,
    },
  };
}

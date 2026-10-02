// Онцгой албан татварын (ОАТ) тэмдгийн QR — ЦЭВЭР, client-safe (DB/React-гүй),
// tests/pos-stock-qr.test.ts. docs/integrations/01 §8.2 (1), developer портал
// «Онцгой албан татварын тэмдгийг PosAPI ашиглан дамжуулах» (2025-04-01-ээс ЗААВАЛ):
// архи, тамхи зэрэг ОАТ-ын тэмдэгтэй бараа борлуулахад тэмдэг БҮРИЙН QR-ийг
// `receipts[].items[].data.stockQR[]`-д илгээнэ.
//
// Дүрэм:
//  - Бараа «ОАТ тэмдэгтэй» эсэхийг барааны картад ИЛ тэмдэглэнэ
//    (`inventory_items.exciseStamped`) — ЗОХИОХГҮЙ, баркодоор таамаглахгүй.
//  - Тэмдэгтэй мөрийн тоо БҮХЭЛ, QR-ийн тоо = тоо хэмжээ (тэмдэг бүр нэг ширхэгт),
//    нэг баримтад давхардахгүй. eBarimt олгох борлуулалтад л шаардана
//    (`stockQrRequired`) — QR-гүй бол борлуулалт батлагдахгүй (касс + сервер).
//  - QR-ийн агуулгыг ӨӨРЧЛӨХГҮЙ (том/жижиг үсэг хэвээр) — зөвхөн зай хасна.
//    Албан жишээ 32 тэмдэгт hex (`A17F974B…`), гэхдээ формат баталгаажаагүй тул
//    хатуу шалгахгүй — ТЕГ буруу/давхар QR-ийг татгалзвал алдаа нь ил гарна.
//  - Хэсэгчилсэн буцаалт: буцаах ширхэгийн QR-ийг үлдсэнээс СҮҮЛЭЭС нь авна
//    (`takeReturnedStockQr`); засварын баримт (`inactiveId`) үлдсэн QR-ээр явна.

/** Нэг QR-ийн дээд урт (тэмдэгт) — сканнерын хог / буруу талбарыг таслана. */
export const STOCK_QR_MAX_LENGTH = 256;
/** Нэг QR-ийн доод урт — гараар санамсаргүй бичсэн богино текстийг QR гэж авахгүй. */
export const STOCK_QR_MIN_LENGTH = 8;

/** Сканнердсан утгыг цэвэрлэнэ (зай/мөр шилжилт хасна); хүчингүй бол null. */
export function normalizeStockQr(raw: string | null | undefined): string | null {
  const value = (raw ?? "").replace(/\s+/g, "");
  if (value.length < STOCK_QR_MIN_LENGTH || value.length > STOCK_QR_MAX_LENGTH) return null;
  // Хэвлэгдэх ASCII л (сканнерын удирдлагын тэмдэгт орж ирэхээс сэргийлнэ).
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

/** Мөрийн QR жагсаалтыг цэвэрлэнэ — хүчингүйг хаяж, давхардлыг нэг болгоно (дарааллаа хадгална). */
export function cleanStockQrList(list: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list ?? []) {
    const value = normalizeStockQr(raw);
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * ОАТ-ын QR шаардах эсэх — eBarimt олгох борлуулалтад л: eBarimt асаалттай, НӨАТ-гүй
 * (баримтгүй) борлуулалт биш, гараар ДДТД бичээгүй (ТЕГ-ийн апп-аар олгосон).
 * Кассчин «eBarimt илгээх»-ийг унтраасан (`skipped`) ч ДАРАА нь илгээгдэж болох тул шаардана.
 */
export function stockQrRequired(input: { ebarimtEnabled: boolean; nonVat: boolean; manualEbarimtId: string | null }): boolean {
  return input.ebarimtEnabled && !input.nonVat && !input.manualEbarimtId;
}

export interface StockQrLine {
  name: string;
  quantity: number;
  exciseStamped: boolean;
  stockQr: readonly string[];
}

/**
 * Тэмдэгтэй мөрийн асуудал (null = хэвийн). Касс төлбөрийн өмнө, сервер батлахын
 * өмнө ИЖИЛ дүрмээр шалгана.
 */
export function stockQrProblem(line: StockQrLine): string | null {
  if (!line.exciseStamped) return null;
  if (!Number.isInteger(line.quantity))
    return `${line.name}: ОАТ-ын тэмдэгтэй бараа бүхэл ширхэгээр зарагдана (тэмдэг бүр нэг ширхэгт)`;
  const codes = cleanStockQrList(line.stockQr);
  if (codes.length !== line.stockQr.length) return `${line.name}: ОАТ-ын тэмдгийн QR давхардсан эсвэл буруу уншигдсан`;
  if (codes.length !== line.quantity)
    return `${line.name}: ОАТ-ын тэмдгийн QR ${codes.length}/${line.quantity} уншуулсан — ширхэг бүрийн тэмдгийг уншуулна`;
  return null;
}

/** Нэг баримтын бүх мөрийн дунд QR давхардсан эсэх — давхардсан эхний утга, эсвэл null. */
export function duplicateStockQrAcrossLines(lines: readonly { stockQr: readonly string[] }[]): string | null {
  const seen = new Set<string>();
  for (const line of lines)
    for (const code of line.stockQr) {
      if (seen.has(code)) return code;
      seen.add(code);
    }
  return null;
}

/** Борлуулсан QR-ээс өмнө буцаагдсаныг хасна (буцаалтын мөрүүдийн QR). */
export function remainingStockQr(sold: readonly string[], returned: readonly (readonly string[])[]): string[] {
  const gone = new Set(returned.flat());
  return sold.filter((code) => !gone.has(code));
}

/**
 * Хэсэгчилсэн буцаалтын QR — үлдсэнээс СҮҮЛЭЭС нь `quantity` ширхэг. Бүхэл биш
 * эсвэл үлдэгдэл хүрэлцэхгүй бол байгаа хэрээр (тэмдэггүй хуучин борлуулалт —
 * хоосон жагсаалт).
 */
export function takeReturnedStockQr(remaining: readonly string[], quantity: number): string[] {
  const count = Math.max(0, Math.min(remaining.length, Math.floor(quantity + 1e-9)));
  return count === 0 ? [] : remaining.slice(remaining.length - count);
}

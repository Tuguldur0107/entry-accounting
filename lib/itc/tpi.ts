// eBarimt TPI (api.ebarimt.mn) — ЦЭВЭР хэсэг: хүсэлтийн body, хариуны parser.
// НӨАТ тайлангийн тулгалтад (docs/integrations/00 §4.1, §4.2 E5): ТЕГ-ийн
// бүртгэлтэй борлуулалт (`getSalesTotalData`) ↔ Entry-ийн POS/АР баримт, охин
// компанийн худалдан авалт (`getSaleListERP`) ↔ АП баримтын оролтын НӨАТ.
// Сүлжээ `client.ts`-д. tests/itc-tpi.test.ts.
//
// Талбарын нэрийг developer.itc.gov.mn-ийн албан хуудастай тулгав (2026-10-02,
// Монголын IP-ээс): getSalesTotalData — body {year, month, day: string; status,
// startCount, endCount: number}, хариу data.content[] (схемд data.list) +
// data.pageModel.totalElements; мөр posRno, posRdate, posRamt, citytax, posVamt,
// netAmt, csmrRegNo, csmrName, posNo, districtCode, prParentRno. getSaleListERP —
// body {pin (регистр), subPin[], startDate, endDate}, хариу data[] →
// receiptBuyModelList[]: prPosRno, name/regNo (борлуулагч — ДАЛДЛАГДСАН), buyerRegNo,
// date, amountVat, amountCitytax, amountTotal, amountNet, fromType, receiptType.
// Parser нь ТАНИГДАХГҮЙ мөрийг алгасаж тоолно — дүн зохиохгүй.

import { ITC_ERRORS, TPI_SALES_STATUS, type TpiSalesStatus } from "./constants";
import { ItcError } from "./auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SalesTotalDataRequest {
  /** Тайлант жил (YYYY). */
  year: number;
  /** Сар 1–12 (сонголтоор — жилээр татахад хоосон). */
  month?: number;
  /** Өдөр 1–31 (сар өгсөн үед л). */
  day?: number;
  status?: TpiSalesStatus;
  /** Хуудаслалт — албан тайлбар: startCount / endCount. */
  startCount?: number;
  endCount?: number;
}

/**
 * `getSalesTotalData` body — албан хуудас: `year`, `month`, `day` нь STRING
 * (`month` ЗААВАЛ), `status`, `startCount`, `endCount` нь number (заавал).
 * Сар/өдрийн тэргүүлэх тэгийн хэлбэр албан хуудсанд жишээгүй — staging-д батална.
 */
export function salesTotalDataBody(input: SalesTotalDataRequest): Record<string, string | number> {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100)
    throw new ItcError(ITC_ERRORS.tpi, "Жил буруу (YYYY)");
  if (input.month != null && (!Number.isInteger(input.month) || input.month < 1 || input.month > 12))
    throw new ItcError(ITC_ERRORS.tpi, "Сар 1–12 байна");
  if (input.day != null) {
    if (input.month == null) throw new ItcError(ITC_ERRORS.tpi, "Өдөр өгөхөд сар заавал");
    if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31)
      throw new ItcError(ITC_ERRORS.tpi, "Өдөр 1–31 байна");
  }
  const status = input.status ?? TPI_SALES_STATUS.all;
  if (!(Object.values(TPI_SALES_STATUS) as number[]).includes(status))
    throw new ItcError(ITC_ERRORS.tpi, "status 0–4 байна");
  if (input.month == null) throw new ItcError(ITC_ERRORS.tpi, "Сар заавал (албан хуудас: month required)");
  const startCount = Math.max(0, Math.trunc(input.startCount ?? 0));
  const body: Record<string, string | number> = {
    year: String(input.year),
    month: String(input.month),
    status,
    startCount,
    endCount: Math.max(startCount, Math.trunc(input.endCount ?? startCount + TPI_PAGE_SIZE)),
  };
  if (input.day != null) body.day = String(input.day);
  return body;
}

export interface SaleListErpRequest {
  /** Компанийн РЕГИСТРИЙН дугаар (албан: `pin` — «Толгой компанийн регистрийн дугаар»). */
  pin: string;
  /** Охин компаниудын регистр (албан: `subPin[]`) — хоосон бол `pin`-ий ӨӨРИЙН худалдан авалт. */
  subPins?: string[];
  /** YYYY-MM-DD. */
  startDate: string;
  endDate: string;
}

/** Регистр — хуулийн этгээд 7 оронтой тоо; иргэн/бусад нь 2 үсэг + 8 орон эсвэл 8 орон (staging 99119911). */
const REGISTER_RE = /^(\d{7,8}|[А-ЯӨҮЁ]{2}\d{8})$/u;

/**
 * `getSaleListERP` body — албан хуудас: `pin`, `subPin`, `startDate`, `endDate`
 * (жижиг үсгээр). Огноо «YYYY-MM-DD HH:mm:ss» хэлбэрээр (хариуны жишээтэй ижил);
 * эхлэл 00:00:00, төгсгөл 23:59:59.
 */
export function saleListErpBody(input: SaleListErpRequest): {
  pin: string;
  subPin: string[];
  startDate: string;
  endDate: string;
} {
  const pin = input.pin.trim().toUpperCase();
  if (!REGISTER_RE.test(pin)) throw new ItcError(ITC_ERRORS.tpi, "pin — байгууллагын регистрийн дугаар (7 орон) байна");
  if (!DATE_RE.test(input.startDate) || !DATE_RE.test(input.endDate))
    throw new ItcError(ITC_ERRORS.tpi, "Огноо YYYY-MM-DD хэлбэртэй байна");
  if (input.startDate > input.endDate) throw new ItcError(ITC_ERRORS.tpi, "Эхлэх огноо дуусахаас хойш байж болохгүй");
  const subPin = (input.subPins ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const s of subPin)
    if (!REGISTER_RE.test(s)) throw new ItcError(ITC_ERRORS.tpi, `subPin «${s}» — регистрийн дугаар байна`);
  return { pin, subPin, startDate: `${input.startDate} 00:00:00`, endDate: `${input.endDate} 23:59:59` };
}

/** Нэг хуудасны мөр (startCount/endCount). */
export const TPI_PAGE_SIZE = 500;
/** Нэг өдөр × status-д хамгийн ихдээ — хэтэрвэл ил алдаа (чимээгүй таслахгүй). */
export const TPI_MAX_PAGES = 400;

/**
 * Хуудасны цонх. `startCount`/`endCount`-ийн утга (0/1-ээс эхлэх, төгсгөл орох
 * эсэх) албан тайлбарт тодорхойгүй тул дараагийн хуудас ӨМНӨХИЙН `endCount`-оос
 * эхэлнэ: аль ч тайлбарт мөр АЛГАСАХГҮЙ, хамгийн ихдээ 1 мөр давхцана (ДДТД-ээр
 * upsert тул хор хөнөөлгүй).
 */
export function tpiPageWindow(page: number, size = TPI_PAGE_SIZE): { startCount: number; endCount: number } {
  return { startCount: page * size, endCount: (page + 1) * size };
}

/**
 * Дараагийн хуудас бий эсэх. Хариунд `pageModel.totalElements` ирвэл ҮҮГЭЭР
 * (дараагийн `startCount` < нийт); ирээгүй бол дүүрэн хуудас (size−1 … size+1 —
 * төгсгөл орох/үл орох тайлбарын зөрүү) л үргэлжилнэ. Үүнээс их бол сервер
 * хуудаслалтыг үл тоож бүгдийг өгсөн — дахин асуухгүй.
 */
export function tpiHasMorePages(
  rowsInPage: number,
  size = TPI_PAGE_SIZE,
  progress?: { nextStart: number; totalElements: number | null }
): boolean {
  if (progress && progress.totalElements !== null) return rowsInPage > 0 && progress.nextStart < progress.totalElements;
  return rowsInPage >= size - 1 && rowsInPage <= size + 1;
}

// ── Хариу ────────────────────────────────────────────────────────────────────

export interface TpiSaleRow {
  /** ДДТД (posRno). */
  ddtd: string;
  /** Баримтын огноо (posRdate) — эх текст хэвээр (ТЕГ-ийн формат). */
  date: string;
  /** Нийт дүн (posRamt). */
  total: number;
  /** НӨАТ (posVamt). */
  vat: number;
  cityTax: number;
  /** Цэвэр (netAmt). */
  net: number;
  buyerRegNo: string;
  buyerName: string;
  posNo: string;
  districtCode: string;
  /** Нэхэмжлэхийн төлөлт болох баримтын эх ДДТД (2025-09-01-ээс). */
  parentDdtd: string | null;
}

export interface TpiPurchaseRow {
  /** ДДТД (prPosRno). */
  ddtd: string;
  /** Баримт хэвлэсэн огноо (date) — эх текст «YYYY-MM-DD HH:mm:ss». */
  date: string;
  /** Борлуулагчийн регистр / нэр — ТЕГ ДАЛДАЛЖ өгдөг («57***85») тул тааруулахад ХЭРЭГЛЭХГҮЙ. */
  sellerRegNo: string;
  sellerName: string;
  /** Худалдан авагчийн регистр (далдлагдсан байж болно). */
  buyerRegNo: string;
  vat: number;
  cityTax: number;
  total: number;
  net: number;
  fromType: string;
  /** 2025-09-01-ээс (B2C_RECEIPT / B2B_RECEIPT / …). */
  receiptType: string | null;
}

export interface TpiParseResult<T> {
  rows: T[];
  /** Танигдахгүй (ДДТД-гүй / дүнгүй) мөрийн тоо — ИЛ хэлнэ, зохиохгүй. */
  skipped: number;
  /** `data.pageModel.totalElements` — хуудаслалтын эх (ирээгүй бол null). */
  totalElements?: number | null;
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/[\s,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Хариуны жагсаалт — `data`, `data.list`, `receiptBuyModelList`, `list`, эсвэл массив өөрөө. */
function listOf(json: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (!json || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    if (value && typeof value === "object") {
      const nested = listOf(value, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** ТЕГ-ийн стандарт хариуны `status`/`msg` — алдаа бол ШИДНЭ (мөр байхгүй ч). */
export function assertTpiStatus(json: unknown): void {
  if (!json || typeof json !== "object" || Array.isArray(json)) return;
  const record = json as Record<string, unknown>;
  const status = record.status;
  const ok = status === undefined || status === null || status === 200 || status === "200" || status === true || status === "SUCCESS";
  if (!ok) {
    const message = str(pick(record, ["msg", "message", "error"])) || `status ${String(status)}`;
    throw new ItcError(ITC_ERRORS.tpi, `ТЕГ хариу: ${message}`);
  }
}

export function parseSalesTotalData(json: unknown): TpiParseResult<TpiSaleRow> {
  assertTpiStatus(json);
  const rows: TpiSaleRow[] = [];
  let skipped = 0;
  for (const item of listOf(json, ["data", "content", "list", "receipts", "salesList"])) {
    const ddtd = str(pick(item, ["posRno", "ddtd", "id"]));
    const total = num(pick(item, ["posRamt", "totalAmount", "amountTotal"]));
    if (!ddtd || total === null) {
      skipped += 1;
      continue;
    }
    rows.push({
      ddtd,
      date: str(pick(item, ["posRdate", "date"])),
      total,
      vat: num(pick(item, ["posVamt", "totalVAT", "vat"])) ?? 0,
      cityTax: num(pick(item, ["citytax", "cityTax", "totalCityTax"])) ?? 0,
      net: num(pick(item, ["netAmt", "netAmount"])) ?? total,
      buyerRegNo: str(pick(item, ["csmrRegNo", "customerTin", "customerNo"])),
      buyerName: str(pick(item, ["csmrName", "customerName"])),
      posNo: str(pick(item, ["posNo"])),
      districtCode: str(pick(item, ["districtCode"])),
      parentDdtd: str(pick(item, ["prParentRno", "parentRno"])) || null,
    });
  }
  return { rows, skipped, totalElements: pageTotalOf(json) };
}

/** `data.pageModel.totalElements` (эсвэл `pageModel.totalElements`). */
function pageTotalOf(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const page = data.pageModel && typeof data.pageModel === "object" ? (data.pageModel as Record<string, unknown>) : null;
  return page ? num(page.totalElements) : null;
}

export function parseSaleListErp(json: unknown): TpiParseResult<TpiPurchaseRow> {
  assertTpiStatus(json);
  const rows: TpiPurchaseRow[] = [];
  let skipped = 0;
  // Албан хариу: data[] — компани бүрд {startDate, endDate, regNo, receiptBuyModelList[]}.
  // Мөр нь receiptBuyModelList дотор (wrapper-ийг мөр гэж ХАРАХГҮЙ).
  const record = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const wrappers = Array.isArray(record.data) ? (record.data as unknown[]) : Array.isArray(json) ? (json as unknown[]) : [record.data ?? json];
  const items = wrappers.flatMap((wrapper) => {
    if (!wrapper || typeof wrapper !== "object") return [];
    const list = (wrapper as Record<string, unknown>).receiptBuyModelList;
    return Array.isArray(list) ? (list.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
  });
  for (const item of items) {
    const ddtd = str(pick(item, ["prPosRno", "posRno", "ddtd"]));
    const total = num(pick(item, ["amountTotal", "totalAmount"]));
    if (!ddtd || total === null) {
      skipped += 1;
      continue;
    }
    rows.push({
      ddtd,
      date: str(pick(item, ["date", "posRdate"])),
      sellerRegNo: str(pick(item, ["regNo", "sellerRegNo", "tin"])),
      sellerName: str(pick(item, ["name", "sellerName"])),
      buyerRegNo: str(pick(item, ["buyerRegNo"])),
      vat: num(pick(item, ["amountVat", "totalVAT"])) ?? 0,
      cityTax: num(pick(item, ["amountCitytax", "amountCityTax", "totalCityTax"])) ?? 0,
      total,
      net: num(pick(item, ["amountNet", "netAmount"])) ?? total,
      fromType: str(pick(item, ["fromType"])),
      receiptType: str(pick(item, ["receiptType"])) || null,
    });
  }
  return { rows, skipped };
}

/** Тулгалтын түлхүүр — ДДТД (33 орон) цэвэрлэсэн; Entry `pos_sales.ebarimtId`-тай харьцуулна. */
export function normalizeDdtd(value: string): string {
  return value.replace(/\s/g, "");
}

export interface DdtdReconciliation {
  /** ТЕГ-д ч, Entry-д ч байгаа. */
  matched: string[];
  /** Зөвхөн ТЕГ-д — Entry-д бүртгэлгүй (гар кассаас илгээсэн, эсвэл Entry-ийн бичилт алга). */
  onlyTax: string[];
  /** Зөвхөн Entry-д — ТЕГ-д хүрээгүй (илгээгдээгүй / устгагдсан). */
  onlyEntry: string[];
}

/** ДДТД-ийн олонлогийн тулгалт — ЦЭВЭР (reconcile_modules-ийн «ТЕГ ↔ Entry» хэсгийн суурь). */
export function reconcileDdtd(taxDdtds: readonly string[], entryDdtds: readonly string[]): DdtdReconciliation {
  const tax = new Set(taxDdtds.map(normalizeDdtd).filter(Boolean));
  const entry = new Set(entryDdtds.map(normalizeDdtd).filter(Boolean));
  const matched = [...tax].filter((d) => entry.has(d)).sort();
  const onlyTax = [...tax].filter((d) => !entry.has(d)).sort();
  const onlyEntry = [...entry].filter((d) => !tax.has(d)).sort();
  return { matched, onlyTax, onlyEntry };
}

// ── Гаалийн мэдүүлэг (developer портал 10.4, `tpiDeclaration`) ───────────────

/** Нэг хуудасны мэдүүлэг (албан жишээ 100). */
export const CUSTOMS_PAGE_SIZE = 100;
/** Нэг мужид хамгийн ихдээ хэдэн хуудас — хэтэрвэл ил алдаа (чимээгүй таслахгүй). */
export const CUSTOMS_MAX_PAGES = 200;

export interface CustomsDeclarationRequest {
  startDate: string;
  endDate: string;
  /** 1-ээс (албан жишээ `pageNumber: 1`). */
  pageNumber: number;
  pageSize?: number;
}

export function customsDeclarationBody(input: CustomsDeclarationRequest): {
  startDate: string;
  endDate: string;
  pageNumber: number;
  pageSize: number;
} {
  if (!DATE_RE.test(input.startDate) || !DATE_RE.test(input.endDate))
    throw new ItcError(ITC_ERRORS.tpi, "Огноо YYYY-MM-DD хэлбэртэй байна");
  if (input.startDate > input.endDate) throw new ItcError(ITC_ERRORS.tpi, "Эхлэх огноо дуусахаас хойш байж болохгүй");
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) throw new ItcError(ITC_ERRORS.tpi, "pageNumber 1-ээс эхэлнэ");
  return { startDate: input.startDate, endDate: input.endDate, pageNumber: input.pageNumber, pageSize: input.pageSize ?? CUSTOMS_PAGE_SIZE };
}

/** Мэдүүлгийн барааны мөр — албан талбарууд (утгыг ЗОХИОХГҮЙ, ирсэн хэвээр). */
export interface CustomsDeclarationItem {
  /** Барааны нэр (goodsnm). */
  name: string;
  /** Нэгжийн үнэ (itemuprc) — валют/нэгж албан тайлбаргүй тул ДАНСАНД ХЭРЭГЛЭХГҮЙ. */
  unitPrice: number | null;
  /** Гаалийн албан татвар (dutyamt). */
  duty: number;
  /** Онцгой албан татвар (exciseamt). */
  excise: number;
  /** Маягтын / бусад хураамж (formamt). */
  fee: number;
  /** НӨАТ-ын суурь (vatBaseAmt). */
  vatBase: number;
  /** Импортын НӨАТ (vatamt) — оролтын НӨАТ-ын эх. */
  vat: number;
}

export interface CustomsDeclaration {
  /** Мэдүүлгийн дугаар (dclrNo) — далдлагдсан ирж болно, тулгалтын түлхүүр. */
  declarationNo: string;
  /** Эх огноо (dclrDate, «2020-09-24T09:15:58.000+0000»). */
  rawDate: string;
  /** YYYY-MM-DD (эх огнооны эхний 10 тэмдэгт; танигдахгүй бол ""). */
  date: string;
  items: CustomsDeclarationItem[];
  duty: number;
  excise: number;
  fee: number;
  vatBase: number;
  vat: number;
}

export interface CustomsParseResult {
  rows: CustomsDeclaration[];
  skipped: number;
  /** Spring хуудаслалтын `totalPages` ирвэл (албан схемд байхгүй) — үгүй бол null. */
  totalPages: number | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * `tpiDeclaration` хариу → мэдүүлгүүд. Албан хариу `{ content: [{dclrNo, dclrDate,
 * items[]}] }`. Дугааргүй мөр алгасаж ТООЛНО. Дүн нь мөрүүдийн нийлбэр (2 орон).
 */
export function parseCustomsDeclarations(json: unknown): CustomsParseResult {
  assertTpiStatus(json);
  const record = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : record;
  const content = Array.isArray(data.content) ? data.content : Array.isArray(json) ? (json as unknown[]) : [];
  const rows: CustomsDeclaration[] = [];
  let skipped = 0;
  for (const raw of content) {
    if (!raw || typeof raw !== "object") {
      skipped += 1;
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const declarationNo = str(pick(entry, ["dclrNo", "declarationNo"]));
    if (!declarationNo) {
      skipped += 1;
      continue;
    }
    const rawDate = str(pick(entry, ["dclrDate", "declarationDate"]));
    const items = (Array.isArray(entry.items) ? entry.items : [])
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        name: str(pick(item, ["goodsnm", "goodsName", "name"])),
        unitPrice: num(pick(item, ["itemuprc", "unitPrice"])),
        duty: num(pick(item, ["dutyamt"])) ?? 0,
        excise: num(pick(item, ["exciseamt"])) ?? 0,
        fee: num(pick(item, ["formamt"])) ?? 0,
        vatBase: num(pick(item, ["vatBaseAmt", "vatbaseamt"])) ?? 0,
        vat: num(pick(item, ["vatamt", "vatAmt"])) ?? 0,
      }));
    const sum = (field: "duty" | "excise" | "fee" | "vatBase" | "vat") => round2(items.reduce((total, item) => total + item[field], 0));
    rows.push({
      declarationNo,
      rawDate,
      date: DATE_RE.test(rawDate.slice(0, 10)) ? rawDate.slice(0, 10) : "",
      items,
      duty: sum("duty"),
      excise: sum("excise"),
      fee: sum("fee"),
      vatBase: sum("vatBase"),
      vat: sum("vat"),
    });
  }
  const totalPages = num(data.totalPages);
  return { rows, skipped, totalPages: totalPages === null ? null : Math.trunc(totalPages) };
}

/** Дараагийн хуудас бий эсэх — `totalPages` ирвэл түүгээр, эс бөгөөс дүүрэн хуудсаар. */
export function customsHasMorePages(pageNumber: number, rowsInPage: number, totalPages: number | null, size = CUSTOMS_PAGE_SIZE): boolean {
  if (totalPages !== null) return pageNumber < totalPages;
  return rowsInPage >= size;
}

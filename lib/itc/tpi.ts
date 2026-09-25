// eBarimt TPI (api.ebarimt.mn) — ЦЭВЭР хэсэг: хүсэлтийн body, хариуны parser.
// НӨАТ тайлангийн тулгалтад (docs/integrations/00 §4.1, §4.2 E5): ТЕГ-ийн
// бүртгэлтэй борлуулалт (`getSalesTotalData`) ↔ Entry-ийн POS/АР баримт, охин
// компанийн худалдан авалт (`getSaleListERP`) ↔ АП баримтын оролтын НӨАТ.
// Сүлжээ `client.ts`-д. tests/itc-tpi.test.ts.
//
// Хариуны талбарын нэр албан тайлбараас (posRno, posRdate, posRamt, posVamt,
// cityTax, netAmt, csmrRegNo, csmrName, posNo, districtCode, prParentRno;
// receiptBuyModelList[]: prPosRno, regNo, name, amountVat, amountCityTax,
// amountTotal, amountNet, fromType, receiptType). Parser нь ТАНИГДАХГҮЙ мөрийг
// алгасаж тоолно — дүн зохиохгүй.

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
 * `getSalesTotalData` body. ⚠ Талбарын WIRE нэр («ETAX API documentation» /
 * ebarimt-api хуудаснаас) энд албан тайлбарын нэрээр — staging тестээр
 * баталгаажуулна (docs §4.4 №3); шалгалт нь утгын хүрээ л.
 */
export function salesTotalDataBody(input: SalesTotalDataRequest): Record<string, number> {
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
  const body: Record<string, number> = { year: input.year, status };
  if (input.month != null) body.month = input.month;
  if (input.day != null) body.day = input.day;
  if (input.startCount != null) body.startCount = Math.max(0, Math.trunc(input.startCount));
  if (input.endCount != null) body.endCount = Math.max(0, Math.trunc(input.endCount));
  return body;
}

export interface SaleListErpRequest {
  /** Толгой татвар төлөгчийн ТТД/PIN (албан: `Pin`). */
  pin: string;
  /** Охин компаниудын ТТД (албан: `subPin[]`). */
  subPins?: string[];
  /** YYYY-MM-DD. */
  startDate: string;
  endDate: string;
}

/** `getSaleListERP` body — албан талбар `Pin`, `subPin`, `StartDate`, `EndDate`. */
export function saleListErpBody(input: SaleListErpRequest): {
  Pin: string;
  subPin: string[];
  StartDate: string;
  EndDate: string;
} {
  const pin = input.pin.trim();
  if (!/^\d{11,14}$/.test(pin)) throw new ItcError(ITC_ERRORS.tpi, "Pin (ТТД) 11–14 оронтой тоо байна");
  if (!DATE_RE.test(input.startDate) || !DATE_RE.test(input.endDate))
    throw new ItcError(ITC_ERRORS.tpi, "Огноо YYYY-MM-DD хэлбэртэй байна");
  if (input.startDate > input.endDate) throw new ItcError(ITC_ERRORS.tpi, "Эхлэх огноо дуусахаас хойш байж болохгүй");
  const subPin = (input.subPins ?? []).map((s) => s.trim()).filter(Boolean);
  for (const s of subPin)
    if (!/^\d{11,14}$/.test(s)) throw new ItcError(ITC_ERRORS.tpi, `subPin «${s}» 11–14 оронтой тоо байна`);
  return { Pin: pin, subPin, StartDate: input.startDate, EndDate: input.endDate };
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
  sellerRegNo: string;
  sellerName: string;
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
  for (const item of listOf(json, ["data", "list", "receipts", "salesList"])) {
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
      cityTax: num(pick(item, ["cityTax", "totalCityTax"])) ?? 0,
      net: num(pick(item, ["netAmt", "netAmount"])) ?? total,
      buyerRegNo: str(pick(item, ["csmrRegNo", "customerTin", "customerNo"])),
      buyerName: str(pick(item, ["csmrName", "customerName"])),
      posNo: str(pick(item, ["posNo"])),
      districtCode: str(pick(item, ["districtCode"])),
      parentDdtd: str(pick(item, ["prParentRno", "parentRno"])) || null,
    });
  }
  return { rows, skipped };
}

export function parseSaleListErp(json: unknown): TpiParseResult<TpiPurchaseRow> {
  assertTpiStatus(json);
  const rows: TpiPurchaseRow[] = [];
  let skipped = 0;
  for (const item of listOf(json, ["receiptBuyModelList", "data", "list"])) {
    const ddtd = str(pick(item, ["prPosRno", "posRno", "ddtd"]));
    const total = num(pick(item, ["amountTotal", "totalAmount"]));
    if (!ddtd || total === null) {
      skipped += 1;
      continue;
    }
    rows.push({
      ddtd,
      sellerRegNo: str(pick(item, ["regNo", "sellerRegNo", "tin"])),
      sellerName: str(pick(item, ["name", "sellerName"])),
      vat: num(pick(item, ["amountVat", "totalVAT"])) ?? 0,
      cityTax: num(pick(item, ["amountCityTax", "totalCityTax"])) ?? 0,
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

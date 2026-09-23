// Баримтын ОГНООНЫ нэгдсэн дүрэм — ЦЭВЭР, client-safe (tests/document-date.test.ts).
//
// SIM Trade симуляцийн хамгийн олон давтагдсан алдаа (ENT-012/027/028/035/041/067):
//   • Хуучин сарын ажил хийж байхад (topbar-т MAR-25 сонгосон) шинэ баримт,
//     кассын нээлт, НӨАТ тооцоо, PO хаалт ӨНӨӨДРИЙН огноо авдаг байв
//   • 2025-02-30 гэх мэт БАЙХГҮЙ огноо хүлээн авч батлагдаж, сарын тайланд
//     огт орохгүй «алга болсон» бичилт үүсдэг байв
//   • 2027-06 гэх мэт ИРЭЭДҮЙН сард сануулгагүй батлагддаг байв

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD хэлбэртэй БӨГӨӨД хуанлид байдаг огноо (2025-02-30 → false). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Хуанлид байхгүй огноог монгол тайлбартайгаар татгалзана. */
export function assertCalendarDate(value: unknown, label = "Огноо"): asserts value is string {
  if (typeof value !== "string" || !DATE_RE.test(value))
    throw new Error(`${label} YYYY-MM-DD хэлбэртэй байна (өгсөн: ${String(value)})`);
  if (!isCalendarDate(value))
    throw new Error(`${label} хуанлид байхгүй огноо байна: ${value}`);
}

const periodOf = (date: string) => date.slice(0, 7);

function lastDayOf(periodCode: string): string {
  const [year, month] = periodCode.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${periodCode}-${String(day).padStart(2, "0")}`;
}

/**
 * Шинэ баримтын АНХДАГЧ огноо (topbar-ийн сонгосон сараас):
 *   • сонгосон сар = өнөөдрийн сар (эсвэл сонголтгүй) → өнөөдөр
 *   • өнгөрсөн сар → тэр сарын СҮҮЛИЙН өдөр
 *   • ирээдүйн сар → тэр сарын ЭХНИЙ өдөр
 */
export function defaultDocumentDate(periodCode: string | null | undefined, today: string): string {
  if (!periodCode || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode)) return today;
  const current = periodOf(today);
  if (periodCode === current) return today;
  return periodCode < current ? lastDayOf(periodCode) : `${periodCode}-01`;
}

/** Огноо сонгосон сард багтах эсэх (сонголтгүй бол true). */
export function isDateInPeriod(date: string, periodCode: string | null | undefined): boolean {
  if (!periodCode) return true;
  return periodOf(date) === periodCode;
}

/** Огноо өнөөдрийн сараас ХОЙШХИ (ирээдүйн) тайлант үед орох уу. */
export function isFuturePeriodDate(date: string, today: string): boolean {
  return periodOf(date) > periodOf(today);
}

/** `ea-period` cookie-ийн утга ("2025-03:PTD") → период, эвдэрсэн бол null. */
export function periodFromCookieValue(raw: string | null | undefined): string | null {
  const code = (raw ?? "").split(":")[0];
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(code) ? code : null;
}

/** document.cookie мөрөөс `ea-period`-ийг задлана (client). */
export function periodFromCookieHeader(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "ea-period") return periodFromCookieValue(decodeURIComponent(rest.join("=")));
  }
  return null;
}

/** Улаанбаатарын өнөөдөр (YYYY-MM-DD) — client ба server хоёуланд. */
export function ulaanbaatarToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Ulaanbaatar" });
}

/**
 * Шинэ баримтын АНХДАГЧ огноо — topbar-ийн сонгосон сараас (`ea-period`
 * cookie). Browser-гүй орчинд (SSR) Улаанбаатарын өнөөдөр. Зөвхөн хэрэглэгч
 * нээсэн форм/диалог/панелийн анхны утгад хэрэглэнэ (SSR-д рендерлэгддэг
 * input-ийн утгад БИШ — hydration зөрнө).
 */
export function currentDocumentDate(): string {
  const today = ulaanbaatarToday();
  if (typeof document === "undefined") return today;
  return defaultDocumentDate(periodFromCookieHeader(document.cookie), today);
}

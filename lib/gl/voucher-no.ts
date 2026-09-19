// Журналын бичилтийн дугаар — "<МОДУЛЬ>-<YY>-<NNNNNN>" (ж: GL-26-000001).
//
// Журнал нь БҮХ модулиас үүсдэг (касс, АР/АП, ҮХ, өртөг, хангамж, цалин,
// НӨАТ…) тул дугаарын эхний хэсэг нь бичилтийг ХЭН үүсгэснийг шууд хэлнэ.
// Жил бүр 1-ээс эхэлнэ: сангийн жилийн дотор тасралтгүй дугаарлалт нь
// монголын нягтлан бодох практикт тохирдог.
//
// Энэ файлын ЦЭВЭР функцууд (`voucherNoScope`, `formatVoucherNo`,
// `parseVoucherNo`) DB хөндөхгүй тул тесттэй. DB давхарга нь `nextVoucherNo`
// — тоолуурын мөрийг АТОМААР нэмэгдүүлнэ (lib/db/schema.ts documentCounters).

import { sql } from "drizzle-orm";

import { documentCounters } from "@/lib/db/schema";

/**
 * Модулийн товчлол. Түлхүүр нь `lib/constants/app-modules.ts`-ийн moduleKey-тэй
 * аль болох таарна; `fx` нь кассын дотор ялгаатай урсгал тул тусдаа.
 *
 * ⚠️ Кодыг ӨӨРЧЛӨХИЙГ ХОРИГЛОНО — бичигдсэн дугаар нь баримтын мөнхийн
 * танигдахуун. Шинэ модуль нэмэхэд ШИНЭ түлхүүр нэмнэ.
 */
export const JOURNAL_MODULE_CODES = {
  gl: "GL", // Ерөнхий журнал (гар бичилт, Excel импорт, AI)
  cash: "CM", // Мөнгөн хөрөнгө — касс/банкны баримт, хуулга
  fx: "FX", // Валютын ханшийн тэгшитгэл
  ar: "AR", // Авлага
  ap: "AP", // Өглөг
  inv: "INV", // Бараа материал
  cost: "COST", // Өртгийн бүртгэл
  fa: "FA", // Үндсэн хөрөнгө
  proc: "PROC", // Хангамж (PO хаалт, хүлээн авалт)
  payroll: "PAY", // Цалин
  vat: "VAT", // НӨАТ
} as const;

export type JournalModule = keyof typeof JOURNAL_MODULE_CODES;

/** Дугаарын дараалсан хэсгийн урт — 999,999 хүртэл. */
const SEQ_DIGITS = 6;

/**
 * Тоолуурын scope = дугаарын тогтмол иш: "GL-26".
 * Огноо нь `YYYY-MM-DD`; жилийн сүүлийн хоёр орноор бүлэглэнэ.
 */
export function voucherNoScope(module: JournalModule, date: string): string {
  const year = date.slice(2, 4);
  if (!/^\d{2}$/.test(year))
    throw new Error(`Журналын дугаарын огноо буруу: "${date}"`);
  return `${JOURNAL_MODULE_CODES[module]}-${year}`;
}

/** scope + дараалал → бүтэн дугаар. */
export function formatVoucherNo(scope: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1)
    throw new Error(`Журналын дугаарын дараалал буруу: ${seq}`);
  return `${scope}-${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

/**
 * Дугаарыг буцааж задална — жагсаалт/тайлангийн шүүлтэд. Танихгүй бол null
 * (ТААМАГЛАХГҮЙ): дугааргүй түүхэн бичилт ч энэ замаар орж ирнэ.
 */
export function parseVoucherNo(documentNo: string | null | undefined): {
  module: JournalModule;
  year: string;
  seq: number;
} | null {
  if (!documentNo) return null;
  const match = /^([A-Z]+)-(\d{2})-(\d+)$/.exec(documentNo.trim());
  if (!match) return null;
  const [, code, year, seq] = match;
  // Next.js-ийн lint дүрэм `module` нэртэй хувьсагч зөвшөөрдөггүй.
  const found = (Object.keys(JOURNAL_MODULE_CODES) as JournalModule[]).find(
    (key) => JOURNAL_MODULE_CODES[key] === code
  );
  if (!found) return null;
  return { module: found, year, seq: Number(seq) };
}

/**
 * БУЦААЛТЫН журнал эх журналынхаа модулийг ӨВЛӨНӨ — кассын баримтын буцаалт
 * "CM-…", ҮХ-ийн элэгдлийн буцаалт "FA-…" болж хосууд нь нэг модульд үлдэнэ.
 * Дугааргүй (энэ багана нэмэгдэхээс өмнөх) эх журналд `fallback` хэрэглэнэ.
 */
export function moduleOfVoucherNo(
  documentNo: string | null | undefined,
  fallback: JournalModule
): JournalModule {
  return parseVoucherNo(documentNo)?.module ?? fallback;
}

/** Транзакцийн хамгийн бага гэрээ — тест/бодит tx хоёуланд таарна. */
type SqlRunner = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * `count` ширхэг дугаарыг НЭГ удаагийн атомик нэмэгдүүлэлтээр нөөцөлнө;
 * буцаах утга нь блокийн СҮҮЛИЙН дараалал.
 */
async function reserveSeqBlock(
  tx: SqlRunner,
  orgId: string,
  scope: string,
  count: number
): Promise<number> {
  const result = await tx.execute(sql`
    insert into ${documentCounters} (organization_id, scope, value, updated_at)
    values (${orgId}, ${scope}, ${count}, now())
    on conflict (organization_id, scope)
    do update set value = ${documentCounters}.value + ${count}, updated_at = now()
    returning value
  `);
  const last = readReturnedValue(result);
  if (last === null || last < count)
    throw new Error(`Журналын дугаар үүсгэж чадсангүй (${scope})`);
  return last;
}

/**
 * Дараагийн дугаарыг АТОМААР авна. ЗААВАЛ журналаа бичиж буй транзакц дотор
 * дуудна (`tx`) — тэгвэл бичилт нь унавал тоолуур ч буцаж, цоорхой үүсэхгүй.
 */
export async function nextVoucherNo(
  tx: SqlRunner,
  orgId: string,
  module: JournalModule,
  date: string
): Promise<string> {
  const scope = voucherNoScope(module, date);
  return formatVoucherNo(scope, await reserveSeqBlock(tx, orgId, scope, 1));
}

/**
 * ОЛОН журналыг нэг дор бичихэд (банкны хуулга) — огноо бүрээр нь дугаар.
 * Scope тус бүрд ГАНЦ л хүсэлт явуулна: 500 мөрт 500 биш, нэг (ховор хоёр)
 * round trip. Буцах дараалал нь ОРСОН дарааллаа хадгална.
 */
export async function nextVoucherNos(
  tx: SqlRunner,
  orgId: string,
  module: JournalModule,
  dates: string[]
): Promise<string[]> {
  const scopes = dates.map((date) => voucherNoScope(module, date));
  const counts = new Map<string, number>();
  for (const scope of scopes) counts.set(scope, (counts.get(scope) ?? 0) + 1);

  // scope бүрд блок нөөцөлж, эхний дугаарыг нь курсор болгоно.
  const cursors = new Map<string, number>();
  for (const [scope, count] of counts) {
    const last = await reserveSeqBlock(tx, orgId, scope, count);
    cursors.set(scope, last - count + 1);
  }

  return scopes.map((scope) => {
    const seq = cursors.get(scope)!;
    cursors.set(scope, seq + 1);
    return formatVoucherNo(scope, seq);
  });
}

/**
 * `tx.execute` нь драйвераас хамаарч мөрийн массив ЭСВЭЛ `{ rows }` буцаадаг —
 * хоёуланг нь тэвчнэ (postgres.js vs node-postgres).
 */
function readReturnedValue(result: unknown): number | null {
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] } | null)?.rows ?? []);
  const first = rows[0] as { value?: unknown } | undefined;
  const value = Number(first?.value);
  return Number.isInteger(value) && value > 0 ? value : null;
}

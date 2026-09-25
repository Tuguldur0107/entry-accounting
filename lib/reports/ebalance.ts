// e-Balance (Сангийн яамны Цахим санхүүгийн тайлангийн систем) МАЯГТЫН
// дарааллаар санхүүгийн тайлан — ЦЭВЭР (client-safe, DB-гүй, тесттэй).
//
// Нягтлан бодох бүртгэлийн тухай хуулийн 8.1: санхүүгийн байдлын тайлан
// (СТ-1), орлогын дэлгэрэнгүй тайлан (СТ-2), өмчийн өөрчлөлтийн тайлан (СТ-3),
// мөнгөн гүйлгээний тайлан (СТ-4) — Entry-ийн ГУРВАН тайлангийн mapping
// (report_line_mappings: balance-sheet / income-statement / cash-flow) ба S8
// мөнгөн урсгалын кодоос маягтын мөр бүрд БУУЛГАНА. Тайлан ЗОХИОХГҮЙ: маягтын
// мөр бүр Entry-ийн аль мөрөөс (эсвэл S8 кодоос) бүрдсэнээ `sources`-д ил
// хэлнэ; Entry-д харгалзах мөргүй маягтын мөр 0 + `note` (нягтлан гараар).
//
// Маягтын мөрийн дугаарлалт — ААНБ-ын санхүүгийн тайлангийн стандарт маягтын
// (Сангийн сайдын тушаалаар батлагдсан СТ-1…СТ-4) дараалал. e-Balance-ийн
// тухайн жилийн маягттай тулгаж энэ файлын НЭГ жагсаалтыг л засна
// (docs/integrations/00-itc-developer-portal.md §5).

import type { JournalVoucherWithLines } from "@/lib/db/schema";
import { computeCumulativeNetIncome, computeNetIncome, type BalanceRow } from "./balances";
import { resolveBsLines, type BsMappingInput, type ResolvedBsLine } from "./bs-resolve";
import { resolveIsLines, type IsMappingInput, type ResolvedIsLine } from "./is-lines";
import {
  collectCashFlows,
  resolveCfLines,
  type CashFlowItem,
  type CfMappingInput,
  type CfSection,
} from "./cf-lines";

export type EbalanceStatementKey = "bs" | "is" | "equity" | "cf";
export type EbalanceRowKind = "header" | "line" | "subtotal" | "total";

export interface EbalanceRow {
  /** Маягтын мөрийн дугаар (1.1, 4.1.12 …). */
  code: string;
  label: string;
  kind: EbalanceRowKind;
  /** Тайлант үе (БС: эцсийн үлдэгдэл). header мөрд null. */
  amount: number | null;
  /** БС: эхний үлдэгдэл (мужийн эхэн — жилийн тайланд өмнөх оны эцэс). */
  opening?: number | null;
  /** Өмчийн өөрчлөлтийн маягт: багана бүрийн дүн (`columns`-ийн дарааллаар). */
  cells?: number[];
  /** Entry-ийн эх — мөрийн нэрс / S8 кодууд (ил тод байдал). */
  sources: string[];
  /** Гараар нөхөх, анхаарах тэмдэглэл. */
  note?: string;
}

export interface EbalanceStatement {
  key: EbalanceStatementKey;
  /** Маягтын албан нэр. */
  title: string;
  /** Маягтын код (СТ-1 …). */
  form: string;
  /** Тоон багануудын нэр — БС 2 (эхний / эцсийн), ӨӨТ олон, бусад 1. */
  columns: string[];
  rows: EbalanceRow[];
  /** Маягтын түвшний тэмдэглэл (тулгалт, хязгаарлалт). */
  notes: string[];
}

export interface EbalanceReport {
  from: string;
  to: string;
  statements: EbalanceStatement[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPSILON = 0.01;

// ── Entry-ийн мөрийн дүн ──────────────────────────────────────────────────────

interface BsLineValue {
  line: ResolvedBsLine;
  opening: number;
  closing: number;
}

function bsLineValues(rows: BalanceRow[], lines: ResolvedBsLine[]): BsLineValue[] {
  const byMain = new Map(rows.map((r) => [r.mainAccount, r]));
  return lines.map((line) => {
    let opening = 0;
    let closing = 0;
    for (const code of line.accountNumbers) {
      const r = byMain.get(code);
      if (!r) continue;
      const openNet = r.totals.openDebit - r.totals.openCredit;
      const closeNet = r.totals.closeDebit - r.totals.closeCredit;
      opening += line.sign === "debit" ? openNet : -openNet;
      closing += line.sign === "debit" ? closeNet : -closeNet;
    }
    return { line, opening, closing };
  });
}

interface IsLineValue {
  line: ResolvedIsLine;
  amount: number;
}

function isLineValues(rows: BalanceRow[], lines: ResolvedIsLine[]): IsLineValue[] {
  const byMain = new Map(rows.map((r) => [r.mainAccount, r]));
  return lines.map((line) => {
    let amount = 0;
    for (const code of line.accountNumbers) {
      const r = byMain.get(code);
      if (!r) continue;
      amount +=
        line.sign === "credit"
          ? r.totals.periodCredit - r.totals.periodDebit
          : r.totals.periodDebit - r.totals.periodCredit;
    }
    return { line, amount };
  });
}

// ── СТ-1 Санхүүгийн байдлын тайлан ───────────────────────────────────────────

type BsFormRow =
  | { code: string; label: string; kind: "header" }
  | { code: string; label: string; kind: "line"; keys: string[]; pnl?: boolean; note?: string }
  | { code: string; label: string; kind: "subtotal" | "total"; sum: string[] };

/** Entry-ийн бүлэг → «бусад» мөр (mapping-д ил нэрлээгүй / custom / ангилагдаагүй мөрүүд). */
const BS_GROUP_FALLBACK_ROW: Record<string, string> = {
  "current-assets": "1.8",
  "non-current-assets": "2.8",
  "current-liabilities": "4.1.10",
  "non-current-liabilities": "4.2.4",
  equity: "5.6",
};

export const EBALANCE_BS_FORM: readonly BsFormRow[] = [
  { code: "1", label: "Эргэлтийн хөрөнгө", kind: "header" },
  { code: "1.1", label: "Мөнгө, түүнтэй адилтгах хөрөнгө", kind: "line", keys: ["cash"] },
  { code: "1.2", label: "Дансны авлага", kind: "line", keys: ["receivables"], note: "Татвар, НДШ-ийн авлага (1.3), бусад авлага (1.4) Entry-д нэг мөр — задаргааг гараар" },
  { code: "1.3", label: "Татвар, НДШ-ийн авлага", kind: "line", keys: [] },
  { code: "1.4", label: "Бусад авлага", kind: "line", keys: [] },
  { code: "1.5", label: "Бусад санхүүгийн хөрөнгө", kind: "line", keys: ["short-term-investments"] },
  { code: "1.6", label: "Бараа материал", kind: "line", keys: ["inventory"] },
  { code: "1.7", label: "Урьдчилж төлсөн зардал / тооцоо", kind: "line", keys: ["prepaid"] },
  { code: "1.8", label: "Бусад эргэлтийн хөрөнгө", kind: "line", keys: ["other-current-assets"] },
  { code: "1.9", label: "Эргэлтийн хөрөнгийн дүн", kind: "subtotal", sum: ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
  { code: "2", label: "Эргэлтийн бус хөрөнгө", kind: "header" },
  { code: "2.1", label: "Үндсэн хөрөнгө", kind: "line", keys: ["ppe"], note: "Биет бус хөрөнгө (2.2) Entry-ийн «Үндсэн хөрөнгө (нэт)» мөрөнд багтсан бол шилжүүлнэ" },
  { code: "2.2", label: "Биет бус хөрөнгө", kind: "line", keys: [] },
  { code: "2.3", label: "Биологийн хөрөнгө", kind: "line", keys: [] },
  { code: "2.4", label: "Урт хугацаат хөрөнгө оруулалт", kind: "line", keys: ["long-term-investments"] },
  { code: "2.5", label: "Хайгуул ба үнэлгээний хөрөнгө", kind: "line", keys: [] },
  { code: "2.6", label: "Хойшлогдсон татварын хөрөнгө", kind: "line", keys: ["deferred-tax-asset"] },
  { code: "2.7", label: "Хөрөнгө оруулалтын зориулалттай үл хөдлөх хөрөнгө", kind: "line", keys: [] },
  { code: "2.8", label: "Бусад эргэлтийн бус хөрөнгө", kind: "line", keys: ["other-non-current-assets"] },
  { code: "2.9", label: "Эргэлтийн бус хөрөнгийн дүн", kind: "subtotal", sum: ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8"] },
  { code: "3", label: "Нийт хөрөнгийн дүн", kind: "total", sum: ["1.9", "2.9"] },
  { code: "4", label: "Өр төлбөр", kind: "header" },
  { code: "4.1", label: "Богино хугацаат өр төлбөр", kind: "header" },
  { code: "4.1.1", label: "Дансны өглөг", kind: "line", keys: ["ap"] },
  { code: "4.1.2", label: "Цалингийн өглөг", kind: "line", keys: ["payroll-payable"], note: "Entry-ийн «Цалин, НДШ, ХХОАТ-ын өглөг» нэг мөр — НДШ-ийн өглөгийг (4.1.4) гараар салгана" },
  { code: "4.1.3", label: "Татварын өр", kind: "line", keys: ["tax-payable"] },
  { code: "4.1.4", label: "НДШ-ийн өглөг", kind: "line", keys: [] },
  { code: "4.1.5", label: "Богино хугацаат зээл", kind: "line", keys: ["short-term-loans"] },
  { code: "4.1.6", label: "Хүүний өглөг", kind: "line", keys: [] },
  { code: "4.1.7", label: "Ногдол ашгийн өглөг", kind: "line", keys: [] },
  { code: "4.1.8", label: "Урьдчилж орсон орлого", kind: "line", keys: [] },
  { code: "4.1.9", label: "Нөөц (өр төлбөр)", kind: "line", keys: [] },
  { code: "4.1.10", label: "Бусад богино хугацаат өр төлбөр", kind: "line", keys: ["other-current-liabilities"] },
  { code: "4.1.11", label: "Борлуулах зорилгоор эзэмшиж буй хөрөнгөнд хамаарах өр төлбөр", kind: "line", keys: [] },
  { code: "4.1.12", label: "Богино хугацаат өр төлбөрийн дүн", kind: "subtotal", sum: ["4.1.1", "4.1.2", "4.1.3", "4.1.4", "4.1.5", "4.1.6", "4.1.7", "4.1.8", "4.1.9", "4.1.10", "4.1.11"] },
  { code: "4.2", label: "Урт хугацаат өр төлбөр", kind: "header" },
  { code: "4.2.1", label: "Урт хугацаат зээл", kind: "line", keys: ["long-term-debt"] },
  { code: "4.2.2", label: "Нөөц (өр төлбөр)", kind: "line", keys: [] },
  { code: "4.2.3", label: "Хойшлогдсон татварын өр", kind: "line", keys: ["deferred-tax-liability"] },
  { code: "4.2.4", label: "Бусад урт хугацаат өр төлбөр", kind: "line", keys: [] },
  { code: "4.2.5", label: "Урт хугацаат өр төлбөрийн дүн", kind: "subtotal", sum: ["4.2.1", "4.2.2", "4.2.3", "4.2.4"] },
  { code: "4.3", label: "Өр төлбөрийн нийт дүн", kind: "total", sum: ["4.1.12", "4.2.5"] },
  { code: "5", label: "Эздийн өмч", kind: "header" },
  { code: "5.1", label: "Өмч", kind: "line", keys: ["share-capital"], note: "Төрийн / хувийн / хувьцаат (5.1.1–5.1.3) задаргаа Entry-д байхгүй — маягтад гараар" },
  { code: "5.2", label: "Халаасны хувьцаа", kind: "line", keys: [] },
  { code: "5.3", label: "Нэмж төлөгдсөн капитал", kind: "line", keys: [] },
  { code: "5.4", label: "Хөрөнгийн дахин үнэлгээний нэмэгдэл", kind: "line", keys: ["revaluation-reserve"] },
  { code: "5.5", label: "Гадаад валютын хөрвүүлэлтийн нөөц", kind: "line", keys: ["fx-translation-reserve"] },
  { code: "5.6", label: "Эздийн өмчийн бусад хэсэг", kind: "line", keys: [] },
  { code: "5.7", label: "Хуримтлагдсан ашиг", kind: "line", keys: ["retained-earnings"], pnl: true },
  { code: "5.8", label: "Эздийн өмчийн дүн", kind: "subtotal", sum: ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7"] },
  { code: "6", label: "Өр төлбөр ба эздийн өмчийн дүн", kind: "total", sum: ["4.3", "5.8"] },
];

function sumRows(rows: EbalanceRow[], codes: string[], pick: (row: EbalanceRow) => number): number {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  return round2(codes.reduce((sum, code) => sum + (byCode.get(code) ? pick(byCode.get(code)!) : 0), 0));
}

export function buildEbalanceBalanceSheet(
  values: BsLineValue[],
  pnl: { openingCumulative: number; closingCumulative: number }
): EbalanceStatement {
  const explicitKeys = new Set(
    EBALANCE_BS_FORM.flatMap((row) => (row.kind === "line" ? row.keys : []))
  );
  // Мөр → түүнд орох Entry мөрүүд: ил нэрлэсэн key + бүлгээрээ «бусад» руу
  // унасан (custom / ангилагдаагүй / mapping-д байхгүй) мөрүүд.
  const contributions = new Map<string, BsLineValue[]>();
  const push = (code: string, value: BsLineValue) =>
    contributions.set(code, [...(contributions.get(code) ?? []), value]);
  for (const value of values) {
    if (explicitKeys.has(value.line.key)) {
      const row = EBALANCE_BS_FORM.find((r) => r.kind === "line" && r.keys.includes(value.line.key));
      if (row) push(row.code, value);
      continue;
    }
    const fallback = BS_GROUP_FALLBACK_ROW[value.line.group];
    if (fallback) push(fallback, value);
  }

  const rows: EbalanceRow[] = [];
  for (const def of EBALANCE_BS_FORM) {
    if (def.kind === "header") {
      rows.push({ code: def.code, label: def.label, kind: "header", amount: null, opening: null, sources: [] });
      continue;
    }
    if (def.kind === "line") {
      const parts = contributions.get(def.code) ?? [];
      let opening = parts.reduce((sum, p) => sum + p.opening, 0);
      let closing = parts.reduce((sum, p) => sum + p.closing, 0);
      const sources = parts
        .filter((p) => Math.abs(p.opening) > EPSILON || Math.abs(p.closing) > EPSILON || explicitKeys.has(p.line.key))
        .map((p) => p.line.label);
      if (def.pnl) {
        // Хаагдаагүй тайлант үеийн ашиг (5–8 ангиллын данс) хуримтлагдсан ашигт.
        opening += pnl.openingCumulative;
        closing += pnl.closingCumulative;
        sources.push("Тайлант үеийн (хаагдаагүй) цэвэр ашиг");
      }
      const note =
        parts.length === 0 && !def.pnl
          ? "Entry-д харгалзах мөр байхгүй — маягтад гараар"
          : def.note;
      rows.push({
        code: def.code,
        label: def.label,
        kind: "line",
        amount: round2(closing),
        opening: round2(opening),
        sources,
        note,
      });
      continue;
    }
    rows.push({
      code: def.code,
      label: def.label,
      kind: def.kind,
      amount: sumRows(rows, def.sum, (r) => r.amount ?? 0),
      opening: sumRows(rows, def.sum, (r) => r.opening ?? 0),
      sources: def.sum,
    });
  }

  const byCode = new Map(rows.map((row) => [row.code, row]));
  const assets = byCode.get("3")!;
  const liabEq = byCode.get("6")!;
  const notes: string[] = [];
  const diffClose = round2((assets.amount ?? 0) - (liabEq.amount ?? 0));
  const diffOpen = round2((assets.opening ?? 0) - (liabEq.opening ?? 0));
  if (Math.abs(diffClose) > EPSILON)
    notes.push(`Эцсийн тэнцэл зөрүү ${diffClose.toFixed(2)} (3 ≠ 6) — Гүйлгээ баланс / reconcile_modules-оор шалтгааныг олно`);
  if (Math.abs(diffOpen) > EPSILON)
    notes.push(`Эхний тэнцэл зөрүү ${diffOpen.toFixed(2)} (3 ≠ 6)`);
  return {
    key: "bs",
    form: "СТ-1",
    title: "Санхүүгийн байдлын тайлан",
    columns: ["Эхний үлдэгдэл", "Эцсийн үлдэгдэл"],
    rows,
    notes,
  };
}

// ── СТ-2 Орлогын дэлгэрэнгүй тайлан ──────────────────────────────────────────

type IsFormRow =
  | { code: string; label: string; kind: "header" }
  | { code: string; label: string; kind: "line"; keys: string[]; negKeys?: string[]; note?: string }
  | { code: string; label: string; kind: "subtotal" | "total"; plus: string[]; minus: string[] };

/** Entry-ийн бүлэг → маягтын мөр (custom мөрүүд бүлгээрээ). */
const IS_GROUP_FALLBACK_ROW: Record<string, string> = {
  revenue: "8",
  cogs: "2",
  opex: "10",
  finex: "11",
};

export const EBALANCE_IS_FORM: readonly IsFormRow[] = [
  { code: "1", label: "Борлуулалтын орлого (цэвэр)", kind: "line", keys: ["sales-revenue"] },
  { code: "2", label: "Борлуулалтын өртөг", kind: "line", keys: ["cogs"] },
  { code: "3", label: "Нийт ашиг (алдагдал)", kind: "subtotal", plus: ["1"], minus: ["2"] },
  { code: "4", label: "Түрээсийн орлого", kind: "line", keys: [] },
  { code: "5", label: "Хүүний орлого", kind: "line", keys: [] },
  { code: "6", label: "Ногдол ашгийн орлого", kind: "line", keys: [] },
  { code: "7", label: "Эрхийн шимтгэлийн орлого", kind: "line", keys: [] },
  { code: "8", label: "Бусад орлого", kind: "line", keys: ["other-income"], note: "Түрээс / хүү / ногдол ашгийн орлого (4–7) энд багтсан бол салгана" },
  { code: "9", label: "Борлуулалт, маркетингийн зардал", kind: "line", keys: [], note: "Entry-ийн үйл ажиллагааны зардал 10-т бүтнээрээ — борлуулалтын зардлыг гараар салгана" },
  { code: "10", label: "Ерөнхий ба удирдлагын зардал", kind: "line", keys: ["payroll-expense", "depreciation-expense", "other-opex"] },
  { code: "11", label: "Санхүүгийн зардал", kind: "line", keys: ["interest-expense", "other-finex"] },
  { code: "12", label: "Бусад зардал", kind: "line", keys: [] },
  { code: "13", label: "Гадаад валютын ханшийн зөрүүний олз (гарз)", kind: "line", keys: ["fx-gain"], negKeys: ["fx-loss"] },
  { code: "14", label: "Үндсэн хөрөнгө данснаас хассаны олз (гарз)", kind: "line", keys: [] },
  { code: "15", label: "Биет бус хөрөнгө данснаас хассаны олз (гарз)", kind: "line", keys: [] },
  { code: "16", label: "Хөрөнгө оруулалт борлуулснаас үүссэн олз (гарз)", kind: "line", keys: [] },
  { code: "17", label: "Бусад ашиг (алдагдал)", kind: "line", keys: [] },
  { code: "18", label: "Татвар төлөхийн өмнөх ашиг (алдагдал)", kind: "subtotal", plus: ["3", "4", "5", "6", "7", "8", "13", "14", "15", "16", "17"], minus: ["9", "10", "11", "12"] },
  { code: "19", label: "Орлогын татварын зардал", kind: "line", keys: [], note: "ААНОАТ-ын зардал Entry-д тусдаа мөр биш — 10-т орсон бол шилжүүлнэ" },
  { code: "20", label: "Татварын дараах ашиг (алдагдал)", kind: "subtotal", plus: ["18"], minus: ["19"] },
  { code: "21", label: "Зогсоосон үйл ажиллагааны татварын дараах ашиг (алдагдал)", kind: "line", keys: [] },
  { code: "22", label: "Тайлант үеийн цэвэр ашиг (алдагдал)", kind: "total", plus: ["20", "21"], minus: [] },
  { code: "23", label: "Бусад дэлгэрэнгүй орлого", kind: "header" },
  { code: "23.1", label: "Хөрөнгийн дахин үнэлгээний нэмэгдлийн зөрүү", kind: "line", keys: [] },
  { code: "23.2", label: "Гадаад валютын хөрвүүлэлтийн зөрүү", kind: "line", keys: [] },
  { code: "23.3", label: "Бусад олз (гарз)", kind: "line", keys: [] },
  { code: "24", label: "Орлогын нийт дүн", kind: "total", plus: ["22", "23.1", "23.2", "23.3"], minus: [] },
  { code: "25", label: "Нэгж хувьцаанд ногдох суурь ашиг (алдагдал)", kind: "line", keys: [], note: "Хувьцааны тоо Entry-д байхгүй" },
];

export function buildEbalanceIncomeStatement(values: IsLineValue[], netIncome: number): EbalanceStatement {
  const explicit = new Map<string, { code: string; sign: 1 | -1 }>();
  for (const row of EBALANCE_IS_FORM) {
    if (row.kind !== "line") continue;
    for (const key of row.keys) explicit.set(key, { code: row.code, sign: 1 });
    for (const key of row.negKeys ?? []) explicit.set(key, { code: row.code, sign: -1 });
  }
  const contributions = new Map<string, { value: IsLineValue; sign: 1 | -1 }[]>();
  const push = (code: string, value: IsLineValue, sign: 1 | -1) =>
    contributions.set(code, [...(contributions.get(code) ?? []), { value, sign }]);
  for (const value of values) {
    const target = explicit.get(value.line.key);
    if (target) {
      push(target.code, value, target.sign);
      continue;
    }
    const fallback = IS_GROUP_FALLBACK_ROW[value.line.group];
    if (fallback) push(fallback, value, 1);
  }

  const rows: EbalanceRow[] = [];
  for (const def of EBALANCE_IS_FORM) {
    if (def.kind === "header") {
      rows.push({ code: def.code, label: def.label, kind: "header", amount: null, sources: [] });
      continue;
    }
    if (def.kind === "line") {
      const parts = contributions.get(def.code) ?? [];
      const amount = parts.reduce((sum, p) => sum + p.sign * p.value.amount, 0);
      rows.push({
        code: def.code,
        label: def.label,
        kind: "line",
        amount: round2(amount),
        sources: parts
          .filter((p) => Math.abs(p.value.amount) > EPSILON || explicit.has(p.value.line.key))
          .map((p) => (p.sign < 0 ? `− ${p.value.line.label}` : p.value.line.label)),
        note: parts.length === 0 ? (def.note ?? "Entry-д харгалзах мөр байхгүй — маягтад гараар") : def.note,
      });
      continue;
    }
    rows.push({
      code: def.code,
      label: def.label,
      kind: def.kind,
      amount: round2(
        sumRows(rows, def.plus, (r) => r.amount ?? 0) - sumRows(rows, def.minus, (r) => r.amount ?? 0)
      ),
      sources: [...def.plus, ...def.minus.map((code) => `− ${code}`)],
    });
  }
  const notes: string[] = [];
  const net = rows.find((row) => row.code === "22")?.amount ?? 0;
  if (Math.abs(net - netIncome) > EPSILON)
    notes.push(
      `Маягтын цэвэр ашиг ${net.toFixed(2)} ≠ Entry-ийн орлогын тайлан ${round2(netIncome).toFixed(2)} — mapping-д ороогүй 5–8 ангиллын данс байна (Орлогын тайлангийн «Ангилагдаагүй»)`
    );
  return {
    key: "is",
    form: "СТ-2",
    title: "Орлогын дэлгэрэнгүй тайлан",
    columns: ["Тайлант үе"],
    rows,
    notes,
  };
}

// ── СТ-3 Өмчийн өөрчлөлтийн тайлан ───────────────────────────────────────────

/** Маягтын багана → Entry-ийн эздийн өмчийн мөр (custom/ангилагдаагүй → «бусад хэсэг»). */
const EQUITY_COLUMNS: readonly { key: string; label: string; lineKeys: string[] }[] = [
  { key: "share-capital", label: "Өмч", lineKeys: ["share-capital"] },
  { key: "revaluation-reserve", label: "Хөрөнгийн дахин үнэлгээний нэмэгдэл", lineKeys: ["revaluation-reserve"] },
  { key: "fx-translation-reserve", label: "Гадаад валютын хөрвүүлэлтийн нөөц", lineKeys: ["fx-translation-reserve"] },
  { key: "other", label: "Эздийн өмчийн бусад хэсэг", lineKeys: [] },
  { key: "retained-earnings", label: "Хуримтлагдсан ашиг", lineKeys: ["retained-earnings"] },
];

export function buildEbalanceEquityChanges(
  values: BsLineValue[],
  pnl: { period: number; openingCumulative: number; closingCumulative: number }
): EbalanceStatement {
  const equity = values.filter((v) => v.line.section === "equity");
  const explicit = new Set(EQUITY_COLUMNS.flatMap((c) => c.lineKeys));
  const opening = EQUITY_COLUMNS.map((column) =>
    equity
      .filter((v) => (column.lineKeys.includes(v.line.key) ? true : column.key === "other" && !explicit.has(v.line.key)))
      .reduce((sum, v) => sum + v.opening, 0)
  );
  const closing = EQUITY_COLUMNS.map((column) =>
    equity
      .filter((v) => (column.lineKeys.includes(v.line.key) ? true : column.key === "other" && !explicit.has(v.line.key)))
      .reduce((sum, v) => sum + v.closing, 0)
  );
  const re = EQUITY_COLUMNS.findIndex((c) => c.key === "retained-earnings");
  const openingRow = opening.map((v, i) => round2(i === re ? v + pnl.openingCumulative : v));
  const profitRow = EQUITY_COLUMNS.map((_, i) => (i === re ? round2(pnl.period) : 0));
  const otherRow = EQUITY_COLUMNS.map((_, i) => round2(closing[i] - opening[i]));
  const closingRow = closing.map((v, i) => round2(i === re ? v + pnl.closingCumulative : v));
  const withTotal = (cells: number[]) => [...cells, round2(cells.reduce((a, b) => a + b, 0))];

  const rows: EbalanceRow[] = [
    { code: "1", label: "Эхний үлдэгдэл", kind: "line", amount: null, cells: withTotal(openingRow), sources: ["БС эхний үлдэгдэл + хаагдаагүй өмнөх үеийн ашиг"] },
    { code: "2", label: "Нягтлан бодох бүртгэлийн бодлогын өөрчлөлт, алдааны залруулга", kind: "line", amount: null, cells: withTotal(EQUITY_COLUMNS.map(() => 0)), sources: [], note: "Entry-д тусдаа бүртгэгдэхгүй — гараар" },
    { code: "3", label: "Тайлант үеийн цэвэр ашиг (алдагдал)", kind: "line", amount: null, cells: withTotal(profitRow), sources: ["Орлогын тайлан 22"] },
    { code: "4", label: "Бусад дэлгэрэнгүй орлого, өмчийн бусад өөрчлөлт", kind: "line", amount: null, cells: withTotal(otherRow), sources: ["Өмчийн дансны тайлант үеийн эргэлт"], note: "Ногдол ашиг, өмчийн оруулалт, жилийн хаалтын шилжүүлэлтийг маягтын мөрүүдэд гараар задална" },
    { code: "5", label: "Эцсийн үлдэгдэл", kind: "total", amount: null, cells: withTotal(closingRow), sources: ["1 + 2 + 3 + 4"] },
  ];
  const notes: string[] = [];
  const check = openingRow.map((v, i) => round2(v + profitRow[i] + otherRow[i] - closingRow[i]));
  if (check.some((d) => Math.abs(d) > EPSILON))
    notes.push("Эхний + өөрчлөлт ≠ эцсийн — баганын тооцоо зөрсөн (алдаа)");
  return {
    key: "equity",
    form: "СТ-3",
    title: "Өмчийн өөрчлөлтийн тайлан",
    columns: [...EQUITY_COLUMNS.map((c) => c.label), "Нийт"],
    rows,
    notes,
  };
}

// ── СТ-4 Мөнгөн гүйлгээний тайлан (шууд арга) ────────────────────────────────

type CfDirection = "in" | "out";
type CfFormRow =
  | { code: string; label: string; kind: "header" }
  | { code: string; label: string; kind: "line"; direction: CfDirection }
  | { code: string; label: string; kind: "subtotal" | "total"; plus: string[]; minus: string[] }
  | { code: string; label: string; kind: "line"; fixed: "cashOpen" | "fxEffect" | "cashClose" };

export const EBALANCE_CF_FORM: readonly CfFormRow[] = [
  { code: "1", label: "Үндсэн үйл ажиллагааны мөнгөн гүйлгээ", kind: "header" },
  { code: "1.1", label: "Мөнгөн орлогын дүн", kind: "subtotal", plus: ["1.1.1", "1.1.2", "1.1.3", "1.1.4", "1.1.5", "1.1.6"], minus: [] },
  { code: "1.1.1", label: "Бараа борлуулсан, үйлчилгээ үзүүлсний орлого", kind: "line", direction: "in" },
  { code: "1.1.2", label: "Эрхийн шимтгэл, хураамж, төлбөрийн орлого", kind: "line", direction: "in" },
  { code: "1.1.3", label: "Даатгалын нөхвөрөөс хүлээн авсан мөнгө", kind: "line", direction: "in" },
  { code: "1.1.4", label: "Буцаан авсан албан татвар", kind: "line", direction: "in" },
  { code: "1.1.5", label: "Татаас, санхүүжилтийн орлого", kind: "line", direction: "in" },
  { code: "1.1.6", label: "Бусад мөнгөн орлого", kind: "line", direction: "in" },
  { code: "1.2", label: "Мөнгөн зарлагын дүн", kind: "subtotal", plus: ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.2.6", "1.2.7", "1.2.8", "1.2.9"], minus: [] },
  { code: "1.2.1", label: "Ажиллагчдад төлсөн", kind: "line", direction: "out" },
  { code: "1.2.2", label: "Нийгмийн даатгалын байгууллагад төлсөн", kind: "line", direction: "out" },
  { code: "1.2.3", label: "Бараа материал худалдан авахад төлсөн", kind: "line", direction: "out" },
  { code: "1.2.4", label: "Ашиглалтын зардалд төлсөн", kind: "line", direction: "out" },
  { code: "1.2.5", label: "Түлш шатахуун, тээврийн хөлс, сэлбэг хэрэгсэлд төлсөн", kind: "line", direction: "out" },
  { code: "1.2.6", label: "Хүүний төлбөрт төлсөн", kind: "line", direction: "out" },
  { code: "1.2.7", label: "Татварын байгууллагад төлсөн", kind: "line", direction: "out" },
  { code: "1.2.8", label: "Даатгалын төлбөрт төлсөн", kind: "line", direction: "out" },
  { code: "1.2.9", label: "Бусад мөнгөн зарлага", kind: "line", direction: "out" },
  { code: "1.3", label: "Үндсэн үйл ажиллагааны цэвэр мөнгөн гүйлгээний дүн", kind: "total", plus: ["1.1"], minus: ["1.2"] },
  { code: "2", label: "Хөрөнгө оруулалтын үйл ажиллагааны мөнгөн гүйлгээ", kind: "header" },
  { code: "2.1", label: "Мөнгөн орлогын дүн", kind: "subtotal", plus: ["2.1.1", "2.1.2", "2.1.3", "2.1.4", "2.1.5", "2.1.6", "2.1.7"], minus: [] },
  { code: "2.1.1", label: "Үндсэн хөрөнгө борлуулсны орлого", kind: "line", direction: "in" },
  { code: "2.1.2", label: "Биет бус хөрөнгө борлуулсны орлого", kind: "line", direction: "in" },
  { code: "2.1.3", label: "Хөрөнгө оруулалт борлуулсны орлого", kind: "line", direction: "in" },
  { code: "2.1.4", label: "Бусад урт хугацаат хөрөнгө борлуулсны орлого", kind: "line", direction: "in" },
  { code: "2.1.5", label: "Бусдад олгосон зээл, мөнгөн урьдчилгааны буцаан төлөлт", kind: "line", direction: "in" },
  { code: "2.1.6", label: "Хүлээн авсан хүүний орлого", kind: "line", direction: "in" },
  { code: "2.1.7", label: "Хүлээн авсан ногдол ашиг", kind: "line", direction: "in" },
  { code: "2.2", label: "Мөнгөн зарлагын дүн", kind: "subtotal", plus: ["2.2.1", "2.2.2", "2.2.3", "2.2.4", "2.2.5"], minus: [] },
  { code: "2.2.1", label: "Үндсэн хөрөнгө олж эзэмшихэд төлсөн", kind: "line", direction: "out" },
  { code: "2.2.2", label: "Биет бус хөрөнгө олж эзэмшихэд төлсөн", kind: "line", direction: "out" },
  { code: "2.2.3", label: "Хөрөнгө оруулалт олж эзэмшихэд төлсөн", kind: "line", direction: "out" },
  { code: "2.2.4", label: "Бусад урт хугацаат хөрөнгө олж эзэмшихэд төлсөн", kind: "line", direction: "out" },
  { code: "2.2.5", label: "Бусдад олгосон зээл болон мөнгөн урьдчилгаа", kind: "line", direction: "out" },
  { code: "2.3", label: "Хөрөнгө оруулалтын үйл ажиллагааны цэвэр мөнгөн гүйлгээний дүн", kind: "total", plus: ["2.1"], minus: ["2.2"] },
  { code: "3", label: "Санхүүгийн үйл ажиллагааны мөнгөн гүйлгээ", kind: "header" },
  { code: "3.1", label: "Мөнгөн орлогын дүн", kind: "subtotal", plus: ["3.1.1", "3.1.2", "3.1.3"], minus: [] },
  { code: "3.1.1", label: "Зээл авсан, өрийн үнэт цаас гаргаснаас хүлээн авсан", kind: "line", direction: "in" },
  { code: "3.1.2", label: "Хувьцаа болон өмчийн бусад үнэт цаас гаргаснаас хүлээн авсан", kind: "line", direction: "in" },
  { code: "3.1.3", label: "Төрөл бүрийн хандив", kind: "line", direction: "in" },
  { code: "3.2", label: "Мөнгөн зарлагын дүн", kind: "subtotal", plus: ["3.2.1", "3.2.2", "3.2.3", "3.2.4"], minus: [] },
  { code: "3.2.1", label: "Зээл, өрийн үнэт цаасны төлбөрт төлсөн", kind: "line", direction: "out" },
  { code: "3.2.2", label: "Санхүүгийн түрээсийн өглөгт төлсөн", kind: "line", direction: "out" },
  { code: "3.2.3", label: "Хувьцаа буцаан худалдаж авахад төлсөн", kind: "line", direction: "out" },
  { code: "3.2.4", label: "Төлсөн ногдол ашиг", kind: "line", direction: "out" },
  { code: "3.3", label: "Санхүүгийн үйл ажиллагааны цэвэр мөнгөн гүйлгээний дүн", kind: "total", plus: ["3.1"], minus: ["3.2"] },
  { code: "4", label: "Бүх цэвэр мөнгөн гүйлгээ", kind: "total", plus: ["1.3", "2.3", "3.3"], minus: [] },
  { code: "5", label: "Мөнгө, түүнтэй адилтгах хөрөнгийн эхний үлдэгдэл", kind: "line", fixed: "cashOpen" },
  { code: "6", label: "Валютын ханшийн зөрүү", kind: "line", fixed: "fxEffect" },
  { code: "7", label: "Мөнгө, түүнтэй адилтгах хөрөнгийн эцсийн үлдэгдэл", kind: "line", fixed: "cashClose" },
];

/**
 * S8 мөнгөн урсгалын СТАНДАРТ код → маягтын мөр (lib/constants/segment-defaults.ts S8).
 * Хүүгийн төлбөр (3103) маягтад үйл ажиллагааны 1.2.6-д (IAS 7-ын сонголт — Сангийн
 * яамны маягт ийм). Цалин + НДШ (1103) нэг код тул 1.2.1-д — НДШ-ийг (1.2.2) гараар.
 */
export const EBALANCE_CF_CODE_ROW: Readonly<Record<string, string>> = {
  "1101": "1.1.1",
  "1109": "1.1.6",
  "1102": "1.2.3",
  "1103": "1.2.1",
  "1104": "1.2.7",
  "1105": "1.2.4",
  "2101": "2.2.1",
  "2102": "2.1.1",
  "2103": "2.2.3",
  "2104": "2.1.3",
  "2109": "", // чиглэлээр (2.1.4 / 2.2.4)
  "3101": "3.1.1",
  "3102": "3.2.1",
  "3103": "1.2.6",
  "3104": "3.1.2",
  "3105": "3.2.4",
  "3109": "", // чиглэлээр (3.1.1 / 3.2.1)
};

/** Кодгүй урсгал: Entry-ийн CF мөр → [орлогын мөр, зарлагын мөр]. */
const CF_LINE_ROWS: Readonly<Record<string, [string, string]>> = {
  "op-sales": ["1.1.1", "1.2.9"],
  "op-goods": ["1.1.6", "1.2.3"],
  "op-payroll": ["1.1.6", "1.2.1"],
  "op-tax": ["1.1.4", "1.2.7"],
  "op-opex": ["1.1.6", "1.2.4"],
  "op-fin-costs": ["1.1.6", "1.2.6"],
  "op-working-capital": ["1.1.6", "1.2.9"],
  "op-payables": ["1.1.6", "1.2.9"],
  "inv-noncurrent": ["2.1.4", "2.2.4"],
  "fin-debt": ["3.1.1", "3.2.1"],
  "fin-equity": ["3.1.2", "3.2.4"],
};

const CF_SECTION_ROWS: Readonly<Record<CfSection, [string, string]>> = {
  operating: ["1.1.6", "1.2.9"],
  investing: ["2.1.4", "2.2.4"],
  financing: ["3.1.1", "3.2.1"],
};

/** Урсгал бүрийн маягтын мөр — ЦЭВЭР (тесттэй): S8 код > Entry мөр (чиглэлээр) > секц. */
export function ebalanceCfRowOf(item: CashFlowItem): string {
  const byCode = item.cfCode ? EBALANCE_CF_CODE_ROW[item.cfCode] : undefined;
  if (byCode) return byCode;
  const pair =
    (item.lineKey ? CF_LINE_ROWS[item.lineKey] : undefined) ?? CF_SECTION_ROWS[item.section];
  return item.amount >= 0 ? pair[0] : pair[1];
}

export function buildEbalanceCashFlow(
  items: CashFlowItem[],
  cash: { open: number; close: number; fxEffect: number }
): EbalanceStatement {
  const amounts = new Map<string, number>();
  const sourcesByRow = new Map<string, Set<string>>();
  const directionOf = new Map<string, CfDirection>();
  for (const def of EBALANCE_CF_FORM)
    if (def.kind === "line" && "direction" in def) directionOf.set(def.code, def.direction);

  for (const item of items) {
    const code = ebalanceCfRowOf(item);
    const direction = directionOf.get(code) ?? "in";
    // Зарлагын мөр ЭЕРЭГ тоогоор (маягтын хэлбэр); буцаалт нь мөрөө бууруулна.
    const signed = direction === "in" ? item.amount : -item.amount;
    amounts.set(code, (amounts.get(code) ?? 0) + signed);
    const source = item.cfCode
      ? `S8 ${item.cfCode}`
      : item.lineKey
        ? `Мөр «${item.lineKey}»`
        : "Ангилагдаагүй";
    sourcesByRow.set(code, (sourcesByRow.get(code) ?? new Set()).add(source));
  }

  const rows: EbalanceRow[] = [];
  // Дэд дүнгүүд мөрүүдээсээ ХОЙНО бодогдох ёстой — маягтад дүн нь дээрээ
  // байрладаг тул эхлээд мөрүүдийг бодож, дараа нь дарааллаар нь гаргана.
  const computed = new Map<string, EbalanceRow>();
  const lineDefs = EBALANCE_CF_FORM.filter((d) => d.kind === "line");
  for (const def of lineDefs) {
    if (def.kind !== "line") continue;
    if ("fixed" in def) {
      const amount = def.fixed === "cashOpen" ? cash.open : def.fixed === "fxEffect" ? cash.fxEffect : cash.close;
      computed.set(def.code, {
        code: def.code,
        label: def.label,
        kind: "line",
        amount: round2(amount),
        sources: [def.fixed === "fxEffect" ? "FX тэгшитгэлийн журнал" : "Мөнгөн хөрөнгийн данс (10x/11x)"],
      });
      continue;
    }
    computed.set(def.code, {
      code: def.code,
      label: def.label,
      kind: "line",
      amount: round2(amounts.get(def.code) ?? 0),
      sources: [...(sourcesByRow.get(def.code) ?? [])].sort(),
    });
  }
  // Дэд дүн / дүн — тодорхойлолтын дарааллаар (1.1 нь 1.1.x-ээс ӨМНӨ бичигдсэн ч
  // хамааралтай мөрүүд нь бүгд line тул аль хэдийн бодогдсон; 1.3 нь 1.1/1.2-оос
  // хамаардаг тул хоёр дахь давалтаар).
  const totalDefs = EBALANCE_CF_FORM.filter((d) => d.kind === "subtotal" || d.kind === "total");
  const pending = [...totalDefs];
  while (pending.length > 0) {
    const before = pending.length;
    for (const def of [...pending]) {
      if (def.kind !== "subtotal" && def.kind !== "total") continue;
      const deps = [...def.plus, ...def.minus];
      if (!deps.every((code) => computed.has(code))) continue;
      const amount =
        def.plus.reduce((sum, code) => sum + (computed.get(code)!.amount ?? 0), 0) -
        def.minus.reduce((sum, code) => sum + (computed.get(code)!.amount ?? 0), 0);
      computed.set(def.code, {
        code: def.code,
        label: def.label,
        kind: def.kind,
        amount: round2(amount),
        sources: [...def.plus, ...def.minus.map((code) => `− ${code}`)],
      });
      pending.splice(pending.indexOf(def), 1);
    }
    if (pending.length === before) throw new Error("e-Balance CF маягтын дүнгийн хамаарал тойрог үүсгэв");
  }
  for (const def of EBALANCE_CF_FORM) {
    if (def.kind === "header") {
      rows.push({ code: def.code, label: def.label, kind: "header", amount: null, sources: [] });
      continue;
    }
    rows.push(computed.get(def.code)!);
  }

  const notes: string[] = [];
  const net = computed.get("4")!.amount ?? 0;
  const expectedClose = round2(cash.open + net + cash.fxEffect);
  if (Math.abs(expectedClose - cash.close) > EPSILON)
    notes.push(
      `Эхний ${round2(cash.open).toFixed(2)} + цэвэр ${round2(net).toFixed(2)} + ханш ${round2(cash.fxEffect).toFixed(2)} = ${expectedClose.toFixed(2)} ≠ эцсийн ${round2(cash.close).toFixed(2)} — мөнгөн дансны шууд бичилт (касс↔банк биш) шалгана`
    );
  const uncoded = items.filter((item) => !item.cfCode).length;
  if (uncoded > 0)
    notes.push(
      `${uncoded} урсгал S8 кодгүй — Entry-ийн мөрийн чиглэлээр байрлуулав («Бусад» мөрүүд); кассын баримтад МГ код оноовол маягтын мөр нарийсна`
    );
  return {
    key: "cf",
    form: "СТ-4",
    title: "Мөнгөн гүйлгээний тайлан",
    columns: ["Тайлант үе"],
    rows,
    notes,
  };
}

// ── Бүгдийг нэг дор ───────────────────────────────────────────────────────────

export interface EbalanceInput {
  /** [from,to] мужаар үндсэн данс (S3) түвшинд нэгтгэсэн мөрүүд (loadBalanceRowsFast). */
  rows: BalanceRow[];
  accounts: readonly { number: string }[];
  bsMappings: readonly BsMappingInput[];
  isMappings: readonly IsMappingInput[];
  cfMappings: readonly CfMappingInput[];
  /** [from,to] доторх батлагдсан ваучерууд — мөнгөн гүйлгээний контра ангилалд. */
  vouchers: JournalVoucherWithLines[];
  /** Журнал → кассын баримтын S8 код. */
  voucherCfCodes: ReadonlyMap<string, string>;
  from: string;
  to: string;
  cashOpenNet: number;
  cashCloseNet: number;
}

export function computeEbalanceStatements(input: EbalanceInput): EbalanceReport {
  const bsValues = bsLineValues(input.rows, resolveBsLines(input.accounts, input.bsMappings));
  const isValues = isLineValues(input.rows, resolveIsLines(input.isMappings, input.accounts));
  const period = computeNetIncome(input.rows);
  const cumulative = computeCumulativeNetIncome(input.rows);
  const pnl = {
    period: period.netIncome,
    closingCumulative: cumulative.netIncome,
    openingCumulative: cumulative.netIncome - period.netIncome,
  };
  const flows = collectCashFlows(
    input.vouchers,
    input.from,
    input.to,
    resolveCfLines([...input.cfMappings], [...input.accounts]),
    input.voucherCfCodes
  );
  return {
    from: input.from,
    to: input.to,
    statements: [
      buildEbalanceBalanceSheet(bsValues, pnl),
      buildEbalanceIncomeStatement(isValues, pnl.period),
      buildEbalanceEquityChanges(bsValues, pnl),
      buildEbalanceCashFlow(flows.items, {
        open: input.cashOpenNet,
        close: input.cashCloseNet,
        fxEffect: flows.fxEffect,
      }),
    ],
  };
}

/** Тайлангийн текст хэлбэр — AI/MCP `get_ebalance_statements` (вэбтэй НЭГ тооцоо). */
export function formatEbalanceReport(report: EbalanceReport, fmt: (n: number) => string): string {
  const out: string[] = [`e-Balance маягтын санхүүгийн тайлан ${report.from} … ${report.to}`];
  for (const statement of report.statements) {
    out.push("", `${statement.form} ${statement.title.toUpperCase()} (${statement.columns.join(" / ")})`);
    for (const row of statement.rows) {
      const indent = "  ".repeat(Math.max(0, row.code.split(".").length - 1));
      if (row.kind === "header") {
        out.push(`${indent}${row.code} ${row.label}`);
        continue;
      }
      const values = row.cells
        ? row.cells.map(fmt).join(" | ")
        : row.opening !== undefined && row.opening !== null
          ? `${fmt(row.opening)} | ${fmt(row.amount ?? 0)}`
          : fmt(row.amount ?? 0);
      const src = row.sources.length > 0 ? ` ← ${row.sources.join(", ")}` : "";
      const note = row.note ? ` ⚠ ${row.note}` : "";
      out.push(`${indent}${row.code} ${row.label} — ${values}${src}${note}`);
    }
    for (const note of statement.notes) out.push(`  ⚠ ${note}`);
  }
  return out.join("\n");
}

// Мөнгөн гүйлгээний тайлангийн стандарт мөрүүд — BS_LINES / IS_LINES-тэй
// ижил хэв маяг (knowledge/03-стандарт/reports/01-line-mapping.md §3).
//
// ХОЁР хэмжигдэхүүнээр mapping хийгдэнэ:
//   1. S8 мөнгөн урсгалын КОД (cfCodes) — журналын контра мөрийн S8 сегмент
//      мөрийн cfCodes-ийн аль нэгтэй таарвал урсгал ЭНЭ мөрөнд орно.
//      Данснаас ТҮРҮҮЛЖ шалгагдана (илүү тодорхой заавар тул).
//   2. Үндсэн данс (accountNumbers) — контра дансны S3 код таарвал.
// Аль алинд нь таараагүй урсгал classifyCashFlow-ийн ангиллаар өөрийн
// секцдээ "Ангилагдаагүй" мөрөнд ИЛ харагдана — нэг ч урсгал алдагдахгүй
// тул "Эхний + Цэвэр = Эцсийн" тулгалт mapping-аас үл хамааран хадгалагдана.
//
// ХАТУУ ДҮРЭМ: default prefix-үүд хоорондоо ДАВХЦАХГҮЙ (нэг данс хоёр
// мөрөнд орвол урсгал давхар тоологдоно). Доорх багц нь хуучин
// classifyCashFlow ангиллыг (1x→үйл ажиллагаа, 2x→хөрөнгө оруулалт,
// 3x/4x→санхүү, 5-8x→үйл ажиллагаа) БҮРЭН, давхцалгүй хуваасан тул
// default байдлаараа хуучин тайлантай ИЖИЛ дүн өгнө.

import type { JournalVoucherWithLines } from "@/lib/db/schema";
import {
  classifyCashFlow,
  extractMainAccount,
  isCashMainAccount,
  type CashFlowSection,
} from "@/lib/reports/balances";

const EPSILON = 0.01;

export type CfSection = CashFlowSection; // "operating" | "investing" | "financing"

export interface CfLine {
  key: string;
  section: CfSection;
  label: string;
  /** Дансны кодын угтвар — мөрүүд хооронд давхцахгүй байх ёстой. */
  defaultPrefixes: string[];
}

export const CF_SECTION_LABEL: Record<CfSection, string> = {
  operating: "ҮЙЛ АЖИЛЛАГААНЫ МӨНГӨН УРСГАЛ",
  investing: "ХӨРӨНГӨ ОРУУЛАЛТЫН МӨНГӨН УРСГАЛ",
  financing: "САНХҮҮГИЙН МӨНГӨН УРСГАЛ",
};

export const CF_SUBTOTAL_LABEL: Record<CfSection, string> = {
  operating: "Үйл ажиллагааны цэвэр урсгал",
  investing: "Хөрөнгө оруулалтын цэвэр урсгал",
  financing: "Санхүүгийн цэвэр урсгал",
};

export const CF_LINES: readonly CfLine[] = [
  // ── Үйл ажиллагаа ────────────────────────────────────────────────────
  {
    key: "op-sales",
    section: "operating",
    label: "Борлуулалт, үйлчилгээний орлого",
    defaultPrefixes: ["5"],
  },
  {
    key: "op-goods",
    section: "operating",
    label: "Бараа материал, нийлүүлэгчид төлсөн",
    defaultPrefixes: ["6"],
  },
  {
    key: "op-payroll",
    section: "operating",
    label: "Ажиллагсад, НДШ-д төлсөн",
    defaultPrefixes: ["72"],
  },
  {
    key: "op-opex",
    section: "operating",
    label: "Бусад үйл ажиллагааны зардалд төлсөн",
    defaultPrefixes: ["70", "71", "73", "74", "75", "76", "77", "78", "79"],
  },
  {
    key: "op-fin-costs",
    section: "operating",
    label: "Хүү, санхүүгийн зардалд төлсөн",
    defaultPrefixes: ["8"],
  },
  {
    // Кассын (11x) контра мөр угаасаа урсгалд ордоггүй тул "11"-гүй.
    key: "op-working-capital",
    section: "operating",
    label: "Авлага, урьдчилгаа, бусад эргэлтийн хөрөнгийн өөрчлөлт",
    defaultPrefixes: ["10", "12", "13", "14", "15", "16", "17", "18", "19"],
  },

  // ── Хөрөнгө оруулалт ─────────────────────────────────────────────────
  {
    key: "inv-noncurrent",
    section: "investing",
    label: "Үндсэн хөрөнгө, хөрөнгө оруулалтын хөдөлгөөн",
    defaultPrefixes: ["2"],
  },

  // ── Санхүү ───────────────────────────────────────────────────────────
  {
    key: "fin-debt",
    section: "financing",
    label: "Зээл, өр төлбөрийн хөдөлгөөн",
    defaultPrefixes: ["3"],
  },
  {
    key: "fin-equity",
    section: "financing",
    label: "Эздийн өмчийн хөдөлгөөн",
    defaultPrefixes: ["4"],
  },
];

/** Mapping мөрийн шаардлагатай хэсэг — DB row-оос ч, тестээс ч бүтнэ. */
export interface CfMappingInput {
  lineKey: string;
  accountNumbers: string;
  cfCodes: string | null;
  isHidden: boolean;
  customLabel: string | null;
  customGroup: string | null;
  sortOrder: number;
}

export interface ResolvedCfLine {
  key: string;
  section: CfSection;
  label: string;
  accountNumbers: string[];
  cfCodes: string[];
  isHidden: boolean;
  isCustom: boolean;
  sortOrder: number;
}

const splitCsv = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * CF_LINES + хэрэглэгчийн override + custom мөрүүд → эцсийн мөрүүд.
 * IS-тэй ижил дүрэм: ХООСОН accountNumbers нь override БИШ (нуух/нэр
 * солих үйлдэл mapping мөрийг хоосон дансаар үүсгэдэг) — default-даа үлдэнэ;
 * харин cfCodes нь бие даасан НЭМЭЛТ заавар тул байгаа л бол хэрэглэгдэнэ.
 */
export function resolveCfLines(
  mappings: CfMappingInput[],
  accounts: { number: string }[]
): ResolvedCfLine[] {
  const byKey = new Map<string, CfMappingInput>();
  for (const m of mappings) byKey.set(m.lineKey, m);

  const out: ResolvedCfLine[] = [];
  CF_LINES.forEach((line, idx) => {
    const m = byKey.get(line.key);
    const override =
      m && m.accountNumbers.trim() !== "" ? splitCsv(m.accountNumbers) : undefined;
    const accountNumbers =
      override !== undefined
        ? override
        : accounts
            .filter((a) => line.defaultPrefixes.some((p) => a.number.startsWith(p)))
            .map((a) => a.number);
    out.push({
      key: line.key,
      section: line.section,
      label: m?.customLabel?.trim() || line.label,
      accountNumbers,
      cfCodes: splitCsv(m?.cfCodes),
      isHidden: !!m?.isHidden,
      isCustom: false,
      sortOrder: idx,
    });
  });

  const customs = mappings
    .filter((m) => m.lineKey.startsWith("custom-"))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const m of customs) {
    const section = (m.customGroup ?? "operating") as CfSection;
    if (!(section in CF_SECTION_LABEL)) continue;
    out.push({
      key: m.lineKey,
      section,
      label: m.customLabel?.trim() || "Нэргүй мөр",
      accountNumbers: splitCsv(m.accountNumbers),
      cfCodes: splitCsv(m.cfCodes),
      isHidden: m.isHidden,
      isCustom: true,
      sortOrder: CF_LINES.length + m.sortOrder,
    });
  }
  return out;
}

/** Журналын мөрийн S8 (мөнгөн урсгалын) код — бүтэн 10 хэсэгт кодоос. */
export function extractCfCode(accountNumber: string): string {
  const parts = accountNumber.split(".");
  if (parts.length !== 10) return "";
  const code = parts[7] ?? "";
  // "0000" = default (заагаагүй) — кодгүйтэй адил.
  return /^0*$/.test(code) ? "" : code;
}

export interface CfComputedLine extends ResolvedCfLine {
  amount: number;
}

export interface CfSectionComputed {
  lines: CfComputedLine[];
  /** Аль ч мөрөнд таараагүй урсгал — ИЛ харагдана, subtotal-д орно. */
  unmapped: number;
  subtotal: number;
}

export interface MappedCashFlowReport {
  sections: Record<CfSection, CfSectionComputed>;
  totals: { operating: number; investing: number; financing: number; net: number };
}

/**
 * Урсгал бүр ЯГ НЭГ мөрөнд ордог тул давхар тооллого бүтцээрээ боломжгүй:
 *   1. S8 код (байвал) → cfCodes-доо агуулсан ЭХНИЙ мөр
 *   2. Контра үндсэн данс → accountNumbers-доо агуулсан ЭХНИЙ мөр
 *   3. Аль нь ч биш → classifyCashFlow секцийн "Ангилагдаагүй"
 */
export function buildMappedCashFlow(
  vouchers: JournalVoucherWithLines[],
  appliedFrom: string,
  appliedTo: string,
  resolvedLines: ResolvedCfLine[],
): MappedCashFlowReport {
  const amounts = new Map<string, number>();
  const unmapped: Record<CfSection, number> = {
    operating: 0,
    investing: 0,
    financing: 0,
  };

  const byCfCode = new Map<string, ResolvedCfLine>();
  const byAccount = new Map<string, ResolvedCfLine>();
  for (const line of resolvedLines) {
    for (const code of line.cfCodes)
      if (!byCfCode.has(code)) byCfCode.set(code, line);
    for (const acc of line.accountNumbers)
      if (!byAccount.has(acc)) byAccount.set(acc, line);
  }

  for (const v of vouchers) {
    if (v.date < appliedFrom || v.date > appliedTo) continue;

    const cashImpact = v.lines.reduce((acc, l) => {
      const main = extractMainAccount(l.accountNumber);
      if (!isCashMainAccount(main)) return acc;
      return acc + Number(l.debit) - Number(l.credit);
    }, 0);
    if (Math.abs(cashImpact) <= EPSILON) continue;

    for (const l of v.lines) {
      const main = extractMainAccount(l.accountNumber);
      if (isCashMainAccount(main)) continue;
      // Контра урсгал: контра руу Дт = мөнгө гарсан, Кт = мөнгө орж ирсэн.
      const flow = Number(l.credit) - Number(l.debit);
      if (Math.abs(flow) <= EPSILON) continue;

      const cfCode = extractCfCode(l.accountNumber);
      const target =
        (cfCode ? byCfCode.get(cfCode) : undefined) ?? byAccount.get(main);
      if (target) {
        amounts.set(target.key, (amounts.get(target.key) ?? 0) + flow);
      } else {
        unmapped[classifyCashFlow(main)] += flow;
      }
    }
  }

  const sections: Record<CfSection, CfSectionComputed> = {
    operating: { lines: [], unmapped: 0, subtotal: 0 },
    investing: { lines: [], unmapped: 0, subtotal: 0 },
    financing: { lines: [], unmapped: 0, subtotal: 0 },
  };
  for (const line of resolvedLines) {
    sections[line.section].lines.push({
      ...line,
      amount: amounts.get(line.key) ?? 0,
    });
  }
  (Object.keys(sections) as CfSection[]).forEach((s) => {
    const sec = sections[s];
    sec.lines.sort((a, b) => a.sortOrder - b.sortOrder);
    sec.unmapped = unmapped[s];
    sec.subtotal =
      sec.lines.reduce((sum, l) => sum + l.amount, 0) + sec.unmapped;
  });

  const totals = {
    operating: sections.operating.subtotal,
    investing: sections.investing.subtotal,
    financing: sections.financing.subtotal,
    net: 0,
  };
  totals.net = totals.operating + totals.investing + totals.financing;

  return { sections, totals };
}

/**
 * MappingDialog-д данс/S8 код бүрийн тайлант үеийн урсгалыг харуулахад:
 * контра мөр бүрийн урсгалыг данс болон S8 кодоор нь тусад нь нэгтгэнэ.
 */
export function computeContraFlows(
  vouchers: JournalVoucherWithLines[],
  appliedFrom: string,
  appliedTo: string,
): { byAccount: Map<string, number>; byCfCode: Map<string, number> } {
  const byAccount = new Map<string, number>();
  const byCfCode = new Map<string, number>();
  for (const v of vouchers) {
    if (v.date < appliedFrom || v.date > appliedTo) continue;
    const cashImpact = v.lines.reduce((acc, l) => {
      const main = extractMainAccount(l.accountNumber);
      if (!isCashMainAccount(main)) return acc;
      return acc + Number(l.debit) - Number(l.credit);
    }, 0);
    if (Math.abs(cashImpact) <= EPSILON) continue;
    for (const l of v.lines) {
      const main = extractMainAccount(l.accountNumber);
      if (isCashMainAccount(main)) continue;
      const flow = Number(l.credit) - Number(l.debit);
      if (Math.abs(flow) <= EPSILON) continue;
      byAccount.set(main, (byAccount.get(main) ?? 0) + flow);
      const cfCode = extractCfCode(l.accountNumber);
      if (cfCode) byCfCode.set(cfCode, (byCfCode.get(cfCode) ?? 0) + flow);
    }
  }
  return { byAccount, byCfCode };
}

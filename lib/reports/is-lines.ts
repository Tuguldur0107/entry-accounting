// Орлогын тайлангийн стандарт мөрүүд — BS_LINES-тэй ижил хэв маяг.
// Мөр бүр default prefix-ээр данс татаж, хэрэглэгч report_line_mappings
// (reportType="income-statement")-ээр мөр бүрийн дансыг override хийнэ.
//
// ХАТУУ ДҮРЭМ (knowledge/03-стандарт/reports/01-line-mapping.md): нэг данс
// НЭГ л мөрөнд орно. Угтварууд давхцаж болох бөгөөд данс нь ХАМГИЙН УРТ
// таарсан угтвартай мөрөнд очно (`isDefaultLineKeyOf`) — ингэснээр
// «87000001 хүү», «87000003 ханшийн гарз» зэрэг стандарт дансыг бүлгээс нь
// ялгаж болно (ENT-048: 870/871-ийн угтвар хүү, ханшийг сольж харуулдаг байв).

export type IsSection = "revenue" | "expense";
export type IsSign = "credit" | "debit";

export interface IsLine {
  key: string;
  section: IsSection;
  group: string;
  groupLabel: string;
  label: string;
  /** Дансны кодын угтвар — давхцахгүй байх ёстой. */
  defaultPrefixes: string[];
  /** credit = periodCredit − periodDebit (орлого), debit = урвуу (зардал). */
  sign: IsSign;
}

export const IS_LINES: readonly IsLine[] = [
  // ── Орлого (5xxxxxxx) ─────────────────────────────────────────────────
  {
    key: "sales-revenue",
    section: "revenue",
    group: "revenue",
    groupLabel: "Үйл ажиллагааны орлого",
    label: "Борлуулалтын орлого",
    defaultPrefixes: ["511"],
    sign: "credit",
  },
  {
    key: "fx-gain",
    section: "revenue",
    group: "revenue",
    groupLabel: "Үйл ажиллагааны орлого",
    label: "Ханшийн олз",
    // 518-ын бусад данс (тооллогын илүүдэл, кассын илүүдэл, IC) ханшийн олз биш.
    defaultPrefixes: ["51800001"],
    sign: "credit",
  },
  {
    key: "other-income",
    section: "revenue",
    group: "revenue",
    groupLabel: "Үйл ажиллагааны орлого",
    label: "Бусад орлого",
    defaultPrefixes: [
      "50",
      "510",
      "512",
      "513",
      "514",
      "515",
      "516",
      "517",
      "518",
      "519",
      "52",
      "53",
      "54",
      "55",
      "56",
      "57",
      "58",
      "59",
    ],
    sign: "credit",
  },

  // ── Борлуулалтын өртөг (6xxxxxxx) ─────────────────────────────────────
  {
    key: "cogs",
    section: "expense",
    group: "cogs",
    groupLabel: "Борлуулсан бүтээгдэхүүний өртөг",
    label: "Борлуулсан бараа, үйлчилгээний өртөг",
    defaultPrefixes: ["6"],
    sign: "debit",
  },

  // ── Үйл ажиллагааны зардал (7xxxxxxx) ─────────────────────────────────
  {
    key: "payroll-expense",
    section: "expense",
    group: "opex",
    groupLabel: "Үйл ажиллагааны зардал",
    label: "Цалин, НДШ-ийн зардал",
    defaultPrefixes: ["721"],
    sign: "debit",
  },
  {
    key: "depreciation-expense",
    section: "expense",
    group: "opex",
    groupLabel: "Үйл ажиллагааны зардал",
    label: "Элэгдэл, хорогдлын зардал",
    defaultPrefixes: ["70"],
    sign: "debit",
  },
  {
    key: "other-opex",
    section: "expense",
    group: "opex",
    groupLabel: "Үйл ажиллагааны зардал",
    label: "Бусад үйл ажиллагааны зардал",
    defaultPrefixes: [
      "71",
      "720",
      "722",
      "723",
      "724",
      "725",
      "726",
      "727",
      "728",
      "729",
      "73",
      "74",
      "75",
      "76",
      "77",
      "78",
      "79",
      // 871 — тооллогын дутагдал, NRV бууруулалт, торгууль: үйл ажиллагааны.
      "871",
    ],
    sign: "debit",
  },

  // ── Санхүүгийн болон бусад зардал (8xxxxxxx) ──────────────────────────
  {
    key: "interest-expense",
    section: "expense",
    group: "finex",
    groupLabel: "Санхүүгийн зардал",
    label: "Хүүгийн зардал",
    defaultPrefixes: ["87000001"],
    sign: "debit",
  },
  {
    key: "fx-loss",
    section: "expense",
    group: "finex",
    groupLabel: "Санхүүгийн зардал",
    label: "Ханшийн гарз",
    defaultPrefixes: ["87000003"],
    sign: "debit",
  },
  {
    key: "other-finex",
    section: "expense",
    group: "finex",
    groupLabel: "Санхүүгийн зардал",
    label: "Бусад санхүүгийн зардал",
    defaultPrefixes: [
      "80",
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "870",
      "872",
      "873",
      "874",
      "875",
      "876",
      "877",
      "878",
      "879",
      "88",
      "89",
    ],
    sign: "debit",
  },
];

/** Данс анхдагчаар аль мөрөнд орох вэ — ХАМГИЙН УРТ таарсан угтвар ялна. */
export function isDefaultLineKeyOf(accountNumber: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const line of IS_LINES)
    for (const prefix of line.defaultPrefixes)
      if (accountNumber.startsWith(prefix) && (!best || prefix.length > best.length))
        best = { key: line.key, length: prefix.length };
  return best?.key ?? null;
}

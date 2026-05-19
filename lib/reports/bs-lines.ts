// Standard Mongolian SAS / IAS 1 Balance Sheet line items. Each entry
// maps a statutory report line to a default set of chart-of-accounts
// prefixes. Users can override the mapping per line via the UI; the
// override is persisted in `report_line_mappings` (see schema.ts) and
// resolved by `aggregateBalanceSheet`.

export type BsSection = "assets" | "liabilities" | "equity";
export type BsSign = "debit" | "credit";

export interface BsLine {
  key: string;
  section: BsSection;
  group: string;          // e.g. "current-assets", "non-current-assets"
  groupLabel: string;     // shown as the group heading
  label: string;
  /** 8-digit account-number prefixes that default into this line. */
  defaultPrefixes: string[];
  sign: BsSign;
}

export const BS_LINES: readonly BsLine[] = [
  // ── Assets · Current ────────────────────────────────────────────────────
  {
    key: "cash",
    section: "assets",
    group: "current-assets",
    groupLabel: "Эргэлтийн хөрөнгө",
    label: "Мөнгөн хөрөнгө",
    defaultPrefixes: ["10", "11"],
    sign: "debit",
  },
  {
    key: "short-term-investments",
    section: "assets",
    group: "current-assets",
    groupLabel: "Эргэлтийн хөрөнгө",
    label: "Богино хугацаат хөрөнгө оруулалт",
    defaultPrefixes: [],
    sign: "debit",
  },
  {
    key: "receivables",
    section: "assets",
    group: "current-assets",
    groupLabel: "Эргэлтийн хөрөнгө",
    label: "Дансны болон бусад авлага",
    defaultPrefixes: ["12", "13"],
    sign: "debit",
  },
  {
    key: "inventory",
    section: "assets",
    group: "current-assets",
    groupLabel: "Эргэлтийн хөрөнгө",
    label: "Бараа материал",
    defaultPrefixes: ["14"],
    sign: "debit",
  },
  {
    key: "prepaid",
    section: "assets",
    group: "current-assets",
    groupLabel: "Эргэлтийн хөрөнгө",
    label: "Урьдчилж төлсөн зардал",
    defaultPrefixes: ["18"],
    sign: "debit",
  },
  {
    key: "other-current-assets",
    section: "assets",
    group: "current-assets",
    groupLabel: "Эргэлтийн хөрөнгө",
    label: "Бусад эргэлтийн хөрөнгө",
    defaultPrefixes: ["19"],
    sign: "debit",
  },

  // ── Assets · Non-current ────────────────────────────────────────────────
  {
    key: "ppe",
    section: "assets",
    group: "non-current-assets",
    groupLabel: "Эргэлтийн бус хөрөнгө",
    label: "Үндсэн хөрөнгө (нэт)",
    defaultPrefixes: ["20", "21"],
    sign: "debit",
  },
  {
    key: "long-term-investments",
    section: "assets",
    group: "non-current-assets",
    groupLabel: "Эргэлтийн бус хөрөнгө",
    label: "Урт хугацаат хөрөнгө оруулалт",
    defaultPrefixes: ["24", "25", "27"],
    sign: "debit",
  },
  {
    key: "deferred-tax-asset",
    section: "assets",
    group: "non-current-assets",
    groupLabel: "Эргэлтийн бус хөрөнгө",
    label: "Хойшлогдсон татварын хөрөнгө (DTA)",
    defaultPrefixes: ["26"],
    sign: "debit",
  },
  {
    key: "other-non-current-assets",
    section: "assets",
    group: "non-current-assets",
    groupLabel: "Эргэлтийн бус хөрөнгө",
    label: "Бусад эргэлтийн бус хөрөнгө",
    defaultPrefixes: ["29"],
    sign: "debit",
  },

  // ── Liabilities · Current ───────────────────────────────────────────────
  {
    key: "ap",
    section: "liabilities",
    group: "current-liabilities",
    groupLabel: "Богино хугацаат өр төлбөр",
    label: "Дансны өглөг",
    // Explicit AP codes — using a bare "31000" prefix would also catch
    // 31000003 which belongs to the tax-payable line. Listing the
    // specific codes avoids the double-count.
    defaultPrefixes: ["31000001", "31000099"],
    sign: "credit",
  },
  {
    key: "tax-payable",
    section: "liabilities",
    group: "current-liabilities",
    groupLabel: "Богино хугацаат өр төлбөр",
    label: "Татварын өр",
    defaultPrefixes: ["3141", "31000003"],
    sign: "credit",
  },
  {
    key: "payroll-payable",
    section: "liabilities",
    group: "current-liabilities",
    groupLabel: "Богино хугацаат өр төлбөр",
    label: "Цалин, НДШ, ХХОАТ-ын өглөг",
    defaultPrefixes: ["3142", "3143", "3150"],
    sign: "credit",
  },
  {
    key: "short-term-loans",
    section: "liabilities",
    group: "current-liabilities",
    groupLabel: "Богино хугацаат өр төлбөр",
    label: "Богино хугацаат зээл",
    defaultPrefixes: ["32"],
    sign: "credit",
  },
  {
    key: "other-current-liabilities",
    section: "liabilities",
    group: "current-liabilities",
    groupLabel: "Богино хугацаат өр төлбөр",
    label: "Бусад богино хугацаат өр төлбөр",
    defaultPrefixes: ["316", "319"],
    sign: "credit",
  },

  // ── Liabilities · Non-current ──────────────────────────────────────────
  {
    key: "long-term-debt",
    section: "liabilities",
    group: "non-current-liabilities",
    groupLabel: "Урт хугацаат өр төлбөр",
    label: "Урт хугацаат зээл / Түрээсийн өр",
    defaultPrefixes: ["33000001"],
    sign: "credit",
  },
  {
    key: "deferred-tax-liability",
    section: "liabilities",
    group: "non-current-liabilities",
    groupLabel: "Урт хугацаат өр төлбөр",
    label: "Хойшлогдсон татварын өглөг (DTL)",
    defaultPrefixes: ["33000002"],
    sign: "credit",
  },

  // ── Equity ──────────────────────────────────────────────────────────────
  {
    key: "share-capital",
    section: "equity",
    group: "equity",
    groupLabel: "Эздийн өмч",
    label: "Эздийн оруулсан өмч",
    defaultPrefixes: ["41"],
    sign: "credit",
  },
  {
    key: "revaluation-reserve",
    section: "equity",
    group: "equity",
    groupLabel: "Эздийн өмч",
    label: "Дахин үнэлгээний нэмэгдэл (OCI)",
    defaultPrefixes: ["42"],
    sign: "credit",
  },
  {
    key: "fx-translation-reserve",
    section: "equity",
    group: "equity",
    groupLabel: "Эздийн өмч",
    label: "Гадаад валютын хөрвүүлэлтийн нөөц (OCI)",
    defaultPrefixes: ["43"],
    sign: "credit",
  },
  {
    key: "retained-earnings",
    section: "equity",
    group: "equity",
    groupLabel: "Эздийн өмч",
    label: "Хуримтлагдсан ашиг",
    defaultPrefixes: ["44"],
    sign: "credit",
  },
  // "current-period-pnl" is computed separately from revenue / expense
  // accounts (5X / 6X / 7X / 8X) — see balance-sheet-view.tsx.
];

export const BS_LINE_BY_KEY: Record<string, BsLine> = Object.fromEntries(
  BS_LINES.map((l) => [l.key, l])
);

// ─── 10 Segment definitions ───────────────────────────────────────────────────

export type ModuleKey = "gl" | "ar" | "ap" | "fa" | "inv" | "cost" | "cash" | "agis";

export const MODULE_LABELS: Record<ModuleKey, string> = {
  gl: "GL",
  ar: "AR",
  ap: "AP",
  fa: "FA",
  inv: "Inventory",
  cost: "Cost",
  cash: "Cash",
  agis: "AGIS",
};

export interface ModuleDef {
  key: ModuleKey;
  nameMn: string;
  name: string;
  description: string;
}

export const MODULE_DEFS: ModuleDef[] = [
  { key: "gl",   nameMn: "Ерөнхий журнал",         name: "General Ledger",      description: "Журнал бичилт, дансны тохиргоо, GL тайлан" },
  { key: "ar",   nameMn: "Авлагын удирдлага",       name: "Accounts Receivable", description: "Нэхэмжлэл, харилцагчийн авлага, орлого бүртгэл" },
  { key: "ap",   nameMn: "Өглөгийн удирдлага",      name: "Accounts Payable",    description: "Нийлүүлэгчийн нэхэмжлэл, өглөг, төлбөр" },
  { key: "fa",   nameMn: "Үндсэн хөрөнгө",          name: "Fixed Assets",        description: "Хөрөнгийн бүртгэл, элэгдэл, данснаас хасалт" },
  { key: "inv",  nameMn: "Бараа материал",          name: "Inventory",           description: "Бараа, агуулах, тоо хэмжээний хөдөлгөөн" },
  { key: "cost", nameMn: "Өртгийн бүртгэл",         name: "Cost Accounting",     description: "Зардлын төв, бүтээгдэхүүний өртөг, MOH" },
  { key: "cash", nameMn: "Мөнгөн гүйлгээ",          name: "Cash Management",     description: "Касс, банк, IAS 7 мөнгөн урсгалын тайлан" },
  { key: "agis", nameMn: "Группын дотоод тооцоо",   name: "Inter-Company (AGIS)", description: "IC журнал, элиминейшн, нэгтгэсэн тайлан" },
];

export const ALL_MODULES: ModuleKey[] = ["gl", "ar", "ap", "fa", "inv", "cost", "cash", "agis"];

export interface SegmentDef {
  id: number;         // 1–10
  key: string;        // "s1"…"s10"
  name: string;       // English
  nameMn: string;     // Mongolian
  length: number;     // char count
  description: string;
  defaultModules: ModuleKey[];
}

export const SEGMENT_DEFS: SegmentDef[] = [
  {
    id: 1, key: "s1", name: "Company", nameMn: "Компани", length: 3,
    description: "Group structure, multi-entity tenant, consolidation",
    defaultModules: ["gl", "ar", "ap", "fa", "cost", "cash"],
  },
  {
    id: 2, key: "s2", name: "Cost Center", nameMn: "Зардлын төв", length: 6,
    description: "Зардал үүссэн хэлтэс, цех, нэгж",
    defaultModules: ["gl", "ap", "fa", "cost"],
  },
  {
    id: 3, key: "s3", name: "Main Account", nameMn: "Үндсэн данс", length: 8,
    description: "Chart of Accounts — дансны мөн чанарыг илэрхийлнэ",
    defaultModules: ["gl", "ar", "ap", "fa", "cost", "cash"],
  },
  {
    id: 4, key: "s4", name: "Product / Service", nameMn: "Бүтээгдэхүүн / Үйлчилгээ", length: 2,
    description: "Бүтээгдэхүүн / үйлчилгээгээр тайлагнах",
    defaultModules: ["gl", "ar", "cost"],
  },
  {
    id: 5, key: "s5", name: "Project", nameMn: "Төсөл", length: 4,
    description: "Project P&L, unbilled revenue, WIP",
    defaultModules: ["gl", "ar", "ap", "fa", "cost"],
  },
  {
    id: 6, key: "s6", name: "Inter Company", nameMn: "Группын дотоод", length: 3,
    description: "Группын доторх эсрэг тал — consolidation elimination",
    defaultModules: ["gl", "agis"],
  },
  {
    id: 7, key: "s7", name: "Related Party", nameMn: "Холбоотой этгээд", length: 4,
    description: "Группээс гадуурх холбоотой этгээд (IAS 24 disclosure)",
    defaultModules: ["gl", "ar", "ap"],
  },
  {
    id: 8, key: "s8", name: "Cash Flow", nameMn: "Мөнгөн гүйлгээ", length: 4,
    description: "IAS 7 — Operating / Investing / Financing ангилал",
    defaultModules: ["gl", "cash"],
  },
  {
    id: 9, key: "s9", name: "Modules", nameMn: "Модуль", length: 2,
    description: "Journal үүсгэсэн source модуль — системээр автомат тохируулагдана",
    defaultModules: ["gl", "ar", "ap", "fa", "cost", "cash"],
  },
  {
    id: 10, key: "s10", name: "Reserve", nameMn: "Нөөц", length: 1,
    description: "Ирээдүйн өргөтгөлд зориулсан — одоогоор '0'",
    defaultModules: [],
  },
];

// ─── Legacy: kept for journal account grouping display ────────────────────────

/** First-digit → Mongolian group label for chart-of-accounts grouping */
export const ACCOUNT_GROUPS: Record<string, string> = {
  "1": "Эргэлтийн хөрөнгө",
  "2": "Эргэлтийн бус хөрөнгө",
  "3": "Өр төлбөр",
  "4": "Эздийн өмч",
  "5": "Орлого",
  "6": "Өртөг",
  "7": "Үйл ажиллагааны зардал",
  "8": "Санхүүгийн зардал",
  "9": "ОЗНД / нэгдсэн",
};

// Keep SEGMENTS alias for components that still use it
export const SEGMENTS = ACCOUNT_GROUPS;

export type StandardAccount = { number: string; name: string };

export const STANDARD_ACCOUNTS: StandardAccount[] = [
  // ── 10 — Касс ───────────────────────────────────────────────────────────────
  { number: "10000001", name: "Кассд байгаа бэлэн мөнгө MNT" },
  { number: "10000002", name: "Кассд байгаа бэлэн мөнгө USD" },
  { number: "10000099", name: "Кассийн түр данс" },

  // ── 11 — Харилцах ───────────────────────────────────────────────────────────
  { number: "11000001", name: "Харилцахад байгаа бэлэн мөнгө MNT" },
  { number: "11000002", name: "Харилцахад байгаа бэлэн мөнгө USD" },
  { number: "11000099", name: "Харилцах дансны түр данс" },

  // ── 12 — Авлага ─────────────────────────────────────────────────────────────
  { number: "12000001", name: "Дансны авлага" },
  { number: "12000002", name: "НӨАТ оролтын авлага" },
  { number: "12000003", name: "Бусад авлага" },
  { number: "12000099", name: "Авлагын ECL нөөц" },

  // ── 13 — Авлага / Санхүүгийн хөрөнгө ───────────────────────────────────────
  { number: "13000001", name: "Санхүүгийн хөрөнгө" },
  { number: "13110000", name: "Дансны авлага (харилцагч)" },
  { number: "13620000", name: "НӨАТ оролтын данс" },
  { number: "13000099", name: "Санхүүгийн хөрөнгийн түр данс" },

  // ── 14 — Бараа материал ─────────────────────────────────────────────────────
  { number: "14000001", name: "Бараа материал" },
  { number: "14000002", name: "Түлш шатахуун" },
  { number: "14000003", name: "Дуусаагүй үйлдвэрлэл (WIP)" },
  { number: "14000004", name: "Бэлэн бүтээгдэхүүн" },
  { number: "14000099", name: "Бараа материалын түр данс" },

  // ── 18 — Урьдчилж төлсөн ────────────────────────────────────────────────────
  { number: "18000001", name: "Урьдчилж төлсөн зардал" },

  // ── 19 — Бусад эргэлтийн ────────────────────────────────────────────────────
  { number: "19000001", name: "Бусад эргэлтийн хөрөнгө" },

  // ── 20 — Үндсэн хөрөнгө / ROU ───────────────────────────────────────────────
  { number: "20000001", name: "Үндсэн хөрөнгө / ROU хөрөнгө" },
  { number: "20000002", name: "Хуримтлагдсан элэгдэл" },
  { number: "20000099", name: "Үндсэн хөрөнгийн түр данс" },

  // ── 21 — Биет бус хөрөнгө ───────────────────────────────────────────────────
  { number: "21000001", name: "Биет бус хөрөнгө" },
  { number: "21010000", name: "Үндсэн хөрөнгийн өртөг" },
  { number: "21000099", name: "Хуримтлагдсан элэгдэл — биет бус" },

  // ── 24–29 — Бусад эргэлтийн бус ────────────────────────────────────────────
  { number: "24000001", name: "Урт хугацаат хөрөнгө оруулалт" },
  { number: "25000001", name: "Холбоотой компанид хийсэн хөрөнгө оруулалт" },
  { number: "26000001", name: "Хойшлогдсон татварын хөрөнгө (DTA)" },
  { number: "27000001", name: "Хөрөнгө оруулалтын зориулалттай ҮХХ" },
  { number: "29000001", name: "Бусад эргэлтийн бус хөрөнгө" },

  // ── 31 — Богино хугацаат өглөг ──────────────────────────────────────────────
  { number: "31000001", name: "Дансны өглөг (AP)" },
  { number: "31000003", name: "Татварын өр (НӨАТ/ААНОАТ/WHT)" },
  { number: "31420000", name: "НДШ өглөг" },
  { number: "31430000", name: "ХХОАТ өглөг" },
  { number: "31500001", name: "Цалингийн өглөг (нэт)" },
  { number: "31600001", name: "Wallet үүргийн өр" },
  { number: "31900001", name: "Нөөц өр төлбөр" },
  { number: "31000099", name: "Өглөгийн түр данс" },

  // ── 32 — Богино хугацаат зээл ───────────────────────────────────────────────
  { number: "32000001", name: "Богино хугацаат зээл" },
  { number: "32000002", name: "Хүүгийн өглөг" },
  { number: "32000004", name: "Урьдчилж орсон орлого" },

  // ── 33 — Урт хугацаат өр ────────────────────────────────────────────────────
  { number: "33000001", name: "Урт хугацаат зээл / Түрээсийн өр (IFRS 16)" },
  { number: "33000002", name: "Хойшлогдсон татварын өглөг (DTL)" },

  // ── 41–44 — Эздийн өмч ──────────────────────────────────────────────────────
  { number: "41000001", name: "Эздийн өмч" },
  { number: "42000001", name: "Хөрөнгийн дахин үнэлгээний нэмэгдэл (OCI)" },
  { number: "43000001", name: "Гадаад валютын хөрвүүлэлтийн нөөц" },
  { number: "44000001", name: "Хуримтлагдсан ашиг" },
  { number: "44000099", name: "Орлого/зарлагын нэгтгэлийн данс" },

  // ── 51 — Орлого ─────────────────────────────────────────────────────────────
  { number: "51100000", name: "Үйл ажиллагааны орлого" },
  { number: "51800001", name: "Валютын ханшийн олз (FX Gain)" },
  { number: "51800003", name: "Бараа материалын тооллогын илүүдэл" },
  { number: "51800005", name: "Группын доторх орлого (IC)" },
  { number: "51000099", name: "Орлогын түр данс" },

  // ── 60–61 — Өртөг ───────────────────────────────────────────────────────────
  { number: "60000002", name: "Шууд хөдөлмөрийн зардал" },
  { number: "60000003", name: "Үйлдвэрлэлийн нийтлэг зардал (MOH)" },
  { number: "61100000", name: "Борлуулсан бүтээгдэхүүний өртөг (COGS)" },

  // ── 70–73 — Үйл ажиллагааны зардал ─────────────────────────────────────────
  { number: "70000001", name: "Элэгдлийн зардал" },
  { number: "70000002", name: "ROU хөрөнгийн элэгдэл (IFRS 16)" },
  { number: "70000004", name: "ААНОАТ / Хойшлогдсон татварын зардал (IAS 12)" },
  { number: "72100000", name: "Цалингийн зардал" },
  { number: "72100002", name: "НДШ ажил олгогчийн зардал" },
  { number: "73100001", name: "Үйл ажиллагааны зардал (AP)" },

  // ── 87 — Санхүүгийн зардал ──────────────────────────────────────────────────
  { number: "87000001", name: "Санхүүгийн зардал / Түрээсийн хүү (IFRS 16)" },
  { number: "87000002", name: "Үнэ цэнийн бууралтын алдагдал (IAS 36)" },
  { number: "87000003", name: "Гадаад валютын ханшийн гарз (IAS 21)" },
  { number: "87100004", name: "Бараа материалын тооллогын дутагдал" },
  { number: "87000004", name: "Үндсэн хөрөнгө данснаас хассаны олз/гарз" },
  { number: "87100007", name: "Татварын торгууль, алданги" },

  // ── 92 — ОЗНД / нэгдсэн ─────────────────────────────────────────────────────
  { number: "92000000", name: "Орлого, зарлагын нэгдсэн данс (P&L Summary)" },
];

export function getSegmentKey(accountNumber: string): string {
  return accountNumber[0] ?? "1";
}

// ─── Default seed accounts (subset for new-user registration) ─────────────────
// Codes picked from STANDARD_ACCOUNTS so seed + later sync don't create duplicates.
const SEED_ACCOUNT_NUMBERS = [
  "10000001", // Касс (MNT)
  "11000001", // Харилцах (MNT)
  "13110000", // Дансны авлага
  "31000001", // AP
  "31000003", // Татварын өр
  "41000001", // Эздийн өмч
  "44000001", // Хуримтлагдсан ашиг
  "51100000", // Үйл ажиллагааны орлого
  "61100000", // COGS
  "72100000", // Цалингийн зардал
];

export const DEFAULT_ACCOUNTS: StandardAccount[] = SEED_ACCOUNT_NUMBERS.map(
  (n) => {
    const a = STANDARD_ACCOUNTS.find((s) => s.number === n);
    if (!a) throw new Error(`SEED_ACCOUNT_NUMBERS references unknown code ${n}`);
    return a;
  }
);

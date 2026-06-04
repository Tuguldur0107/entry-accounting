// Cash модулийн лавлах утгууд

export type CfCategory = "operating" | "investing" | "financing";
export type Direction = "inflow" | "outflow";

export const CF_CATEGORIES: { value: CfCategory; label: string }[] = [
  { value: "operating", label: "Үндсэн үйл ажиллагаа" },
  { value: "investing", label: "Хөрөнгө оруулалт" },
  { value: "financing", label: "Санхүүжилт" },
];

export const CF_CATEGORY_LABEL: Record<CfCategory, string> = {
  operating: "Үндсэн үйл ажиллагаа",
  investing: "Хөрөнгө оруулалт",
  financing: "Санхүүжилт",
};

export const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "inflow", label: "Орлого (+)" },
  { value: "outflow", label: "Зарлага (−)" },
];

export const DIRECTION_LABEL: Record<Direction, string> = {
  inflow: "Орлого",
  outflow: "Зарлага",
};

// Кассын/банкны GL дансны бүлэг (1XXXXXXX) — банкны дансанд сонгох боломжтой код
export const CASH_ACCOUNT_PREFIXES = ["10", "11"];

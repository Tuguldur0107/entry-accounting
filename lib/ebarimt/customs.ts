// Гаалийн мэдүүлгийн харагдац — ЦЭВЭР, client-safe (DB/сүлжээгүй),
// tests/ebarimt-customs.test.ts. docs/dev/ebarimt-tax-reconcile.md §10.

export interface EbarimtCustomsItem {
  name: string;
  unitPrice: number | null;
  duty: number;
  excise: number;
  fee: number;
  vatBase: number;
  vat: number;
}

export interface EbarimtCustomsRow {
  declarationNo: string;
  rawDate: string;
  /** YYYY-MM-DD. */
  date: string;
  items: EbarimtCustomsItem[];
  duty: number;
  excise: number;
  fee: number;
  vatBase: number;
  vat: number;
}

export interface EbarimtCustomsSummary {
  count: number;
  items: number;
  duty: number;
  excise: number;
  fee: number;
  vatBase: number;
  /** Импортын НӨАТ — НӨАТ-ын тайлангийн оролтын НӨАТ-тай харьцуулах дүн. */
  vat: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function summarizeCustomsDeclarations(rows: readonly EbarimtCustomsRow[]): EbarimtCustomsSummary {
  const total = (field: "duty" | "excise" | "fee" | "vatBase" | "vat") => round2(rows.reduce((sum, row) => sum + row[field], 0));
  return {
    count: rows.length,
    items: rows.reduce((sum, row) => sum + row.items.length, 0),
    duty: total("duty"),
    excise: total("excise"),
    fee: total("fee"),
    vatBase: total("vatBase"),
    vat: total("vat"),
  };
}

/** Мэдүүлгийн барааны товч — эхний нэр + үлдсэний тоо (жагсаалтад). */
export function customsGoodsLabel(items: readonly { name: string }[]): string {
  const names = items.map((item) => item.name.trim()).filter(Boolean);
  if (names.length === 0) return "";
  return names.length === 1 ? names[0] : `${names[0]} … (+${names.length - 1})`;
}

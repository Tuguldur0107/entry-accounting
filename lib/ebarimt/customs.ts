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

const money = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Хураангуй мөр (AI tool `get_ebarimt_customs_declarations`). */
export function customsSummaryText(summary: EbarimtCustomsSummary): string {
  return `Мэдүүлэг ${summary.count} · барааны мөр ${summary.items} · гаалийн татвар ${money(summary.duty)} · ОАТ ${money(summary.excise)} · хураамж ${money(summary.fee)} · НӨАТ-ын суурь ${money(summary.vatBase)} · импортын НӨАТ ${money(summary.vat)}`;
}

/**
 * Мэдүүлгийн мөрүүд (AI tool) — `includeItems` бол барааны мөр бүр доор нь.
 * Нэгжийн үнэ (`itemuprc`) нь гаалийн эх утга — валют/нэгж нь баримтаар
 * тодорхойгүй тул «эх» гэж тэмдэглэнэ (тооцоонд хэрэглэхгүй, §10).
 */
export function customsDeclarationLines(rows: readonly EbarimtCustomsRow[], options: { limit: number; includeItems: boolean }): string[] {
  const lines: string[] = [];
  for (const row of rows.slice(0, options.limit)) {
    const goods = customsGoodsLabel(row.items);
    lines.push(
      `- ${row.declarationNo} (${row.date})${goods ? `: ${goods}` : ""} · гааль ${money(row.duty)} · ОАТ ${money(row.excise)} · хураамж ${money(row.fee)} · НӨАТ-ын суурь ${money(row.vatBase)} · НӨАТ ${money(row.vat)}`
    );
    if (options.includeItems)
      for (const item of row.items)
        lines.push(
          `    · ${item.name || "—"}${item.unitPrice === null ? "" : ` · нэгжийн үнэ (эх) ${money(item.unitPrice)}`} · гааль ${money(item.duty)} · ОАТ ${money(item.excise)} · хураамж ${money(item.fee)} · НӨАТ-ын суурь ${money(item.vatBase)} · НӨАТ ${money(item.vat)}`
        );
  }
  if (rows.length > options.limit) lines.push(`… дахиад ${rows.length - options.limit} мэдүүлэг (вэб: Өглөг → eBarimt → Гаалийн мэдүүлэг)`);
  return lines;
}

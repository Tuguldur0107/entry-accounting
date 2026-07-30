// Excel унших/бичих ЦӨМ — зөвхөн CLIENT талд ажиллана (файл сонголт,
// татаж авалт). exceljs том сан тул хэрэглэх мөчид нь dynamic import
// хийж bundle-ыг бүдүүрүүлэхгүй.
//
// Уншилт: эхний worksheet → текст матриц. Excel-ийн date нүд ISO
// (YYYY-MM-DD), тоон нүд стринг болж хэвийн боловсруулагдана.
// Бичилт: нэг өгөгдлийн хуудас (+ сонголтоор "Заавар" хуудас), толгой нь
// bold, багана өргөнтэй. Файлын нэр: <slug>-YYYYMMDD.xlsx.

import type { ImportSpec } from "./import-spec";

type CellValue = string | number | null;

async function loadExceljs() {
  const mod = await import("exceljs");
  // exceljs-ийн browser build нь default export-оор ирдэг.
  return (mod.default ?? mod) as typeof import("exceljs");
}

/** Excel-ийн нүдний утгыг импортын текст болгоно. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Томьёотой нүд: үр дүнг нь авна.
    if ("result" in record) return cellToText(record.result);
    // RichText: хэсгүүдийг нийлүүлнэ.
    if ("richText" in record && Array.isArray(record.richText))
      return (record.richText as { text?: string }[])
        .map((part) => part.text ?? "")
        .join("");
    // Hyperlink: харагдах текст.
    if ("text" in record) return cellToText(record.text);
    return "";
  }
  return String(value);
}

/** Файлын эхний worksheet-ийг текст матриц болгож уншина. */
export async function readWorkbookMatrix(file: File): Promise<string[][]> {
  const ExcelJS = await loadExceljs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    // row.values нь 1-based sparse массив.
    const values = row.values as unknown[];
    for (let index = 1; index < values.length; index += 1)
      cells.push(cellToText(values[index]));
    matrix.push(cells);
  });
  return matrix;
}

export interface ExportColumn {
  header: string;
  /** Баганын өргөн (тэмдэгтээр). */
  width?: number;
  /** "number" бол баруун зэрэгцүүлж #,##0.00 форматлана. */
  kind?: "text" | "number";
}

function stampedName(slug: string): string {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${slug}-${today}.xlsx`;
}

function triggerDownload(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Өгөгдлийг .xlsx болгож татуулна. */
export async function downloadWorkbook(input: {
  slug: string;
  sheetName: string;
  columns: ExportColumn[];
  rows: CellValue[][];
}): Promise<void> {
  const ExcelJS = await loadExceljs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(input.sheetName);

  sheet.columns = input.columns.map((column) => ({
    header: column.header,
    width: column.width ?? 18,
    style:
      column.kind === "number"
        ? { numFmt: "#,##0.00", alignment: { horizontal: "right" as const } }
        : undefined,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of input.rows) sheet.addRow(row);

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer as ArrayBuffer, stampedName(input.slug));
}

/**
 * Импортын ЗАГВАР файл — спекээсээ үүснэ (толгой + жишээ мөр + "Заавар"
 * хуудас). Толгой parser-тайгаа хэзээ ч зөрөхгүй.
 */
export async function downloadTemplate<T>(spec: ImportSpec<T>): Promise<void> {
  const ExcelJS = await loadExceljs();
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Өгөгдөл");
  sheet.columns = spec.columns.map((column) => ({
    header: column.required ? `${column.header}*` : column.header,
    width: Math.max(column.header.length + 4, 16),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(spec.columns.map((column) => column.example));
  // Жишээ мөрийг саарал болгож "устгаад өөрийн өгөгдлөө бичнэ" гэдгийг илтгэнэ.
  sheet.getRow(2).font = { color: { argb: "FF888888" }, italic: true };

  const help = workbook.addWorksheet("Заавар");
  help.columns = [
    { header: "Багана", width: 24 },
    { header: "Заавал", width: 10 },
    { header: "Тайлбар", width: 70 },
  ];
  help.getRow(1).font = { bold: true };
  for (const column of spec.columns)
    help.addRow([column.header, column.required ? "Тийм" : "Үгүй", column.hint]);
  help.addRow([]);
  help.addRow(["", "", spec.title]);
  help.addRow(["", "", "Жишээ мөрийг устгаад өөрийн өгөгдлөө бичнэ үү."]);
  help.addRow(["", "", "Багана НЭРЭЭР танигдана — дарааллыг өөрчилж болно."]);

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(buffer as ArrayBuffer, `${spec.slug}-загвар.xlsx`);
}

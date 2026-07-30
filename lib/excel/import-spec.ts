// EXCEL ИМПОРТЫН СТАНДАРТ — цэвэр логик (DB/DOM хамааралгүй, тесттэй).
//
// Дүрэм (CLAUDE.md "Excel импорт/экспортын стандарт"):
//   1. Эхний мөр = толгой. Багана НЭРЭЭР танигдана (байрлалаар БИШ) —
//      хэрэглэгч багана нэмэх/солих эрх чөлөөтэй, илүүдэл багана үл тоомсорлоно.
//   2. Толгой том/жижиг үсэг, зай, "*"-ээс хамаарахгүй тааруулагдана.
//   3. Мөр бүр тусдаа шалгагдаж алдаа нь МӨРИЙН ДУГААРТАЙГАА тайлагнана.
//   4. Юу ч аяндаа орохгүй: урьдчилан харах → зөвхөн ЗӨВ мөрүүд оруулах.
//   5. Загвар файл нь энэ спекээсээ үүсдэг — толгой, заавар, жишээ мөр
//      хэзээ ч parser-аас зөрөхгүй.

export interface ImportColumn {
  /** Дотоод түлхүүр — record-ийн талбарын нэр. */
  key: string;
  /** Excel дэх толгойн нэр (загварт мөн энэ гарна). */
  header: string;
  required?: boolean;
  /** Загварын "Заавар" хуудсанд гарах тайлбар. */
  hint: string;
  /** Загварын жишээ мөрөнд гарах утга. */
  example: string;
}

export interface ImportSpec<T> {
  /** Файлын нэрийн үндэс: entry-<slug>-загвар.xlsx */
  slug: string;
  /** Загварын хуудасны нэр + тайлбар. */
  title: string;
  columns: ImportColumn[];
  /**
   * Нэг мөрийг задлана. `record` нь key→трим хийсэн текст (байхгүй нүд "").
   * Алдаанууд нь хэрэглэгчид ойлгомжтой монгол өгүүлбэрүүд.
   */
  parseRow: (record: Record<string, string>) => { value: T } | { errors: string[] };
}

export interface ParsedRow<T> {
  /** Excel дахь мөрийн дугаар (1-based, толгой = 1). */
  rowNumber: number;
  record: Record<string, string>;
  value: T | null;
  errors: string[];
}

export interface ParseResult<T> {
  /** Спек-түвшний алдаа (толгой дутуу г.м.) — байвал юу ч оруулахгүй. */
  headerErrors: string[];
  rows: ParsedRow<T>[];
  validCount: number;
  errorCount: number;
}

/** Толгойг харьцуулахад: трим, жижиг үсэг, "*" ба олдмол зайг хаяна. */
const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replaceAll("*", "").replaceAll(/\s+/g, " ").trim();

/**
 * Матрицыг (эхний мөр = толгой) спекээр задлана. Бүр хоосон мөрүүд
 * алгасагдана.
 */
export function parseMatrix<T>(
  matrix: string[][],
  spec: ImportSpec<T>
): ParseResult<T> {
  if (matrix.length === 0)
    return {
      headerErrors: ["Файл хоосон байна"],
      rows: [],
      validCount: 0,
      errorCount: 0,
    };

  const headerRow = matrix[0].map(normalizeHeader);
  const indexByKey = new Map<string, number>();
  const headerErrors: string[] = [];

  for (const column of spec.columns) {
    const index = headerRow.indexOf(normalizeHeader(column.header));
    if (index >= 0) indexByKey.set(column.key, index);
    else if (column.required)
      headerErrors.push(`"${column.header}" багана олдсонгүй`);
  }
  if (headerErrors.length > 0)
    return { headerErrors, rows: [], validCount: 0, errorCount: 0 };

  const rows: ParsedRow<T>[] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const cells = matrix[index];
    // Бүх нүд хоосон мөр — алгасна (загварын үлдэгдэл, форматын мөр).
    if (cells.every((cell) => cell.trim() === "")) continue;

    const record: Record<string, string> = {};
    for (const column of spec.columns) {
      const cellIndex = indexByKey.get(column.key);
      record[column.key] =
        cellIndex === undefined ? "" : (cells[cellIndex] ?? "").trim();
    }

    const parsed = spec.parseRow(record);
    rows.push({
      rowNumber: index + 1,
      record,
      value: "value" in parsed ? parsed.value : null,
      errors: "errors" in parsed ? parsed.errors : [],
    });
  }

  return {
    headerErrors: [],
    rows,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
  };
}

// ── Нийтлэг задлагчид ───────────────────────────────────────────────────────

/** MNT дүн: "₮", зай, таслал тэвчинэ. Хоосон → null. Алдаа → undefined. */
export function parseAmountCell(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replaceAll("₮", "").replaceAll(/[\s,]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Огноо: "YYYY-MM-DD" / "YYYY.MM.DD" / "YYYY/MM/DD" хүлээнэ (Excel-ийн
 * date нүдийг core.ts ISO болгож өгдөг). Алдаа → null.
 */
export function parseDateCell(raw: string): string | null {
  const trimmed = raw.trim().replaceAll(".", "-").replaceAll("/", "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // 2026-02-31 маягийн худал огноог JS Date чимээгүй гулсуулдаг — таарахыг шаардана.
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";

import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
} from "./bank-statement-types";

const HEADER_HINTS = {
  transactionDate: [
    "гүйлгээний огноо",
    "хөдөлгөөний огноо",
    "огноо",
    "transaction date",
    "date",
  ],
  valueDate: ["утгын огноо", "валютын огноо", "value date"],
  description: [
    "гүйлгээний утга",
    "гүйлгээний дэлгэрэнгүй",
    "утга",
    "тайлбар",
    "description",
    "purpose",
    "details",
  ],
  income: ["орлого", "кредит", "credit", "орсон дүн", "deposit"],
  expense: ["зарлага", "дебит", "debit", "гарсан дүн", "withdrawal"],
  amount: ["гүйлгээний дүн", "дүн", "amount", "transaction amount"],
  balance: ["эцсийн үлдэгдэл", "үлдэгдэл", "balance"],
  exchangeRate: [
    "гүйлгээний ханш",
    "валютын ханш",
    "ханш",
    "exchange rate",
    "rate",
  ],
  baseAmount: [
    "төгрөгийн дүн",
    "mnt дүн",
    "суурь валютын дүн",
    "base amount",
    "mnt amount",
  ],
  counterAccount: [
    "харьцсан данс",
    "харилцсан данс",
    "эсрэг данс",
    "counter account",
    "account number",
    "дансны дугаар",
  ],
  counterparty: [
    "харилцагчийн нэр",
    "харьцсан дансны нэр",
    "данс эзэмшигч",
    "counterparty",
    "beneficiary",
    "customer name",
  ],
  direction: ["гүйлгээний төрөл", "төрөл", "transaction type", "direction"],
} as const;

type HeaderKey = keyof typeof HEADER_HINTS;
type HeaderMap = Partial<Record<HeaderKey, number>>;

const EXACT_ONLY_HEADER_HINTS = new Set([
  "date",
  "огноо",
  "дүн",
  "утга",
  "төрөл",
  "credit",
  "debit",
]);

function normalized(value: string) {
  return value
    .toLocaleLowerCase("mn")
    .replace(/[\n\r\t]+/g, " ")
    .replace(/[.:_/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "object") {
    const record = value as {
      text?: string;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
    };
    if (record.result != null) return cellText(record.result);
    if (record.richText)
      return record.richText.map((part) => part.text ?? "").join("");
    if (record.text != null) return String(record.text);
  }
  return String(value).trim();
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: unknown): string {
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "number" && value > 20_000 && value < 100_000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(value));
    return epoch.toISOString().slice(0, 10);
  }

  const text = cellText(value).trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (iso)
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dayFirst = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dayFirst)
    return `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = cellText(value)
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/₮|MNT|USD|EUR|CNY/gi, "")
    .replace(/,/g, "");
  if (!text || text === "-") return 0;
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[()]/g, ""));
  if (!Number.isFinite(number)) return 0;
  return negative ? -number : number;
}

function headerMap(row: unknown[]): HeaderMap {
  const headers = row.map((value) => normalized(cellText(value)));
  const map: HeaderMap = {};

  for (const [key, hints] of Object.entries(HEADER_HINTS) as Array<
    [HeaderKey, readonly string[]]
  >) {
    const normalizedHints = hints.map(normalized);
    const exact = headers.findIndex((header) =>
      normalizedHints.some((hint) => header === hint)
    );
    const partial =
      exact >= 0
        ? -1
        : headers.findIndex((header) =>
            normalizedHints.some(
              (hint) =>
                !EXACT_ONLY_HEADER_HINTS.has(hint) && header.includes(hint)
            )
          );
    const found = exact >= 0 ? exact : partial;
    if (found >= 0) map[key] = found;
  }
  return map;
}

function headerScore(map: HeaderMap) {
  let score = 0;
  if (map.transactionDate != null) score += 3;
  if (map.description != null) score += 2;
  if (map.income != null) score += 2;
  if (map.expense != null) score += 2;
  if (map.amount != null) score += 2;
  if (map.balance != null) score += 1;
  if (map.counterAccount != null) score += 1;
  if (map.counterparty != null) score += 1;
  return score;
}

function get(row: unknown[], map: HeaderMap, key: HeaderKey) {
  const index = map[key];
  return index == null ? "" : row[index];
}

function detectBankName(rows: unknown[][]) {
  const sample = rows
    .slice(0, 12)
    .flat()
    .map(cellText)
    .join(" ")
    .toLocaleLowerCase("mn");
  if (sample.includes("голомт") || sample.includes("golomt")) return "Голомт банк";
  if (sample.includes("хаан банк") || sample.includes("khan bank")) return "ХААН банк";
  if (
    sample.includes("худалдаа хөгжлийн банк") ||
    sample.includes("ххб") ||
    sample.includes("tdb")
  )
    return "Худалдаа хөгжлийн банк";
  if (sample.includes("төрийн банк") || sample.includes("state bank"))
    return "Төрийн банк";
  return "";
}

function normalizeRows(
  rows: unknown[][],
  fileName: string,
  fileHash: string
): ParsedBankStatement {
  let headerIndex = -1;
  let map: HeaderMap = {};
  let bestScore = 0;

  rows.slice(0, 30).forEach((row, index) => {
    const candidate = headerMap(row);
    const score = headerScore(candidate);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
      map = candidate;
    }
  });

  if (
    headerIndex < 0 ||
    map.transactionDate == null ||
    (map.income == null && map.expense == null && map.amount == null)
  ) {
    throw new Error(
      "Хуулгын баганын толгойг таньсангүй. Огноо болон Орлого/Зарлага/Дүн багана шаардлагатай."
    );
  }

  const headers = rows[headerIndex].map((value, index) => {
    const text = cellText(value);
    return text || `Багана ${index + 1}`;
  });
  const output: ParsedBankStatementRow[] = [];

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const transactionDate = parseDate(get(row, map, "transactionDate"));
    if (!transactionDate) return;

    let income = Math.abs(parseMoney(get(row, map, "income")));
    let expense = Math.abs(parseMoney(get(row, map, "expense")));
    if (map.income == null && map.expense == null && map.amount != null) {
      const amount = parseMoney(get(row, map, "amount"));
      const direction = normalized(cellText(get(row, map, "direction")));
      if (
        amount < 0 ||
        direction.includes("зарлага") ||
        direction.includes("debit") ||
        direction.includes("withdraw")
      ) {
        expense = Math.abs(amount);
      } else {
        income = Math.abs(amount);
      }
    }
    if (income === 0 && expense === 0) return;

    const description = cellText(get(row, map, "description"));
    let counterAccount = cellText(get(row, map, "counterAccount"));
    if (!counterAccount) {
      counterAccount =
        description.match(/(?:^|\D)(\d{8,20})(?:\D|$)/)?.[1] ?? "";
    }

    const rawData = Object.fromEntries(
      headers.map((header, index) => [header, cellText(row[index])])
    );
    output.push({
      id: crypto.randomUUID(),
      rowNumber: headerIndex + offset + 2,
      transactionDate,
      valueDate: parseDate(get(row, map, "valueDate")),
      description,
      counterparty: cellText(get(row, map, "counterparty")),
      counterAccount,
      income,
      expense,
      balance:
        map.balance == null ? null : parseMoney(get(row, map, "balance")),
      exchangeRate:
        map.exchangeRate == null
          ? null
          : parseMoney(get(row, map, "exchangeRate")),
      baseAmount:
        map.baseAmount == null
          ? null
          : Math.abs(parseMoney(get(row, map, "baseAmount"))),
      debitAccountNumber: "",
      creditAccountNumber: "",
      rawData,
    });
  });

  if (output.length === 0)
    throw new Error("Хуулгаас мөнгөн гүйлгээ олдсонгүй");
  if (output.length > 5_000)
    throw new Error("Нэг удаад 5,000 хүртэл гүйлгээ импортлоно");

  const dates = output
    .map((row) => row.transactionDate)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();

  return {
    fileName,
    fileHash,
    bankName: detectBankName(rows),
    periodStart: dates[0] ?? "",
    periodEnd: dates.at(-1) ?? "",
    rows: output,
  };
}

function parseDelimitedWithDelimiter(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function parseDelimited(text: string): string[][] {
  const candidates = [",", ";", "\t"].map((delimiter) => {
    const rows = parseDelimitedWithDelimiter(text, delimiter);
    const score = Math.max(
      0,
      ...rows.slice(0, 30).map((row) => headerScore(headerMap(row)))
    );
    return { rows, score };
  });
  return candidates.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best
  ).rows;
}

export async function parseBankStatementFile(
  fileName: string,
  bytes: ArrayBuffer
) {
  const fileHash = createHash("sha256")
    .update(Buffer.from(bytes))
    .digest("hex");
  const extension = fileName.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (extension === "csv" || extension === "txt") {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    return normalizeRows(parseDelimited(text), fileName, fileHash);
  }
  if (extension !== "xlsx")
    throw new Error("CSV эсвэл XLSX файл сонгоно уу");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Excel файлд worksheet алга");

  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    for (let index = 1; index <= row.cellCount; index++) {
      values.push(row.getCell(index).value);
    }
    rows.push(values);
  });
  return normalizeRows(rows, fileName, fileHash);
}

// Голомтын хуулга (OPERACCTSTA, SPEC §5.5) → банкны хуулгын импортын НЭГ
// хэлбэр (ParsedBankStatement). ЦЭВЭР — DB-гүй, тесттэй
// (tests/golomt-statement.test.ts). Үр дүн нь файлаас уншсан хуулгатай ЯГ
// ИЖИЛ хянах → данс оноох → хадгалах (saveBankStatement) урсгалаар явна.

import { createHash } from "node:crypto";

import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
} from "@/lib/cash/bank-statement-types";

import { GOLOMT_STATEMENT_MAX_ROWS } from "./constants";

/**
 * SPEC §5.5 — хуулгын нэг мөр (банкнаас ирсэн түүхий утга). `tranDate`,
 * `balance`, `accName`, `accNum` нь SPEC-д байхгүй ч 2026-10-01 UAT-д ирсэн:
 * харьцсан талын нэр/данс (шимтгэлийн мөрөнд хоосон), гүйлгээний дараах үлдэгдэл.
 */
export type GolomtStatementEntry = {
  recNum?: number | string | null;
  tranId?: string | null;
  tranDate?: string | null;
  drOrCr?: string | null;
  tranAmount?: number | string | null;
  tranDesc?: string | null;
  tranPostedDate?: string | null;
  tranCrnCode?: string | null;
  exchRate?: number | string | null;
  balance?: number | string | null;
  accName?: string | null;
  accNum?: string | null;
};

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function money(value: unknown): number {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
}

/**
 * Гүйлгээний тогтвортой түлхүүр. `recNum` нь хүсэлтийн доторх дараалал тул
 * огнооны муж өөрчлөгдөхөд солигдоно — ОРОЛЦУУЛАХГҮЙ. Нэг tranId олон мөртэй
 * ирдэг (2026-10-01 UAT: гүйлгээ + түүний шимтгэл ижил tranId, ижил цагтай) —
 * чиглэл + дүнгээр ялгана. Бүх талбар ижил мөр давтагдвал (ж: нэг гүйлгээний
 * хоёр ижил шимтгэл) 2 дахь нь `:2`, 3 дахь нь `:3` (`occurrence`) — эхнийх нь
 * хуучин хэлбэрээрээ тул өмнө импортолсон түлхүүр хөндөгдөхгүй.
 */
export function golomtExternalRef(
  accountId: string,
  entry: GolomtStatementEntry,
  occurrence = 1
): string {
  const direction = /^c/i.test(text(entry.drOrCr)) ? "C" : "D";
  const parts = [
    "golomt",
    accountId,
    text(entry.tranId),
    text(entry.tranPostedDate),
    direction,
    money(entry.tranAmount).toFixed(2),
  ];
  if (occurrence > 1) parts.push(String(occurrence));
  return parts.join(":");
}

export type GolomtStatementInput = {
  accountId: string;
  /** Кассын дансны валют — хуулгын валют зөрвөл ил алдаа. */
  currency: string;
  startDate: string;
  endDate: string;
  entries: GolomtStatementEntry[];
  /** Өмнө нь хадгалагдсан externalRef-үүд — эдгээр мөр алгасагдана. */
  alreadyImported?: ReadonlySet<string>;
};

export type GolomtStatementResult = {
  statement: ParsedBankStatement;
  /** Өмнө импортлогдсон тул алгассан мөрийн тоо. */
  skipped: number;
};

export function golomtStatementToParsed(
  input: GolomtStatementInput
): GolomtStatementResult {
  const currency = input.currency.toUpperCase();
  const occurrences = new Map<string, number>();
  let skipped = 0;

  const sorted = [...input.entries].sort((left, right) => {
    const byDate = text(left.tranPostedDate).localeCompare(
      text(right.tranPostedDate)
    );
    return byDate !== 0 ? byDate : Number(left.recNum ?? 0) - Number(right.recNum ?? 0);
  });

  const rows: ParsedBankStatementRow[] = [];
  for (const entry of sorted) {
    const label = `Голомтын гүйлгээ ${text(entry.tranId) || "(дугааргүй)"}`;
    const tranId = text(entry.tranId);
    if (!tranId) throw new Error(`${label}: гүйлгээний дугаар (tranId) ирээгүй`);

    const direction = text(entry.drOrCr);
    const isCredit = /^c/i.test(direction);
    if (!isCredit && !/^d/i.test(direction))
      throw new Error(`${label}: орлого/зарлагын чиглэл тодорхойгүй («${direction}»)`);

    const amount = money(entry.tranAmount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error(`${label}: гүйлгээний дүн буруу`);

    const transactionDate = text(entry.tranPostedDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate))
      throw new Error(`${label}: гүйлгээний огноо буруу`);

    const tranCurrency = text(entry.tranCrnCode).toUpperCase();
    if (tranCurrency && tranCurrency !== currency)
      throw new Error(
        `${label}: валют ${tranCurrency} — сонгосон кассын данс ${currency}`
      );

    // OPERACCTSTA-ийн сарын хэсгүүд давхцахгүй тул ижил мөр = банкны жинхэнэ
    // тусдаа мөр — хаяхгүй, дарааллын дугаараар ялгана.
    const baseRef = golomtExternalRef(input.accountId, entry);
    const occurrence = (occurrences.get(baseRef) ?? 0) + 1;
    occurrences.set(baseRef, occurrence);
    const externalRef = golomtExternalRef(input.accountId, entry, occurrence);
    if (input.alreadyImported?.has(externalRef)) {
      skipped++;
      continue;
    }

    // Ханш ЗОХИОХГҮЙ — валютын дансанд банкны ханш ирээгүй (эсвэл 1) бол
    // хоосон үлдэж, хэрэглэгч хадгалахаас өмнө бөглөнө (saveBankStatement шалгана).
    const bankRate = Number(text(entry.exchRate));
    const exchangeRate =
      currency === "MNT"
        ? 1
        : Number.isFinite(bankRate) && bankRate > 1
          ? bankRate
          : null;
    const baseAmount =
      exchangeRate === null
        ? null
        : Math.round(amount * exchangeRate * 100) / 100;

    rows.push({
      id: externalRef,
      rowNumber: rows.length + 1,
      transactionDate,
      description: text(entry.tranDesc),
      // Харьцсан тал (шимтгэл, хүүгийн мөрөнд банк хоосон ирүүлнэ) — П8
      // дүрэм / харилцагчийн санал файлын импортынх шиг эндээс уншина.
      counterparty: text(entry.accName),
      counterAccount: text(entry.accNum),
      income: isCredit ? amount : 0,
      expense: isCredit ? 0 : amount,
      exchangeRate,
      baseAmount,
      debitAccountNumber: "",
      creditAccountNumber: "",
      externalRef,
      rawData: {
        source: "golomt-api",
        accountId: input.accountId,
        tranId,
        tranDate: text(entry.tranDate),
        drOrCr: direction,
        tranAmount: text(entry.tranAmount),
        tranDesc: text(entry.tranDesc),
        tranPostedDate: text(entry.tranPostedDate),
        tranCrnCode: text(entry.tranCrnCode),
        exchRate: text(entry.exchRate),
        balance: text(entry.balance),
        accName: text(entry.accName),
        accNum: text(entry.accNum),
      },
    });
  }

  if (rows.length > GOLOMT_STATEMENT_MAX_ROWS)
    throw new Error(
      `Нэг удаад ${GOLOMT_STATEMENT_MAX_ROWS.toLocaleString("en-US")} хүртэл гүйлгээ импортлоно — хугацааг богиносгоно уу`
    );

  const fileHash = createHash("sha256")
    .update(
      ["golomt-api", input.accountId, ...rows.map((row) => row.externalRef)].join("\n")
    )
    .digest("hex");

  return {
    statement: {
      fileName: `Голомт API · ${input.accountId} · ${input.startDate}–${input.endDate}`,
      fileHash,
      bankName: "Голомт банк",
      periodStart: input.startDate,
      periodEnd: input.endDate,
      rows,
    },
    skipped,
  };
}

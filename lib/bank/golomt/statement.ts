// Голомтын хуулга (OPERACCSTAINQ, SPEC §5.6) → банкны хуулгын импортын НЭГ
// хэлбэр (ParsedBankStatement). ЦЭВЭР — DB-гүй, тесттэй
// (tests/golomt-statement.test.ts). Үр дүн нь файлаас уншсан хуулгатай ЯГ
// ИЖИЛ хянах → данс оноох → хадгалах (saveBankStatement) урсгалаар явна.

import { createHash } from "node:crypto";

import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
} from "@/lib/cash/bank-statement-types";

import { GOLOMT_STATEMENT_MAX_ROWS } from "./constants";

/** SPEC §5.6 — хуулгын нэг мөр (банкнаас ирсэн түүхий утга). */
export type GolomtStatementEntry = {
  recNum?: number | string | null;
  tranId?: string | null;
  drOrCr?: string | null;
  tranAmount?: number | string | null;
  tranDesc?: string | null;
  tranPostedDate?: string | null;
  tranCrnCode?: string | null;
  exchRate?: number | string | null;
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
 * огнооны муж өөрчлөгдөхөд солигдоно — ОРОЛЦУУЛАХГҮЙ. Finacle-ийн tranId нь
 * огноо дотроо давтагдашгүй; нэг tranId-ийн хэд хэдэн хэсэг нэг дансанд
 * орохыг чиглэл + дүнгээр ялгана.
 */
export function golomtExternalRef(
  accountId: string,
  entry: GolomtStatementEntry
): string {
  const direction = /^c/i.test(text(entry.drOrCr)) ? "C" : "D";
  return [
    "golomt",
    accountId,
    text(entry.tranId),
    text(entry.tranPostedDate),
    direction,
    money(entry.tranAmount).toFixed(2),
  ].join(":");
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
  const seen = new Set<string>();
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

    const externalRef = golomtExternalRef(input.accountId, entry);
    if (input.alreadyImported?.has(externalRef)) {
      skipped++;
      continue;
    }
    // Нэг хариунд давхар ирвэл (хуудаслалтын давхцал) нэг л удаа.
    if (seen.has(externalRef)) continue;
    seen.add(externalRef);

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
      counterparty: "",
      counterAccount: "",
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
        drOrCr: direction,
        tranAmount: text(entry.tranAmount),
        tranDesc: text(entry.tranDesc),
        tranPostedDate: text(entry.tranPostedDate),
        tranCrnCode: text(entry.tranCrnCode),
        exchRate: text(entry.exchRate),
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

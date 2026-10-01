// Банкны хуулгын бичилтийг батлахаас ӨМНӨ харах (docs/dev/arap.md §5l) — ЦЭВЭР,
// DB импортгүй тул client component ч импортолно (CLAUDE.md «Client/server хил»).
// Өгөгдөл нь previewBankStatement (lib/cash/import-statement.ts) — saveBankStatement-ийн
// ЯГ ТЭР кодыг транзакц дотор ажиллуулж, үүссэн журналын мөрийг уншаад буцаадаг
// (rollback). Тиймээс энд бичилт бодохгүй, зөвхөн бүлэглэж нэгтгэнэ.
// Тесттэй: tests/statement-preview.test.ts.

import { extractMainAccount } from "@/lib/reports/balances";

/** Журналын төрөл — хуулгын нэг мөр 1–3 журнал үүсгэж болно. */
export type PreviewVoucherKind =
  | "ar_invoice" // Борлуулалтын нэхэмжлэх үүснэ (create_ar_invoice)
  | "ap_bill" // Өглөгийн нэхэмжлэх үүснэ (create_ap_bill)
  | "settlement" // Кассын баримт нэхэмжлэхийг хаана
  | "cash" // Ердийн кассын баримт (урьдчилгаа ч энд)
  | "ewallet" // Э-хэтэвчийн settlement — түр данс → банк шилжүүлэг
  | "fee"; // Э-хэтэвчийн шимтгэл

export const PREVIEW_VOUCHER_LABELS: Record<PreviewVoucherKind, string> = {
  ar_invoice: "Борлуулалтын нэхэмжлэх үүснэ",
  ap_bill: "Өглөгийн нэхэмжлэх үүснэ",
  settlement: "Нэхэмжлэх хаах баримт",
  cash: "Кассын баримт",
  ewallet: "Э-хэтэвчийн шилжүүлэг",
  fee: "Э-хэтэвчийн шимтгэл",
};

export type PreviewLine = {
  /** Бүтэн сегмент код. */
  accountNumber: string;
  mainAccount: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
};

export type PreviewVoucher = {
  /** Хуулгын мөрийн дугаар. */
  rowNumber: number;
  kind: PreviewVoucherKind;
  /** Хаах нэхэмжлэхийн дугаар (settlement) эсвэл харилцагч г.м. тайлбар. */
  reference: string | null;
  date: string;
  lines: PreviewLine[];
};

export type PreviewAccountTotal = {
  mainAccount: string;
  accountName: string;
  debit: number;
  credit: number;
  /** Дебет − кредит. Нэхэмжлэх үүсч тэр даруй хаагдвал хяналтын данс 0. */
  net: number;
};

export type BankStatementPreview = {
  rowCount: number;
  vouchers: PreviewVoucher[];
  totals: PreviewAccountTotal[];
  debitTotal: number;
  creditTotal: number;
  balanced: boolean;
  /** Журналын төрөл бүрийн тоо. */
  counts: Record<PreviewVoucherKind, number>;
  /** Нэгээс олон журнал үүсгэх мөрийн тоо (нэхэмжлэх үүсгэж хаах г.м.). */
  multiVoucherRows: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

export function buildStatementPreview(input: {
  rowCount: number;
  vouchers: Array<Omit<PreviewVoucher, "lines"> & { id: string }>;
  lines: Array<{
    voucherId: string;
    accountNumber: string;
    debit: string | number;
    credit: string | number;
    description: string | null;
    sortOrder?: number | null;
  }>;
  accountNames: Map<string, string>;
}): BankStatementPreview {
  const linesByVoucher = new Map<string, PreviewLine[]>();
  const sortedLines = [...input.lines].sort(
    (left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
  );
  for (const line of sortedLines) {
    const mainAccount = extractMainAccount(line.accountNumber);
    const list = linesByVoucher.get(line.voucherId) ?? [];
    list.push({
      accountNumber: line.accountNumber,
      mainAccount,
      accountName: input.accountNames.get(mainAccount) ?? "",
      debit: round(Number(line.debit) || 0),
      credit: round(Number(line.credit) || 0),
      description: line.description ?? "",
    });
    linesByVoucher.set(line.voucherId, list);
  }

  // Мөрийн дарааллаар, мөр дотроо: нэхэмжлэх → кассын баримт → шимтгэл.
  const kindOrder: Record<PreviewVoucherKind, number> = {
    ar_invoice: 0,
    ap_bill: 0,
    settlement: 1,
    cash: 1,
    ewallet: 1,
    fee: 2,
  };
  const vouchers: PreviewVoucher[] = input.vouchers
    .map(({ id, ...voucher }) => ({ ...voucher, lines: linesByVoucher.get(id) ?? [] }))
    .sort(
      (left, right) =>
        left.rowNumber - right.rowNumber || kindOrder[left.kind] - kindOrder[right.kind]
    );

  const totalsByAccount = new Map<string, PreviewAccountTotal>();
  const counts: Record<PreviewVoucherKind, number> = {
    ar_invoice: 0,
    ap_bill: 0,
    settlement: 0,
    cash: 0,
    ewallet: 0,
    fee: 0,
  };
  const vouchersPerRow = new Map<number, number>();
  let debitTotal = 0;
  let creditTotal = 0;
  for (const voucher of vouchers) {
    counts[voucher.kind] += 1;
    vouchersPerRow.set(voucher.rowNumber, (vouchersPerRow.get(voucher.rowNumber) ?? 0) + 1);
    for (const line of voucher.lines) {
      const entry = totalsByAccount.get(line.mainAccount) ?? {
        mainAccount: line.mainAccount,
        accountName: line.accountName,
        debit: 0,
        credit: 0,
        net: 0,
      };
      entry.debit = round(entry.debit + line.debit);
      entry.credit = round(entry.credit + line.credit);
      entry.net = round(entry.debit - entry.credit);
      totalsByAccount.set(line.mainAccount, entry);
      debitTotal = round(debitTotal + line.debit);
      creditTotal = round(creditTotal + line.credit);
    }
  }

  return {
    rowCount: input.rowCount,
    vouchers,
    totals: [...totalsByAccount.values()].sort((left, right) =>
      left.mainAccount.localeCompare(right.mainAccount)
    ),
    debitTotal,
    creditTotal,
    balanced: Math.abs(debitTotal - creditTotal) <= 0.01,
    counts,
    multiVoucherRows: [...vouchersPerRow.values()].filter((count) => count > 1).length,
  };
}

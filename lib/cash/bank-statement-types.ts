import type { EwalletSettlementRowInput } from "./ewallet-settlement";
import type { BankRowAction } from "@/lib/arap/advance-math";

export type ParsedBankStatementRow = {
  id: string;
  rowNumber: number;
  transactionDate: string;
  description: string;
  counterparty: string;
  counterAccount: string;
  income: number;
  expense: number;
  exchangeRate: number | null;
  baseAmount: number | null;
  debitAccountNumber: string;
  creditAccountNumber: string;
  /**
   * Нэхэмжлэхийн саналыг «Ашиглах» дарахад бөглөгдөнө — хадгалах үед энэ
   * нэхэмжлэхтэй settlement (төлбөрийн холбоос) үүсгэж, төлсөн дүнг нь
   * шинэчилнэ. Харьцах дансыг гараар өөрчилбөл цуцлагдана.
   */
  settleInvoiceId?: string | null;
  /**
   * Э-хэтэвчийн (QPay) settlement — «Ашиглах» дарахад бөглөгдөнө: хадгалах үед
   * энэ мөр орлого биш, түр данс → банк ШИЛЖҮҮЛЭГ (цэвэр) + шимтгэлийн зарлага
   * (түр данснаас) болно (lib/cash/ewallet-settlement.ts). Харьцах данс =
   * түр дансны GL; гараар өөрчилбөл цуцлагдана.
   */
  ewalletSettlement?: EwalletSettlementRowInput | null;
  /**
   * Банкны API-аас татсан мөрийн давтагдашгүй түлхүүр (ж: Голомтын
   * `golomt:<данс>:<tranId>:…`, lib/bank/golomt/statement.ts). Хадгалахад
   * байгууллага дотор давхардал шалгана — огнооны муж давхцсан татал ижил
   * гүйлгээг ДАХИН бичихгүй. Файлын импортод байхгүй.
   */
  externalRef?: string | null;
  /**
   * Мөрийн бүртгэлийн төрөл (docs/dev/arap.md §5l) — хоосон бол ердийн
   * (харьцах данс / нэхэмжлэх хаах):
   *   advance_received — урьдчилж орсон орлого (харьцах тал = урьдчилгааны өр)
   *   create_ar_invoice — борлуулалтын нэхэмжлэх үүсгэж (Cr харьцах тал = орлого,
   *                      НӨАТ төлөгч бол 10/110 НӨАТ) тэр даруй энэ мөрөөр хаана
   *   prepaid_paid     — урьдчилж төлсөн (харьцах тал = урьдчилж төлсөн хөрөнгө)
   *   create_ap_bill   — өглөгийн нэхэмжлэх үүсгэж (Dr харьцах тал = зардал,
   *                      НӨАТ төлөгч бол 10/110 НӨАТ) тэр даруй энэ мөрөөр хаана
   * Бүгд `counterpartyId` ЗААВАЛ.
   */
  rowAction?: BankRowAction | null;
  /** Харилцагчийн бүртгэл — өгвөл нэрээр таахаас давуу. */
  counterpartyId?: string | null;
  rawData: Record<string, string>;
};

export type ParsedBankStatement = {
  fileName: string;
  fileHash: string;
  bankName: string;
  periodStart: string;
  periodEnd: string;
  rows: ParsedBankStatementRow[];
};

/** Хянаж буй (хадгалаагүй) хуулгын ноорог — lib/cash/statement-draft.ts. */
export type StatementDraft = {
  cashAccountId: string;
  /** Эх хуулгын толгой (мөргүй — засварласан мөрүүд `rows`-д). */
  statement: ParsedBankStatement;
  rows: ParsedBankStatementRow[];
  updatedAt: string;
};

import type { EwalletSettlementRowInput } from "./ewallet-settlement";

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

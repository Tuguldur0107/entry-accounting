export type ParsedBankStatementRow = {
  id: string;
  rowNumber: number;
  transactionDate: string;
  valueDate: string;
  description: string;
  counterparty: string;
  counterAccount: string;
  income: number;
  expense: number;
  balance: number | null;
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

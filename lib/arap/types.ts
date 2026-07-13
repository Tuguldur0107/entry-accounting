export type CounterpartyView = {
  id: string;
  name: string;
  counterpartyType: string;
  registerNo: string | null;
  defaultReceivableAccountNumber: string | null;
  defaultPayableAccountNumber: string | null;
  defaultCurrency: string;
  paymentTermsDays: number;
  isActive: boolean;
};

export type ArApDocumentType = "ar_invoice" | "ap_bill";

export type ArApDocumentView = {
  id: string;
  documentNo: string;
  documentType: ArApDocumentType;
  counterpartyId: string;
  counterpartyName: string;
  date: string;
  dueDate: string;
  currency: string;
  exchangeRate: number;
  controlAccountNumber: string;
  description: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  baseTotalAmount: number;
  basePaidAmount: number;
  baseBalance: number;
  status: string;
  voucherId: string | null;
};

export type ArApLineInput = {
  account: string;
  description: string;
  amount: number;
  /** Бараатай мөр: батлагдахад inventory-д тоо хэмжээний draft үүснэ. */
  itemId?: string;
  quantity?: number;
  warehouseId?: string;
};

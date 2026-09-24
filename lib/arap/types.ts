export type CounterpartyView = {
  id: string;
  name: string;
  /** Харилцагчийн код — РД-ээс тусдаа, org дотор давтагдашгүй; null = оноогоогүй. */
  code: string | null;
  counterpartyType: string;
  /** Субъектийн төрлийн КОД — систем ("organization"/"individual") эсвэл нэмсэн ("kind_<n>"). */
  entityKind: string;
  /** Төрлийн харагдах нэр (lib/arap/counterparty-kind.ts `entityKindName`). */
  entityKindName: string;
  /** Суурь төрөл — регистрийн шалгалт, eBarimt B2B ЭНЭГЭЭР (`baseKindOf`). */
  entityKindBase: "organization" | "individual";
  registerNo: string | null;
  defaultReceivableAccountNumber: string | null;
  defaultPayableAccountNumber: string | null;
  defaultCurrency: string;
  paymentTermsDays: number;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Ханган нийлүүлэгчийн мэдээлэл — PO панелийн карт, төлбөрийн заавар. */
  contactPerson: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  /** POS хөнгөлөлтийн бүлэг (VIP, ажилтан…) — null = бүлэггүй. */
  customerGroup: string | null;
  /** Зээлээр борлуулах дээд хязгаар (MNT) — null = хязгааргүй. */
  creditLimit: number | null;
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
  /** Буцаагдсан баримтын буцаалтын журнал — панелиас шууд үсэрнэ. */
  reversalVoucherId: string | null;
  /** АР нэхэмжлэхийн илгээлт: null = илгээгээгүй. */
  sendStatus: "sent" | "viewed" | null;
  /**
   * Хангамжийн захиалга (PO) — өгөгдсөн бол бараа/бүрэлдэхүүн мөр нь
   * ӨГЛӨГИЙН ТҮР ДАНС руу бичигдэж, орлого нь хүлээн авалтын баримтаас
   * үүснэ (docs/procurement §3.3 ③④).
   */
  purchaseOrderId: string | null;
};

export type ArApLineInput = {
  account: string;
  description: string;
  amount: number;
  /** Бараатай мөр: батлагдахад inventory-д тоо хэмжээний draft үүснэ. */
  itemId?: string;
  quantity?: number;
  warehouseId?: string;
  /** PO мөрийн холбоос — PO-той нэхэмжлэхийн бараатай мөр. */
  purchaseOrderLineId?: string;
  /** Нэгж үнэ (баримтын валютаар) — тоо × нэгж үнэ = мөрийн дүн. */
  unitPrice?: number;
  /**
   * Өртгийн бүрэлдэхүүн (гааль, тээвэр …) — барааны өртөгт капиталжих
   * нэмэлт зардлын мөр. Бараатай мөртэй ЗЭРЭГ байж болохгүй.
   */
  costComponentId?: string;
};

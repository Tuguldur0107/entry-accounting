// POS-ийн plain төрлүүд — client component ч, server action ч эндээс уншина
// ("use server" БИШ, DB import БИШ).

import type {
  DiscountRuleType,
  DiscountScope,
  DiscountValueType,
  PaymentKind,
  VatMode,
} from "./constants";

/** Хөнгөлөлтийн дүрэм — pos_discount_rules-ийн plain хувилбар (тоон талбар number). */
export interface DiscountRule {
  id: string;
  code: string;
  name: string;
  ruleType: DiscountRuleType;
  scope: DiscountScope;
  scopeRef: string | null;
  valueType: DiscountValueType;
  value: number;
  minQty: number | null;
  minAmount: number | null;
  buyQty: number | null;
  getQty: number | null;
  tiers: { minQty: number; percent?: number; price?: number }[] | null;
  dateFrom: string | null;
  dateTo: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  weekdays: string | null;
  couponCode: string | null;
  maxUsesTotal: number | null;
  maxUsesPerCustomer: number | null;
  usedCount: number;
  stackable: boolean;
  priority: number;
  requiresApproval: boolean;
  isActive: boolean;
}

/** Төлбөрийн хэлбэр — pos_payment_methods-ийн plain хувилбар. */
export interface PaymentMethodView {
  id: string;
  code: string;
  name: string;
  kind: PaymentKind;
  cashAccountId: string | null;
  cashAccountName: string | null;
  currency: string;
  requiresReference: boolean;
  allowsChange: boolean;
  allowsRefund: boolean;
  feePercent: number | null;
  /** eBarimt төлбөрийн код (payments[].code) — хоосон бол eBarimt илгээгдэхгүй. */
  ebarimtCode: string | null;
  isActive: boolean;
  sortOrder: number;
}

/** Сагсны нэг мөр — кассчны оруулсан хэлбэрээр (хөнгөлөлтөөс өмнө). */
export interface CartLine {
  /** Client талын түлхүүр (нэг бараа олон мөрөнд байж болно). */
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  categoryCode: string | null;
  quantity: number;
  /** Нэгж үнэ (НӨАТ төлөгч бол орсон). */
  unitPrice: number;
  vatMode: VatMode;
  minSalesPrice: number | null;
  /** Кассчны гар хөнгөлөлт — хувь ЭСВЭЛ дүн (мөрөнд). */
  manualDiscountPercent?: number | null;
  manualDiscountAmount?: number | null;
}

/** Хөнгөлөлтийн задаргааны нэг мөр (pos_sale_lines.discountDetail). */
export interface DiscountDetail {
  ruleId: string | null;
  ruleCode: string | null;
  /** auto | manual | coupon | receipt */
  kind: "auto" | "manual" | "coupon" | "receipt";
  amount: number;
}

/** Хөнгөлөлт тооцогдсон мөр. */
export interface PricedLine extends CartLine {
  lineGross: number;
  discountAmount: number;
  discountDetail: DiscountDetail[];
  /** Хөнгөлөлтийн дараах, НӨАТ орсон мөрийн дүн. */
  lineTotal: number;
}

/** НӨАТ задарсан мөр — АР нэхэмжлэх, тайланд бичигдэх эцсийн хэлбэр. */
export interface TotaledLine extends PricedLine {
  netAmount: number;
  vatAmount: number;
}

export interface CartContext {
  /** Харилцагчийн бүлэг (counterparties.customerGroup) — null = бэлэн худалдан авагч. */
  customerGroup: string | null;
  couponCodes: string[];
  /** УБ-ын өдөр YYYY-MM-DD, цаг HH:MM, гарагийн дугаар 1 (Да) … 7 (Ня). */
  date: string;
  time: string;
  weekday: number;
  /** Баримтын түвшний гар хөнгөлөлт (кассчин) — хувь ЭСВЭЛ дүн. */
  receiptDiscountPercent?: number | null;
  receiptDiscountAmount?: number | null;
  /** pos_settings */
  discountStacking: "best_single" | "cumulative";
  maxManualDiscountPercent: number;
  maxTotalDiscountPercent: number;
}

export interface ReceiptDiscount {
  ruleId: string | null;
  ruleCode: string | null;
  kind: "auto" | "manual" | "coupon" | "receipt";
  amount: number;
}

export interface DiscountResult {
  lines: PricedLine[];
  /** Баримтын түвшний хөнгөлөлтүүд (мөрүүдэд pro-rata ХУВААРИЛАГДСАН). */
  receiptDiscounts: ReceiptDiscount[];
  /** Ашиглагдсан дүрмүүд (usedCount нэмэгдэнэ). */
  appliedRuleIds: string[];
  /** Менежерийн зөвшөөрөл шаардах шалтгаанууд — хоосон бол шаардахгүй. */
  approvalReasons: string[];
  grossAmount: number;
  discountTotal: number;
  /** Хөнгөлөлтийн дараах нийт (НӨАТ орсон), бөөрөнхийлөлгүй. */
  subtotal: number;
}

export interface SaleTotals {
  lines: TotaledLine[];
  grossAmount: number;
  discountTotal: number;
  netAmount: number;
  vatAmount: number;
  /** Бөөрөнхийлөлгүй төлөх дүн. */
  total: number;
}

export interface PaymentInput {
  paymentMethodId: string;
  /** Төлбөрийн валютаарх дүн. */
  amount: number;
  reference?: string | null;
  giftCardCode?: string | null;
  storeCreditId?: string | null;
}

export interface ResolvedPayment extends PaymentInput {
  method: PaymentMethodView;
  currency: string;
  exchangeRate: number;
  baseAmount: number;
  /** Бэлэн хариулт (MNT) — зөвхөн allowsChange хэлбэрийн НЭГ мөрөнд. */
  changeGiven: number;
}

export interface PaymentContext {
  /** Харилцагч бэлэн худалдан авагч (walk-in) эсэх — зээл/урьдчилгаа/кредит хориотой. */
  isWalkIn: boolean;
  /** Харилцагчийн зээлийн лимит (null = хязгааргүй) ба одоогийн нээлттэй авлага (MNT). */
  creditLimit: number | null;
  openReceivable: number;
  /** Урьдчилгааны үлдэгдэл (MNT) — advance хэлбэрт. */
  advanceBalance: number;
  /** Бэлгийн картын код → үлдэгдэл. */
  giftCardBalances: Record<string, number>;
  /** Дэлгүүрийн кредит id → үлдэгдэл. */
  storeCreditBalances: Record<string, number>;
  /** Валют → ханш (ээлжийн fxRates). */
  fxRates: Record<string, number>;
  /** Бэлэн бөөрөнхийллийн нэгж 0 | 10 | 100. */
  cashRoundingUnit: number;
}

export interface PaymentPlan {
  payments: ResolvedPayment[];
  /** Σ baseAmount (хариулт хасаагүй). */
  paidBase: number;
  /** Бэлэн хариулт. */
  change: number;
  /** Бэлэн төлөх хэсгийн бөөрөнхийллийн зөрүү (төлөх дүнд нэмэгдэнэ; ± байж болно). */
  roundingAmount: number;
  /** Бөөрөнхийлсний дараах төлөх дүн. */
  payable: number;
  errors: string[];
}

export interface SaleLineView {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineGross: number;
  discountAmount: number;
  discountDetail: DiscountDetail[];
  vatMode: VatMode;
  netAmount: number;
  vatAmount: number;
  lineTotal: number;
  /** Буцаасан тоо (эх борлуулалтын мөрөнд). */
  returnedQty: number;
  movementId: string | null;
  provisionalCostEntryId: string | null;
  /** Урьдчилсан COGS дүн (MNT), байхгүй бол null. */
  provisionalCost: number | null;
}

export interface SalePaymentView {
  id: string;
  methodId: string;
  methodName: string;
  kind: PaymentKind;
  amount: number;
  currency: string;
  exchangeRate: number;
  baseAmount: number;
  changeGiven: number;
  reference: string | null;
  cashDocumentId: string | null;
  voucherId: string | null;
}

export interface PosSaleView {
  id: string;
  documentNo: string;
  date: string;
  soldAt: string;
  shiftId: string | null;
  shiftNo: string | null;
  warehouseId: string;
  warehouseName: string;
  counterpartyId: string;
  counterpartyName: string;
  /** Бэлэн худалдан авагч (pos_settings.walkInCounterpartyId) — дэлгүүрийн кредит олгохгүй. */
  isWalkIn: boolean;
  cashierName: string;
  grossAmount: number;
  discountTotal: number;
  netAmount: number;
  vatAmount: number;
  roundingAmount: number;
  total: number;
  status: string;
  isReturn: boolean;
  originalSaleId: string | null;
  originalSaleNo: string | null;
  returnReason: string | null;
  arApDocumentId: string | null;
  arApDocumentNo: string | null;
  arApStatus: string | null;
  /** Сүүлийн ДДТД (хэсэгчилсэн буцаалтын засвар бүрд шинэчлэгдэнэ). Сугалаа/QR хадгалагдахгүй (албан спек). */
  ebarimtId: string | null;
  /** lib/ebarimt/constants.ts EbarimtStatus — null = илгээгдээгүй (eBarimt унтраалттай). */
  ebarimtStatus: string | null;
  ebarimtDate: string | null;
  ebarimtType: string | null;
  ebarimtConsumerNo: string | null;
  ebarimtCustomerTin: string | null;
  note: string;
  /** Төлбөрийн хэлбэрийн товч (жишээ: "Бэлэн 1,000,000 · Карт 661,550"). */
  paymentSummary: string;
  lineCount: number;
}

export interface PosSaleDetail extends PosSaleView {
  lines: SaleLineView[];
  payments: SalePaymentView[];
  discounts: { id: string; ruleCode: string | null; kind: string; amount: number; note: string }[];
  /** Холбоотой журналууд (АР, касс, урьдчилсан COGS) — drill. */
  voucherIds: string[];
  /** Буцаалтууд (эх борлуулалтад). */
  returns: { id: string; documentNo: string; date: string; total: number }[];
}

export interface PosShiftView {
  id: string;
  documentNo: string;
  cashAccountId: string;
  cashAccountName: string;
  warehouseId: string;
  warehouseName: string;
  openedByName: string;
  openedAt: string;
  openingFloat: number;
  closedByName: string | null;
  closedAt: string | null;
  countedCash: number | null;
  systemCash: number | null;
  varianceAmount: number | null;
  varianceCashDocumentId: string | null;
  fxRates: Record<string, number>;
  status: "open" | "closed";
  note: string;
  /** Ээлжийн борлуулалтын нэгтгэл. */
  salesCount: number;
  salesTotal: number;
  cashReceipts: number;
  cashRefunds: number;
  returnsTotal: number;
}

export interface PosSettingsView {
  revenueAccountNumber: string;
  discountAccountNumber: string;
  discountPosting: "net" | "contra";
  giftCardLiabilityAccountNumber: string;
  storeCreditLiabilityAccountNumber: string;
  customerAdvanceAccountNumber: string;
  cashOverAccountNumber: string;
  cashShortAccountNumber: string;
  roundingAccountNumber: string;
  walkInCounterpartyId: string | null;
  issueTypeId: string | null;
  defaultWarehouseId: string | null;
  provisionalCogs: boolean;
  allowNegativeStock: boolean;
  maxManualDiscountPercent: number;
  maxTotalDiscountPercent: number;
  discountStacking: "best_single" | "cumulative";
  cashRoundingUnit: number;
  receiptHeader: string;
  receiptFooter: string;
  // ── eBarimt 3.0 (docs/pos/03-ebarimt-integration-plan.md) ──
  ebarimtEnabled: boolean;
  ebarimtMerchantTin: string;
  ebarimtBranchNo: string;
  ebarimtDistrictCode: string;
  ebarimtPosNo: string;
  ebarimtPosApiUrl: string;
  ebarimtMode: "server" | "browser";
}

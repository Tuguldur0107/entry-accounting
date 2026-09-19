// POS-ийн литералын ЦОРЫН ГАНЦ эх сурвалж (docs/pos/00-proposal.md §3.2,
// §3.10). Хангамжийн lib/procurement/constants.ts-тэй ижил хэв маяг —
// бусад модуль (АР, касс, бараа, өртөг, сар хаалт) эндээс л импортолно.

/** Эрхийн түлхүүр (module_configs.moduleKey, requireModuleAction). */
export const POS_MODULE_KEY = "pos";

/** ar_ap_documents.sourceType / cash_documents.sourceType утга. */
export const POS_SOURCE_TYPE = "pos";

/** inventory_movements.sourceType утга — борлуулалтын мөрөөс үүссэн зарлага/буцаалт. */
export const POS_MOVEMENT_SOURCE_TYPE = "pos_sale";

/** journal_lines / cost_entries businessObjectType — клирингийн түлхүүр (карт, QPay түр данс). */
export const POS_BUSINESS_OBJECT = "pos_sale";

/** cost_entries.valuationSource — борлуулах мөчийн явцын дундаж (§3.7). */
export const PROVISIONAL_VALUATION_SOURCE = "provisional_avg";

/** cost_entries.entryType — сар хаалтын залруулга (§3.7). */
export const COGS_TRUE_UP_ENTRY_TYPE = "cogs_true_up";

/** S9 модулийн тэмдэг — POS-ийн журналын мөрүүд. */
export const POS_MODULE_TAG = "PS";

export const VAT_MODES = ["standard", "exempt", "zero"] as const;
export type VatMode = (typeof VAT_MODES)[number];
export const VAT_MODE_LABELS: Record<VatMode, string> = {
  standard: "10%",
  exempt: "Чөлөөлөгдсөн",
  zero: "0%",
};

export const PAYMENT_KINDS = [
  "cash",
  "cash_fx",
  "card",
  "ewallet",
  "transfer",
  "credit",
  "advance",
  "gift_card",
  "store_credit",
  "bnpl",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  cash: "Бэлэн (₮)",
  cash_fx: "Бэлэн (валют)",
  card: "Карт (POS терминал)",
  ewallet: "QPay / SocialPay / MonPay",
  transfer: "Дансны шилжүүлэг",
  credit: "Зээлээр (дараа төлөх)",
  advance: "Урьдчилгаа ашиглах",
  gift_card: "Бэлгийн карт",
  store_credit: "Дэлгүүрийн кредит",
  bnpl: "Хуваан төлөх (BNPL)",
};
/** Мөнгө хүлээн авах касс/банк/түр данс шаарддаг хэлбэрүүд. */
export const PAYMENT_KINDS_WITH_CASH_ACCOUNT: PaymentKind[] = [
  "cash",
  "cash_fx",
  "card",
  "ewallet",
  "transfer",
  "bnpl",
];

export const DISCOUNT_RULE_TYPES = [
  "line_percent",
  "line_amount",
  "fixed_price",
  "qty_tier",
  "buy_x_get_y",
  "basket_threshold",
  "customer_group",
  "coupon",
  "time_window",
] as const;
export type DiscountRuleType = (typeof DISCOUNT_RULE_TYPES)[number];
export const DISCOUNT_RULE_TYPE_LABELS: Record<DiscountRuleType, string> = {
  line_percent: "Мөрийн хувь (%)",
  line_amount: "Мөрийн дүн (₮/нэгж)",
  fixed_price: "Урамшууллын үнэ",
  qty_tier: "Тоо хэмжээний шатлал",
  buy_x_get_y: "N авбал M үнэгүй",
  basket_threshold: "Сагсны босго",
  customer_group: "Харилцагчийн бүлэг",
  coupon: "Купон / промо код",
  time_window: "Цагийн цонх",
};

export const DISCOUNT_SCOPES = ["all", "category", "item", "customer_group"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];
export const DISCOUNT_SCOPE_LABELS: Record<DiscountScope, string> = {
  all: "Бүх бараа",
  category: "Барааны бүлэг",
  item: "Тодорхой бараа",
  customer_group: "Харилцагчийн бүлэг",
};

export const DISCOUNT_VALUE_TYPES = ["percent", "amount", "fixed_price"] as const;
export type DiscountValueType = (typeof DISCOUNT_VALUE_TYPES)[number];

export const SALE_STATUS_LABELS: Record<string, string> = {
  posted: "Батлагдсан",
  partially_returned: "Хэсэгчлэн буцаасан",
  returned: "Буцаасан",
  voided: "Цуцалсан",
};

export const SHIFT_STATUS_LABELS: Record<string, string> = {
  open: "Нээлттэй",
  closed: "Хаагдсан",
};

/** Дараалсан дугаарлалтын угтварууд (PO/GR-ийн `PO-YYMM-NNN` хэв маяг). */
export const POS_SALE_NO_PREFIX = "POS";
export const POS_RETURN_NO_PREFIX = "RET";
export const POS_SHIFT_NO_PREFIX = "SH";

// AI туслахын TOOL давхарга — бүх модульд өгөгдөл ОРУУЛАХ болон лавлах
// хэрэгслүүд. Дүрэм (§9 human-in-the-loop):
//
//   - Бичилт үргэлж НООРОГ болж үүснэ. Хэрэглэгч "Шууд бичих" (post)
//     горимыг ил сонгосон үед л тэнцсэн, ≤10 сая ₮ бичилт шууд батлагдана.
//   - >10 сая ₮ бичилт post горимд ч НООРОГ болно (нягтланч шалгана).
//   - Гүйцэтгэгчид одоо байгаа server action-уудыг дуудна — бүх шалгалт
//     (период, данс, тэнцэл) нэг л газар байна; AI тусдаа зам гаргахгүй.
//
// Tool schema нь JSON Schema — Anthropic input_schema болон OpenAI
// function.parameters хоёуланд нь ИЖИЛ бүтцээр явна.

import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, like, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  createArApDocument,
  createCounterparty,
  deleteArApDocument,
  deleteCounterparty,
  postArApDocument,
  updateArApDocument,
  settleArApOffset,
} from "@/lib/actions/arap";
import { createCreditNote, getCreditNoteSource } from "@/lib/actions/arap-credit-note";
import {
  getEclOverview,
  recoverArApWriteOff,
  runEclProvision,
  writeOffArApDocument,
} from "@/lib/actions/arap-ecl";
import type { EclProvisionPlan } from "@/lib/arap/ecl";
import {
  arapLedger,
  documentTypeLabel,
  isCreditDocument,
  ledgerSign,
  settlementCashType,
} from "@/lib/arap/document-kind";
import {
  createInvoiceLink,
  sendInvoiceEmail,
} from "@/lib/actions/invoice-send";
import {
  createCashAccount,
  createCashDocument,
  createCashOpeningVoucher,
  deleteCashDocument,
  postCashDocument,
  postCashFxRevaluation,
  reverseCashDocument,
  reverseCashFxRevaluation,
  updateCashDocument,
} from "@/lib/actions/cash";
import {
  activateFixedAsset,
  createFixedAsset,
  deleteFixedAsset,
  disposeFixedAsset,
  postDepreciationMonth,
  reverseDepreciationEntry,
  runDepreciation,
  type FaDisposalType,
} from "@/lib/actions/fa";
import {
  createAccount,
  createVoucher,
  deleteVoucher,
  postVoucher,
  syncStandardAccounts,
  unpostVoucher,
  updateVoucher,
} from "@/lib/actions/gl";
import {
  confirmInventoryMovement,
  createInventoryItem,
  createInventoryMovement,
  createWarehouse,
  deleteInventoryItem,
  deleteInventoryMovement,
  recordInventoryCount,
  toggleInventoryItem,
  updateInventoryItem,
  updateInventoryMovement,
} from "@/lib/actions/inventory";
import { createOpeningStock } from "@/lib/actions/opening-stock";
import { planOpeningStock } from "@/lib/inventory/opening-stock";
import {
  deleteCostEntry,
  postCostEntries,
  reverseCostEntry,
} from "@/lib/actions/costing";
import {
  createCostAllocation,
  reverseCostAllocation,
  loadPoAllocationTargets,
} from "@/lib/actions/cost-allocation";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  confirmGoodsReceipt,
  createApInvoiceFromPo,
  createGoodsReceipt,
  createPurchaseOrder,
  getLandedCostSummary,
  reverseGoodsReceipt,
  deleteGoodsReceipt,
  updatePurchaseOrder,
} from "@/lib/actions/procurement";
import {
  loadGoodsReceiptDetail,
  loadPurchaseOrderDetail,
  loadPurchaseOrders,
  loadUnallocatedCostLines,
} from "@/lib/procurement/load-data";
import {
  ALLOCATION_BASE_LABELS,
  type AllocationBase,
} from "@/lib/costing/allocation";
import type {
  PurchaseOrderDetail,
  PurchaseOrderLineView,
  PurchaseOrderStatus,
} from "@/lib/procurement/types";
import { computeMonthlyCosting } from "@/lib/actions/costing-period";
import { closePeriod, listPeriods, reopenPeriod } from "@/lib/actions/periods";
import { createVatSettlementDraft, getVatReturnData } from "@/lib/actions/vat";
import { getMonthEndChecklist } from "@/lib/actions/month-end";
import {
  calculatePayrollRun,
  createPayrollVoucher,
  getPayrollRunData,
  upsertEmployee,
  type EmployeeInput,
  type EmploymentType,
} from "@/lib/actions/payroll";
import {
  getOrganizationProfile,
  updateOrganizationProfile,
} from "@/lib/actions/organization-profile";
import { fmtDateTimeUb } from "@/lib/format/datetime";
import { getBillingOverview } from "@/lib/actions/billing";
import { READ_ONLY_MESSAGES } from "@/lib/billing/entitlements";
import { EntitlementError, requireFeature } from "@/lib/billing/guards";
import { getEntitlements } from "@/lib/billing/load";
import { toolInPlan } from "@/lib/billing/tool-scope";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_DAILY_READ_LIMIT,
  KNOWLEDGE_FEATURE,
  formatSection,
  formatTopicIndex,
  isKnowledgeCategory,
  normalizeSectionSlug,
  normalizeTopicSlug,
} from "@/lib/knowledge/catalog";
import {
  countKnowledgeReadsToday,
  listKnowledgeTopics,
  readKnowledgeSection,
  recordKnowledgeRead,
} from "@/lib/knowledge/store";
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  PLAN_LABELS as BILLING_PLAN_LABELS,
  STATUS_LABELS as SUBSCRIPTION_STATUS_LABELS,
} from "@/lib/billing/plans";
import { DEPLOYMENT_MODE_LABELS } from "@/lib/deployment-mode";
import {
  createOrganizationForUser,
  deleteOrganizationForUser,
} from "@/lib/actions/org";
import {
  getStoredRateForDate,
  syncMongolbankRates,
} from "@/lib/actions/exchange-rates";
// STORE-FIRST: ханшийг ХЭЗЭЭ Ч `fetch`-ээр шууд авахгүй (CLAUDE.md §5b) —
// `getOfficialRateForDate` нь хадгалсан түүхээс → Монголбанкнаас → ШИДНЭ.
import { getOfficialRateForDate } from "@/lib/cash/official-rate";
import { saveBankStatement } from "@/lib/cash/import-statement";
import {
  suggestEwalletSettlements,
  type EwalletSettlementRowInput,
} from "@/lib/cash/ewallet-settlement";
import { loadEwalletSettlementContext } from "@/lib/cash/ewallet-settlement-data";
import { expectedCashGlBalance, groupCashAccountsByGl } from "@/lib/cash/reconciliation";
import { cashOpeningAccountIdOf, mainAccountOf } from "@/lib/cash/gl-sync";
import { faExpectedGl } from "@/lib/fa/reconcile";
import { planCurrencyExchange } from "@/lib/cash/exchange-transfer";
import { toolInputProblem, type ToolInputSchema } from "@/lib/ai/tool-input";
import { loadVoucherCfCodes } from "@/lib/reports/cf-codes";
import { isGuardExemptRef } from "@/lib/gl/control-accounts";
import { FA_COST_ACCOUNTS } from "@/lib/fa/sync-sources";
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";
import {
  saveCostComponent,
  saveCostingAccountSettings,
  saveIssueType,
} from "@/lib/actions/costing-master";
import { latestClosingByItem } from "@/lib/costing/valuation";
import { loadVatSettings } from "@/lib/vat/settings";
import { applyInclusiveVatToLines } from "@/lib/vat/return";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { loadClearingReconciliation } from "@/lib/costing/clearing-reconciliation";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { loadInventoryGlReconciliation } from "@/lib/costing/transaction-detail";
import { unwrapAction } from "@/lib/action-result";
import {
  closeShift,
  createPosSale,
  deletePaymentMethod,
  getPosSaleDetail,
  openShift,
  quotePosSale,
  returnPosSale,
  savePaymentMethod,
  updatePosSettings,
  type SaleLineInput,
  type SaleQuoteInput,
} from "@/lib/actions/pos";
import {
  ensurePosSettings,
  loadPaymentMethodViews,
  loadSaleViews,
  loadShiftViews,
} from "@/lib/pos/load-data";
import { PAYMENT_KIND_LABELS, PAYMENT_KINDS, SALE_STATUS_LABELS, type PaymentKind } from "@/lib/pos/constants";
import { lookupEbarimtTin, resendEbarimt } from "@/lib/actions/ebarimt";
import { EBARIMT_STATUS_LABELS, type EbarimtStatus } from "@/lib/ebarimt/constants";
import { ebarimtSettingsProblems } from "@/lib/ebarimt/receipt";
import {
  DEFAULT_COUNTERPARTY_ENTITY_KIND,
  baseKindOf,
  entityKindName,
  inferEntityKindFromRegisterNo,
  resolveEntityKindCode,
  type EntityKindOption,
} from "@/lib/arap/counterparty-kind";
import { loadEntityKinds } from "@/lib/arap/entity-kinds";
import { ebarimtStatusWithPosApi, loadEbarimtReadiness, settingsInputOf } from "@/lib/ebarimt/queue";
import { loadQpayReadiness, qpayStatusSummary } from "@/lib/qpay/store";
import { todayInUlaanbaatar } from "@/lib/periods/selection";
import {
  aggregateBy,
  aggregatePayments,
  COGS_BASIS_LABELS,
  loadSalesReport,
  summarize,
  type AggRow,
} from "@/lib/pos/reports";
import type { PaymentInput } from "@/lib/pos/types";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertCounterpartyCodeAvailable,
  normalizeCounterpartyCode,
} from "@/lib/arap/counterparty-code";
import {
  arApDocuments,
  arApSettlements,
  arapWriteOffs,
  auditEvents,
  cashAccounts,
  posSales,
  cashFxRevaluations,
  cashDocuments,
  chartOfAccounts,
  organizationProfile,
  costAllocations,
  costComponents,
  costEntries,
  counterparties,
  employees,
  faDepreciationEntries,
  fixedAssets,
  goodsReceipts,
  inventoryIssueTypes,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  memberships,
  organizations,
  purchaseOrders,
  reportLineMappings,
  segmentConfigs,
  segmentValues,
  warehouses,
} from "@/lib/db/schema";
import {
  ONBOARDING_INTRO,
  ONBOARDING_LIMITS,
  ONBOARDING_SECTIONS,
  extractSection,
  formatOnboardingStatus,
  type OnboardingSection,
} from "@/lib/onboarding/guide";
import { loadOnboardingStatus, readOnboardingDoc } from "@/lib/onboarding/status";
import {
  fmtAccountDisplay,
  normalizePastedAccount,
  parseSegParts,
} from "@/lib/grid/segments";
import {
  aggregateBalances,
  computeNetIncome,
  extractMainAccount,
  isBalanced,
  isCashMainAccount,
} from "@/lib/reports/balances";
import {
  buildMappedCashFlow,
  resolveCfLines,
} from "@/lib/reports/cf-lines";
import { loadBalanceRowsFast } from "@/lib/reports/period-balances";
import { type BsSection } from "@/lib/reports/bs-lines";
import { resolveBsLines, type ResolvedBsLine } from "@/lib/reports/bs-resolve";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@/lib/actions/notifications";
import { notificationTypeLabel } from "@/lib/notifications/catalog";
import { emitNotification } from "@/lib/notifications/emit";
import { ENTITY_HREF, ENTITY_MODULE_KEYS } from "@/lib/notifications/rules";

import type { AiWriteMode } from "./write-mode";
import {
  AI_POST_LIMIT_TOOL_MAX_MNT,
  currentAiPostLimit,
  DEFAULT_AI_POST_LIMIT_MNT,
  planAiPostLimitChange,
  resolveAiPostLimit,
  runWithAiPostLimit,
} from "./post-limit";

import type { AiAction } from "./action-markers";
import { classifyToolError, describeErrorChain, internalErrorText } from "@/lib/ai/error-sanitize";
import { isFuturePeriodDate, ulaanbaatarToday } from "@/lib/periods/document-date";
import {
  accumDepAccountFor,
  computeFaDisposal,
  DEFAULT_FA_ASSET_ACCOUNT,
  faDisposalJournalTotal,
} from "@/lib/fa/opening";
import { cashOpeningMnt } from "@/lib/cash/opening";
import { loadCashBalancesFast } from "@/lib/cash/period-balances";
import { recordAiToolCall } from "@/lib/ai-logging/record-tool";
import { logAuditEvent } from "@/lib/audit";
import { approvalAuditNote } from "@/lib/pos/discounts";
import { posIssueTypeWarning } from "@/lib/pos/sale-math";
import {
  customToolDefs,
  executeCustomTool,
  findCustomTool,
} from "@/lib/custom/loader";


export type { AiAction };

export interface AiToolResult {
  /** Модельд буцаах текст (tool_result). */
  resultText: string;
  /** Амжилттай үүссэн объект — чатад карт болж харагдана. */
  action?: AiAction;
  /**
   * externalRef/давхардлаар алгасагдсан (шинэ бичлэг үүсээгүй, байгааг нь
   * буцаасан) — batch wrapper "skipped" гэж тоолно.
   */
  dedup?: boolean;
}

/**
 * Машинаар боловсруулагдах алдааны код — текстийн эхэнд [CODE] хэлбэрээр
 * залгагдана (спек: entry-mcp-tools §11). Модель болон MCP клиент кодоор
 * нь салгаж боловсруулна.
 */
function codedError(code: string, message: string): Error {
  return new Error(`[${code}] ${message}`);
}

/** Tool аль замаар нээгдэх вэ — өгөөгүй бол бүгдэд (чат, MCP, REST). */
export type AiToolSurface = "mcp" | "rest";

export interface AiToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Хязгаарлагдсан зам — ж: мэдлэгийн сан зөвхөн ["mcp"]
   * (docs/knowledge/00-proposal.md D4: REST нь скриптээр бөөнөөр татах зам).
   * Undefined = бүх замд. Шүүлт: aiToolsForSurface().
   */
  surfaces?: AiToolSurface[];
}

// ── Tool тодорхойлолтууд ────────────────────────────────────────────────────

const LINE_SCHEMA = {
  type: "object",
  properties: {
    account: {
      type: "string",
      description:
        "Дансны 8 оронтой үндсэн дугаар (жишээ нь 11000001) — идэвхтэй дансны жагсаалтаас",
    },
    debit: { type: "number", description: "Дебет дүн (₮). Кредиттэй зэрэг байж болохгүй" },
    credit: { type: "number", description: "Кредит дүн (₮). Дебеттэй зэрэг байж болохгүй" },
    description: { type: "string", description: "Мөрийн тайлбар" },
  },
  required: ["account"],
} as const;

/** Idempotency түлхүүр — гурван create tool ижил талбартай (спек §3). */
const EXTERNAL_REF_SCHEMA = {
  type: "string",
  description:
    "Гадаад системийн давтагдашгүй дугаар (eBarimt ДДТД, банкны гүйлгээний ID г.м). Ижил externalRef-тэй баримт байвал шинээр үүсгэхгүй, байгааг нь буцаана — retry аюулгүй.",
} as const;

export const AI_TOOLS: AiToolDef[] = [
  {
    name: "create_journal_voucher",
    description:
      "Ерөнхий журналын бичилт үүсгэнэ. Үргэлж ноорог болж үүсэх ба хэрэглэгч 'Шууд бичих' горим сонгосон үед тэнцсэн (ΣДт=ΣКт), 10 сая ₮-с хэтрэхгүй бичилт шууд батлагдана. Дансыг зөвхөн хэрэглэгчийн идэвхтэй дансны жагсаалтаас ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        description: { type: "string", description: "Журналын нэр (баримтын ерөнхий утга)" },
        lines: {
          type: "array",
          description: "Журналын мөрүүд (дор хаяж 2)",
          items: LINE_SCHEMA,
        },
        externalRef: EXTERNAL_REF_SCHEMA,
        currency: {
          type: "string",
          description:
            "Баримтын валют (default MNT). Валютын журналд мөрийн debit/credit нь ВАЛЮТААР, ₮ нь ханшаар бодогдоно (IAS 21)",
        },
        exchangeRate: {
          type: "number",
          description:
            "1 валют = ? ₮ (сонголтоор — өгөөгүй бол огнооны Монголбанкны албан ханш; олдохгүй бол [RATE_REQUIRED])",
        },
      },
      required: ["date", "description", "lines"],
    },
  },
  {
    name: "create_arap_invoice",
    description:
      "Авлагын нэхэмжлэл (ar_invoice) эсвэл өглөгийн нэхэмжлэх (ap_bill) үүсгэнэ. Харилцагчийг нэрээр нь заана — олдохгүй/олон таарвал алдаа буцаана (list_counterparties-оор шалгаж болно). Бараатай мөрөнд itemCode+quantity+warehouseCode өгвөл батлагдахад бараа материалын хөдөлгөөний ноорог автоматаар үүснэ. Худалдан авалтын захиалгатай (PO) нэхэмжлэхийг create_ap_invoice_from_po-гоор үүсгэх нь хялбар (үлдэгдэл автоматаар бөглөгдөнө) — purchaseOrder талбар нь гараар мөр бүрийг заах хувилбар.",
    inputSchema: {
      type: "object",
      properties: {
        documentType: { type: "string", enum: ["ar_invoice", "ap_bill"] },
        counterparty: { type: "string", description: "Харилцагчийн нэр" },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        dueDate: {
          type: "string",
          description: "Төлөх огноо YYYY-MM-DD (хоосон бол харилцагчийн нөхцөлөөр)",
        },
        description: { type: "string", description: "Баримтын утга" },
        controlAccount: {
          type: "string",
          description:
            "Хяналтын данс (авлага/өглөгийн 8 оронтой данс). Хоосон бол харилцагчийн default данс",
        },
        currency: { type: "string", description: "Валют (default: харилцагчийнх, ихэвчлэн MNT)" },
        exchangeRate: { type: "number", description: "Валют MNT биш үед ханш" },
        purchaseOrder: {
          type: "string",
          description:
            "Худалдан авалтын захиалга (PO дугаар, externalRef эсвэл 6+ тэмдэгтийн ID) — зөвхөн ap_bill. Өгвөл бараа/бүрэлдэхүүнтэй мөрүүд ӨГЛӨГИЙН ТҮР ДАНСанд суух ба орлогын хөдөлгөөн ҮҮСЭХГҮЙ (орлого нь хүлээн авалтын баримтаас). Захиалга хаагдсан бол [PO_CLOSED]",
        },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account: {
                type: "string",
                description:
                  "Мөрийн данс (8 оронтой). АП-ийн БАРААТАЙ мөрөнд орхи — клирингийн данс автоматаар орно (PO-той бол өглөгийн түр данс)",
              },
              description: { type: "string" },
              amount: { type: "number", description: "Мөрийн дүн (0-ээс их). unitPrice+quantity өгвөл орхиж болно; АР-д бараа бүртгэлийн борлуулах үнэтэй бол quantity-ээр бодогдоно" },
              itemCode: { type: "string", description: "Барааны код (бараатай мөрөнд)" },
              quantity: { type: "number", description: "Тоо хэмжээ (бараатай мөрөнд заавал)" },
              warehouseCode: { type: "string", description: "Агуулахын код (бараатай мөрөнд заавал)" },
              unitPrice: {
                type: "number",
                description:
                  "Нэгж үнэ (баримтын валютаар) — тоо × нэгж үнэ = мөрийн дүн",
              },
              purchaseOrderLineId: {
                type: "string",
                description:
                  "Захиалгын мөрийн ID (get_purchase_order-оос) — purchaseOrder өгсөн үед бараатай мөрийг PO мөртэй холбоно",
              },
              costComponentCode: {
                type: "string",
                description:
                  "Өртгийн бүрэлдэхүүний код (гааль, тээвэр … — get_costing_settings). Зөвхөн PO-той нэхэмжлэхэд, бараатай мөртэй ЗЭРЭГ байж болохгүй; хуваарилалтаар барааны өртөгт капиталжина",
              },
            },
            required: ["amount"],
          },
        },
        vatMode: {
          type: "string",
          enum: ["none", "exclusive", "inclusive"],
          description:
            "НӨАТ 10%: exclusive — мөрийн дүн ЦЭВЭР, НӨАТ дээр нь нэмж тооцоод НӨАТ-ийн мөр автоматаар нэмэгдэнэ; inclusive — мөрийн дүнд НӨАТ багтсан, дотроос нь ялгана (мөрүүд /1.1 болно); default none",
        },
        externalRef: EXTERNAL_REF_SCHEMA,
      },
      required: ["documentType", "counterparty", "date", "description", "lines"],
    },
  },
  {
    name: "create_cash_transaction",
    description:
      "Мөнгөн хөрөнгийн орлого (receipt), зарлага (payment), шилжүүлэг (transfer) үүсгэнэ. Кассын/банкны дансыг нэрээр заана (list_cash_accounts-оор шалгаж болно). counterAccount нь харьцах GL данс (орлогод кредитлэгдэх, зарлагад дебетлэгдэх тал).",
    inputSchema: {
      type: "object",
      properties: {
        documentType: { type: "string", enum: ["receipt", "payment", "transfer"] },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        cashAccount: {
          type: "string",
          description: "Орлогод хүлээн авах, зарлагад гаргах, шилжүүлэгт ЭХЛЭХ дансны нэр",
        },
        toCashAccount: { type: "string", description: "Шилжүүлэгт хүлээн авах дансны нэр" },
        counterAccount: {
          type: "string",
          description: "Харьцах GL данс (8 оронтой) — шилжүүлэгт хэрэггүй",
        },
        amount: { type: "number", description: "Дүн (0-ээс их)" },
        description: { type: "string", description: "Журналын нэр (баримтын ерөнхий утга)" },
        counterparty: { type: "string", description: "Харилцагчийн нэр (сонголтоор)" },
        exchangeRate: { type: "number", description: "Валютын данс бол ханш (валют солилцоонд — арилжааны ханш)" },
        toAmount: {
          type: "number",
          description:
            "Валют солилцоо (өөр валюттай дансны transfer): хүлээн авах дансанд орох дүн тэр валютаар — эсвэл exchangeRate",
        },
        clearingAccount: {
          type: "string",
          description: "Валют солилцооны түр данс (default 11000099) — хоёр баримт энэ дансаар тэглэгдэнэ",
        },
        cashFlowCode: {
          type: "string",
          description:
            "Мөнгөн гүйлгээний ангилал — S8 сегментийн код (IAS 7; жишээ нь үйл ажиллагааны орлого/зарлага). Мөнгөн гүйлгээний тайланд ангилагдахын тулд өгнө",
        },
        externalRef: EXTERNAL_REF_SCHEMA,
        applyTo: {
          type: "array",
          description:
            "Энэ төлөлтөөр хаагдах АР/АП нэхэмжлэхүүд (батлагдсан). Σ amount нь төлөлтийн дүнгээс хэтрэхгүй; олон нэхэмжлэхэд хуваарилахад нэхэмжлэх тус бүрд тусдаа кассын баримт үүснэ. Өгөхгүй бол нэхэмжлэхтэй холбогдохгүй.",
          items: {
            type: "object",
            properties: {
              documentId: {
                type: "string",
                description: "Нэхэмжлэхийн ID, дугаар (AR-...), эсвэл externalRef",
              },
              amount: { type: "number", description: "Энэ нэхэмжлэхэд ноогдох дүн" },
            },
            required: ["documentId", "amount"],
          },
        },
      },
      required: ["documentType", "date", "cashAccount", "amount", "description"],
    },
  },
  {
    name: "create_inventory_movement",
    description:
      "Бараа материалын хөдөлгөөн үүсгэнэ (зөвхөн ТОО ХЭМЖЭЭ — үнэлгээг өртгийн модуль сар хаахад хийнэ; нээлтийн үлдэгдлийг ӨРТӨГТЭЙ нь create_opening_stock-оор). Төрөл: receipt=орлого, issue=зарлага, transfer=шилжүүлэг, adjustment=тохируулга, return_in=буцаан авалт, return_out=буцаалт. Бараа/агуулахыг кодоор нь заана (list_inventory-оор шалгаж болно).",
    inputSchema: {
      type: "object",
      properties: {
        movementType: {
          type: "string",
          enum: ["receipt", "issue", "transfer", "adjustment", "return_in", "return_out"],
        },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        itemCode: { type: "string", description: "Барааны код" },
        warehouseCode: { type: "string", description: "Агуулахын код (зарлагад гаргах агуулах)" },
        toWarehouseCode: { type: "string", description: "Шилжүүлэгт хүлээн авах агуулахын код" },
        quantity: { type: "number", description: "Тоо хэмжээ (тохируулгад сөрөг байж болно)" },
        description: { type: "string", description: "Тайлбар" },
        issueType: {
          type: "string",
          description: "Зарлагын төрлийн КОД (ж: WRITEOFF) эсвэл нэр (issue үед — хоосон бол хэрэглэгч сонгоно)",
        },
      },
      required: ["movementType", "date", "itemCode", "warehouseCode", "quantity"],
    },
  },
  {
    name: "create_opening_stock",
    description:
      "Нээлтийн барааны үлдэгдлийг ӨРТӨГТЭЙ оруулна (нэвтрүүлэлт, бараа × агуулах × тоо × нэгж өртөг, ≤1000 мөр). Мөр бүрд баталгаажсан орлого + өртгийн бичилт үүсч GL-д Dr барааны нөөц / Cr нээлтийн зөрүүний данс (44000098) бичигдэнэ — тиймээс нээлтийн журнал барааг ДАХИН оруулахгүй (onboarding R8). Огноо нь нээлтийн бус анхны барааны гүйлгээнээс хожуу байж болохгүй. Ноорог горимд өртгийн бичилт ноорог (Өртөг → Өртгийн бичилтээс батална); 'Шууд бичих' горимд батлах хязгаар дотор шууд батлагдаж НЭГ журнал үүснэ. Өртөг мэдэгдэхгүй бараанд create_inventory_movement (өртөггүй орлого) хэрэглэнэ. externalRef-ээр идемпотент.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Нээлтийн (cut-off) огноо YYYY-MM-DD" },
        lines: {
          type: "array",
          description: "Мөрүүд — бараа × агуулах давхардахгүй",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Барааны код" },
              warehouseCode: { type: "string", description: "Агуулахын код" },
              quantity: { type: "number", description: "Тоо хэмжээ (0-ээс их)" },
              unitCost: { type: "number", description: "Нэгж өртөг ₮ (0-ээс их)" },
            },
            required: ["itemCode", "warehouseCode", "quantity", "unitCost"],
          },
        },
        counterAccount: {
          type: "string",
          description: "Кредит данс (сонголтоор). Хоосон бол нээлтийн зөрүүний данс 44000098",
        },
        externalRef: { type: "string", description: "Идемпотент түлхүүр (ж: opening-stock:2024-12-31)" },
        description: { type: "string", description: "Тайлбар" },
      },
      required: ["date", "lines"],
    },
  },
  {
    name: "create_fixed_asset",
    description:
      "Үндсэн хөрөнгийн карт үүсгэнэ (ноорог — хэрэглэгч шалгаад идэвхжүүлнэ; 'Шууд бичих' горимд идэвхтэй үүснэ). Данс өгөөгүй бол биет ҮХ-ийн анхдагч: хөрөнгө 20000001, хуримтлагдсан элэгдэл 20000002, элэгдлийн зардал 70000001. Нэвтрүүлэлтийн өмнө элэгдэж эхэлсэн хөрөнгөд openingAccumulatedDepreciation + openingAsOf (cut-off) ЗААВАЛ — эс бөгөөс систем дахин бүтэн хугацаагаар элэгдүүлнэ; нээлтийн дүн GL-д нээлтийн журналаар (Кт 20000002) орно.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Хөрөнгийн нэр" },
        acquisitionDate: { type: "string", description: "Худалдан авсан огноо YYYY-MM-DD" },
        cost: { type: "number", description: "Өртөг (₮, 0-ээс их)" },
        salvageValue: { type: "number", description: "Үлдэх өртөг (default 0)" },
        usefulLifeMonths: { type: "integer", description: "Ашиглалтын хугацаа (сараар)" },
        depreciationMethod: {
          type: "string",
          enum: ["straight_line", "declining_balance"],
          description: "Элэгдлийн арга (default straight_line)",
        },
        custodian: { type: "string", description: "Хариуцагч (овог нэр)" },
        depreciationStartMonth: {
          type: "string",
          description: "Элэгдэл эхлэх сар YYYY-MM (default: авсан сарын дараах сар)",
        },
        openingAccumulatedDepreciation: {
          type: "number",
          description:
            "Нээлтийн (нэвтрүүлэлтийн өмнөх) хуримтлагдсан элэгдэл ₮ — ≤ өртөг − үлдэх өртөг",
        },
        openingTaxAccumulated: {
          type: "number",
          description: "Татварын нээлтийн хуримтлагдсан элэгдэл ₮ (мэмо, сонголтоор)",
        },
        openingAsOf: {
          type: "string",
          description:
            "Нээлтийн cut-off огноо YYYY-MM-DD — энэ сар хүртэлх элэгдэл нээлтийн дүнд багтсан (систем дараагийн сараас элэгдүүлнэ)",
        },
        assetAccountNumber: {
          type: "string",
          description: "Хөрөнгийн данс (8 оронтой, default 20000001)",
        },
        accumDepAccountNumber: {
          type: "string",
          description: "Хуримтлагдсан элэгдлийн данс (default: хөрөнгийн дансанд харгалзах — 20000002)",
        },
        capitalizeFrom: {
          type: "string",
          description:
            "Капиталжуулах ЭХ данс (ж: 20000099 ҮХ-ийн түр данс, 31000001 өглөг, банк) — өгвөл Dr хөрөнгийн данс / Cr энэ данс журнал үүснэ (картын төлөвтэй хамт ноорог/батлагдсан). Өртөг АП/журналаар ҮХ-ийн дансанд аль хэдийн орсон бол өгөхгүй",
        },
        depExpenseAccountNumber: {
          type: "string",
          description: "Элэгдлийн зардлын данс (default 70000001)",
        },
      },
      required: ["name", "acquisitionDate", "cost", "usefulLifeMonths", "custodian"],
    },
  },
  {
    name: "list_counterparties",
    description:
      "Харилцагчдын жагсаалт (ID, нэр, ТТД/регистр, төрөл, төлбөрийн нөхцөл, default данс). Нэхэмжлэх үүсгэхийн өмнө яг нэр/ID-г шалгах, ТТД-гээр давхардлыг илрүүлэхэд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Нэр эсвэл ТТД-гээр шүүх (сонголтоор)" },
        includeInactive: {
          type: "boolean",
          description: "Идэвхгүй харилцагчдыг ч оруулах (default false)",
        },
        limit: { type: "integer", description: "Max мөр (default 50, max 100)" },
      },
    },
  },
  {
    name: "list_inventory",
    description:
      "Идэвхтэй бараа (код, нэр), агуулах (код, нэр), зарлагын төрлүүдийн жагсаалт. Бараа материалын хөдөлгөөн, бараатай нэхэмжлэхийн өмнө кодуудыг шалгахад ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Барааны нэр/кодоор шүүх (сонголтоор)" },
      },
    },
  },
  {
    name: "list_cash_accounts",
    description: "Идэвхтэй кассын/банкны дансны жагсаалт (нэр, төрөл, валют, GL данс).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_gl_accounts",
    description:
      "Идэвхтэй GL дансны жагсаалт (дугаар, нэр). Данс таамаглахын ОРОНД үүгээр хайна — бичилт хийхийн өмнө зөв дугаараа олоход ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Нэр эсвэл дугаараар шүүх (жишээ нь 'түрээс', '7400'). Хоосон бол бүгд",
        },
      },
    },
  },
  {
    name: "post_journal_voucher",
    description:
      "Ноорог журналыг баталж GL-д бичнэ. Зөвхөн 'Шууд бичих' горимд, тэнцсэн, 10 сая ₮-с хэтрэхгүй бичилтэд зөвшөөрөгдөнө — бусад тохиолдолд вэб дээрээс батлахыг заана.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: {
          type: "string",
          description: "Журналын бичилтийн дугаар (ж: GL-26-000001) ЭСВЭЛ ID (бүтэн/эхний 8+ тэмдэгт)",
        },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "delete_journal_voucher",
    description:
      "НООРОГ журнал устгана (аль ч горимд). Батлагдсан журнал устгагдахгүй — [USE_REVERSAL]: reverse_journal_voucher-оор буцаана (аудитын мөр хадгалагдана). Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: {
          type: "string",
          description: "Журналын бичилтийн дугаар (ж: GL-26-000001) ЭСВЭЛ ID (бүтэн/эхний 8+ тэмдэгт)",
        },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "post_cash_document",
    description:
      "Ноорог мөнгөн хөрөнгийн баримтыг баталж GL журнал үүсгэнэ. Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд зөвшөөрөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "delete_cash_document",
    description:
      "Мөнгөн хөрөнгийн баримт устгана. Ноорог — аль ч горимд; БАТЛАГДСАНЫГ устгах нь 'Шууд бичих' горимд — GL журнал нь хамт устаж, нэхэмжлэхийн төлөлт байсан бол үлдэгдэл сэргэнэ. Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "post_arap_document",
    description:
      "Ноорог АР/АП нэхэмжлэхийг баталж GL журнал үүсгэнэ (бараатай мөрүүд нь бараа материалын ноорог хөдөлгөөн үүсгэнэ). Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд зөвшөөрөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID эсвэл нэхэмжлэхийн дугаар (жишээ нь AR-20260712-18CFE0)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "list_journal_vouchers",
    description:
      "Журналын бичилтүүдийн жагсаалт (огноо, утга, дүн, төлөв) — сүүлийнх нь эхэндээ. Үүсгэсэн ноорогоо шалгах, тайлагнахад ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD (сонголтоор)" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD (сонголтоор)" },
        status: {
          type: "string",
          enum: ["draft", "posted", "reversed"],
          description: "Төлвөөр шүүх (сонголтоор)",
        },
        limit: { type: "integer", description: "Хамгийн ихдээ хэдэн мөр (default 20, max 50)" },
        offset: { type: "integer", description: "Хэдэн мөр алгасах (дараагийн хуудас, default 0)" },
      },
    },
  },

  // ── Мастер дата үүсгэх ────────────────────────────────────────────────────
  {
    name: "create_gl_account",
    description:
      "Дансны модонд шинэ GL данс нээнэ (8 оронтой дугаар, бүлгийн эхний цифр нь ангиллаа заана: 1 эргэлтийн хөрөнгө … 8 санхүүгийн зардал).",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "string", description: "8 оронтой дансны дугаар (жишээ нь 74000002)" },
        name: { type: "string", description: "Дансны нэр" },
      },
      required: ["number", "name"],
    },
  },
  {
    name: "create_counterparty",
    description:
      "Шинэ харилцагч бүртгэнэ (авлага/өглөгийн нэхэмжлэхэд ашиглагдана). Нэрийг нормчилж (илүү зай арилгана), ижил нэр (том/жижиг ялгахгүй) эсвэл ижил ТТД-тэй харилцагч байвал шинээр үүсгэхгүй — [CONFLICT] + байгаа харилцагчийн ID-г буцаана. Мастер дата тул аль ч горимд шууд идэвхтэй үүснэ.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Харилцагчийн нэр" },
        counterpartyType: {
          type: "string",
          enum: ["customer", "supplier", "both"],
          description: "customer=авлагын, supplier=өглөгийн, both=хоёулаа",
        },
        entityKind: {
          type: "string",
          description: "Субъектийн төрөл — код эсвэл нэр: organization=Байгууллага (default), individual=Хувь хүн, эсвэл байгууллагын НЭМСЭН төрөл (ж: «Төрийн байгууллага», kind_1). Иргэний РД (УУ12345678) өгвөл individual. Бүртгэлд байхгүй төрөл өгвөл алдаа + жагсаалт буцна",
        },
        code: {
          type: "string",
          description: "Харилцагчийн код — РД-ээс тусдаа, байгууллага дотор давтагдашгүй (сонголтоор; ж: 10001)",
        },
        registerNo: { type: "string", description: "Регистрийн дугаар — байгууллагад РД (7 орон) / ТТД (11/14), хувь хүнд иргэний РД (сонголтоор)" },
        email: { type: "string", description: "И-мэйл (нэхэмжлэх илгээхэд ашиглагдана)" },
        defaultReceivableAccount: { type: "string", description: "Default авлагын данс (сонголтоор)" },
        defaultPayableAccount: { type: "string", description: "Default өглөгийн данс (сонголтоор)" },
        currency: { type: "string", description: "Default валют (default MNT)" },
        paymentTermsDays: { type: "integer", description: "Төлбөрийн нөхцөл, хоногоор (default 30)" },
        phone: { type: "string", description: "Утас (сонголтоор)" },
        address: { type: "string", description: "Хаяг (сонголтоор)" },
        contactPerson: { type: "string", description: "Холбоо барих хүн (сонголтоор)" },
        bankName: { type: "string", description: "Банкны нэр — нийлүүлэгчийн төлбөрт (сонголтоор)" },
        bankAccountNo: { type: "string", description: "Банкны дансны дугаар (сонголтоор)" },
      },
      required: ["name", "counterpartyType"],
    },
  },
  {
    name: "create_inventory_item",
    description:
      "Шинэ бараа бүртгэнэ (код нь давхардахгүй байх ёстой). POS-ийн талбарууд сонголтоор: борлуулах үнэ, доод үнэ, баркод, НӨАТ-ийн горим, бүлэг, орлогын данс.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Барааны код (жишээ нь ITEM-010)" },
        name: { type: "string", description: "Барааны нэр" },
        unit: { type: "string", description: "Хэмжих нэгж (default ш)" },
        salesPrice: { type: "number", description: "Борлуулах үнэ ₮ (POS; НӨАТ төлөгч бол НӨАТ орсон үнэ) — сонголтоор" },
        minSalesPrice: { type: "number", description: "Кассчны хөнгөлөлтийн доод үнэ ₮ (борлуулах үнээс ихгүй) — сонголтоор" },
        barcode: { type: "string", description: "Баркод (байгууллага дотор давхцахгүй) — сонголтоор" },
        vatMode: {
          type: "string",
          enum: ["standard", "exempt", "zero"],
          description: "НӨАТ-ийн горим: standard (10%) / exempt (чөлөөлөгдсөн) / zero (0%) — сонголтоор, default standard",
        },
        categoryCode: { type: "string", description: "Барааны бүлгийн код (бүртгэлд байх ёстой) — сонголтоор" },
        revenueAccountNumber: { type: "string", description: "Орлогын дансны override, 8 оронтой (хоосон бол POS тохиргооны данс) — сонголтоор" },
        ebarimtClassificationCode: { type: "string", description: "eBarimt: ТЕГ/ҮСХ-ын бараа, үйлчилгээний ангиллын код 7 орон (хоосон бол ангиллаас өвлөнө) — сонголтоор. Код ЗОХИОХГҮЙ — мэдэхгүй бол хэрэглэгчээс асууна" },
        ebarimtTaxProductCode: { type: "string", description: "eBarimt: НӨАТ-гүй (305–446) / 0% (501–507) барааны татварын бүтээгдэхүүний код 3 орон — exempt/zero бараанд заавал" },
        barcodeType: { type: "string", enum: ["GS1", "ISBN", "UNDEFINED"], description: "Баркодын төрөл (eBarimt barCodeType) — сонголтоор" },
        description: { type: "string", description: "Барааны тайлбар (≤2000) — сонголтоор" },
        brand: { type: "string", description: "Брэнд — сонголтоор" },
        manufacturer: { type: "string", description: "Үйлдвэрлэгч — сонголтоор" },
        originCountry: { type: "string", description: "Гарал үүслийн улс — сонголтоор" },
      },
      required: ["code", "name"],
    },
  },
  {
    name: "create_warehouse",
    description: "Шинэ агуулах бүртгэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Агуулахын код (жишээ нь WH-02)" },
        name: { type: "string", description: "Агуулахын нэр" },
      },
      required: ["code", "name"],
    },
  },

  {
    name: "update_counterparty",
    description:
      "Харилцагчийн мэдээлэл засна (нэр, төрөл, нөхцөл, default данс, и-мэйл, идэвх). Зөвхөн өгсөн талбарууд өөрчлөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty: { type: "string", description: "Одоогийн нэр (олоход ашиглана)" },
        newName: { type: "string", description: "Шинэ нэр (сонголтоор)" },
        counterpartyType: {
          type: "string",
          enum: ["customer", "supplier", "both"],
          description: "Шинэ төрөл (сонголтоор)",
        },
        entityKind: {
          type: "string",
          description: "Субъектийн төрөл — код эсвэл нэр: organization=Байгууллага (default), individual=Хувь хүн, эсвэл байгууллагын НЭМСЭН төрөл (ж: «Төрийн байгууллага», kind_1). Иргэний РД (УУ12345678) өгвөл individual. Бүртгэлд байхгүй төрөл өгвөл алдаа + жагсаалт буцна",
        },
        paymentTermsDays: { type: "integer", description: "Төлбөрийн нөхцөл, хоног (сонголтоор)" },
        defaultReceivableAccount: { type: "string", description: "Default авлагын данс (сонголтоор)" },
        defaultPayableAccount: { type: "string", description: "Default өглөгийн данс (сонголтоор)" },
        currency: { type: "string", description: "Default валют (сонголтоор)" },
        code: { type: "string", description: "Харилцагчийн код — давтагдашгүй; хоосон өгвөл арилна (сонголтоор)" },
        registerNo: { type: "string", description: "Регистр/ТТД (сонголтоор)" },
        email: { type: "string", description: "И-мэйл — нэхэмжлэх илгээхэд (сонголтоор)" },
        phone: { type: "string", description: "Утас (сонголтоор)" },
        address: { type: "string", description: "Хаяг (сонголтоор)" },
        contactPerson: { type: "string", description: "Холбоо барих хүн (сонголтоор)" },
        bankName: { type: "string", description: "Банкны нэр (сонголтоор)" },
        bankAccountNo: { type: "string", description: "Банкны дансны дугаар (сонголтоор)" },
        isActive: { type: "boolean", description: "Идэвхтэй эсэх (сонголтоор)" },
      },
      required: ["counterparty"],
    },
  },
  {
    name: "send_invoice_email",
    description:
      "БИЧИГДСЭН (posted) авлагын нэхэмжлэхийг харилцагч руу и-мэйлээр илгээнэ — PDF хавсралт + онлайнаар үзэх линктэй. to өгөхгүй бол харилцагчийн бүртгэлтэй и-мэйл рүү явна. Хэрэглэгч ил хүссэн үед л ашиглана; ноорог нэхэмжлэх илгээгдэхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Нэхэмжлэхийн ID, дугаар (AR-...), эсвэл externalRef",
        },
        to: {
          type: "string",
          description: "Хүлээн авагчийн и-мэйл (default: харилцагчийн бүртгэлтэй и-мэйл)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "create_invoice_link",
    description:
      "БИЧИГДСЭН авлагын нэхэмжлэхийн public линк үүсгэнэ — и-мэйлгүй харилцагчид хуваалцахад (линкийг хэрэглэгч өөрөө дамжуулна).",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Нэхэмжлэхийн ID, дугаар (AR-...), эсвэл externalRef",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "delete_counterparty",
    description:
      "Харилцагчийг устгана — зөвхөн АР/АП баримтад ашиглагдаагүй харилцагч устгагдана. Түүхтэй харилцагчийг update_counterparty isActive=false-аар идэвхгүй болгоно.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty: { type: "string", description: "Харилцагчийн нэр" },
      },
      required: ["counterparty"],
    },
  },
  {
    name: "delete_inventory_item",
    description:
      "Барааг устгана — зөвхөн хөдөлгөөн, АР/АП мөр, захиалга, өртгийн бичилтэд ашиглагдаагүй бараа устгагдана. Түүхтэй барааг update_inventory_item isActive=false-аар идэвхгүй болгоно.",
    inputSchema: {
      type: "object",
      properties: {
        itemCode: { type: "string", description: "Барааны код" },
      },
      required: ["itemCode"],
    },
  },
  {
    name: "update_inventory_item",
    description:
      "Барааны нэр, нэгж, идэвх болон POS-ийн талбаруудыг (борлуулах үнэ, доод үнэ, баркод, НӨАТ-ийн горим, бүлэг, орлогын данс) засна — кодоор нь олно. Зөвхөн өгсөн талбарууд өөрчлөгдөнө; үнэ өөрчлөгдвөл үнийн түүхэнд бичигдэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        itemCode: { type: "string", description: "Барааны код" },
        name: { type: "string", description: "Шинэ нэр (сонголтоор)" },
        unit: { type: "string", description: "Шинэ нэгж (сонголтоор)" },
        isActive: { type: "boolean", description: "Идэвхтэй эсэх (сонголтоор)" },
        salesPrice: { type: "number", description: "Борлуулах үнэ ₮ (POS; НӨАТ төлөгч бол НӨАТ орсон үнэ) — сонголтоор; null өгвөл арилгана" },
        minSalesPrice: { type: "number", description: "Кассчны хөнгөлөлтийн доод үнэ ₮ (борлуулах үнээс ихгүй) — сонголтоор" },
        barcode: { type: "string", description: "Баркод (байгууллага дотор давхцахгүй) — сонголтоор" },
        vatMode: {
          type: "string",
          enum: ["standard", "exempt", "zero"],
          description: "НӨАТ-ийн горим: standard (10%) / exempt (чөлөөлөгдсөн) / zero (0%) — сонголтоор, default standard",
        },
        categoryCode: { type: "string", description: "Барааны бүлгийн код (бүртгэлд байх ёстой) — сонголтоор" },
        revenueAccountNumber: { type: "string", description: "Орлогын дансны override, 8 оронтой (хоосон бол POS тохиргооны данс) — сонголтоор" },
        ebarimtClassificationCode: { type: "string", description: "eBarimt: ТЕГ/ҮСХ-ын бараа, үйлчилгээний ангиллын код 7 орон (хоосон бол ангиллаас өвлөнө) — сонголтоор. Код ЗОХИОХГҮЙ — мэдэхгүй бол хэрэглэгчээс асууна" },
        ebarimtTaxProductCode: { type: "string", description: "eBarimt: НӨАТ-гүй (305–446) / 0% (501–507) барааны татварын бүтээгдэхүүний код 3 орон — exempt/zero бараанд заавал" },
        barcodeType: { type: "string", enum: ["GS1", "ISBN", "UNDEFINED"], description: "Баркодын төрөл (eBarimt barCodeType) — сонголтоор" },
        description: { type: "string", description: "Барааны тайлбар (≤2000) — сонголтоор" },
        brand: { type: "string", description: "Брэнд — сонголтоор" },
        manufacturer: { type: "string", description: "Үйлдвэрлэгч — сонголтоор" },
        originCountry: { type: "string", description: "Гарал үүслийн улс — сонголтоор" },
      },
      required: ["itemCode"],
    },
  },
  {
    name: "update_inventory_movement",
    description:
      "НООРОГ хөдөлгөөнийг засна (огноо, тоо, тайлбар, бараа, агуулах). Зөвхөн өгсөн талбарууд өөрчлөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        movementId: { type: "string", description: "Хөдөлгөөний ID (бүтэн эсвэл 8+ тэмдэгт)" },
        date: { type: "string", description: "Шинэ огноо YYYY-MM-DD (сонголтоор)" },
        quantity: { type: "number", description: "Шинэ тоо хэмжээ (сонголтоор)" },
        description: { type: "string", description: "Шинэ тайлбар (сонголтоор)" },
        itemCode: { type: "string", description: "Шинэ бараа (сонголтоор)" },
        warehouseCode: { type: "string", description: "Шинэ агуулах (сонголтоор)" },
        toWarehouseCode: { type: "string", description: "Шилжүүлэгт хүлээн авах агуулах (сонголтоор)" },
        issueType: { type: "string", description: "Зарлагын төрлийн КОД эсвэл нэр (get_costing_settings; сонголтоор)" },
      },
      required: ["movementId"],
    },
  },
  {
    name: "record_inventory_count",
    description:
      "Тооллого бүртгэнэ — агуулах дахь бараануудын тоолсон тоог өгөхөд системийн үлдэгдэлтэй зөрсөн зөрүүгээр тохируулгын НООРОГ хөдөлгөөн үүснэ.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Тооллогын огноо YYYY-MM-DD" },
        warehouseCode: { type: "string", description: "Агуулахын код" },
        counts: {
          type: "array",
          description: "Тоолсон бараанууд",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Барааны код" },
              countedQty: { type: "number", description: "Тоолсон бодит тоо" },
            },
            required: ["itemCode", "countedQty"],
          },
        },
      },
      required: ["date", "warehouseCode", "counts"],
    },
  },
  {
    name: "create_cash_account",
    description: "Шинэ кассын/банкны данс бүртгэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Дансны нэр (жишээ нь 'Хаан банк MNT')" },
        accountType: { type: "string", enum: ["cash", "bank"] },
        bankName: { type: "string", description: "Банкны нэр (банкны дансанд)" },
        accountNumber: { type: "string", description: "Банкны дансны дугаар (сонголтоор)" },
        bankCode: {
          type: "string",
          description:
            "Банкны 6 оронтой код (QPay/банк хоорондын: Хаан 050000, Голомт 150000, ХХБ 040000, Хас 320000, Төрийн 190000…) — qpayPayout-д ЗААВАЛ",
        },
        accountHolder: { type: "string", description: "Данс эзэмшигчийн нэр (сонголтоор — хоосон бол компанийн нэр)" },
        iban: { type: "string", description: "IBAN (сонголтоор)" },
        qpayPayout: {
          type: "boolean",
          description:
            "«QPay төлбөр хүлээн авах» — данс QPay мерчантын дансанд sync хийгдэнэ (банкны, MNT, дугаартай, банкны кодтой); салбар (агуулах) бүр өөрийн дансаа сонгоно",
        },
        qpayDefault: { type: "boolean", description: "Байгууллагын QPay үндсэн данс (нэг л) — салбарт данс сонгоогүй үед" },
        currency: { type: "string", description: "Валют (default MNT)" },
        glAccount: { type: "string", description: "Холбогдох GL данс (8 оронтой)" },
        openingBalance: {
          type: "number",
          description: "Нээлтийн үлдэгдэл ДАНСНЫ ВАЛЮТААР (сонголтоор)",
        },
        openingDate: {
          type: "string",
          description:
            "Нээлтийн (cut-off) огноо YYYY-MM-DD — openingBalance ≠ 0 бол ЗААВАЛ; нээлтийн журнал энэ огноогоор бичигдэнэ",
        },
        openingRate: {
          type: "number",
          description:
            "Валютын дансны нээлтийн ханш (сонголтоор — хоосон бол нээлтийн огнооны Монголбанкны албан ханш)",
        },
      },
      required: ["name", "accountType", "glAccount"],
    },
  },
  {
    name: "activate_fixed_asset",
    description:
      "НООРОГ хөрөнгийн картыг идэвхжүүлнэ (АП нэхэмжлэх/AI-аас үүссэн ноорог карт элэгдүүлж эхлэхийн өмнө). Өгсөн талбарууд картын утгыг дарж бичигдэнэ, бусад нь хэвээрээ.",
    inputSchema: {
      type: "object",
      properties: {
        assetCode: { type: "string", description: "Хөрөнгийн код (FA-...)" },
        name: { type: "string" },
        cost: { type: "number" },
        salvageValue: { type: "number" },
        usefulLifeMonths: { type: "integer" },
        custodian: { type: "string", description: "Хариуцагч" },
        depreciationStartMonth: { type: "string", description: "YYYY-MM" },
        openingAccumulatedDepreciation: {
          type: "number",
          description: "Нээлтийн хуримтлагдсан элэгдэл ₮ (нэвтрүүлэлтийн өмнөх)",
        },
        openingAsOf: { type: "string", description: "Нээлтийн cut-off огноо YYYY-MM-DD" },
        assetAccountNumber: { type: "string" },
        accumDepAccountNumber: { type: "string" },
        depExpenseAccountNumber: { type: "string" },
      },
      required: ["assetCode"],
    },
  },
  {
    name: "delete_fixed_asset",
    description: "Хөрөнгийн карт устгана. Ноорог — аль ч горимд; ИДЭВХТЭЙГ устгах нь 'Шууд бичих' горимд, элэгдлийн бичилтгүй үед л. Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        assetCode: { type: "string", description: "Хөрөнгийн код (FA-...)" },
      },
      required: ["assetCode"],
    },
  },
  {
    name: "reverse_fa_depreciation",
    description:
      "Тухайн сарын БАТЛАГДСАН элэгдлийн бичилтүүдийг буцаана (буцаалтын журнал үүснэ). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },

  // ── GL нэмэлт ─────────────────────────────────────────────────────────────
  {
    name: "get_journal_voucher",
    description: "Нэг журналын дэлгэрэнгүй — толгой + мөрүүд (данс, дебет, кредит).",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: { type: "string", description: "Журналын бичилтийн дугаар (ж: GL-26-000001) ЭСВЭЛ ID (бүтэн/эхний 8+ тэмдэгт)" },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "update_journal_voucher",
    description:
      "НООРОГ журналыг засна (огноо, утга, мөрүүд). Мөр өгвөл хуучин мөрүүд БҮГД шинэчлэгдэнэ. Батлагдсан журнал засагдахгүй — эхлээд буцаана.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: { type: "string", description: "Журналын бичилтийн дугаар (ж: GL-26-000001) ЭСВЭЛ ID (бүтэн/эхний 8+ тэмдэгт)" },
        date: { type: "string", description: "Шинэ огноо YYYY-MM-DD (сонголтоор)" },
        description: { type: "string", description: "Шинэ утга (сонголтоор)" },
        lines: {
          type: "array",
          description: "Шинэ мөрүүд — өгвөл бүх мөр солигдоно (сонголтоор)",
          items: LINE_SCHEMA,
        },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "reverse_journal_voucher",
    description:
      "Батлагдсан журналд буцаалтын бичилт үүсгэнэ — эх журнал 'Буцаагдсан' төлөвт орно. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: { type: "string", description: "Журналын бичилтийн дугаар (ж: GL-26-000001) ЭСВЭЛ ID (бүтэн/эхний 8+ тэмдэгт)" },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "get_trial_balance",
    description:
      "Гүйлгээ баланс — данс бүрийн эхний үлдэгдэл, гүйлгээ, эцсийн үлдэгдэл (нээлт нь from-оос өмнөх бүх бичилтээс).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },

  // ── Санхүүгийн тайлангууд ─────────────────────────────────────────────────
  {
    name: "get_income_statement",
    description:
      "Орлогын тайлан (үр дүнгийн тайлан) — орлого дансаар, зардал бүлгээр (COGS/үйл ажиллагааны/санхүүгийн), тайлант үеийн ЦЭВЭР АШИГ/АЛДАГДАЛ. Вэбийн тайлантай ижил тооцоо.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_balance_sheet",
    description:
      "Баланс тайлан (SAS/IAS 1 мөрүүдээр) — хөрөнгө, өр төлбөр, эздийн өмч + тайлант үеийн цэвэр ашиг; Актив = Пассив тэнцлийг шалгана. Хэрэглэгчийн мөрийн mapping (report_line_mappings) хэрэглэгдэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "Тайлант огноо YYYY-MM-DD" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "get_cash_flow",
    description:
      "Мөнгөн гүйлгээний тайлан (шууд бус ангилал: үндсэн/хөрөнгө оруулалт/санхүүгийн үйл ажиллагаа) — мөнгөний эхний/эцсийн үлдэгдэлтэй тулгана.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_account_ledger",
    description:
      "Нэг дансны хуулга — эхний үлдэгдэл, хөдөлгөөн бүр (огноо, утга, Дт/Кт), гүйлгээний дараах явцын үлдэгдэл. Тайлангийн дүнг мөр хүртэл нь мөшгөхөд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Дансны 8 оронтой дугаар" },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        limit: { type: "integer", description: "Max мөр (default 50, max 200)" },
      },
      required: ["account", "from", "to"],
    },
  },
  {
    name: "create_year_end_closing",
    description:
      "Жилийн эцсийн хаалтын бичилтүүдийг НООРОГ-оор үүсгэнэ (12-31 огноогоор, 3 журнал): орлого → 44000099 Орлогын дүн, 44000099 → зардал, цэвэр дүн → 44000001 Хуримтлагдсан ашиг. Өмнө нь тухайн жилд хаалт хийгдсэн бол шинээр үүсгэхгүй. Урьдчилаад элэгдэл, өртөг, тулгалтаа дуусгасан байх ёстой — нягтланч ноорогуудыг вэбээс шалгаж батална.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "string", description: "Хаах жил YYYY (жишээ нь 2026)" },
      },
      required: ["year"],
    },
  },

  // ── АР/АП нэмэлт ──────────────────────────────────────────────────────────
  {
    name: "list_arap_documents",
    description:
      "АР/АП нэхэмжлэхүүдийн жагсаалт (огноо, дугаар, харилцагч, нийт, төлөгдсөн, үлдэгдэл, төлөв, ID, externalRef).",
    inputSchema: {
      type: "object",
      properties: {
        documentType: {
          type: "string",
          enum: ["ar_invoice", "ap_bill", "ar_credit_note", "ap_debit_note"],
          description: "Төрлөөр шүүх (кредит нэхэмжлэл / дебит нэхэмжлэх — буцаалт)",
        },
        counterparty: { type: "string", description: "Харилцагчийн нэрээр шүүх" },
        status: {
          type: "string",
          enum: ["draft", "posted", "partially_paid", "paid", "reversed"],
          description: "Төлвөөр шүүх",
        },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        openOnly: { type: "boolean", description: "Зөвхөн үлдэгдэлтэйг" },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
      },
    },
  },
  {
    name: "delete_arap_document",
    description:
      "АР/АП нэхэмжлэх устгана. Ноорог — аль ч горимд; БАТЛАГДСАНЫГ устгах нь 'Шууд бичих' горимд — GL журнал нь хамт устна (төлөлттэй бол татгалзана: эхлээд төлөлтийн баримтыг устгана; баталгаажсан бараа хөдөлгөөнтэй бол эхлээд цуцлана). Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт) эсвэл дугаар (AR-...)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "get_counterparty_balance",
    description:
      "Харилцагчийн авлага/өглөгийн үлдэгдэл (батлагдсан нэхэмжлэхээр, asOf огноогоор). Тулгалт болон aging (0-30/31-60/61-90/90+) задаргаанд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty: { type: "string", description: "Харилцагчийн нэр — хоосон бол бүх харилцагч" },
        asOf: { type: "string", description: "YYYY-MM-DD (default өнөөдөр)" },
        aging: { type: "boolean", description: "Хугацааны задаргаатай (0-30/31-60/61-90/90+)" },
      },
    },
  },
  {
    name: "pay_arap_document",
    description:
      "Батлагдсан нэхэмжлэхийг мөнгөн хөрөнгөөр төлнө/хаана — АР бол орлого, АП бол зарлагын кассын баримт үүсч нэхэмжлэхтэй холбогдоно. Дүн өгөхгүй бол үлдэгдлээр нь бүтэн төлнө.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Нэхэмжлэхийн ID эсвэл дугаар (AR-...)" },
        cashAccount: { type: "string", description: "Кассын/банкны дансны нэр" },
        date: { type: "string", description: "Төлсөн огноо YYYY-MM-DD" },
        amount: { type: "number", description: "Төлөх дүн (default: үлдэгдэл бүтнээрээ)" },
        exchangeRate: {
          type: "number",
          description:
            "Төлбөрийн өдрийн ханш (1 валют = ? ₮) — валютын данснаас төлөхөд шаардлагатай",
        },
      },
      required: ["documentId", "cashAccount", "date"],
    },
  },
  {
    name: "settle_arap_offset",
    description:
      "Нэг харилцагчийн хоёр баримтыг мөнгө хөдөлгөлгүй хооронд нь хаана: (а) авлагын нэхэмжлэл ↔ өглөгийн нэхэмжлэх (харилцан суутган тооцоо), (б) нэхэмжлэл ↔ кредит нэхэмжлэл (кредитийн илүүдлийг дараагийн нэхэмжлэхэд тооцох), (в) өглөгийн нэхэмжлэх ↔ дебит нэхэмжлэх. GL: Дт Кт-талын баримтын хяналтын данс / Кт Дт-талынх, НӨАТ-д нөлөөгүй. Зөвхөн MNT, нээлттэй (батлагдсан/хэсэгчлэн төлсөн) баримтууд; зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        arInvoice: {
          type: "string",
          description:
            "Дт талын баримт: авлагын нэхэмжлэл (AR-...) эсвэл дебит нэхэмжлэх (DN-...) — дугаар/ID",
        },
        apBill: {
          type: "string",
          description:
            "Кт талын баримт: өглөгийн нэхэмжлэх (AP-...) эсвэл кредит нэхэмжлэл (CN-...) — дугаар/ID",
        },
        amount: {
          type: "number",
          description: "Дүн ₮ (өгөхгүй бол хоёр үлдэгдлийн бага нь)",
        },
        date: {
          type: "string",
          description: "Тооцооны актын огноо YYYY-MM-DD (default: өнөөдөр)",
        },
      },
      required: ["arInvoice", "apBill"],
    },
  },
  {
    name: "get_ecl_provision",
    description:
      "Авлагын хүлээгдэж буй зээлийн алдагдлын (IFRS 9 ECL) нөөцийн тооцоо — хялбаршуулсан арга, provision matrix (хугацаа хэтэрсэн хоногийн бүлэг × хувь): бүлэг бүрийн үлдэгдэл, шаардлагатай нөөц, GL-ийн одоогийн нөөц, бичигдэх delta, хойшлогдсон татвар (IAS 12; ААНОАТ-ын хувь тохируулаагүй бол бодогдохгүй). Зөвхөн УНШИНА — журнал үүсгэхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "Аль өдрийн байдлаар YYYY-MM-DD (хоосон бол өнөөдөр)" },
      },
    },
  },
  {
    name: "run_ecl_provision",
    description:
      "Сарын ECL нөөцийн журналыг НООРОГ болгон үүсгэнэ (Dr ECL зардал / Cr ECL нөөц эсвэл эргэлт; DTA мөртэй). Өмнөх ноорог ECL журнал солигдоно; батлах нь нягтланчийн баталгаажуулалтаар (post_journal_voucher). Аль ч горимд — ноорог л үүсгэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "Сарын сүүлийн өдөр YYYY-MM-DD" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "write_off_arap_document",
    description:
      "Авлагын нэхэмжлэлийг НАЙДВАРГҮЙ болгож хасна (IFRS 9 write-off): Dr ECL нөөц (хүрэлцэхгүй хэсэг Dr ECL зардал) / Cr авлага; нэхэмжлэл насжилтаас гарна. reason ЗААВАЛ (аудитад). Зөвхөн 'Шууд бичих' горимд, батлах хязгаар дотор. Дараа нь мөнгө орвол recover_arap_write_off.",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Авлагын нэхэмжлэл — дугаар (AR-...), externalRef эсвэл ID" },
        date: { type: "string", description: "Хасах огноо YYYY-MM-DD (хоосон бол өнөөдөр)" },
        amount: { type: "number", description: "Хасах дүн баримтын валютаар (хоосон бол нээлттэй үлдэгдэл бүхэлдээ)" },
        reason: { type: "string", description: "Шалтгаан (5+ тэмдэгт — жишээ: «Харилцагч татан буугдсан, шүүхийн шийдвэр №…»)" },
      },
      required: ["document", "reason"],
    },
  },
  {
    name: "recover_arap_write_off",
    description:
      "Хассан авлагын мөнгө орж ирэхэд СЭРГЭЭНЭ: Dr авлага / Cr ECL зардал (зардлыг бууруулна) — нэхэмжлэлийн үлдэгдэл дахин нээгдэж, дараа нь create_cash_transaction (applyTo)-оор хаана. Зөвхөн 'Шууд бичих' горимд, батлах хязгаар дотор.",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Хасагдсан нэхэмжлэл — дугаар, externalRef эсвэл ID" },
        date: { type: "string", description: "Сэргэлтийн огноо YYYY-MM-DD (хоосон бол өнөөдөр)" },
        amount: { type: "number", description: "Сэргээх дүн баримтын валютаар (хоосон бол хассан дүнгийн үлдэгдэл)" },
      },
      required: ["document"],
    },
  },
  {
    name: "create_credit_note",
    description:
      "Батлагдсан нэхэмжлэхийн БУЦААЛТ (ENT-029): авлагын нэхэмжлэлээс «Кредит нэхэмжлэл» (CN-), өглөгийн нэхэмжлэхээс «Дебит нэхэмжлэх» (DN-) үүсгэнэ — авлага/өглөг, НӨАТ, бараа (return_in/return_out) НЭГ баримтаар буурна. Мөр бүр эх мөртэйгээ; буцаах тоо/дүн эх мөрийн үлдэгдлээс хэтрэхгүй; НӨАТ автоматаар хувиар. АР-ын орлогын мөр 51900001 «Борлуулалтын хөнгөлөлт»-д бичигдэнэ. Батлахад эх нэхэмжлэхийн үлдэгдэлд автоматаар тооцогдож, илүүдэл нь харилцагчийн кредит болно (pay_arap_document-оор буцаан олгох эсвэл settle_arap_offset-оор дараагийн нэхэмжлэхтэй суутгах). Мөрийг мэдэхгүй бол эхлээд preview:true-гээр эх мөрүүд, үлдэгдлийг харна. Default ноорог; 'Шууд бичих' горимд хязгаар дотор батлагдана. POS-ийн нэхэмжлэх → return_pos_sale; PO-той нэхэмжлэх одоогоор дэмжигдэхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        sourceDocument: {
          type: "string",
          description: "Эх нэхэмжлэхийн дугаар (AR-/AP-...), externalRef эсвэл ID",
        },
        preview: {
          type: "boolean",
          description: "true бол юу ч үүсгэхгүй — эх мөрүүд (lineNo), буцаах үлдэгдлийг харуулна",
        },
        date: { type: "string", description: "Буцаалтын огноо YYYY-MM-DD (default: өнөөдөр)" },
        reason: { type: "string", description: "Буцаалтын шалтгаан (баримтын утгад)" },
        lines: {
          type: "array",
          description:
            "Хоосон бол БҮТЭН буцаалт (бүх мөрийн үлдэгдэл). Хэсэгчилсэн бол мөр бүр: lineNo (эх мөрийн дугаар, preview-ээс) + quantity (бараатай мөр) эсвэл amount. quantity 0 + amount = бараа буцаахгүй үнийн хөнгөлөлт. НӨАТ-ын мөрийг бүү оруул.",
          items: {
            type: "object",
            properties: {
              lineNo: { type: "integer" },
              quantity: { type: "number" },
              amount: { type: "number" },
            },
            required: ["lineNo"],
          },
        },
        externalRef: {
          type: "string",
          description: "Гадаад системийн давтагдашгүй дугаар — ижил ref дахин үүсгэхгүй",
        },
      },
      required: ["sourceDocument"],
    },
  },

  // ── Касс нэмэлт ───────────────────────────────────────────────────────────
  {
    name: "list_cash_documents",
    description:
      "Мөнгөн хөрөнгийн баримтуудын жагсаалт (огноо, дугаар, төрөл, дүн, төлөв, ID, externalRef).",
    inputSchema: {
      type: "object",
      properties: {
        documentType: {
          type: "string",
          enum: ["receipt", "payment", "transfer"],
          description: "Төрлөөр шүүх",
        },
        status: {
          type: "string",
          enum: ["draft", "posted", "reversed"],
          description: "Төлвөөр шүүх",
        },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        cashAccount: {
          type: "string",
          description: "Мөнгөн дансны нэрээр шүүх (шилжүүлгийн аль нэг тал)",
        },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
        offset: { type: "integer", description: "Хэдэн мөр алгасах (default 0)" },
      },
    },
  },
  {
    name: "reverse_cash_document",
    description:
      "Батлагдсан кассын баримтыг буцаана (буцаалтын журнал үүснэ). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["documentId"],
    },
  },

  // ── Бараа материал нэмэлт ─────────────────────────────────────────────────
  {
    name: "list_inventory_movements",
    description:
      "Бараа материалын хөдөлгөөнүүдийн жагсаалт (дугаар, төрөл, бараа, тоо, агуулах, төлөв) — огноо, бараа, агуулах, төрөл, төлвөөр шүүнэ (DB дээр, хуучин сар ч олдоно).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "confirmed", "cancelled"],
          description: "Төлвөөр шүүх",
        },
        movementType: {
          type: "string",
          enum: ["receipt", "issue", "transfer", "adjustment", "return_in", "return_out"],
          description: "Төрлөөр шүүх",
        },
        from: { type: "string", description: "Огнооны эхлэл YYYY-MM-DD" },
        to: { type: "string", description: "Огнооны төгсгөл YYYY-MM-DD" },
        itemCode: { type: "string", description: "Барааны код" },
        warehouseCode: { type: "string", description: "Агуулахын код (орох эсвэл гарах тал)" },
        limit: { type: "integer", description: "Max мөр (default 20, max 200)" },
      },
    },
  },
  {
    name: "confirm_inventory_movement",
    description:
      "Ноорог хөдөлгөөнийг баталгаажуулна (үлдэгдэлд нөлөөлж эхэлнэ; өртөг нь сар хаахад бодогдоно). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        movementId: { type: "string", description: "Хөдөлгөөний ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["movementId"],
    },
  },
  {
    name: "delete_inventory_movement",
    description: "Хөдөлгөөн устгана. Ноорог — аль ч горимд; БАТАЛГААЖСАНЫГ устгах нь 'Шууд бичих' горимд (үнэлэгдсэн бол эхлээд өртгийг буцаана; үлдэгдэл хасах болохоор бол татгалзана). Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        movementId: { type: "string", description: "Хөдөлгөөний ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["movementId"],
    },
  },
  {
    name: "get_stock_balances",
    description:
      "Барааны үлдэгдэл (баталгаажсан хөдөлгөөнөөр, бараа × агуулах). Шүүлтгүй бол бүх үлдэгдэл.",
    inputSchema: {
      type: "object",
      properties: {
        itemCode: { type: "string", description: "Барааны кодоор шүүх (сонголтоор)" },
        warehouseCode: { type: "string", description: "Агуулахын кодоор шүүх (сонголтоор)" },
        limit: { type: "integer", description: "Мөрийн тоо (default 100, max 500)" },
        offset: { type: "integer", description: "Хэдэн мөр алгасах (дараагийн хуудас, default 0)" },
      },
    },
  },

  // ── Үндсэн хөрөнгө нэмэлт ─────────────────────────────────────────────────
  {
    name: "list_fixed_assets",
    description: "Үндсэн хөрөнгийн картуудын жагсаалт (код, нэр, өртөг, төлөв).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "active", "disposed"],
          description: "Төлвөөр шүүх",
        },
      },
    },
  },
  {
    name: "run_fa_depreciation",
    description:
      "Тухайн сарын элэгдлийг бүх идэвхтэй хөрөнгөд бодож НООРОГ бичилтүүд үүсгэнэ (аль хэдийн бодогдсон хөрөнгө алгасагдана).",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },
  {
    name: "post_fa_depreciation",
    description:
      "Тухайн сарын НООРОГ элэгдлийн бичилтүүдийг бүгдийг нь баталж GL-д бичнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },

  // ── Период ────────────────────────────────────────────────────────────────
  {
    name: "list_periods",
    description:
      "Тайлант үеүүдийн жагсаалт (сар, төлөв, бичилтийн тоо). Бүртгэгдээгүй сар = нээлттэй.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sync_standard_accounts",
    description:
      "Стандарт дансны төлөвлөгөөг (STANDARD_ACCOUNTS — зөрүүний 44000098, ҮХ, валют, POS, цалин, НӨАТ …) дутууг нь нэмнэ — байгаа дансыг ХӨНДӨХГҮЙ, идемпотент. Шинэ байгууллага цөөн дансаар үүсдэг тул нэвтрүүлэлтийн ЭХНИЙ алхам. Эрх: admin+. Аль ч горимд (журнал үүсгэхгүй).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_segment_values",
    description:
      "Сегментийн утгуудын жагсаалт (код · нэр · идэвхтэй эсэх). segment=8 — мөнгөн гүйлгээний ангилал (кассын баримтын cashFlowCode); 2 салбар, 4 хэлтэс, 5 төсөл … Унших, аль ч горимд.",
    inputSchema: {
      type: "object",
      properties: {
        segment: { type: "number", description: "Сегментийн дугаар 1–10 (S3 = данс — list_gl_accounts)" },
        includeDisabled: { type: "boolean", description: "Идэвхгүйг ч харуулах (default false)" },
      },
      required: ["segment"],
    },
  },
  {
    name: "close_period",
    description:
      "Сарыг хаана — хаагдсан тайлант үе рүү бичилт хийгдэхгүй болно. Ноорог бичилт үлдсэн бол татгалзана. Зөвхөн 'Шууд бичих' горимд; хаахын өмнө элэгдэл, өртөг тооцоо хийгдсэн эсэхийг хэрэглэгчээс лавлана.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["code"],
    },
  },
  {
    name: "reopen_period",
    description: "Хаагдсан сарыг дахин нээнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["code"],
    },
  },
  {
    name: "create_employee",
    description:
      "Цалингийн модульд ажилтан бүртгэнэ — нэр/цалингаас гадна овог, регистр, банк, IBAN, ажилд орсон огноо зэрэг дэлгэрэнгүй талбартай. РД (өгвөл) байгууллага дотор давхцахгүй. Мастер дата тул аль ч горимд.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Ажилтны нэр" },
        position: { type: "string", description: "Албан тушаал" },
        baseSalary: { type: "number", description: "Сарын үндсэн цалин ₮" },
        employerSiPercent: {
          type: "number",
          description:
            "АО-НДШ % — ажил олгогчийн нийт НДШ, ҮОМШӨ багтсан (оффис 12.5, барилга 13.2, уул уурхай 14.2-14.7; default 12.5)",
        },
        lastName: { type: "string", description: "Овог (сонголтоор)" },
        registerNo: { type: "string", description: "Регистрийн дугаар — байгууллага дотор давхцахгүй (сонголтоор)" },
        department: { type: "string", description: "Хэлтэс (сонголтоор)" },
        employmentType: { type: "string", enum: ["primary", "contract", "hourly"], description: "Ажил эрхлэлт: primary=Үндсэн, contract=Гэрээт, hourly=Цагийн (сонголтоор)" },
        hireDate: { type: "string", description: "Ажилд орсон огноо YYYY-MM-DD (сонголтоор)" },
        birthDate: { type: "string", description: "Төрсөн огноо YYYY-MM-DD (сонголтоор)" },
        phone: { type: "string", description: "Утас (сонголтоор)" },
        email: { type: "string", description: "И-мэйл (сонголтоор)" },
        homeAddress: { type: "string", description: "Гэрийн хаяг (сонголтоор)" },
        bankName: { type: "string", description: "Банк (сонголтоор)" },
        bankAccountNo: { type: "string", description: "Дансны дугаар (сонголтоор)" },
        iban: { type: "string", description: "IBAN (сонголтоор)" },
      },
      required: ["name", "baseSalary"],
    },
  },
  {
    name: "run_payroll",
    description:
      "Сарын цалингийн бодолт: идэвхтэй ажилтан бүрд НДШ (cap-тай), ХАОАТ (шатлал+хөнгөлөлт), гарт олгохыг бодож НООРОГ мөрүүд үүсгэнэ/шинэчилнэ. GL журнал үүсгэхгүй — түүнийг create_payroll_voucher хийнэ.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "get_payroll_summary",
    description:
      "Сарын цалингийн бодолтын нэгтгэл: ажилтан бүрийн олголт/НДШ/ХАОАТ/гарт олгох + нийт дүн, GL журналын төлөв.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "create_payroll_voucher",
    description:
      "Сарын цалингийн GL НООРОГ журнал үүсгэнэ (Dr цалингийн зардал + АО НДШ / Cr НДШ, ХАОАТ, цалингийн өглөг). Сард нэг л удаа — давхар дуудвал байгааг нь буцаана. Нягтланч GL-ээс шалгаж батална.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "get_month_end_checklist",
    description:
      "Сар хаалтын шалгах хуудас: элэгдэл, FX тэгшитгэл, өртөг тооцоо, цалин, НӨАТ тооцоо, ХАНГАМЖ (хүлээн авалттай нээлттэй захиалга сар хаалтыг хориглоно), үлдсэн ноорог, периодын төлөв — алхам бүрийн статустай. Сар хаахын өмнө юу дутууг харахад ашиглана (вэб: Системийн хяналт → Сар хаалт).",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "list_notifications",
    description:
      "Хэрэглэгчийн мэдэгдлийн inbox — татварын хугацаа, хуучирсан ноорог, хэтэрсэн авлага/өглөг, хамт олны батлалт/буцаалт, сар хаалт, лиценз. Хэрэглэгч 'юу анхаарах вэ', 'мэдэгдэл', 'сануулга' гэвэл үүгээр (вэб: топбарын хонх, /notifications).",
    inputSchema: {
      type: "object",
      properties: {
        unreadOnly: { type: "boolean", description: "Зөвхөн уншаагүй (default true)" },
        limit: { type: "number", description: "Дээд тал нь (default 20, max 100)" },
      },
    },
  },
  {
    name: "mark_notifications_read",
    description:
      "Мэдэгдлийг уншсан гэж тэмдэглэнэ — ids өгвөл тэдгээрийг, all=true бол бүгдийг. Журнал үүсгэхгүй, аль ч горимд.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Мэдэгдлийн ID (бүтэн эсвэл 6+ тэмдэгтийн угтвар)" },
        all: { type: "boolean", description: "Бүх уншаагүйг тэмдэглэх" },
      },
    },
  },
  {
    name: "get_vat_return",
    description:
      "Сарын НӨАТ тайлан: гаралтын НӨАТ (борлуулалт), оролтын НӨАТ (худалдан авалт), төлөх/буцаан авах дүн, тайлангийн эцсийн хугацаа (дараа сарын 10). GL-ийн НӨАТ дансдын эргэлтээс тооцно.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "create_vat_settlement",
    description:
      "Сарын НӨАТ тооцооны НООРОГ журнал үүсгэнэ (Дт гаралтын НӨАТ / Кт оролтын НӨАТ / Кт банк). Нэг сард нэг л тооцоо — давхар дуудвал байгааг нь буцаана. Төлөх дүнтэй үед cashAccount заавал.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Тайлант үе YYYY-MM" },
        cashAccount: {
          type: "string",
          description: "Төлбөр гарах банкны дансны нэр (төлөх дүнтэй үед заавал)",
        },
      },
      required: ["period"],
    },
  },

  {
    name: "fix_cash_opening_balance",
    description:
      "Кассын дансны НЭЭЛТИЙН үлдэгдлийг GL-д бичих ноорог журнал үүсгэнэ (Дт данс / Кт эздийн өмч; сөрөгт эсрэгээр). reconcile_modules-д кассын зөрүү нь нээлтийн үлдэгдэлтэй тэнцүү гарсан үед ашиглана — журнал батлагдмагц зөрүү арилна. Журнал дансны НЭЭЛТИЙН ОГНООГООР (өнөөдрөөр биш) бичигдэнэ; валютын данс FC × нээлтийн огнооны ханшаар (валютын дүн хадгалагдана).",
    inputSchema: {
      type: "object",
      properties: {
        cashAccount: { type: "string", description: "Кассын/банкны дансны нэр" },
        counterAccount: {
          type: "string",
          description: "Харьцах данс (default: 41000001 эздийн өмч)",
        },
        date: {
          type: "string",
          description:
            "Нээлтийн огноо YYYY-MM-DD — дансанд нээлтийн огноо хадгалагдаагүй үед ЗААВАЛ",
        },
        exchangeRate: {
          type: "number",
          description:
            "Валютын дансны нээлтийн ханш (сонголтоор — хоосон бол дансны нээлтийн ханш, түүнгүй бол албан ханш)",
        },
      },
      required: ["cashAccount"],
    },
  },

  // ── Тулгалт ба ажлын урсгал ───────────────────────────────────────────────
  {
    name: "reconcile_modules",
    description:
      "Модуль хоорондын тулгалт — дэд дэвтэр бүрийг GL-тэй тулгаж зөрүүг илрүүлнэ: касс/банкны данс, авлага/өглөгийн хяналтын данс, бараа материалын үнэлгээ, клирингийн данс. Зөрүү олдвол магадлалт шалтгаан, засах алхмыг зааж өгнө. Сар хаахын ӨМНӨ заавал ажиллуулна.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Мужийн эхлэл YYYY-MM-DD (клиринг/бараанд)" },
        to: { type: "string", description: "Тулгах огноо YYYY-MM-DD (үлдэгдэл энэ өдрөөр)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_workflow_guide",
    description:
      "Даалгаврыг модулиудын ЗӨВ ДАРААЛЛААР хийх заавар — аль tool-ыг ямар дэс дараатай дуудахыг алхам алхмаар өгнө. Олон модуль дамнасан ажил эхлэхийн өмнө үүнийг уншина.",
    inputSchema: {
      type: "object",
      properties: {
        workflow: {
          type: "string",
          enum: [
            "purchase_inventory",
            "purchase_order",
            "sale",
            "payment",
            "month_end_close",
            "fix_discrepancy",
            "new_company_setup",
            "fixed_asset_lifecycle",
            "pos_sale",
          ],
          description:
            "purchase_inventory=бараатай худалдан авалт (PO-гүй жижиг), purchase_order=захиалгатай худалдан авалт (импорт, нэмэлт зардал, PO хаалт), sale=B2B борлуулалт (АР нэхэмжлэх), pos_sale=жижиглэн худалдаа (POS: ээлж → борлуулалт → буцаалт → ээлж хаалт), payment=нэхэмжлэх төлөх, month_end_close=сар хаалт, fix_discrepancy=зөрүү засах, new_company_setup=шинэ компанийн тохиргоо, fixed_asset_lifecycle=ҮХ-ийн амьдралын мөчлөг",
        },
      },
      required: ["workflow"],
    },
  },

  {
    name: "get_onboarding_guide",
    description:
      "АНХ ХОЛБОГДСОН эсвэл нэвтрүүлэлт хийж буй хэрэглэгчид: системийн танилцуулга, AI-ийн ажиллах хязгаар, ЭНЭ байгууллагын нэвтрүүлэлтийн шат (0 судалгаа … 5 хүлээлгэн өгсөн) + дараагийн алхмууд. section=checklist — бэлдэх материалын шалгах жагсаалт; rules — зөрүү шийдвэрлэх дүрэм R0–R9 (хураангуй бүртгэл, нээлтийн зөрүүний данс, залруулгын журнал); phases — шатууд ба 'дууссан' шалгуур; status — зөвхөн төлөв. Нэвтрүүлэлтийн ямар ч ажил эхлэхийн ӨМНӨ overview-г унш.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["overview", "checklist", "rules", "phases", "status"],
          description:
            "overview (default) = танилцуулга + хязгаар + төлөв + дараагийн алхам; checklist = §2 материал; rules = §3 зөрүүний дүрэм; phases = §4 шатууд; status = зөвхөн байгууллагын төлөв",
        },
      },
    },
  },

  // ── Өртөг ─────────────────────────────────────────────────────────────────
  {
    name: "run_monthly_costing",
    description:
      "Сарын өртөг тооцно — зарлага/тохируулгыг сарын жигнэсэн дундажаар үнэлж НООРОГ өртгийн бичилтүүд үүсгэнэ/шинэчилнэ. Блоклогдсон бараа байвал шалтгаантай нь буцаана.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "post_cost_entries",
    description:
      "Тухайн сарын НООРОГ өртгийн бичилтүүдийг бүгдийг нь баталж GL-д бичнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },
  {
    name: "list_cost_entries",
    description:
      "Өртгийн бичилтүүдийн жагсаалт (бараа, хөдөлгөөн, төрөл, нэгж өртөг, дүн, төлөв). reverse_cost_entry / delete_cost_entry-д шаардлагатай ID-г эндээс олно; хөдөлгөөн устгах гэхэд «үнэлэгдсэн байна» гэвэл тэр хөдөлгөөний бичилтийг энд хайна.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM (сонголтоор)" },
        from: { type: "string", description: "Огнооноос YYYY-MM-DD (сонголтоор)" },
        to: { type: "string", description: "Огноо хүртэл YYYY-MM-DD (сонголтоор)" },
        itemCode: { type: "string", description: "Барааны кодоор шүүх (сонголтоор)" },
        status: {
          type: "string",
          enum: ["draft", "posted", "reversed"],
          description: "Төлвөөр шүүх (сонголтоор)",
        },
        entryType: { type: "string", description: "Төрлөөр шүүх: receipt_capitalize | issue_cogs | landed_cost | adjustment_gain | adjustment_loss | nrv_writedown | nrv_reversal | return_in | return_out | cogs_true_up (сонголтоор)" },
        limit: { type: "number", description: "Мөрийн тоо (default 20, max 200)" },
        offset: { type: "number", description: "Хэдэн мөр алгасах (дараагийн хуудас, default 0)" },
      },
    },
  },
  {
    name: "reverse_cost_entry",
    description:
      "БАТЛАГДСАН өртгийн бичилтийг буцаана — GL журнал эсрэг бичилтээр буцаж, бичилт 'reversed' болно (дараагийн run_monthly_costing уг хөдөлгөөнийг дахин үнэлж болно). Хүлээн авалтын капитализаци (Хангамж → Хүлээн авалт) ба POS-ийн урьдчилсан COGS (Борлуулалт → Буцаалт) энэ замаар буцахгүй. Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд.",
    inputSchema: {
      type: "object",
      properties: {
        entryId: { type: "string", description: "Өртгийн бичилтийн ID (бүтэн эсвэл эхний 8+ тэмдэгт) — list_cost_entries-ээс" },
      },
      required: ["entryId"],
    },
  },
  {
    name: "delete_cost_entry",
    description:
      "НООРОГ өртгийн бичилтийг устгана (батлагдсаныг ЭХЛЭЭД reverse_cost_entry-ээр буцаана). Тухайн барааны хожмын бичилт байвал татгалзана — сүүлийнхээс нь эхэлнэ.",
    inputSchema: {
      type: "object",
      properties: {
        entryId: { type: "string", description: "Өртгийн бичилтийн ID (бүтэн эсвэл эхний 8+ тэмдэгт) — list_cost_entries-ээс" },
      },
      required: ["entryId"],
    },
  },

  // ── Batch (бөөн оруулалт) ─────────────────────────────────────────────────
  {
    name: "create_counterparties_batch",
    description:
      "Олон харилцагчийг нэг дуудлагаар бүртгэнэ (max 100). Partial success: мөр бүрийн үр дүн тусдаа буцна — давхардсан нь алгасагдаж, алдаатай нь бусдад нөлөөлөхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_counterparty-ийн input-уудын жагсаалт",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              counterpartyType: { type: "string", enum: ["customer", "supplier", "both"] },
              entityKind: { type: "string", description: "Төрөл — organization (default) / individual / байгууллагын нэмсэн төрлийн код эсвэл нэр" },
              code: { type: "string", description: "Харилцагчийн код (давтагдашгүй, сонголтоор)" },
              registerNo: { type: "string" },
              defaultReceivableAccount: { type: "string" },
              defaultPayableAccount: { type: "string" },
              currency: { type: "string" },
              paymentTermsDays: { type: "integer" },
            },
            required: ["name", "counterpartyType"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_gl_accounts_batch",
    description:
      "Олон GL данс нэг дуудлагаар нээнэ (max 100) — анхны нэвтрүүлэлтийн дансны мод импорт. Partial success: байгаа данс алгасагдаж, алдаатай мөр бусдад нөлөөлөхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_gl_account-ийн input-уудын жагсаалт",
          items: {
            type: "object",
            properties: {
              number: { type: "string", description: "8 оронтой дансны дугаар" },
              name: { type: "string", description: "Дансны нэр" },
            },
            required: ["number", "name"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_inventory_items_batch",
    description:
      "Олон бараа нэг дуудлагаар бүртгэнэ (max 100) — анхны бараа материалын лавлах импорт. Partial success: давхардсан код алгасагдана.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description:
            "create_inventory_item-ийн input-уудын жагсаалт (POS талбарууд: salesPrice, minSalesPrice, barcode, vatMode, categoryCode, revenueAccountNumber сонголтоор)",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              name: { type: "string" },
              unit: { type: "string", description: "Хэмжих нэгж (default ш)" },
              salesPrice: { type: "number", description: "Борлуулах үнэ ₮ (сонголтоор)" },
              minSalesPrice: { type: "number", description: "Доод үнэ ₮ (сонголтоор)" },
              barcode: { type: "string", description: "Баркод (сонголтоор)" },
              vatMode: {
                type: "string",
                enum: ["standard", "exempt", "zero"],
                description: "НӨАТ-ийн горим (сонголтоор, default standard)",
              },
              categoryCode: { type: "string", description: "Бүлгийн код (сонголтоор)" },
              revenueAccountNumber: { type: "string", description: "Орлогын данс, 8 оронтой (сонголтоор)" },
            },
            required: ["code", "name"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_employees_batch",
    description:
      "Олон ажилтныг нэг дуудлагаар цалингийн модульд бүртгэнэ (max 100). Partial success — мөр бүрийн үр дүн тусдаа.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description:
            "create_employee-ийн input-уудын жагсаалт (бүх дэлгэрэнгүй талбар дэмжигдэнэ: lastName, registerNo, bankName, iban, hireDate г.м.)",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              lastName: { type: "string" },
              registerNo: { type: "string" },
              position: { type: "string" },
              department: { type: "string" },
              hireDate: { type: "string" },
              bankName: { type: "string" },
              bankAccountNo: { type: "string" },
              iban: { type: "string" },
              phone: { type: "string" },
              baseSalary: { type: "number", description: "Сарын үндсэн цалин ₮" },
              employerSiPercent: { type: "number", description: "АО-НДШ % (default 12.5)" },
              // SIM2-003: create_employee-тэй ИЖИЛ (batch-д зарлагдаагүй байв).
              employmentType: {
                type: "string",
                enum: ["primary", "contract", "hourly"],
                description: "Ажил эрхлэлт: primary=Үндсэн, contract=Гэрээт, hourly=Цагийн",
              },
              terminationDate: { type: "string", description: "Ажлаас гарсан огноо YYYY-MM-DD (сонголтоор)" },
            },
            required: ["name", "baseSalary"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_fixed_assets_batch",
    description:
      "Олон үндсэн хөрөнгийн картыг нэг дуудлагаар үүсгэнэ (max 100) — анхны ҮХ бүртгэлийн импорт. Ноорог-first: хэрэглэгч шалгаад идэвхжүүлнэ ('Шууд бичих' горимд идэвхтэй үүснэ). Partial success.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_fixed_asset-ийн input-уудын жагсаалт (ижил талбарууд)",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_arap_invoices_batch",
    description:
      "Олон АР/АП нэхэмжлэхийг нэг дуудлагаар үүсгэнэ (max 100). Partial success + externalRef idempotency: давхардсан нь алгасагдана, алдаатай мөрийг л дахин явуулна.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_arap_invoice-ийн input-уудын жагсаалт",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_cash_transactions_batch",
    description:
      "Олон мөнгөн хөрөнгийн гүйлгээг нэг дуудлагаар үүсгэнэ (max 100). Partial success + externalRef idempotency; applyTo дэмжинэ.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_cash_transaction-ийн input-уудын жагсаалт",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "post_arap_documents_batch",
    description:
      "Олон ноорог АР/АП нэхэмжлэхийг бөөнөөр батална. Зөвхөн 'Шууд бичих' горимд; 10 сая ₮-с их дүнтэй нь алгасагдаж, вэб дээрээс батлах жагсаалт болж буцна.",
    inputSchema: {
      type: "object",
      properties: {
        documentIds: {
          type: "array",
          description: "Баримтын ID эсвэл дугаарууд (max 100)",
          items: { type: "string" },
        },
      },
      required: ["documentIds"],
    },
  },
  {
    name: "post_cash_documents_batch",
    description:
      "Олон ноорог кассын баримтыг бөөнөөр батална. Зөвхөн 'Шууд бичих' горимд; 10 сая ₮-с их дүнтэй нь алгасагдаж, вэб дээрээс батлах жагсаалт болж буцна.",
    inputSchema: {
      type: "object",
      properties: {
        documentIds: {
          type: "array",
          description: "Баримтын ID-ууд (max 100)",
          items: { type: "string" },
        },
      },
      required: ["documentIds"],
    },
  },
  {
    name: "post_journal_vouchers_batch",
    description:
      "Олон ноорог журналыг бөөнөөр батална. Зөвхөн 'Шууд бичих' горимд; 10 сая ₮-с их дүнтэй нь алгасагдаж, вэб дээрээс батлах жагсаалт болж буцна.",
    inputSchema: {
      type: "object",
      properties: {
        voucherIds: {
          type: "array",
          description: "Журналын ID-ууд (max 100)",
          items: { type: "string" },
        },
      },
      required: ["voucherIds"],
    },
  },
  {
    name: "create_journal_vouchers_batch",
    description:
      "Олон журналын бичилтийг нэг дуудлагаар үүсгэнэ (max 100). Partial success + externalRef idempotency — түүхэн дата импортод.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_journal_voucher-ийн input-уудын жагсаалт",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },

  // ── Валютын тэгшитгэл (сар хаалтын 2-р алхам) ─────────────────────────────
  {
    name: "run_fx_revaluation",
    description:
      "Валютын кассын/банкны дансдад ханшийн тэгшитгэл хийж GL журнал бичнэ (сар хаалтын 2-р алхам). Ханш өгөхгүй бол тэгшитгэлийн огнооны Монголбанкны албан ханшийг ХАДГАЛСАН түүхээс, байхгүй бол Монголбанкнаас татаж хэрэглэнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        valuationDate: { type: "string", description: "Тэгшитгэлийн огноо YYYY-MM-DD (сарын эцэс)" },
        cashAccount: {
          type: "string",
          description: "Дансны нэр — хоосон бол БҮХ валютын идэвхтэй данс",
        },
        rate: {
          type: "number",
          description:
            "Гар ханш (өгвөл cashAccount заавал; өгөхгүй бол хадгалсан/Монголбанкны албан ханш хэрэглэгдэнэ)",
        },
        manualReason: { type: "string", description: "Гар ханш ашигласан шалтгаан" },
        gainAccount: { type: "string", description: "Ханшийн олзын данс (default 51800001)" },
        lossAccount: { type: "string", description: "Ханшийн гарзын данс (default 87000003)" },
        replaceExisting: {
          type: "boolean",
          description: "Тухайн өдрийн өмнөх тэгшитгэлийг буцааж шинээр хийх",
        },
      },
      required: ["valuationDate"],
    },
  },
  {
    name: "reverse_fx_revaluation",
    description: "Ханшийн тэгшитгэлийг буцаана (буцаалтын журнал үүснэ). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        cashAccount: { type: "string", description: "Дансны нэр" },
        valuationDate: { type: "string", description: "Тэгшитгэлийн огноо YYYY-MM-DD" },
      },
      required: ["cashAccount", "valuationDate"],
    },
  },

  // ── Валютын ханшийн түүх (НИЙТИЙН лавлах — GL бичилт үүсгэхгүй) ───────────
  {
    name: "sync_exchange_rates",
    description:
      "Монголбанкны ТҮҮХЭН албан ханшийг [from, to] мужаар татаж хадгална. Эхний үлдэгдэл, өмнөх хугацааны бичилт, ханшийн тэгшитгэлд ӨМНӨХ ҮЕИЙН ханш хэрэгтэй болоход эхлээд үүнийг дуудна — дараа нь ханшийн уншилт хадгалсан түүхээс шууд явна. Лавлах дата тул журнал/GL бичилт үүсгэхгүй, аль ч горимд ажиллана. Муж 2015-01-01-ээс хойш, дээд тал нь 5 жил; дахин дуудахад давхардахгүй (upsert).",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Эхлэх огноо YYYY-MM-DD (2015-01-01-ээс хойш)",
        },
        to: {
          type: "string",
          description: "Дуусах огноо YYYY-MM-DD (ирээдүйд байж болохгүй)",
        },
        currencies: {
          type: "array",
          description:
            "Валютын кодууд (жишээ нь [\"USD\",\"EUR\"]) — хоосон бол Монголбанкны нийтэлсэн БҮХ валют",
          items: { type: "string" },
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_exchange_rate",
    description:
      "Тухайн огнооны Монголбанкны албан ханшийг буцаана — эхлээд хадгалсан түүхээс, байхгүй бол Монголбанкнаас татаад хадгална. Ханш олдохгүй бол АЛДАА буцна: ханшийг ХЭЗЭЭ Ч зохиохгүй, хэрэглэгчээс гар ханш асууна.",
    inputSchema: {
      type: "object",
      properties: {
        currency: { type: "string", description: "Валютын код (USD, EUR, CNY ...)" },
        date: { type: "string", description: "Ханшийн огноо YYYY-MM-DD" },
      },
      required: ["currency", "date"],
    },
  },

  // ── Үндсэн хөрөнгийн хасалт ───────────────────────────────────────────────
  {
    name: "dispose_fixed_asset",
    description:
      "Идэвхтэй үндсэн хөрөнгийг данснаас хасна (акталах/борлуулах/хандивлах) — үлдэгдэл өртөг, олз гарзын GL журнал бичигдэнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        assetCode: { type: "string", description: "Хөрөнгийн код эсвэл нэр" },
        disposalType: {
          type: "string",
          enum: ["scrap", "sale", "donation"],
          description: "scrap=акталах, sale=борлуулах, donation=хандивлах",
        },
        date: { type: "string", description: "Хасалтын огноо YYYY-MM-DD" },
        proceeds: { type: "number", description: "Борлуулсан үнэ (зөвхөн sale-д)" },
        proceedsAccount: {
          type: "string",
          description: "Орлого хүлээн авах данс — мөнгө/авлага (зөвхөн sale-д)",
        },
        gainLossAccount: { type: "string", description: "Олз (гарз)-ын данс (8 оронтой)" },
      },
      required: ["assetCode", "disposalType", "date", "gainLossAccount"],
    },
  },

  // ── Ажилтан (цалингийн мастер дата) ──────────────────────────────────────
  {
    name: "list_employees",
    description: "Ажилтнуудын жагсаалт (нэр, албан тушаал, үндсэн цалин, АО-НДШ хувь, идэвх).",
    inputSchema: {
      type: "object",
      properties: {
        includeInactive: { type: "boolean", description: "Идэвхгүйг ч оруулах (default false)" },
      },
    },
  },
  {
    name: "update_employee",
    description: "Ажилтны мэдээлэл засна (нэрээр олно) — зөвхөн өгсөн талбарууд өөрчлөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        employee: { type: "string", description: "Одоогийн нэр (олоход ашиглана)" },
        newName: { type: "string", description: "Шинэ нэр (сонголтоор)" },
        position: { type: "string", description: "Албан тушаал (сонголтоор)" },
        baseSalary: { type: "number", description: "Үндсэн цалин ₮ (сонголтоор)" },
        employerSiPercent: { type: "number", description: "АО-НДШ хувь 0-20 (сонголтоор)" },
        terminationDate: { type: "string", description: "Гарсан огноо YYYY-MM-DD (сонголтоор)" },
        lastName: { type: "string", description: "Овог (сонголтоор)" },
        registerNo: { type: "string", description: "Регистрийн дугаар — байгууллага дотор давхцахгүй (сонголтоор)" },
        department: { type: "string", description: "Хэлтэс (сонголтоор)" },
        employmentType: { type: "string", enum: ["primary", "contract", "hourly"], description: "Ажил эрхлэлт: primary=Үндсэн, contract=Гэрээт, hourly=Цагийн (сонголтоор)" },
        hireDate: { type: "string", description: "Ажилд орсон огноо YYYY-MM-DD (сонголтоор)" },
        birthDate: { type: "string", description: "Төрсөн огноо YYYY-MM-DD (сонголтоор)" },
        phone: { type: "string", description: "Утас (сонголтоор)" },
        email: { type: "string", description: "И-мэйл (сонголтоор)" },
        homeAddress: { type: "string", description: "Гэрийн хаяг (сонголтоор)" },
        bankName: { type: "string", description: "Банк (сонголтоор)" },
        bankAccountNo: { type: "string", description: "Дансны дугаар (сонголтоор)" },
        iban: { type: "string", description: "IBAN (сонголтоор)" },
        isActive: { type: "boolean", description: "Идэвхтэй эсэх (сонголтоор)" },
      },
      required: ["employee"],
    },
  },

  // ── Компани (байгууллага) ─────────────────────────────────────────────────
  {
    name: "list_companies",
    description:
      "Энэ түлхүүрийн эзэн хандах эрхтэй компаниуд (id, нэр, регистр, эрх/role). Идэвхтэй компани тэмдэглэгдэнэ. Нэг хэрэглэгч олон компанид гишүүн байж болно.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_active_company",
    description: "Энэ түлхүүр одоо ажиллаж буй компани (id, нэр, регистр, таны эрх).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_company",
    description:
      "ШИНЭ компани (байгууллага) үүсгэнэ — түлхүүрийн эзэн owner болно, стандарт дансны мод автоматаар суулгагдана. Идэвхтэй компанийг СОЛИХГҮЙ (энэ түлхүүр өөрийн компанидаа хэвээр ажиллана); шинэ компанид бичихийн тулд түүнд тусдаа түлхүүр гаргах эсвэл вэбээс сэлгэнэ. Валют/санхүүгийн жил нь системд хуанлийн сар + гүйлгээний валютаар тодорхойлогддог тул параметр байхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Компанийн нэр" },
        registerNo: { type: "string", description: "Регистр / ТТД (сонголтоор)" },
        vatPayerNo: { type: "string", description: "НӨАТ төлөгчийн дугаар (сонголтоор)" },
        address: { type: "string", description: "Хаяг (сонголтоор)" },
        phone: { type: "string", description: "Утас (сонголтоор)" },
        email: { type: "string", description: "И-мэйл (сонголтоор)" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_company",
    description:
      "Компани (байгууллага)-г БУЦАЛТГҮЙ устгана — журнал, баримт, тохиргоо, аудит зэрэг БҮХ дата cascade-аар устана. Зөвхөн тухайн компанийн OWNER; companyId ба компанийн нэрийг ЯГ давхар бичиж баталгаажуулна; зөвхөн 'Шууд бичих' (post) горимд. Сэргээх боломжгүй тул болгоомжтой.",
    inputSchema: {
      type: "object",
      properties: {
        companyId: { type: "string", description: "Устгах компанийн бүтэн id (list_companies-ээс)" },
        confirmName: {
          type: "string",
          description: "Компанийн нэрийг ЯГ бичиж баталгаажуулна (буруу бол устгахгүй)",
        },
      },
      required: ["companyId", "confirmName"],
    },
  },

  // ── Компанийн мэдээлэл ────────────────────────────────────────────────────
  {
    name: "get_company_settings",
    description:
      "Компанийн мэдээлэл (нэр, регистр, НӨАТ дугаар, хаяг, утас, и-мэйл, банкны данс) — нэхэмжлэхийн толгойд ордог.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_company_settings",
    description:
      "Компанийн мэдээлэл засна — зөвхөн өгсөн талбарууд өөрчлөгдөнө (лого/тамга/гарын үсэг вэбээс). Нэхэмжлэх и-мэйлээр илгээхэд компанийн нэр заавал байх ёстой.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Компанийн нэр" },
        registerNo: { type: "string", description: "Регистрийн дугаар" },
        vatPayerNo: { type: "string", description: "НӨАТ төлөгчийн дугаар" },
        address: { type: "string", description: "Хаяг" },
        phone: { type: "string", description: "Утас" },
        email: { type: "string", description: "И-мэйл" },
        bankAccounts: {
          type: "array",
          description: "Банкны данснууд — өгвөл жагсаалт БҮХЛЭЭРЭЭ солигдоно",
          items: {
            type: "object",
            properties: {
              bankName: { type: "string" },
              accountNo: { type: "string" },
              accountName: { type: "string" },
              bankCode: { type: "string", description: "Банкны 6 оронтой код (ж: 050000 Хаан) — QPay мерчантын дансанд" },
              iban: { type: "string" },
              isDefault: { type: "boolean", description: "QPay төлбөр орох үндсэн данс (нэг л мөр)" },
            },
            required: ["bankName", "accountNo", "accountName"],
          },
        },
        invoiceFromEmail: {
          type: "string",
          description:
            "Нэхэмжлэх илгээгч и-мэйл (verify хийгдсэн домэйн) — хоосон string өгвөл цэвэрлэнэ",
        },
        invoiceReplyTo: {
          type: "string",
          description: "Хариу очих (reply-to) хаяг — хоосон string өгвөл цэвэрлэнэ",
        },
        emailDomainVerified: {
          type: "boolean",
          description:
            "Илгээгч домэйн Resend дээр verify хийгдсэн эсэх — false үед tenant хаягаар илгээхгүй",
        },
        largeAmountAlertMnt: {
          type: "number",
          description:
            "«Том дүн» мэдэгдлийн босго (₮) — үүнээс их баримт батлагдахад эзэн/админд мэдэгдэнэ. 0 өгвөл default (10 сая ₮)",
        },
        aiPostLimitMnt: {
          type: "number",
          description:
            "AI/MCP/REST-ийн ШУУД БАТЛАХ дээд хязгаар (₮) — «Шууд бичих» горимд ч үүнээс их бичилт ноорог үлдэнэ. 0 өгвөл default " +
            `(${DEFAULT_AI_POST_LIMIT_MNT.toLocaleString("en-US")} ₮). Бууруулах чөлөөтэй; өсгөх нь ` +
            `${AI_POST_LIMIT_TOOL_MAX_MNT.toLocaleString("en-US")} ₮ хүртэл таазтай — түүнээс дээш ` +
            "[HUMAN_REQUIRED]: вэбийн Тохиргоо → Компанийн мэдээлэл хуудсаас админ хүн тавина",
        },
        controlAccountGuard: {
          type: "string",
          enum: ["warn", "block"],
          description:
            "АР/АП-ийн хяналтын дансанд гар журнал: warn (анхааруулна) | block (хориглоно). Энэ tool-оор ЗӨВХӨН чангатгана (block) — сулруулах [HUMAN_REQUIRED], вэбээс админ",
        },
      },
    },
  },

  // ── Багц, төлбөр (billing / entitlement) ─────────────────────────────────
  {
    name: "get_billing_overview",
    description:
      "Идэвхтэй байгууллагын багц (trial/standard/platform/enterprise), статус, бичих эрх нээлттэй эсэх ба шалтгаан, суудал (ашигласан/хязгаар), боломжууд (eBarimt, AI, MCP, REST API, олон компани, custom/), trial/grace-ийн үлдсэн хоног. ЗӨВХӨН УНШИНА — багц засах нь апп дотор байхгүй (Entry Console-оос). Хэрэглэгч [SUBSCRIPTION_READ_ONLY] / [FEATURE_NOT_IN_PLAN] / [SEAT_LIMIT] алдаа авсан, «яагаад бичиж чадахгүй», «багц маань юу вэ» гэвэл ЭХЛЭЭД үүгээр шалгана.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Мэдлэгийн сан (docs/knowledge/00-proposal.md) — зөвхөн чат + MCP ─────
  {
    name: "list_knowledge_topics",
    description:
      "Entry-ийн мэргэжлийн мэдлэгийн сангийн СЭДВИЙН ЖАГСААЛТ — IFRS/НББОУС стандартууд (IAS 1…IFRS 16), Монголын татварын хууль (НӨАТ, ААНОАТ, ХАОАТ, суутган…), цалин/НДШ, ажлын урсгал, хамгаалалтын дүрэм, стандарт↔модулийн уялдаа. Зөвхөн гарчиг + хэсгийн нэрс буцаана (агуулга биш). Нягтлан бодох, IFRS, татварын онолын асуултад ЭХЛЭЭД үүгээр сэдвээ олоод read_knowledge_section-оор уншина. Багцад ороогүй бол [FEATURE_NOT_IN_PLAN].",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["ifrs", "tax", "mapping", "payroll", "workflow", "guardrail", "practice", "skill"],
          description: "Ангиллаар шүүх (сонголтоор)",
        },
      },
    },
    surfaces: ["mcp"],
  },
  {
    name: "read_knowledge_section",
    description:
      "Мэдлэгийн сангийн НЭГ хэсгийг уншина — эх сурвалжийн ишлэлтэй (ж: «IAS 16 / НББОУС 16»). topic = list_knowledge_topics-ийн slug (ifrs/ias-16, tax/vat, workflow/vat-return…), section = тэр сэдвийн хэсгийн нэр (өгөөгүй бол overview). Хариултдаа ишлэлээ ЗААВАЛ дурд; IFRS ≠ татварын treatment зөрвөл ялгааг ил хэл. Байгууллагад өдөрт " + String(200) + " хэсэг уншина — хэтэрвэл [KNOWLEDGE_LIMIT].",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Сэдвийн slug — ifrs/ias-16, tax/vat" },
        section: { type: "string", description: "Хэсгийн нэр (list_knowledge_topics-оос); хоосон = overview" },
      },
      required: ["topic"],
    },
    surfaces: ["mcp"],
  },

  // ── Аудит ба үнэлгээ ──────────────────────────────────────────────────────
  {
    name: "list_audit_events",
    description:
      "Аудитын мөр — батлах/буцаах/устгах/хаах зэрэг статус шилжилт бүрийн бүртгэл (хэн, хэзээ, юу). Шалгалт, мөрдөлтөд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        entityType: {
          type: "string",
          description: "journal | cash | arap | fa | cost | period | payroll | vat г.м",
        },
        action: { type: "string", description: "post | reverse | delete | close г.м" },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
      },
    },
  },
  {
    name: "update_arap_document",
    description:
      "НООРОГ АР/АП нэхэмжлэхийг засна (огноо, төлөх огноо, утга, хяналтын данс, мөрүүд). Мөрүүд өгвөл бүхлээрээ солигдоно — create-тэй ижил шалгалттай. Батлагдсаныг засахгүй.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Баримтын ID, дугаар, эсвэл externalRef" },
        date: { type: "string", description: "Шинэ огноо YYYY-MM-DD (сонголтоор)" },
        dueDate: { type: "string", description: "Шинэ төлөх огноо (сонголтоор)" },
        description: { type: "string", description: "Шинэ утга (сонголтоор)" },
        controlAccount: { type: "string", description: "Шинэ хяналтын данс (сонголтоор)" },
        lines: {
          type: "array",
          description: "Шинэ мөрүүд — өгвөл хуучин мөрүүд БҮГД солигдоно",
          items: {
            type: "object",
            properties: {
              account: { type: "string", description: "Мөрийн данс (АП-ийн бараатай мөрөнд орхино)" },
              description: { type: "string" },
              amount: { type: "number", description: "Мөрийн дүн (0-ээс их)" },
              itemCode: { type: "string", description: "Барааны код (бараатай мөрөнд)" },
              quantity: { type: "number", description: "Тоо хэмжээ (бараатай мөрөнд)" },
              warehouseCode: { type: "string", description: "Агуулахын код (бараатай мөрөнд)" },
            },
            required: ["amount"],
          },
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "update_cash_document",
    description:
      "НООРОГ кассын баримтыг засна (огноо, дүн, утга, харьцах данс, харилцагч, ханш). Данс/төрөл солихгүй — тэр тохиолдолд устгаад шинээр үүсгэнэ. Нэхэмжлэхтэй холбоотой бол шинэ дүн үлдэгдлийн шалгалтаа дахин давна.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Баримтын ID (бүтэн эсвэл 8+ тэмдэгт)" },
        date: { type: "string", description: "Шинэ огноо YYYY-MM-DD (сонголтоор)" },
        amount: { type: "number", description: "Шинэ дүн (сонголтоор)" },
        description: { type: "string", description: "Шинэ утга (сонголтоор)" },
        counterAccount: { type: "string", description: "Шинэ харьцах GL данс (сонголтоор)" },
        counterparty: { type: "string", description: "Харилцагчийн нэр (сонголтоор)" },
        exchangeRate: { type: "number", description: "Шинэ ханш — валютын данс бол (сонголтоор)" },
      },
      required: ["documentId"],
    },
  },

  // ── Өртгийн мастер дата ───────────────────────────────────────────────────
  {
    name: "get_costing_settings",
    description:
      "Өртгийн тохиргооны бүрэн зураг: дансны рольууд (клиринг, тооллогын илүүдэл/дутагдал, NRV), зарлагын төрлүүд (дебет чиглэлтэй нь), өртгийн бүрэлдэхүүнүүд.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "save_issue_type",
    description:
      "Зарлагын төрөл үүсгэх/засах (кодоор нь олж давхардвал шинэчилнэ). Дебет чиглэл: fixed=тогтмол данс, item_cogs=барааны COGS данс.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Код (жишээ нь SALE, WRITEOFF)" },
        name: { type: "string", description: "Нэр" },
        destinationClass: {
          type: "string",
          description: "Тайлбар ангилал (default: 'Борлуулалтын өртөг (COGS)')",
        },
        debitAccountSource: {
          type: "string",
          enum: ["fixed", "item_cogs"],
          description: "Дебет данс хаанаас: fixed=доорх данс, item_cogs=барааны тохиргооноос",
        },
        debitAccount: { type: "string", description: "Тогтмол дебет данс (fixed үед заавал)" },
      },
      required: ["code", "name", "debitAccountSource"],
    },
  },
  {
    name: "save_cost_component",
    description:
      "Өртгийн бүрэлдэхүүн үүсгэх/засах (тээвэр, гааль г.м — нэмэлт зардлын хуваарилалтад ашиглагдана).",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Код (жишээ нь FREIGHT)" },
        name: { type: "string", description: "Нэр" },
        classification: { type: "string", description: "Ангилал (сонголтоор)" },
        account: { type: "string", description: "Холбогдох данс (сонголтоор)" },
      },
      required: ["code", "name"],
    },
  },
  {
    name: "update_costing_accounts",
    description:
      "Өртгийн дансны рольуудыг засна — зөвхөн өгсөн нь өөрчлөгдөнө (бараа материалын түр данс, өглөгийн түр данс, тооллогын илүүдэл/дутагдал, NRV зардал/нөөц).",
    inputSchema: {
      type: "object",
      properties: {
        clearingAccount: { type: "string", description: "Бараа материалын түр (клиринг) данс" },
        apClearingAccount: {
          type: "string",
          description:
            "Өглөгийн түр данс — захиалгатай (PO) нэхэмжлэх Dr, PO хаалт Cr",
        },
        adjustmentGainAccount: { type: "string", description: "Тооллогын илүүдлийн данс" },
        adjustmentLossAccount: { type: "string", description: "Тооллогын дутагдлын данс" },
        nrvExpenseAccount: { type: "string", description: "NRV зардлын данс" },
        nrvReserveAccount: { type: "string", description: "NRV нөөцийн (contra) данс" },
        openPoCloseMode: {
          type: "string",
          enum: ["block", "warn"],
          description:
            "Хүлээн авалттай нээлттэй PO-той сар хаалт: block (анхдагч — хаахгүй) | warn (анхааруулаад хаана; бараа материалын түр дансны үлдэгдэл балансад үлдэнэ)",
        },
      },
    },
  },
  {
    name: "import_bank_statement",
    description:
      "Банкны хуулгын мөрүүдийг импортлон мөр бүрд кассын баримт + GL журнал ШУУД бичнэ (вэбийн хуулга импорттой нэг зам). settleInvoice өгсөн мөр нэхэмжлэхтэй холбогдож төлсөн дүнг шинэчилнэ. Ижил мөрүүдийг дахин импортлохоос hash-аар хамгаална. Зөвхөн 'Шууд бичих' горимд; max 500 мөр.",
    inputSchema: {
      type: "object",
      properties: {
        cashAccount: { type: "string", description: "Банкны/кассын дансны нэр" },
        bankName: { type: "string", description: "Банкны нэр (сонголтоор)" },
        statementRef: {
          type: "string",
          description: "Хуулгын нэр/дугаар (давхардлын шалгалтад орно, сонголтоор)",
        },
        rows: {
          type: "array",
          description: "Хуулгын мөрүүд (max 500)",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "Гүйлгээний огноо YYYY-MM-DD" },
              description: { type: "string", description: "Гүйлгээний утга" },
              counterparty: { type: "string", description: "Харилцагчийн нэр (текст)" },
              counterAccount: { type: "string", description: "Харьцсан банкны данс (текст)" },
              income: { type: "number", description: "Орлого ₮ (expense-тэй зэрэг биш)" },
              expense: { type: "number", description: "Зарлага ₮" },
              counterGlAccount: {
                type: "string",
                description: "Харьцах GL данс (8 оронтой) — орлогод кредитлэгдэх/зарлагад дебетлэгдэх тал (ewalletSettlement=true бол хэрэггүй — түр дансны GL автоматаар)",
              },
              exchangeRate: { type: "number", description: "Валютын данс бол ханш" },
              settleInvoice: {
                type: "string",
                description: "Хаагдах нэхэмжлэх (ID/дугаар/externalRef) — counterGlAccount нь хяналтын данс байх ёстой",
              },
              ewalletSettlement: {
                type: "boolean",
                description:
                  "Энэ орлогын мөр QPay / э-хэтэвчийн SETTLEMENT (провайдер шимтгэлээ суутгаад банкинд шилжүүлсэн): сервер түр дансны тулгагдаагүй орлогуудыг FIFO-оор нийлүүлж нийт/шимтгэлийг тооцоод түр данс → банк шилжүүлэг + шимтгэлийн зарлага бичнэ. Таарахгүй бол [EWALLET_SETTLEMENT_UNMATCHED]",
              },
              paymentMethod: {
                type: "string",
                description: "ewalletSettlement-д: хэд хэдэн ewallet хэлбэртэй бол тухайн хэлбэрийн код (get_pos_status)",
              },
            },
            required: ["date"],
          },
        },
      },
      required: ["cashAccount", "rows"],
    },
  },
  {
    name: "get_inventory_valuation",
    description:
      "Бараа материалын мөнгөн үнэлгээ — бараа бүрийн хамгийн сүүлд тооцоологдсон сарын хаалтын үлдэгдэл (тоо, дүн, нэгж өртөг) cost_period_results-ээс. get_stock_balances нь зөвхөн ТОО; энэ нь ҮНЭЛГЭЭ.",
    inputSchema: {
      type: "object",
      properties: {
        itemCode: { type: "string", description: "Барааны кодоор шүүх (яг эсвэл угтвар, сонголтоор)" },
        limit: { type: "integer", description: "Мөрийн тоо (default 100, max 500)" },
        offset: { type: "integer", description: "Хэдэн мөр алгасах (default 0)" },
      },
    },
  },

  // ── Хангамж (PO + орлогдох өртөг) ─────────────────────────────────────────
  {
    name: "create_purchase_order",
    description:
      "Худалдан авалтын захиалга (PO) НООРОГ болж үүснэ — GL бичилт ҮГҮЙ (захиалга нь гүйлгээ биш). Нийлүүлэгчийг нэрээр (supplier/both төрөлтэй харилцагч), бараа/агуулахыг кодоор заана. Дараа нь approve_purchase_order-оор нээлттэй болгож, create_goods_receipt-ээр хүлээн авна. 'Шууд бичих' горимд ≤10 сая ₮ захиалга шууд батлагдана (валюттай бол exchangeRate ил өгсөн үед).",
    inputSchema: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Нийлүүлэгчийн нэр (supplier эсвэл both төрөлтэй)" },
        date: { type: "string", description: "Захиалгын огноо YYYY-MM-DD" },
        expectedDate: { type: "string", description: "Хүргэх огноо YYYY-MM-DD (сонголтоор)" },
        currency: { type: "string", description: "Валют (default MNT). Нэгж үнэ ЭНЭ валютаар" },
        exchangeRate: {
          type: "number",
          description:
            "1 валют = ? ₮ — ЗӨВХӨН 10 сая ₮-ийн хязгаарыг шалгахад хэрэглэгдэнэ (захиалгад хадгалагдахгүй; барааны өртөг нь хүлээн авсан өдрийн Монголбанкны ханшаар тодорхойлогдоно)",
        },
        warehouseCode: { type: "string", description: "Мөр бүрийн default агуулахын код" },
        description: { type: "string", description: "Захиалгын утга" },
        documentNo: { type: "string", description: "Захиалгын дугаар (хоосон бол автоматаар)" },
        externalRef: EXTERNAL_REF_SCHEMA,
        lines: {
          type: "array",
          description: "Захиалгын мөрүүд (дор хаяж 1)",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Барааны код (list_inventory)" },
              quantity: { type: "number", description: "Захиалсан тоо (0-ээс их)" },
              unitPrice: { type: "number", description: "Нэгж үнэ захиалгын валютаар (0-ээс их)" },
              warehouseCode: { type: "string", description: "Мөрийн агуулах (хоосон бол толгойн)" },
              description: { type: "string", description: "Мөрийн тайлбар" },
            },
            required: ["itemCode", "quantity", "unitPrice"],
          },
        },
      },
      required: ["supplier", "date", "description", "lines"],
    },
  },
  {
    name: "update_purchase_order",
    description:
      "Ноорог эсвэл нээлттэй захиалгыг засна — мөрүүд өгвөл БҮХЭЛДЭЭ солигдоно (хүлээн авсан/нэхэмжилсэн тооноос доогуур болгож болохгүй). Хаагдсан захиалгыг засахгүй ([PO_CLOSED]).",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        expectedDate: { type: "string", description: "Хүргэх огноо YYYY-MM-DD" },
        warehouseCode: { type: "string", description: "Default агуулахын код" },
        description: { type: "string", description: "Захиалгын утга" },
        lines: {
          type: "array",
          description:
            "Мөрүүд БҮХЭЛДЭЭ (өгвөл хуучин мөрүүдийг ОРЛУУЛНА — жагсаалтад ороогүй мөр хасагдана). Байгаа мөрийг засахдаа purchaseOrderLineId-г өгнө (эсвэл ижил barааны код давхардаагүй бол автоматаар тааруулна) — эс бөгөөс хүлээн авсан/нэхэмжилсэн мөр хасагдаж [OVER_RECEIVED]/[OVER_INVOICED] гарна",
          items: {
            type: "object",
            properties: {
              purchaseOrderLineId: {
                type: "string",
                description:
                  "Байгаа мөрийн ID (get_purchase_order-оос) — үнэ/тоо засахад",
              },
              itemCode: { type: "string", description: "Барааны код" },
              quantity: { type: "number", description: "Тоо" },
              unitPrice: { type: "number", description: "Нэгж үнэ (PO валют)" },
              warehouseCode: { type: "string", description: "Мөрийн агуулах" },
              description: { type: "string", description: "Мөрийн тайлбар" },
            },
            required: ["itemCode", "quantity", "unitPrice"],
          },
        },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "approve_purchase_order",
    description:
      "Ноорог захиалгыг баталж НЭЭЛТТЭЙ болгоно (GL бичилт үгүй — цаашид хүлээн авалт, нэхэмжлэх бүртгэх боломжтой болно). Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд зөвшөөрөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
        exchangeRate: {
          type: "number",
          description:
            "Валюттай захиалгад 1 валют = ? ₮ — ЗӨВХӨН 10 сая ₮-ийн хязгаарыг шалгахад (хадгалагдахгүй). Өгөхгүй бол [EXCHANGE_RATE_REQUIRED]",
        },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "close_purchase_order",
    description:
      "Захиалгыг ХААНА — түр дансдыг тэгшитгэсэн батлагдсан журнал үүснэ (Dr бараа материалын түр данс / Cr өглөгийн түр данс; зөрүү нь ханшийн олз/гарз дансанд). Нөхцөл: Σ хүлээн авсан = захиалсан, Σ нэхэмжилсэн тоо ба дүн = захиалгын дүн, бүх нэмэлт зардал хуваарилагдсан ([PO_NOT_READY], шалтгааныг get_purchase_order харуулна). ДУТУУ ХААЛТ (shortClose: true — бараа бүрэн ирэхгүй болсон): хүлээн аваагүй үлдэгдэл цуцлагдана, хүлээн авснаас илүү нэхэмжилсэн дүн writeOffAccount (6/7/8XXXXXXX зардлын данс — хэрэглэгчээс асууна, ТААХГҮЙ) руу Dr; reason ЗААВАЛ (аудитад). Хүлээн авсан ч нэхэмжлээгүй бараа байвал дутуу хаалт хориотой — эхлээд нэхэмжлэхийг батална. Зөвхөн 'Шууд бичих' горимд, батлах хязгаар дотор — их дүнтэй импортыг нягтланч вэб дээрээс хаана.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
        closeDate: {
          type: "string",
          description: "Хаах огноо YYYY-MM-DD (хоосон бол өнөөдөр) — хаалтын журналын огноо",
        },
        shortClose: {
          type: "boolean",
          description: "true = ДУТУУ хаах (хүлээн аваагүй үлдэгдлийг цуцална). reason заавал",
        },
        reason: {
          type: "string",
          description: "Дутуу хаах шалтгаан (5+ тэмдэгт, жишээ: «Нийлүүлэгч үлдэгдлийг нийлүүлэх боломжгүй»)",
        },
        writeOffAccount: {
          type: "string",
          description: "Хүлээн авснаас илүү нэхэмжилсэн дүнг бичих ЗАРДЛЫН данс (8 оронтой, 6/7/8-аар эхэлнэ) — илүү нэхэмжлэл байвал заавал; хэрэглэгчээс асууна",
        },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "cancel_purchase_order",
    description:
      "Ноорог эсвэл нээлттэй захиалгыг ЦУЦЛАНА (баталгаажсан хүлээн авалт, нэхэмжлэхгүй байх ёстой — байвал эхлээд тэднийг буцаана; НООРОГ хүлээн авалт хамт устгагдана). GL-д нөлөөгүй тул ханш, дүнгийн хязгааргүй; зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
        exchangeRate: {
          type: "number",
          description: "Хэрэглэгдэхгүй (хуучин дуудлагын нийцэлд үлдсэн)",
        },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "list_purchase_orders",
    description:
      "Худалдан авалтын захиалгуудын жагсаалт (огноо, дугаар, нийлүүлэгч, дүн+валют, хүлээн авсан/нэхэмжилсэн %, төлөв, ID).",
    inputSchema: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Нийлүүлэгчийн нэрээр шүүх" },
        status: {
          type: "string",
          enum: ["draft", "open", "closed", "cancelled"],
          description: "Төлвөөр шүүх",
        },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        openOnly: { type: "boolean", description: "Зөвхөн нээлттэй (батлагдсан, хаагдаагүй)" },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
      },
    },
  },
  {
    name: "get_purchase_order",
    description:
      "Захиалгын дэлгэрэнгүй: мөр бүрийн захиалсан / хүлээн авсан / нэхэмжилсэн тоо ба дүн, хүлээн авалтууд, нэхэмжлэхүүд, хуваарилагдаагүй нэмэлт зардал, хоёр түр дансны үлдэгдэл, хаалтын хориглолтын шалтгаанууд. Хүлээн авалт/нэхэмжлэх/хуваарилалт хийхийн ӨМНӨ мөрийн ID-г эндээс авна.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
      },
      required: ["purchaseOrderId"],
    },
  },
  {
    name: "create_goods_receipt",
    description:
      "Барааны ХҮЛЭЭН АВАЛТ (GR) ноорог үүсгэнэ — нээлттэй захиалгаас. Мөр өгөхгүй бол хүлээн аваагүй үлдэгдэл БҮХЭЛДЭЭ бөглөгдөнө. Ханш өгөхгүй бол тухайн өдрийн Монголбанкны албан ханш автоматаар татагдана (олдохгүй бол алдаа — ханш ЗОХИОГДОХГҮЙ). Батлахад бараа Dr барааны нөөц / Cr бараа материалын түр данс гэж АВТОМАТ капиталжина (тоо × PO нэгж үнэ × ханш). 'Шууд бичих' горимд ≤10 сая ₮ бол шууд баталгаажна (валюттай бол exchangeRate ил өгсөн үед).",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
        date: { type: "string", description: "Хүлээн авсан огноо YYYY-MM-DD" },
        warehouseCode: { type: "string", description: "Агуулахын код (хоосон бол захиалгын default)" },
        exchangeRate: {
          type: "number",
          description:
            "Хүлээн авсан өдрийн ханш (1 валют = ? ₮). Хоосон бол Монголбанкны албан ханш автоматаар",
        },
        documentNo: { type: "string", description: "Баримтын дугаар (хоосон бол автоматаар)" },
        description: { type: "string", description: "Тайлбар" },
        lines: {
          type: "array",
          description:
            "Хүлээн авсан мөрүүд (хоосон бол хүлээн аваагүй үлдэгдэл бүхэлдээ). Илүү бол [OVER_RECEIVED]",
          items: {
            type: "object",
            properties: {
              purchaseOrderLineId: {
                type: "string",
                description: "Захиалгын мөрийн ID (get_purchase_order-оос, бүтэн/6+ тэмдэгт)",
              },
              itemCode: {
                type: "string",
                description: "Эсвэл барааны код (захиалгад нэг л мөр байх үед)",
              },
              quantity: { type: "number", description: "Хүлээн авсан тоо (0-ээс их)" },
            },
            required: ["quantity"],
          },
        },
      },
      required: ["purchaseOrderId", "date"],
    },
  },
  {
    name: "confirm_goods_receipt",
    description:
      "Ноорог хүлээн авалтыг БАТАЛНА — орлогын хөдөлгөөн баталгаажиж, receipt_capitalize өртгийн бичилт + батлагдсан журнал (Dr барааны нөөц / Cr бараа материалын түр данс) үүснэ. Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд.",
    inputSchema: {
      type: "object",
      properties: {
        receiptId: {
          type: "string",
          description: "Хүлээн авалтын дугаар (GR-…) эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
      },
      required: ["receiptId"],
    },
  },
  {
    name: "reverse_goods_receipt",
    description:
      "Баталгаажсан хүлээн авалтыг БУЦААНА — капитализацийн журнал эсрэг мөрөөр буцааж, орлогын хөдөлгөөн цуцлагдана (хаагдсан захиалгад хийхгүй). Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд.",
    inputSchema: {
      type: "object",
      properties: {
        receiptId: {
          type: "string",
          description: "Хүлээн авалтын дугаар (GR-…) эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
      },
      required: ["receiptId"],
    },
  },
  {
    name: "delete_goods_receipt",
    description:
      "НООРОГ хүлээн авалтыг устгана (GL, бараанд нөлөөгүй — аль ч горимд). Баталгаажсан хүлээн авалтыг reverse_goods_receipt-ээр буцаана. Захиалгыг цуцлахад ноорог хүлээн авалт автоматаар устана.",
    inputSchema: {
      type: "object",
      properties: {
        receiptId: {
          type: "string",
          description: "Хүлээн авалтын дугаар (GR-…) эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
      },
      required: ["receiptId"],
    },
  },
  {
    name: "create_ap_invoice_from_po",
    description:
      "Захиалгаас НИЙЛҮҮЛЭГЧИЙН (захиалгын харилцагчийн) АП нэхэмжлэх үүсгэнэ — мөр өгөхгүй бол нэхэмжлээгүй үлдэгдэл × PO нэгж үнэ бүхэлдээ автоматаар орно. Dr өглөгийн түр данс / Cr өглөг (хөдөлгөөн ҮҮСГЭХГҮЙ — орлого нь хүлээн авалтаас). costLines нь НИЙЛҮҮЛЭГЧ өөрөө нэхэмжилсэн нэмэлт зардал (тээвэр г.м), otherLines нь капиталжихгүй мөр (импортын НӨАТ). ГААЛЬ, тээврийн компани зэрэг ӨӨР харилцагчийн зардлын нэхэмжлэхийг create_arap_invoice {purchaseOrder, мөрийн costComponentCode}-оор бүртгэнэ. Хаагдсан захиалга → [PO_CLOSED]; илүү нэхэмжлэх → [OVER_INVOICED]. Ноорог болж үүсэх ба 'Шууд бичих' горимд ≤10 сая ₮ бол шууд батлагдана.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
        date: { type: "string", description: "Нэхэмжлэхийн огноо YYYY-MM-DD" },
        dueDate: { type: "string", description: "Төлөх огноо YYYY-MM-DD (хоосон бол нөхцөлөөр)" },
        exchangeRate: {
          type: "number",
          description:
            "Нэхэмжлэхийн өдрийн ханш (хоосон бол Монголбанкны албан ханш автоматаар)",
        },
        description: { type: "string", description: "Баримтын утга" },
        documentNo: { type: "string", description: "Нэхэмжлэхийн дугаар (сонголтоор)" },
        externalRef: EXTERNAL_REF_SCHEMA,
        lines: {
          type: "array",
          description:
            "Барааны мөрүүд. ХООСОН бол нэхэмжлээгүй үлдэгдэл БҮХЭЛДЭЭ нэхэмжлэгдэнэ — зөвхөн зардлын мөр бичих гэж байвал үүнийг анхаар (хэсэгчилсэн нэхэмжлэхэд мөрүүдээ ил өгнө)",
          items: {
            type: "object",
            properties: {
              purchaseOrderLineId: {
                type: "string",
                description: "Захиалгын мөрийн ID (get_purchase_order-оос)",
              },
              itemCode: { type: "string", description: "Эсвэл барааны код" },
              quantity: { type: "number", description: "Нэхэмжилсэн тоо" },
              unitPrice: { type: "number", description: "Нэгж үнэ (хоосон бол PO нэгж үнэ)" },
            },
            required: ["quantity"],
          },
        },
        costLines: {
          type: "array",
          description:
            "Нэмэлт зардлын мөрүүд — барааны өртөгт капиталжина (дараа нь create_cost_allocation-оор хуваарилагдана)",
          items: {
            type: "object",
            properties: {
              costComponentCode: {
                type: "string",
                description: "Өртгийн бүрэлдэхүүний код (get_costing_settings)",
              },
              amount: { type: "number", description: "Дүн баримтын валютаар (0-ээс их)" },
              description: { type: "string", description: "Мөрийн тайлбар" },
            },
            required: ["costComponentCode", "amount"],
          },
        },
        otherLines: {
          type: "array",
          description:
            "Капиталжихгүй мөрүүд — данс ИЛ (импортын НӨАТ 13620000 г.м)",
          items: {
            type: "object",
            properties: {
              account: { type: "string", description: "Дансны 8 оронтой дугаар" },
              amount: { type: "number", description: "Дүн баримтын валютаар (0-ээс их)" },
              description: { type: "string", description: "Мөрийн тайлбар" },
            },
            required: ["account", "amount"],
          },
        },
      },
      required: ["purchaseOrderId", "date"],
    },
  },
  {
    name: "create_cost_allocation",
    description:
      "Нэмэлт зардлыг (гааль, тээвэр, брокер …) орлогуудад хуваарилж landed_cost НООРОГ өртгийн бичилт үүсгэнэ (Dr барааны нөөц / Cr бараа материалын түр данс; post_cost_entries-ээр батална). allocationBase-ийг ЗААВАЛ ил өгнө — default байхгүй (батлагдсан шийдвэр OD-017). Захиалгын зардлыг sourceLine-аар (АП нэхэмжлэхийн мөрийн ID, get_purchase_order/get_landed_cost_summary-аас) холбоно: бүрэлдэхүүн, захиалга, хуваарилах орлогууд автоматаар тодорхойлогдоно, Σ хуваарилалт мөрийн ₮ дүнгээс хэтэрвэл [ALLOCATION_EXCEEDS_LINE].",
    inputSchema: {
      type: "object",
      properties: {
        allocationBase: {
          type: "string",
          enum: ["value", "quantity", "manual"],
          description:
            "ЗААВАЛ: value=үнийн дүнгээр (жин нь захиалгын мөрийн нийт үнэ), quantity=тоо хэмжээгээр, manual=мөр бүрийн дүнг гараар (Σ = зардлын дүн байх ёстой)",
        },
        sourceLine: {
          type: "string",
          description:
            "Зардал гарсан АП нэхэмжлэхийн МӨРИЙН ID (бүтэн/6+ тэмдэгт) — захиалгатай зардалд ЗААВАЛ",
        },
        date: { type: "string", description: "Хуваарилалтын огноо YYYY-MM-DD (хоосон бол нэхэмжлэхийн огноо)" },
        totalAmount: {
          type: "number",
          description: "Хуваарилах дүн ₮ (хоосон бол мөрийн хуваарилагдаагүй үлдэгдэл)",
        },
        component: {
          type: "string",
          description:
            "Өртгийн бүрэлдэхүүний код — ЗӨВХӨН sourceLine байхгүй (захиалгагүй) хуваарилалтад",
        },
        description: { type: "string", description: "Тайлбар" },
        documentNo: { type: "string", description: "Баримтын дугаар (хоосон бол ALLOC-…)" },
        targets: {
          type: "array",
          description:
            "Хуваарилах орлогууд (хоосон бол тухайн захиалгын БҮХ баталгаажсан хүлээн авалт)",
          items: {
            type: "object",
            properties: {
              movementId: {
                type: "string",
                description:
                  "Орлогын хөдөлгөөний ID (бүтэн эсвэл 6+ тэмдэгт) — get_purchase_order-ийн 'ХУВААРИЛАХ ЗОРИЛТУУД' хэсгээс эсвэл list_inventory_movements-ээс",
              },
              manualAmount: {
                type: "number",
                description: "manual суурьд энэ орлогод ноогдох дүн ₮",
              },
            },
            required: ["movementId"],
          },
        },
      },
      required: ["allocationBase"],
    },
  },
  {
    name: "reverse_cost_allocation",
    description:
      "Зардлын хуваарилалтыг БУЦААНА — батлагдсан landed_cost бичилтүүд эсрэг журналаар буцаагдаж, ноорог бичилтүүд устаж, хуваарилалтын баримт хасагдана (мөрийн хуваарилагдаагүй дүн сэргэнэ). Хаагдсан захиалгад хийхгүй ([PO_CLOSED] — эхлээд захиалгыг дахин нээнэ). Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд.",
    inputSchema: {
      type: "object",
      properties: {
        allocationId: {
          type: "string",
          description: "Хуваарилалтын дугаар (ALLOC-…) эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
      },
      required: ["allocationId"],
    },
  },
  {
    name: "get_landed_cost_summary",
    description:
      "Захиалгын ОРЛОГДОХ ӨРТГИЙН хураангуй — бараа бүрээр: худалдан авалтын ₮ дүн, хуваарилагдсан нэмэлт зардлууд (бүрэлдэхүүнээр), нийт орлогдох өртөг ба нэгжид ноогдох өртөг.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseOrderId: {
          type: "string",
          description: "Захиалгын дугаар, externalRef эсвэл ID (бүтэн/6+ тэмдэгт)",
        },
      },
      required: ["purchaseOrderId"],
    },
  },
  // ── POS (Борлуулалтын цэг) — docs/pos/00-proposal.md §3.3, §3.10 ────────────
  {
    name: "get_pos_status",
    description:
      "POS-ийн одоогийн байдал: нээлттэй ээлжүүд (касс, агуулах, дугаар), идэвхтэй төлбөрийн хэлбэрүүд (код, төрөл), НӨАТ төлөгч эсэх, тохиргооны товч. Борлуулалт бүртгэхийн ӨМНӨ үүнийг уншиж ээлж нээлттэй эсэх, төлбөрийн хэлбэрийн кодыг мэднэ.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_pos_settings",
    description:
      "POS-ийн ҮЙЛ АЖИЛЛАГААНЫ тохиргоо засна — зөвхөн өгсөн талбар өөрчлөгдөнө. Одоогийн утга get_pos_status-д. Хасах үлдэгдэл (allowNegativeStock) нь ЧУХАЛ: асаалттай бол кассчин үлдэгдэлгүй бараа зарж чадах ба тэр бараа сарын өртгийн тооцоололд орохгүй тул САР ХААЛТ блоклогдоно. eBarimt / QPay-ийн тохиргоо энд БАЙХГҮЙ (бэлэн байдлын шалгалттай, вэбээс).",
    inputSchema: {
      type: "object",
      properties: {
        allowNegativeStock: {
          type: "boolean",
          description: "Хасах үлдэгдэлтэй болгож зарахыг зөвшөөрөх эсэх (D9; шинэ байгууллагад анхдагч ХААЛТТАЙ)",
        },
        provisionalCogs: {
          type: "boolean",
          description: "Борлуулах мөчид явцын дунджаар урьдчилсан COGS бичих эсэх (сар хаалтад залруулагдана)",
        },
        discountPosting: {
          type: "string",
          enum: ["net", "contra"],
          description: "GL-д хөнгөлөлт: net = цэвэр орлого, contra = Cr орлого бүтэн + Dr хөнгөлөлтийн данс",
        },
        discountStacking: {
          type: "string",
          enum: ["best_single", "cumulative"],
          description: "Хөнгөлөлтийн дүрмүүд давхцахад: хамгийн сайн НЭГ / нийлбэр",
        },
        maxManualDiscountPercent: { type: "number", description: "Гар хөнгөлөлтийн дээд хувь 0–100" },
        maxTotalDiscountPercent: { type: "number", description: "Нийт хөнгөлөлтийн тааз 0–100" },
        cashRoundingUnit: { type: "number", description: "Бэлэн мөнгөний бөөрөнхийлөл: 0, 10 эсвэл 100 ₮" },
        receiptHeader: { type: "string", description: "Баримтын толгойн текст" },
        receiptFooter: { type: "string", description: "Баримтын хөлийн текст" },
        revenueAccount: { type: "string", description: "Борлуулалтын орлогын данс (8 орон)" },
        discountAccount: { type: "string", description: "Хөнгөлөлтийн данс (8 орон, contra горимд)" },
        giftCardLiabilityAccount: { type: "string", description: "Бэлгийн картын өглөгийн данс (8 орон)" },
        storeCreditLiabilityAccount: { type: "string", description: "Дэлгүүрийн кредитийн өглөгийн данс (8 орон)" },
        customerAdvanceAccount: { type: "string", description: "Худалдан авагчийн урьдчилгааны данс (8 орон)" },
        cashOverAccount: { type: "string", description: "Кассын илүүдлийн данс (8 орон)" },
        cashShortAccount: { type: "string", description: "Кассын дутагдлын данс (8 орон)" },
        roundingAccount: { type: "string", description: "Бөөрөнхийллийн зөрүүний данс (8 орон)" },
        nonVatRevenueAccount: {
          type: "string",
          description: "НӨАТ-гүй борлуулалтын ОРЛОГЫН данс (8 орон; кассын «НӨАТ» унтраалттай; default 51100002)",
        },
        nonVatReceivableAccount: {
          type: "string",
          description: "НӨАТ-гүй борлуулалтын АВЛАГЫН (хяналтын) данс (8 орон; default 13110002)",
        },
        ewalletFeeAccount: {
          type: "string",
          description: "QPay / э-хэтэвчийн settlement-ийн ШИМТГЭЛИЙН зардлын данс (8 орон; default 73100008) — import_bank_statement-ийн ewalletSettlement мөрд",
        },
      },
    },
  },
  {
    name: "save_pos_payment_method",
    description:
      "POS-ийн ТӨЛБӨРИЙН ХЭЛБЭР үүсгэх / засах (лавлах өгөгдөл — GL бичилт үүсгэхгүй). Кодоор олдвол ЗАСНА, үгүй бол ШИНЭЭР үүснэ. Зөвхөн өгсөн талбар өөрчлөгдөнө. eBarimt код оноох, буруу хэлбэрийг идэвхгүй болгох, QPay-ийн провайдер тавихад ашиглана. Хэлбэрийн жагсаалт get_pos_status-д.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Хэлбэрийн код (ТОМ үсэг) — байвал засна, үгүй бол үүсгэнэ" },
        name: { type: "string", description: "Нэр (шинээр үүсгэхэд ЗААВАЛ)" },
        kind: {
          type: "string",
          enum: [...PAYMENT_KINDS],
          description: "Бүртгэлийн замыг шийднэ (шинээр үүсгэхэд ЗААВАЛ) — cash=бэлэн, card/ewallet/bnpl=түр данстай, credit=зээл",
        },
        cashAccount: { type: "string", description: "Мөнгө хүлээн авах касс/банк/түр дансны НЭР (cash/cash_fx/card/ewallet/bnpl/bank_transfer төрөлд ЗААВАЛ)" },
        ebarimtCode: { type: "string", description: "eBarimt-ийн төлбөрийн код (ТЕГ: CASH, PAYMENT_CARD, QPAY …) — хоосон бол энэ хэлбэртэй борлуулалт eBarimt-д илгээгдэхгүй" },
        provider: { type: "string", description: "ewallet-ийн провайдер: \"qpay\" бол төлбөр QR intent-ээр батлагдана; бусад төрөлд хоосон" },
        requiresReference: { type: "boolean", description: "Лавлах дугаар заавал эсэх (терминалын слип)" },
        allowsRefund: { type: "boolean", description: "Буцаалтад ашиглах эсэх" },
        isActive: { type: "boolean", description: "Идэвхтэй эсэх — false бол кассын дэлгэцэд гарахгүй" },
        sortOrder: { type: "number", description: "Эрэмбэ (бага нь урд)" },
        feePercent: { type: "number", description: "Шимтгэл % (зөвхөн мэдээлэл)" },
      },
      required: ["code"],
    },
  },
  {
    name: "delete_pos_payment_method",
    description:
      "POS-ийн ТӨЛБӨРИЙН ХЭЛБЭР устгана (буруу үүсгэсэн, давхардсан мөр). Түүхэн борлуулалтад ашиглагдсан хэлбэр УСТАХГҮЙ — тайлан/баримт эвдрэхээс сэргийлж ИДЭВХГҮЙ болно (хариултад ил хэлнэ).",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string", description: "Хэлбэрийн код (get_pos_status-оос)" } },
      required: ["code"],
    },
  },
  {
    name: "open_pos_shift",
    description:
      "Кассын ЭЭЛЖ нээнэ (POS борлуулалт нээлттэй ээлжгүйгээр бүртгэгдэхгүй). GL бичилт үүсгэхгүй тул аль ч горимд. Нэг кассанд нэг л нээлттэй ээлж.",
    inputSchema: {
      type: "object",
      properties: {
        cashAccount: { type: "string", description: "Кассын дансны нэр (MNT бэлэн мөнгөний данс)" },
        warehouseCode: { type: "string", description: "Агуулахын код (дэлгүүр)" },
        openingFloat: { type: "number", description: "Эхний мөнгө ₮ (default 0)" },
        fxRates: {
          type: "object",
          description: "Валютын бэлэн төлбөрт хэрэглэх ханш { USD: 3450 } (сонголтоор)",
        },
        note: { type: "string", description: "Тайлбар" },
      },
      required: ["cashAccount", "warehouseCode"],
    },
  },
  {
    name: "close_pos_shift",
    description:
      "Кассын ЭЭЛЖ хаана — тоолсон бэлэн мөнгийг системийнхтэй (эхний мөнгө + бэлэн орлого − бэлэн буцаалт) тулгаж зөрүүг кассын илүүдэл/дутагдлын дансанд бичнэ (Z-тайлан). Зөрүү GL-д бичигдэх тул ЗӨВХӨН 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        shift: { type: "string", description: "Ээлжийн дугаар (SH-…) эсвэл ID; хоосон бол цорын ганц нээлттэй ээлж" },
        countedCash: { type: "number", description: "Тоолсон бэлэн мөнгө ₮" },
        note: { type: "string", description: "Тайлбар" },
        confirmLargeVariance: {
          type: "boolean",
          description:
            "Зөрүү max(10,000₮, системийн 1%)-ээс их бол [LARGE_VARIANCE] — хэрэглэгч (менежер) дахин тоолсноо ИЛ баталсан үед л true",
        },
      },
      required: ["countedCash"],
    },
  },
  {
    name: "create_pos_sale",
    description:
      "POS БОРЛУУЛАЛТ бүртгэнэ — НЭГ транзакцад: АР нэхэмжлэх (posted) + төлбөр бүрд кассын баримт (settlement) + confirmed зарлага + урьдчилсан COGS (явцын дундаж; сар хаалтад залруулагдана). Хөнгөлөлтийн дүрмүүд автоматаар хэрэглэгдэнэ; НӨАТ төлөгч бол үнэ НӨАТ ОРСОН гэж задарна. Бодит мөнгөн үйлдэл тул ноорог байхгүй — ЗӨВХӨН 'Шууд бичих' горимд, ≤10 сая ₮. Нээлттэй ээлж шаардлагатай (get_pos_status). Харилцагч өгөхгүй бол 'Бэлэн худалдан авагч'. Зээлээр (credit) төлбөрт харилцагч ЗААВАЛ. Хасах үлдэгдэлтэй болсон бараа хариултад анхааруулга болж ирнэ (D9).",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          description: "Борлуулсан бараанууд",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Барааны код (эсвэл баркод)" },
              quantity: { type: "number", description: "Тоо (0-ээс их)" },
              unitPrice: { type: "number", description: "Нэгж үнэ — өгөхгүй бол барааны борлуулах үнэ; өөрчилбөл менежерийн эрх (pos post)" },
              discountPercent: { type: "number", description: "Гар хөнгөлөлт % (сонголтоор)" },
              discountAmount: { type: "number", description: "Гар хөнгөлөлт ₮ (сонголтоор)" },
            },
            required: ["itemCode", "quantity"],
          },
        },
        payments: {
          type: "array",
          description: "Төлбөрүүд — Σ ≥ төлөх дүн (илүү бэлэн = хариулт)",
          items: {
            type: "object",
            properties: {
              method: { type: "string", description: "Төлбөрийн хэлбэрийн код эсвэл нэр (get_pos_status-оос: CASH, CARD, CREDIT …)" },
              amount: { type: "number", description: "Дүн (хэлбэрийн валютаар)" },
              reference: { type: "string", description: "Слип/гүйлгээний дугаар (карт, шилжүүлэгт)" },
              giftCardCode: { type: "string", description: "Бэлгийн картын код (gift_card хэлбэрт)" },
            },
            required: ["method", "amount"],
          },
        },
        customer: { type: "string", description: "Харилцагчийн нэр (хоосон бол бэлэн худалдан авагч)" },
        warehouseCode: { type: "string", description: "Агуулах (хоосон бол ээлжийнх)" },
        couponCodes: { type: "array", items: { type: "string" }, description: "Купоны кодууд" },
        receiptDiscountPercent: { type: "number", description: "Баримтын түвшний гар хөнгөлөлт %" },
        receiptDiscountAmount: { type: "number", description: "Баримтын түвшний гар хөнгөлөлт ₮" },
        note: { type: "string", description: "Тайлбар" },
        ebarimtId: { type: "string", description: "eBarimt ДДТД ГАРААР (ТЕГ-ийн апп-аар олгосон бол) — өгвөл автомат илгээлт хийгдэхгүй" },
        consumerNo: { type: "string", description: "Иргэний eBarimt дугаар (8 орон) — B2C баримтад" },
        customerTin: { type: "string", description: "Байгууллагын ТТД (11/14 орон) — өгвөл B2B баримт" },
        customerRegNo: { type: "string", description: "Байгууллагын РД — ТТД-г ТЕГ-ийн лавлахаас автоматаар олно (customerTin-ийн оронд)" },
        skipEbarimt: { type: "boolean", description: "true бол ЭНЭ борлуулалтыг eBarimt-гүй бүртгэнэ (ТЕГ-д илгээхгүй, статус «Илгээгээгүй») — хэрэглэгч ил хүссэн үед л; дараа нь resend_ebarimt-ээр илгээж болно" },
        nonVat: { type: "boolean", description: "true бол НӨАТ-гүй борлуулалт (кассын «НӨАТ» унтраалттай — нөхөж оруулах, залруулга): НӨАТ задлахгүй, eBarimt ОГТ үүсэхгүй, POS тохиргооны НӨАТ-гүй орлого/авлагын дансаар; nonVatReason ЗААВАЛ, менежерийн эрх (managerApproval). Хэрэглэгч ил хүссэн үед л" },
        nonVatReason: { type: "string", description: "НӨАТ-гүй борлуулалтын шалтгаан (nonVat=true үед заавал)" },
        managerApproval: {
          type: "boolean",
          description:
            "Хөнгөлөлтийн хязгаар / гар үнэ зэрэг МЕНЕЖЕРИЙН ЗӨВШӨӨРӨЛ шаардсан борлуулалтад — хэрэглэгч (эрхтэй менежер) чатад ИЛ зөвшөөрсөн үед л true. Өгөөгүй бол [APPROVAL_REQUIRED] буцна; AI өөрөө зөвшөөрөхгүй",
        },
      },
      required: ["lines", "payments"],
    },
  },
  {
    name: "return_pos_sale",
    description:
      "POS борлуулалтын БУЦААЛТ — АР кредит (Dr орлого, Dr НӨАТ / Cr авлага), return_in хөдөлгөөн, урьдчилсан COGS урвуу, буцаан олголт (бэлэн/карт эсвэл дэлгүүрийн кредит). Өнөөдрийн огноогоор, нээлттэй ээлж дотор. ЗӨВХӨН 'Шууд бичих' горимд, ≤10 сая ₮.",
    inputSchema: {
      type: "object",
      properties: {
        sale: { type: "string", description: "Борлуулалтын дугаар (POS-…) эсвэл ID (бүтэн/6+ тэмдэгт)" },
        lines: {
          type: "array",
          description: "Буцаах мөрүүд (хоосон бол БҮХ үлдсэн мөр бүтнээр)",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Барааны код" },
              quantity: { type: "number", description: "Буцаах тоо" },
            },
            required: ["itemCode", "quantity"],
          },
        },
        reason: { type: "string", description: "Буцаалтын шалтгаан (заавал)" },
        refundMethod: { type: "string", description: "Буцаан олгох хэлбэрийн код/нэр (хоосон бол эх борлуулалтын бэлэн хэлбэр)" },
        storeCredit: { type: "boolean", description: "true бол мөнгө буцаахгүй, дэлгүүрийн кредит олгоно (бүртгэлтэй харилцагчид)" },
      },
      required: ["sale", "reason"],
    },
  },
  {
    name: "list_pos_sales",
    description: "POS борлуулалт/буцаалтын жагсаалт — огноо, төлөв, харилцагчаар шүүнэ.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        status: { type: "string", enum: ["posted", "partially_returned", "returned", "voided"] },
        customer: { type: "string", description: "Харилцагчийн нэр" },
        limit: { type: "integer", description: "Дээд тал нь (default 30, max 100)" },
      },
    },
  },
  {
    name: "get_pos_sale",
    description: "Нэг POS борлуулалтын дэлгэрэнгүй: мөрүүд (хөнгөлөлтийн задаргаа, НӨАТ, урьдчилсан COGS), төлбөрүүд, буцаалтууд, холбоотой АР/касс/журнал.",
    inputSchema: {
      type: "object",
      properties: { sale: { type: "string", description: "Дугаар (POS-…/RET-…) эсвэл ID (бүтэн/6+ тэмдэгт)" } },
      required: ["sale"],
    },
  },
  {
    name: "get_pos_sales_report",
    description:
      "Борлуулалтын дэлгэрэнгүй тайлан (docs/pos §5): хураангуй, бараагаар, өдрөөр, кассчинаар, төлбөрийн хэлбэрээр, харилцагчаар, хөнгөлөлтийн дүрмээр. COGS/ахиуц нь cost_period_results-ээс — сар хаагдаагүй бол 'урьдчилсан'/'тооцоолсон' гэж ил тэмдэглэгдэнэ (GL-ээс тооцохгүй).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        groupBy: {
          type: "string",
          enum: ["summary", "item", "day", "cashier", "method", "customer", "rule"],
          description: "Нэгтгэлийн түвшин (default summary)",
        },
        warehouseCode: { type: "string" },
        limit: { type: "integer", description: "Мөрийн дээд тоо (default 30)" },
      },
      required: ["from", "to"],
    },
  },
  // ── eBarimt 3.0 (docs/pos/03-ebarimt-integration-plan.md) ──────────────────
  {
    name: "get_ebarimt_status",
    description:
      "eBarimt 3.0-ийн байдал: автомат илгээлт асаалттай эсэх, горим (server/browser), тохиргооны дутуу зүйлс, дараалалд хүлээгдэж байгаа / алдаатай баримтын тоо, өнөөдөр илгээсэн, сүүлийн алдаа. Борлуулалтын дараа баримт ТЕГ-д очсон эсэхийг шалгахад.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "resend_ebarimt",
    description:
      "eBarimt-д илгээгдээгүй (алдаатай) баримтыг ДАХИН илгээнэ. Ангилалын код, төлбөрийн код зэрэг дутууг зассаны дараа хэрэглэнэ. kind=cancel бол эх ДДТД-г цуцлана (буцаалтын дараа). Аль хэдийн илгээгдсэн баримтыг дахин илгээхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        sale: { type: "string", description: "Борлуулалтын дугаар (POS-…) эсвэл ID (бүтэн/6+ тэмдэгт)" },
        kind: { type: "string", enum: ["send", "cancel"], description: "send (default) = баримт илгээх, cancel = ДДТД цуцлах" },
      },
      required: ["sale"],
    },
  },
  {
    name: "lookup_tin",
    description:
      "ТЕГ-ийн нийтийн лавлахаас регистрийн дугаараар байгууллагын ТТД ба нэрийг олно (B2B баримт, харилцагч бүртгэхэд). Олдохгүй бол алдаа — ТТД ЗОХИОХГҮЙ.",
    inputSchema: {
      type: "object",
      properties: { regNo: { type: "string", description: "Байгууллагын регистрийн дугаар (эсвэл 7 оронтой ТТД)" } },
      required: ["regNo"],
    },
  },
  // ── QPay Quick QR (docs/pos/04-qpay-integration-plan.md) ──────────────────
  {
    name: "get_qpay_status",
    description:
      "QPay төлбөрийн байдал: асаалттай/тохируулсан эсэх, бэлэн байдлын дутуу (key, secret, нийтийн URL, QPay хэлбэр), мерчант id, нээлттэй QR-ийн тоо, төлөгдсөн ч борлуулалт болоогүй intent (≥10 мин — ЯАРАЛТАЙ), өнөөдөр QPay-ээр батлагдсан тоо. Нууц (key, secret) ХЭЗЭЭ Ч буцахгүй. Холбох нь вэбээс: Борлуулалт → Тохиргоо → QPay → [QPay холбох].",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Туслах ──────────────────────────────────────────────────────────────────

function errorText(caught: unknown): string {
  // Batch-ийн мөр бүрийн алдаа ч гадны клиентэд очдог — DB-ийн дотоод
  // мессежийг (SQL, UUID параметр) ЗАДЛАХГҮЙ (ENT-070).
  const classified = classifyToolError(caught);
  if (classified.internal) {
    console.error(`AI tool internal error [${classified.logId}]: ${describeErrorChain(caught)}`, caught);
    return internalErrorText(classified.logId);
  }
  return classified.message;
}

/**
 * Ирээдүйн тайлант үеийн огноотой бичилт post горимд ч НООРОГ үлдэнэ
 * (ENT-028: 2027-06-ны журнал сануулгагүй батлагдаж байв). null = саадгүй.
 */
function futurePeriodDraftNote(date: string): string | null {
  const today = ulaanbaatarToday();
  return isFuturePeriodDate(date, today)
    ? ` (${date.slice(0, 7)} нь ирээдүйн тайлант үе — өнөөдөр ${today} тул ноорог үлдэв; тэр сар эхэлсний дараа батална)`
    : null;
}

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);

/** Журналын редактортой ижил сегментийн контекст. */
async function accountContext(orgId: string) {
  const [configs, values, accounts] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({ where: eq(segmentValues.organizationId, orgId) }),
    db.query.chartOfAccounts.findMany({
      where: and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.isEnabled, true)),
      columns: { number: true, name: true },
    }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || configMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);
  const defaults: Record<number, string> = {};
  if (activeSegIds.includes(1)) {
    const s1 = values.filter((value) => value.segmentId === 1);
    if (s1.length === 1) defaults[1] = s1[0].code;
  }
  return {
    activeSegIds,
    defaults,
    enabledByMain: new Map(accounts.map((account) => [account.number, account.name])),
  };
}

type Ctx = Awaited<ReturnType<typeof accountContext>>;

/** 8 оронтой/бүтэн кодыг normalize хийж идэвхтэй эсэхийг шалгана. */
function resolveAccount(raw: string, ctx: Ctx): { code: string; main: string } {
  const code = normalizePastedAccount(String(raw).trim(), ctx.activeSegIds, ctx.defaults);
  const main = parseSegParts(code, [3])[3] ?? "";
  if (!ctx.enabledByMain.has(main))
    throw codedError(
      "ACCOUNT_NOT_FOUND",
      `"${raw}" данс идэвхтэй жагсаалтад алга — list_gl_accounts tool-оор зөв дугаарыг хайна уу`
    );
  return { code, main };
}

/** Ойролцоо нэрсийг bigram давхцлаар эрэмбэлж санал болгоно (спек §11). */
function suggestNames(all: string[], query: string, max = 5): string[] {
  const compact = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  const q = compact(query);
  if (q.length === 0) return [];
  const bigrams = new Set<string>();
  for (let i = 0; i < q.length - 1; i++) bigrams.add(q.slice(i, i + 2));
  return all
    .map((name) => {
      const n = compact(name);
      let score = n.includes(q) || q.includes(n) ? 3 : 0;
      for (let i = 0; i < n.length - 1; i++)
        if (bigrams.has(n.slice(i, i + 2))) score += 1;
      return { name, score };
    })
    .filter((entry) => entry.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((entry) => entry.name);
}

/** Нэрээр ганц тохирол шаардана — 0 эсвэл олон бол ойлгомжтой алдаа. */
function requireSingle<T>(
  matches: T[],
  labelOf: (entry: T) => string,
  what: string,
  query: string,
  opts?: { codePrefix?: string; allNames?: string[] }
): T {
  if (matches.length === 1) return matches[0];
  const prefix = opts?.codePrefix;
  if (matches.length === 0) {
    const similar = opts?.allNames ? suggestNames(opts.allNames, query) : [];
    throw codedError(
      prefix ? `${prefix}_NOT_FOUND` : "NOT_FOUND",
      `"${query}" нэртэй ${what} олдсонгүй${similar.length > 0 ? `. Ойролцоо: ${similar.map((name) => `"${name}"`).join(", ")}` : " — жагсаалтаас шалгана уу"}`
    );
  }
  throw codedError(
    prefix ? `${prefix}_AMBIGUOUS` : "AMBIGUOUS",
    `"${query}" гэхэд ${matches.length} ${what} таарлаа: ${matches
      .slice(0, 8)
      .map(labelOf)
      .join(", ")} — аль нь болохыг тодруулна уу`
  );
}

/**
 * SIM2-022: зарлагын төрөл КОДООР (get_costing_settings-д «WRITEOFF · Акт,
 * гэмтэл» гэж харагддаг) эсвэл нэрээр. Код яг таарвал түрүүлнэ.
 */
function resolveIssueType<T extends { id: string; code: string; name: string; isActive: boolean }>(
  issueTypes: T[],
  query: string
): T {
  const active = issueTypes.filter((entry) => entry.isActive);
  const q = query.trim().toLowerCase();
  const byCode = active.filter((entry) => entry.code.toLowerCase() === q);
  const matches = byCode.length > 0 ? byCode : nameMatches(active, (entry) => entry.name, query);
  if (matches.length === 0)
    throw codedError(
      "NOT_FOUND",
      `"${query}" зарлагын төрөл олдсонгүй. Боломжит (код · нэр): ${active
        .map((entry) => `${entry.code} · ${entry.name}`)
        .join("; ")}`
    );
  return requireSingle(
    matches,
    (entry) => `${entry.code} · ${entry.name}`,
    "зарлагын төрөл",
    query,
    { allNames: active.map((entry) => `${entry.code} · ${entry.name}`) }
  );
}

function nameMatches<T>(list: T[], nameOf: (entry: T) => string, query: string): T[] {
  const q = query.trim().toLowerCase();
  const exact = list.filter((entry) => nameOf(entry).toLowerCase() === q);
  if (exact.length > 0) return exact;
  return list.filter((entry) => nameOf(entry).toLowerCase().includes(q));
}

// ── Гүйцэтгэгчид ────────────────────────────────────────────────────────────

type JournalLineInput = {
  account: string;
  debit?: number;
  credit?: number;
  description?: string;
};

async function runCreateJournal(
  orgId: string,
  input: {
    date: string;
    description: string;
    lines: JournalLineInput[];
    externalRef?: string;
    currency?: string;
    exchangeRate?: number;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    const existing = await db.query.journalVouchers.findFirst({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        eq(journalVouchers.externalRef, externalRef)
      ),
      with: { lines: { columns: { debit: true } } },
    });
    if (existing) {
      const total = existing.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.date} · ${existing.description}, ${fmt(total)}₮, төлөв: ${existing.status}`,
        action: {
          kind: "voucher",
          id: existing.id,
          title: existing.description || "Журнал",
          status: existing.status === "draft" ? "draft" : "posted",
        },
        dedup: true,
      };
    }
  }
  const ctx = await accountContext(orgId);
  const lines = (input.lines ?? []).map((line) => {
    const { code } = resolveAccount(line.account, ctx);
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (debit < 0 || credit < 0) throw new Error("Дүн сөрөг байж болохгүй");
    if (debit > 0 && credit > 0)
      throw new Error("Нэг мөрөнд дебет, кредит зэрэг байж болохгүй");
    return { account: code, debit, credit, description: line.description ?? "" };
  });
  if (lines.length < 2) throw new Error("Журналд дор хаяж 2 мөр хэрэгтэй");

  // ENT-013: валютын журнал (вэбийн §2b-тэй ИЖИЛ — мөрийн дүн ВАЛЮТААР, ₮-ийг
  // сервер resolveVoucherCurrency-оор ханшаар дахин бодно).
  const currency = (input.currency?.trim() || "MNT").toUpperCase();
  let rate = 1;
  let rateSource: string | undefined;
  let rateDate: string | undefined;
  let rateNote = "";
  if (currency !== "MNT") {
    if (Number(input.exchangeRate) > 0) {
      rate = Number(input.exchangeRate);
      rateSource = "manual";
      rateDate = input.date;
    } else {
      try {
        const lookup = await getOfficialRateForDate(currency, input.date);
        rate = lookup.rate;
        rateSource = "mongolbank";
        rateDate = lookup.rateDate;
      } catch {
        throw codedError(
          "RATE_REQUIRED",
          `${input.date}-ны ${currency} албан ханш олдсонгүй — exchangeRate (1 ${currency} = ? ₮) өгнө үү`
        );
      }
    }
    rateNote = ` · ${currency} @ ${rate}${rateSource === "mongolbank" ? ` (Монголбанк ${rateDate})` : ""}`;
  }

  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) <= 0.01 && totalDebit > 0;
  // Лимит ₮-өөр.
  const baseDebit = Math.round(totalDebit * rate * 100) / 100;

  let status: "draft" | "posted" = "draft";
  let note = "";
  if (mode === "post") {
    const futureNote = futurePeriodDraftNote(input.date);
    if (futureNote) note = futureNote;
    else if (!balanced)
      note = ` (тэнцээгүй тул ноорог үлдэв: Дт ${fmt(totalDebit)} ≠ Кт ${fmt(totalCredit)})`;
    else if (baseDebit > currentAiPostLimit())
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв — нягтланч шалгаж батална)`;
    else status = "posted";
  }

  const { id, warning } = unwrapAction(await createVoucher({
    date: input.date,
    description: input.description,
    lines:
      currency === "MNT"
        ? lines
        : lines.map((line) => ({
            ...line,
            debitFc: line.debit,
            creditFc: line.credit,
            debit: Math.round(line.debit * rate * 100) / 100,
            credit: Math.round(line.credit * rate * 100) / 100,
          })),
    status,
    externalRef,
    currency,
    exchangeRate: currency === "MNT" ? undefined : rate,
    rateSource,
    rateDate,
  }));

  const unit = currency === "MNT" ? "₮" : ` ${currency}`;
  return {
    resultText: `Журнал үүслээ. ID: ${id}, төлөв: ${status}, Дт ${fmt(totalDebit)}${unit} / Кт ${fmt(totalCredit)}${unit}${rateNote}${currency === "MNT" ? "" : ` ≈ ${fmt(baseDebit)}₮`}${note}${warning ? `\n⚠ ${warning}` : ""}`,
    action: {
      kind: "voucher",
      id,
      title: input.description || "Журнал",
      status,
    },
  };
}

async function runCreateArap(
  orgId: string,
  input: {
    documentType: "ar_invoice" | "ap_bill";
    counterparty: string;
    date: string;
    dueDate?: string;
    description: string;
    controlAccount?: string;
    currency?: string;
    exchangeRate?: number;
    purchaseOrder?: string;
    lines: {
      account?: string;
      description?: string;
      amount: number;
      itemCode?: string;
      quantity?: number;
      warehouseCode?: string;
      unitPrice?: number;
      purchaseOrderLineId?: string;
      costComponentCode?: string;
    }[];
    vatMode?: "none" | "exclusive" | "inclusive";
    externalRef?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    const existing = await db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.externalRef, externalRef)
      ),
    });
    if (existing) {
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.documentNo}, ${fmt(Number(existing.totalAmount))}₮, төлөв: ${ARAP_STATUS_LABELS[existing.status] ?? existing.status}`,
        action: {
          kind: "arap",
          id: existing.id,
          title: existing.documentNo,
          status: existing.status === "draft" ? "draft" : "posted",
        },
        dedup: true,
      };
    }
  }
  const ctx = await accountContext(orgId);
  const [cpList, items, whList, costingAccounts] = await Promise.all([
    db.query.counterparties.findMany({
      where: and(eq(counterparties.organizationId, orgId), eq(counterparties.isActive, true)),
    }),
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
    }),
    loadCostingAccountSettings(orgId),
  ]);

  const counterparty = requireSingle(
    nameMatches(cpList, (entry) => entry.name, input.counterparty),
    (entry) => entry.name,
    "харилцагч",
    input.counterparty,
    { codePrefix: "COUNTERPARTY", allNames: cpList.map((entry) => entry.name) }
  );

  const isAp = input.documentType === "ap_bill";
  const controlRaw =
    input.controlAccount?.trim() ||
    (isAp
      ? counterparty.defaultPayableAccountNumber
      : counterparty.defaultReceivableAccountNumber) ||
    "";
  if (!controlRaw)
    throw new Error(
      `${counterparty.name} харилцагчид default ${isAp ? "өглөгийн" : "авлагын"} данс алга — controlAccount параметрээр өгнө үү`
    );
  const control = resolveAccount(controlRaw, ctx);

  const itemsByCode = new Map(items.map((item) => [item.code.toLowerCase(), item]));
  const whByCode = new Map(whList.map((wh) => [wh.code.toLowerCase(), wh]));

  // ── Хангамжийн захиалга (PO): бараа/бүрэлдэхүүн мөр нь ӨГЛӨГИЙН ТҮР
  // ДАНСанд суух ба орлогын хөдөлгөөн ҮҮСЭХГҮЙ (орлого нь хүлээн авалтаас —
  // docs/procurement §3.3 ③④).
  let purchaseOrderId: string | undefined;
  let purchaseOrderNo = "";
  let poDetail: PurchaseOrderDetail | null = null;
  if (input.purchaseOrder?.trim()) {
    if (!isAp)
      throw new Error(
        "Захиалгатай (PO) нэхэмжлэх зөвхөн өглөгийн баримт (ap_bill) байна"
      );
    const order = await findPurchaseOrder(orgId, input.purchaseOrder);
    if (order.status === "closed")
      throw codedError(
        "PO_CLOSED",
        `${order.documentNo} хаагдсан захиалгад нэхэмжлэх нэмэгдэхгүй`
      );
    if (order.status !== "open")
      throw codedError(
        "PO_NOT_OPEN",
        `${order.documentNo} захиалга нээлттэй биш (төлөв: ${PO_STATUS_LABELS[order.status] ?? order.status}) — эхлээд approve_purchase_order`
      );
    purchaseOrderId = order.id;
    purchaseOrderNo = order.documentNo;
    // PO-той баримтын бараатай мөр бүр захиалгын мөртэй холбогдоно — мөрийн
    // ID өгөөгүй бол барааны кодоор нь олж холбоно.
    poDetail = await requirePurchaseOrderDetail(orgId, order.id);
  }

  // Бүрэлдэхүүний кодуудыг урьдчилан ID болгоно (мөрийн map синхрон).
  const componentIdByCode = new Map<string, string>();
  for (const line of input.lines ?? []) {
    const code = line.costComponentCode?.trim();
    if (!code || componentIdByCode.has(code.toUpperCase())) continue;
    const component = await requireCostComponentByCode(orgId, code);
    componentIdByCode.set(code.toUpperCase(), component.id);
  }

  const lines = (input.lines ?? []).map((line) => {
    let itemId: string | undefined;
    let warehouseId: string | undefined;
    // АР: барааны бүртгэлийн борлуулах үнэ — нэгж үнэ/дүн өгөөгүй үед нөхнө
    // (вэбийн АР панельтэй ИЖИЛ дүрэм; үнэ зохиохгүй — байхгүй бол алдаа).
    let itemSalesPrice: number | undefined;
    if (line.itemCode) {
      const item = itemsByCode.get(line.itemCode.trim().toLowerCase());
      if (!item) throw new Error(`"${line.itemCode}" кодтой бараа олдсонгүй (list_inventory-оор шалгана уу)`);
      itemId = item.id;
      if (!isAp && item.salesPrice != null && Number(item.salesPrice) > 0)
        itemSalesPrice = Number(item.salesPrice);
      if (!(Number(line.quantity) > 0))
        throw new Error(`"${item.name}" мөрөнд тоо хэмжээ 0-ээс их байх ёстой`);
      const wh = line.warehouseCode
        ? whByCode.get(line.warehouseCode.trim().toLowerCase())
        : undefined;
      if (!wh) throw new Error(`Бараатай мөрөнд агуулахын код заавал (list_inventory-оор шалгана уу)`);
      warehouseId = wh.id;
    }
    const costComponentId = line.costComponentCode?.trim()
      ? componentIdByCode.get(line.costComponentCode.trim().toUpperCase())
      : undefined;
    if (costComponentId && itemId)
      throw new Error(
        "Нэг мөрөнд бараа ба өртгийн бүрэлдэхүүн зэрэг байж болохгүй"
      );
    if (costComponentId && !purchaseOrderId)
      throw new Error(
        "Өртгийн бүрэлдэхүүнтэй мөр зөвхөн захиалгатай (PO) нэхэмжлэхэд бичигдэнэ — purchaseOrder талбарыг өгнө үү"
      );
    // АП-ийн бараатай мөр клирингт суана (JPR-006) — данс автоматаар;
    // PO-той баримтын бараа/бүрэлдэхүүн мөр нь ӨГЛӨГИЙН түр дансанд.
    const accountRaw =
      (itemId || costComponentId) && isAp
        ? purchaseOrderId
          ? costingAccounts.apClearingAccountNumber
          : costingAccounts.clearingAccountNumber
        : line.account?.trim();
    if (!accountRaw)
      throw new Error("Мөр бүрд данс хэрэгтэй (АП-ийн бараатай мөрөөс бусад)");
    const unitPrice =
      line.unitPrice != null && Number(line.unitPrice) > 0
        ? Number(line.unitPrice)
        : !(Number(line.amount) > 0)
          ? itemSalesPrice
          : undefined;
    return {
      account: resolveAccount(accountRaw, ctx).code,
      description: line.description ?? "",
      amount:
        Number(line.amount) > 0
          ? Number(line.amount)
          : itemId && unitPrice
            ? Math.round(Number(line.quantity) * unitPrice * 100) / 100
            : Number(line.amount),
      itemId,
      quantity: itemId ? Number(line.quantity) : undefined,
      warehouseId,
      purchaseOrderLineId:
        purchaseOrderId && itemId && poDetail
          ? resolvePurchaseOrderLine(poDetail, {
              purchaseOrderLineId: line.purchaseOrderLineId,
              itemCode: line.itemCode,
            }).id
          : undefined,
      unitPrice,
      costComponentId,
    };
  });

  // ENT-030: 0 / сөрөг дүнтэй мөрийг чимээгүй хасаж «дор хаяж нэг мөр»
  // гэж төөрөгдүүлэхгүй — аль мөр буруу болохыг индекстэй нь хэлнэ.
  lines.forEach((line, index) => {
    if (!Number.isFinite(line.amount) || line.amount <= 0)
      throw codedError(
        "INVALID_LINE",
        `Мөр #${index + 1}${line.description ? ` («${line.description}»)` : ""}: дүн ${line.amount} — 0-ээс их байна (буцаалт/хасалтыг кредит баримт эсвэл тусдаа журналаар)`
      );
  });

  // ── НӨАТ (vatMode): exclusive — мөрүүд дээр НЭМЖ, inclusive — дотроос нь
  // ялгаж НӨАТ-ийн мөр автоматаар нэмэгдэнэ. АР → гаралтын НӨАТ (өглөг тал),
  // АП → оролтын НӨАТ (авлага тал); дансууд vat_settings тохиргооноос.
  let vatNote = "";
  if (input.vatMode && input.vatMode !== "none") {
    const vat = await loadVatSettings(orgId);
    const rate = Number(vat.vatRatePercent);
    const vatMain = isAp
      ? vat.inputVatAccountNumber
      : vat.outputVatAccountNumber;
    const vatCode = resolveAccount(vatMain, ctx).code;
    let vatAmount: number;
    if (input.vatMode === "inclusive") {
      const { adjusted, vat: extracted } = applyInclusiveVatToLines(
        lines.map((line) => line.amount),
        rate
      );
      lines.forEach((line, index) => {
        line.amount = adjusted[index];
      });
      vatAmount = extracted;
    } else {
      vatAmount =
        Math.round(
          lines.reduce((sum, line) => sum + line.amount, 0) * rate
        ) / 100;
    }
    if (vatAmount > 0) {
      lines.push({
        account: vatCode,
        description: `НӨАТ ${rate}%`,
        amount: vatAmount,
        itemId: undefined,
        quantity: undefined,
        warehouseId: undefined,
        purchaseOrderLineId: undefined,
        unitPrice: undefined,
        costComponentId: undefined,
      });
      vatNote = `, НӨАТ ${fmt(vatAmount)}₮ (${input.vatMode})`;
    }
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  // Валют: ил өгсөн → PO-гийн БАРААНЫ нэхэмжлэх бол захиалгынх → бусад үед
  // (PO-гүй, эсвэл PO-гийн нэмэлт зардал) харилцагчийн анхдагч → MNT —
  // createArApDocument-ийн default-тай ИЖИЛ (аудит M: PO-гүй нэхэмжлэх
  // харилцагчийн USD-г үл тоож MNT болдог байв). Гааль/тээврийн НЭМЭЛТ
  // ЗАРДЛЫН нэхэмжлэх PO-гийн валютыг өвлөхгүй (ENT-038/071: USD PO-д
  // холбосон ₮ гаалийн нэхэмжлэх USD болж, «USD ханш 0-ээс их» алдаа өгдөг байв).
  const hasPoGoodsLines = lines.some((line) => line.itemId || line.purchaseOrderLineId);
  const effectiveCurrency = (
    input.currency?.trim() ||
    (poDetail && hasPoGoodsLines ? poDetail.currency : counterparty.defaultCurrency) ||
    "MNT"
  ).toUpperCase();
  // Валютын баримтад ханш өгөөгүй бол баримтын ӨДРИЙН албан ханш (зохиохгүй —
  // олдохгүй бол exchangeRate-ийг шаардана).
  let exchangeRate = input.exchangeRate;
  let rateNote = "";
  if (effectiveCurrency !== "MNT" && !(Number(exchangeRate) > 0)) {
    try {
      const lookup = await getOfficialRateForDate(effectiveCurrency, input.date);
      exchangeRate = lookup.rate;
      rateNote = `, ханш ${lookup.rate} (Монголбанк ${lookup.rateDate})`;
    } catch {
      throw codedError(
        "RATE_REQUIRED",
        `${input.date}-ны ${effectiveCurrency} албан ханш олдсонгүй — exchangeRate (1 ${effectiveCurrency} = ? ₮) өгнө үү`
      );
    }
  }
  // Лимитийг ЗААВАЛ MNT-ээр шалгана — валютын баримтын дүн ханшаар үржинэ.
  const baseTotal =
    effectiveCurrency !== "MNT"
      ? total * (Number(exchangeRate) || 0)
      : total;
  let postNow = false;
  let note = "";
  if (mode === "post") {
    const futureNote = futurePeriodDraftNote(input.date);
    if (futureNote) note = futureNote;
    else if (baseTotal > currentAiPostLimit() || !(baseTotal > 0))
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`;
    else postNow = true;
  }

  const dueDate =
    input.dueDate?.trim() ||
    (() => {
      const date = new Date(`${input.date}T00:00:00`);
      date.setDate(date.getDate() + counterparty.paymentTermsDays);
      return date.toISOString().slice(0, 10);
    })();

  const { id, documentNo } = unwrapAction(await createArApDocument({
    documentType: input.documentType,
    counterpartyId: counterparty.id,
    date: input.date,
    dueDate,
    currency: effectiveCurrency,
    exchangeRate: effectiveCurrency === "MNT" ? undefined : exchangeRate,
    controlAccountNumber: control.code,
    description: input.description,
    purchaseOrderId,
    lines,
    postNow,
    externalRef,
  }));

  const label = isAp ? "Өглөгийн нэхэмжлэх" : "Авлагын нэхэмжлэл";
  return {
    resultText: `${label} үүслээ. Дугаар: ${documentNo}, харилцагч: ${counterparty.name}, дүн: ${fmt(total)} ${effectiveCurrency === "MNT" ? "₮" : effectiveCurrency}${rateNote}${vatNote}, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}${purchaseOrderNo ? ` · захиалга ${purchaseOrderNo} (Dr өглөгийн түр данс; орлого нь хүлээн авалтаас)` : ""}`,
    action: {
      kind: "arap",
      id,
      title: `${documentNo} · ${counterparty.name}`,
      status: postNow ? "posted" : "draft",
    },
  };
}

/**
 * Зарлагын дараа мөнгөн данс хасах үлдэгдэлтэй болсон бол анхааруулга
 * (ENT-062 — зөвхөн самбарт харагддаг байв). Хориг биш: банкны овердрафт
 * байж болно, гэхдээ ИЛ хэлнэ.
 */
async function negativeCashBalanceNote(orgId: string, cashAccountId: string | undefined) {
  if (!cashAccountId) return "";
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.id, cashAccountId)),
  });
  if (!account) return "";
  const balance = (await loadCashBalancesFast(orgId, [account])).get(account.id) ?? 0;
  if (balance >= -0.005) return "";
  const unit = account.currency === "MNT" ? "₮" : ` ${account.currency}`;
  return ` ⚠ ${account.name} ХАСАХ үлдэгдэлтэй болов: ${fmt(balance)}${unit} — орлого дутуу бүртгэгдсэн эсвэл буруу данснаас төлсөн эсэхийг шалгана уу`;
}

async function runCreateCash(
  orgId: string,
  input: {
    documentType: "receipt" | "payment" | "transfer";
    date: string;
    cashAccount: string;
    toCashAccount?: string;
    counterAccount?: string;
    amount: number;
    description: string;
    counterparty?: string;
    exchangeRate?: number;
    toAmount?: number;
    clearingAccount?: string;
    cashFlowCode?: string;
    externalRef?: string;
    applyTo?: { documentId: string; amount: number }[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  // Өмнө нь энэ ref-ээр үүссэн баримтууд: яг таарсан (нэг баримт) болон
  // ref#N (split төлөлтийн хэсгүүд). Split-ийн дундуур тасарсан retry дээр
  // "аль хэдийн үүссэн" гэж зогсохгүй — байгаа хэсгийг алгасаж, дутууг нь
  // үргэлжлүүлж үүсгэнэ (resume).
  const dedupResult = (existing: typeof cashDocuments.$inferSelect): AiToolResult => ({
    resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.documentNo}, ${existing.date}, ${fmt(Number(existing.amount))}₮, төлөв: ${existing.status}`,
    action: {
      kind: "cash",
      id: existing.id,
      title: existing.description,
      status: existing.status === "draft" ? "draft" : "posted",
    },
    dedup: true,
  });
  const existingRefs = new Set<string>();
  let existingPart1: typeof cashDocuments.$inferSelect | undefined;
  if (externalRef) {
    const likeSafe = externalRef.replace(/[\\%_]/g, (c) => `\\${c}`);
    const existingDocs = await db.query.cashDocuments.findMany({
      where: and(
        eq(cashDocuments.organizationId, orgId),
        or(
          eq(cashDocuments.externalRef, externalRef),
          like(cashDocuments.externalRef, `${likeSafe}#%`)
        )
      ),
    });
    for (const doc of existingDocs)
      if (doc.externalRef) existingRefs.add(doc.externalRef);
    // Яг таарсан ref = урьд нь НЭГ баримтаар бүрэн үүссэн — хуучин dedup.
    const exact = existingDocs.find((doc) => doc.externalRef === externalRef);
    if (exact) return dedupResult(exact);
    existingPart1 = existingDocs.find(
      (doc) => doc.externalRef === `${externalRef}#1`
    );
  }

  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
  });
  const findAccount = (query: string) =>
    requireSingle(
      nameMatches(accounts, (entry) => entry.name, query),
      (entry) => entry.name,
      "мөнгөн данс",
      query,
      { allNames: accounts.map((entry) => entry.name) }
    );

  const primary = findAccount(input.cashAccount);
  const secondary = input.toCashAccount ? findAccount(input.toCashAccount) : null;

  // SIM2-021: өөр валюттай дансны шилжүүлэг = валют солилцоо — түр дансаар
  // хоёр баримт (зарлага + орлого), ₮ дүн ижил тул түр данс тэглэгдэнэ.
  if (input.documentType === "transfer" && secondary && secondary.currency !== primary.currency) {
    if (existingPart1) return dedupResult(existingPart1);
    const plan = planCurrencyExchange({
      fromCurrency: primary.currency,
      toCurrency: secondary.currency,
      amount: Number(input.amount),
      toAmount: input.toAmount,
      exchangeRate: input.exchangeRate,
    });
    const ctx = await accountContext(orgId);
    const clearing = resolveAccount(input.clearingAccount?.trim() || "11000099", ctx).main;
    const { postNow, note } =
      mode !== "post"
        ? { postNow: false, note: "" }
        : futurePeriodDraftNote(input.date)
          ? { postNow: false, note: futurePeriodDraftNote(input.date)! }
          : plan.mnt > currentAiPostLimit()
            ? { postNow: false, note: ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)` }
            : { postNow: true, note: "" };
    const legs = [
      {
        documentType: "payment" as const,
        fromCashAccountId: primary.id,
        amount: plan.fromAmount,
        exchangeRate: plan.fromRate,
        ref: externalRef ? `${externalRef}#1` : undefined,
      },
      {
        documentType: "receipt" as const,
        toCashAccountId: secondary.id,
        amount: plan.toAmount,
        exchangeRate: plan.toRate,
        ref: externalRef ? `${externalRef}#2` : undefined,
      },
    ];
    const ids: string[] = [];
    for (const leg of legs) {
      if (leg.ref && existingRefs.has(leg.ref)) continue;
      const result = await createCashDocument({
        documentType: leg.documentType,
        date: input.date,
        fromCashAccountId: "fromCashAccountId" in leg ? leg.fromCashAccountId : undefined,
        toCashAccountId: "toCashAccountId" in leg ? leg.toCashAccountId : undefined,
        counterAccountNumber: clearing,
        amount: leg.amount,
        exchangeRate: leg.exchangeRate,
        description: input.description,
        counterparty: input.counterparty,
        cashFlowCode: input.cashFlowCode?.trim() || undefined,
        postNow: false,
        externalRef: leg.ref,
      });
      if (result.error) {
        // Хагас солилцоо үлдээхгүй — эхний ноорог хөлийг цэвэрлэнэ.
        for (const id of ids) await deleteCashDocument(id);
        throw new Error(result.error);
      }
      if (result.id) ids.push(result.id);
    }
    // Хоёр хөл ноорогоор бүрэн үүссэний ДАРАА л батална.
    if (postNow)
      for (const [index, id] of ids.entries()) {
        const posted = await postCashDocument(id);
        if (posted.error)
          throw new Error(
            `${posted.error}${index > 0 ? " — эхний хөл батлагдсан, хоёр дахь нь ноорог үлдэв (post_cash_document-оор батална)" : ""}`
          );
      }
    return {
      resultText: `Валют солилцоо: ${primary.name} −${fmt(plan.fromAmount)} ${primary.currency} → ${secondary.name} +${fmt(plan.toAmount)} ${secondary.currency} (ханш ${primary.currency === "MNT" ? plan.toRate : plan.fromRate}, ₮ ${fmt(plan.mnt)}; түр данс ${clearing} тэглэгдэнэ) — 2 баримт, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}`,
      action: {
        kind: "cash",
        id: ids[0] ?? "",
        title: `Валют солилцоо · ${input.description}`.slice(0, 80),
        status: postNow ? "posted" : "draft",
      },
    };
  }

  let counterAccountNumber: string | undefined;
  if (input.counterAccount) {
    const ctx = await accountContext(orgId);
    counterAccountNumber = resolveAccount(input.counterAccount, ctx).main;
  }

  const totalAmount = Math.round(Number(input.amount) * 100) / 100;

  // ── applyTo: төлөлтийг нэхэмжлэхүүдэд холбох (спек §7) ──────────────────
  const applyTo = (input.applyTo ?? []).map((entry) => ({
    documentId: String(entry.documentId ?? "").trim(),
    amount: Math.round(Number(entry.amount) * 100) / 100,
  }));
  const allocations: {
    document: typeof arApDocuments.$inferSelect;
    amount: number;
  }[] = [];
  if (applyTo.length > 0) {
    if (input.documentType === "transfer")
      throw new Error("Шилжүүлэгт applyTo хэрэглэхгүй — орлого/зарлагад л нэхэмжлэх холбоно");
    const documents = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.organizationId, orgId),
      orderBy: [desc(arApDocuments.createdAt)],
      limit: 1000,
    });
    for (const alloc of applyTo) {
      if (!(alloc.amount > 0))
        throw new Error("applyTo мөр бүрийн дүн 0-ээс их байх ёстой");
      const q = alloc.documentId.toLowerCase();
      const byNo = documents.filter((doc) => doc.documentNo.toLowerCase() === q);
      const byRef = documents.filter(
        (doc) => (doc.externalRef ?? "").toLowerCase() === q && q.length > 0
      );
      const document =
        byNo.length === 1
          ? byNo[0]
          : byRef.length === 1
            ? byRef[0]
            : resolveByIdPrefix(documents, alloc.documentId, "нэхэмжлэх");
      const balance =
        Number(document.totalAmount) - Number(document.paidAmount);
      if (alloc.amount > balance + 0.01)
        throw new Error(
          `${document.documentNo}: хуваарилах дүн (${fmt(alloc.amount)}₮) үлдэгдлээс (${fmt(balance)}₮) их байна`
        );
      allocations.push({ document, amount: alloc.amount });
    }
    const applied = allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
    if (applied > totalAmount + 0.01)
      throw new Error(
        `applyTo нийлбэр (${fmt(applied)}₮) төлөлтийн дүнгээс (${fmt(totalAmount)}₮) их байна`
      );
  }

  const decidePost = (amount: number) => {
    if (mode !== "post") return { postNow: false, note: "" };
    const futureNote = futurePeriodDraftNote(input.date);
    if (futureNote) return { postNow: false, note: futureNote };
    // Лимит ЗААВАЛ MNT-ээр: валютын дансны дүн ханшаар үржинэ (ханш
    // байхгүй бол аюулгүй тал руу — ноорог үлдээнэ).
    const baseAmount =
      primary.currency !== "MNT"
        ? amount * (Number(input.exchangeRate) || 0)
        : amount;
    if (baseAmount > currentAiPostLimit() || !(baseAmount > 0))
      return {
        postNow: false,
        note: ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`,
      };
    return { postNow: true, note: "" };
  };
  const commonFields = (amount: number) => ({
    documentType: input.documentType,
    date: input.date,
    fromCashAccountId:
      input.documentType === "payment" || input.documentType === "transfer"
        ? primary.id
        : undefined,
    toCashAccountId:
      input.documentType === "receipt"
        ? primary.id
        : input.documentType === "transfer"
          ? secondary?.id
          : undefined,
    counterparty: input.counterparty,
    amount,
    exchangeRate: input.exchangeRate,
    // ENT-050: S8 ангилал — MCP-ээр оноох зам байгаагүй.
    cashFlowCode: input.cashFlowCode?.trim() || undefined,
  });
  const typeLabel =
    input.documentType === "receipt"
      ? "Орлого"
      : input.documentType === "payment"
        ? "Зарлага"
        : "Шилжүүлэг";
  const controlMainOf = (doc: typeof arApDocuments.$inferSelect) =>
    parseSegParts(doc.controlAccountNumber, [3])[3] ?? doc.controlAccountNumber;

  const applied = allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
  const remainder = Math.round((totalAmount - applied) * 100) / 100;

  // Энгийн зам: нэхэмжлэхгүй, эсвэл ГАНЦ нэхэмжлэх бүтэн дүнгээ авч байвал
  // нэг л баримт үүсгэнэ (settlement нь баримтын дүнгээр бүтнээр хийгддэг).
  if (allocations.length === 0 || (allocations.length === 1 && remainder <= 0.01)) {
    // Урьд нь ИЖИЛ ref-ээр split үүсч эхэлсэн бол шинэ (давхар) баримт
    // үүсгэхгүй — эхний хэсгийг нь заасан dedup хариу буцаана.
    if (existingPart1) return dedupResult(existingPart1);
    const linked = allocations[0]?.document;
    const { postNow, note } = decidePost(totalAmount);
    const { id } = unwrapAction(await createCashDocument({
      ...commonFields(totalAmount),
      counterAccountNumber:
        counterAccountNumber ?? (linked ? controlMainOf(linked) : undefined),
      description: input.description,
      postNow,
      arApDocumentId: linked?.id,
      externalRef,
    }));
    const balanceNote =
      postNow && input.documentType !== "receipt"
        ? await negativeCashBalanceNote(orgId, primary.id)
        : "";
    return {
      resultText: `Мөнгөн хөрөнгийн баримт үүслээ. ${typeLabel}, ${primary.name}, ${fmt(totalAmount)}₮${linked ? `, нэхэмжлэх: ${linked.documentNo}` : ""}, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}${balanceNote}`,
      action: {
        kind: "cash",
        id,
        title: `${typeLabel} · ${input.description}`.slice(0, 80),
        status: postNow ? "posted" : "draft",
      },
    };
  }

  // Хуваарилалттай зам: нэхэмжлэх бүрд (болон үлдэгдэлд) тусдаа баримт.
  // Settlement нь баримт бүрийн дүнгээр хийгддэг тул нэг баримтад олон
  // нэхэмжлэх холбох боломжгүй — хуваарилалт бүр өөрийн баримттай.
  if (remainder > 0.01 && !counterAccountNumber)
    throw new Error(
      `Хуваарилагдаагүй ${fmt(remainder)}₮ үлдэж байна — counterAccount өгнө үү (эсвэл applyTo нийлбэрийг дүнтэй тэнцүүлнэ)`
    );
  const created: string[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  // Лимитийг НИЙТ төлөлтийн дүнгээр нэг удаа шийднэ — нэг эдийн засгийн
  // гүйлгээг хэсэглэж хуваагаад лимит тойрохоос сэргийлнэ.
  const totalDecision = decidePost(totalAmount);
  let part = 0;
  /** Retry-resume: өмнө нь үүссэн хэсгийг алгасаж, дутууг нь л үүсгэнэ. */
  const partExists = (n: number) =>
    externalRef !== undefined && existingRefs.has(`${externalRef}#${n}`);
  for (const alloc of allocations) {
    part += 1;
    if (partExists(part)) {
      skippedCount += 1;
      created.push(
        `${alloc.document.documentNo} · ${fmt(alloc.amount)}₮ · алгассан (өмнө үүссэн)`
      );
      continue;
    }
    const { postNow, note } = totalDecision;
    unwrapAction(await createCashDocument({
      ...commonFields(alloc.amount),
      counterAccountNumber: controlMainOf(alloc.document),
      description: `${input.description} (${alloc.document.documentNo})`,
      postNow,
      arApDocumentId: alloc.document.id,
      externalRef: externalRef ? `${externalRef}#${part}` : undefined,
    }));
    createdCount += 1;
    created.push(
      `${alloc.document.documentNo} · ${fmt(alloc.amount)}₮ · үүслээ (${postNow ? "батлагдсан" : "ноорог"})${note}`
    );
  }
  if (remainder > 0.01) {
    part += 1;
    if (partExists(part)) {
      skippedCount += 1;
      created.push(
        `хуваарилагдаагүй · ${fmt(remainder)}₮ · алгассан (өмнө үүссэн)`
      );
    } else {
      const { postNow, note } = totalDecision;
      unwrapAction(await createCashDocument({
        ...commonFields(remainder),
        counterAccountNumber,
        description: `${input.description} (хуваарилагдаагүй)`,
        postNow,
        externalRef: externalRef ? `${externalRef}#${part}` : undefined,
      }));
      createdCount += 1;
      created.push(
        `хуваарилагдаагүй · ${fmt(remainder)}₮ · үүслээ (${postNow ? "батлагдсан" : "ноорог"})${note}`
      );
    }
  }
  return {
    resultText: [
      `${typeLabel} ${fmt(totalAmount)}₮ (${primary.name}) ${part} баримтад хуваагдаж нэхэмжлэхүүдэд холбогдлоо${skippedCount > 0 ? ` (үүссэн ${createdCount}, алгассан ${skippedCount})` : ""}:`,
      ...created.map((line) => `  ${line}`),
    ].join("\n"),
    // Бүх хэсэг нь өмнө үүсчихсэн байсан бол шинэ бичлэг үүсээгүй — dedup.
    dedup: createdCount === 0 && skippedCount > 0,
  };
}

async function runCreateOpeningStock(
  input: {
    date: string;
    lines: { itemCode: string; warehouseCode: string; quantity: number; unitCost: number }[];
    counterAccount?: string;
    externalRef?: string;
    description?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const plan = planOpeningStock(Array.isArray(input.lines) ? input.lines : []);
  if (!plan.ok) return { resultText: `Алдаа: [INVALID_INPUT] ${plan.errors.slice(0, 20).join("; ")}` };
  // §9: шууд батлах нь зөвхөн «Шууд бичих» горимд, батлах хязгаар дотор.
  const overLimit = plan.totalAmount > currentAiPostLimit();
  const post = mode === "post" && !overLimit;
  const result = unwrapAction(
    await createOpeningStock({
      date: input.date,
      lines: input.lines,
      post,
      counterAccount: input.counterAccount ?? null,
      externalRef: input.externalRef ?? null,
      description: input.description ?? null,
    })
  );
  const fmt = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (result.dedup)
    return {
      resultText: `Аль хэдийн оруулсан (externalRef давхардсан) — ${fmt(result.totalAmount)}₮, төлөв: ${result.status === "posted" ? `батлагдсан${result.voucherNo ? ` (${result.voucherNo})` : ""}` : "ноорог"}. Шинэ бичилт үүсээгүй.`,
      dedup: true,
    };
  const statusText =
    result.status === "posted"
      ? `батлагдсан — журнал ${result.voucherNo ?? result.voucherId}`
      : `өртгийн бичилт НООРОГ${mode === "post" && overLimit ? ` (${fmt(currentAiPostLimit())}₮-с их тул)` : ""} — нягтланч Өртөг → Өртгийн бичилтээс батална`;
  return {
    resultText: `Нээлтийн барааны үлдэгдэл оруулагдлаа: ${result.created} мөр, нийт ${fmt(result.totalAmount)}₮, ${input.date}. GL: Dr барааны нөөц / Cr ${result.counterAccount}. Төлөв: ${statusText}. ${
      input.counterAccount?.trim()
        ? `Нээлтийн журнал барааг ${result.counterAccount} дансанд Дт-ээр бичсэн бол тэр данс тэглэгдэнэ.`
        : `Нээлтийн журналд барааны дүнг ДАХИН бичихгүй (${result.counterAccount} тэгширнэ).`
    }`,
  };
}

async function runCreateMovement(
  orgId: string,
  input: {
    movementType: "receipt" | "issue" | "transfer" | "adjustment" | "return_in" | "return_out";
    date: string;
    itemCode: string;
    warehouseCode: string;
    toWarehouseCode?: string;
    quantity: number;
    description?: string;
    issueType?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const [items, whList, issueTypes] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
    }),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.organizationId, orgId),
    }),
  ]);

  const item = requireSingle(
    nameMatches(items, (entry) => entry.code, input.itemCode).length > 0
      ? nameMatches(items, (entry) => entry.code, input.itemCode)
      : nameMatches(items, (entry) => entry.name, input.itemCode),
    (entry) => `${entry.code} (${entry.name})`,
    "бараа",
    input.itemCode
  );
  const findWh = (query: string) =>
    requireSingle(
      nameMatches(whList, (entry) => entry.code, query).length > 0
        ? nameMatches(whList, (entry) => entry.code, query)
        : nameMatches(whList, (entry) => entry.name, query),
      (entry) => `${entry.code} (${entry.name})`,
      "агуулах",
      query
    );
  const warehouse = findWh(input.warehouseCode);
  const toWarehouse = input.toWarehouseCode ? findWh(input.toWarehouseCode) : null;

  let issueTypeId: string | undefined;
  if (input.movementType === "issue" && input.issueType)
    issueTypeId = resolveIssueType(issueTypes, input.issueType).id;

  const confirmNow = mode === "post";
  const { id } = unwrapAction(await createInventoryMovement({
    movementType: input.movementType,
    date: input.date,
    itemId: item.id,
    warehouseId: warehouse.id,
    toWarehouseId: toWarehouse?.id,
    quantity: Number(input.quantity),
    description: input.description,
    issueTypeId,
    confirmNow,
  }));

  const typeLabels: Record<string, string> = {
    receipt: "Орлого",
    issue: "Зарлага",
    transfer: "Шилжүүлэг",
    adjustment: "Тохируулга",
    return_in: "Буцаан авалт",
    return_out: "Буцаалт",
  };
  return {
    resultText: `Бараа материалын хөдөлгөөн үүслээ. ${typeLabels[input.movementType]}, ${item.code} × ${input.quantity}, ${warehouse.code}${toWarehouse ? ` → ${toWarehouse.code}` : ""}, төлөв: ${confirmNow ? "баталгаажсан" : "ноорог"}. Өртгийн үнэлгээ сар хаахад хийгдэнэ.`,
    action: {
      kind: "inventory",
      id,
      title: `${typeLabels[input.movementType]} · ${item.code} × ${input.quantity}`,
      status: confirmNow ? "confirmed" : "draft",
    },
  };
}

async function runCreateFixedAsset(
  orgId: string,
  input: {
    name: string;
    acquisitionDate: string;
    cost: number;
    salvageValue?: number;
    usefulLifeMonths: number;
    depreciationMethod?: "straight_line" | "declining_balance";
    custodian: string;
    depreciationStartMonth?: string;
    openingAccumulatedDepreciation?: number;
    openingTaxAccumulated?: number;
    openingAsOf?: string;
    assetAccountNumber?: string;
    accumDepAccountNumber?: string;
    depExpenseAccountNumber?: string;
    capitalizeFrom?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const ctx = await accountContext(orgId);
  const asDraft = mode !== "post";
  const capitalizeFrom = input.capitalizeFrom?.trim()
    ? resolveAccount(input.capitalizeFrom.trim(), ctx).main
    : undefined;
  if (capitalizeFrom && !asDraft) assertPostLimit(Number(input.cost));
  const assetAccount = resolveAccount(
    input.assetAccountNumber?.trim() || DEFAULT_FA_ASSET_ACCOUNT,
    ctx
  ).main;
  const accumAccount = resolveAccount(
    input.accumDepAccountNumber?.trim() || accumDepAccountFor(assetAccount),
    ctx
  ).main;

  // Default: авсан сарын ДАРААХ сараас элэгдүүлж эхэлнэ.
  const startMonth =
    input.depreciationStartMonth?.trim() ||
    (() => {
      const [y, m] = input.acquisitionDate.slice(0, 7).split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      return next;
    })();

  const { id, code, voucherNo } = unwrapAction(
    await createFixedAsset(
      {
        name: input.name,
        acquisitionDate: input.acquisitionDate,
        cost: Number(input.cost),
        salvageValue: Number(input.salvageValue ?? 0),
        usefulLifeMonths: Number(input.usefulLifeMonths),
        depreciationMethod: input.depreciationMethod ?? "straight_line",
        custodian: input.custodian,
        depreciationStartMonth: startMonth,
        openingAccumulatedDepreciation: input.openingAccumulatedDepreciation,
        openingTaxAccumulated: input.openingTaxAccumulated,
        openingAsOf: input.openingAsOf,
        assetAccountNumber: assetAccount,
        accumDepAccountNumber: accumAccount,
        depExpenseAccountNumber: resolveAccount(
          input.depExpenseAccountNumber?.trim() || "70000001",
          ctx
        ).main,
      },
      { asDraft, capitalizeFrom }
    )
  );

  const opening = Number(input.openingAccumulatedDepreciation ?? 0);
  // SIM2-037: GL-тэй холбоо ИЛ — журнал үүссэн эсэх, үгүй бол яагаад.
  const glText = voucherNo
    ? ` · капиталжуулах журнал ${voucherNo} (Dr ${assetAccount} / Cr ${capitalizeFrom}, ${asDraft ? "ноорог — карт идэвхжихэд батлагдана" : "батлагдсан"})`
    : input.openingAsOf
      ? ""
      : ` · GL журнал үүсээгүй: өртөг АП/журналаар ${assetAccount}-д аль хэдийн орсон бол зөв; түр данс (20000099 г.м.)-д авсан бол capitalizeFrom өгнө (reconcile_modules ҮХ хэсэг зөрүүг харуулна)`;
  const openingText =
    opening > 0
      ? `, нээлтийн хуримт. элэгдэл ${fmt(opening)}₮ (${input.openingAsOf}) — үлдэгдэл өртөг ${fmt(Number(input.cost) - opening)}₮`
      : "";
  return {
    resultText: `Үндсэн хөрөнгийн карт үүслээ. Код: ${code}, ${input.name}, өртөг ${fmt(Number(input.cost))}₮${openingText}, данс ${assetAccount}/${accumAccount}, төлөв: ${asDraft ? "ноорог" : "идэвхтэй"}${glText}`,
    action: {
      kind: "fa",
      id,
      title: `${code} · ${input.name}`,
      status: asDraft ? "draft" : "active",
    },
  };
}

// ── Батлах / устгах гүйцэтгэгчид ────────────────────────────────────────────

/** ID-г бүтэн эсвэл угтвараар нь ГАНЦ тохирол болгож шийднэ. */
/**
 * Баримтыг ЛАВЛАГААГААР шууд DB-ээс шүүх нөхцөл — ID угтвар, дугаар
 * (documentNo), externalRef (ENT-033: сүүлийн 500–1000 бичлэгийн цонхонд
 * хайдаг байсан тул том байгууллагад хуучин баримт олдохгүй байв).
 */
function refCondition(
  columns: { id: AnyPgColumn; documentNo?: AnyPgColumn; externalRef?: AnyPgColumn },
  ref: string
): SQL {
  const query = ref.trim().toLowerCase();
  const prefix = query.replace(/[\\%_]/g, "");
  const conditions: SQL[] = [];
  if (prefix.length >= 6) conditions.push(sql`${columns.id}::text like ${`${prefix}%`}`);
  if (columns.documentNo) conditions.push(sql`lower(${columns.documentNo}) = ${query}`);
  if (columns.externalRef) conditions.push(sql`lower(${columns.externalRef}) = ${query}`);
  return conditions.length > 0 ? or(...conditions)! : sql`false`;
}

function resolveByIdPrefix<
  T extends { id: string; documentNo?: string | null; externalRef?: string | null },
>(rows: T[], idOrPrefix: string, what: string): T {
  const query = idOrPrefix.trim().toLowerCase();
  // Дугаар / externalRef-ээр ЯГ таарвал (мөрөнд тэр багана байвал).
  const byNo = rows.filter((row) => row.documentNo?.toLowerCase() === query);
  if (byNo.length === 1) return byNo[0];
  const byRef = rows.filter((row) => row.externalRef?.toLowerCase() === query);
  if (byRef.length === 1) return byRef[0];
  if (query.length < 6)
    throw new Error(`${what}-ийн ID дор хаяж 6 тэмдэгт байх ёстой (эсвэл баримтын дугаар өгнө)`);
  const matches = rows.filter((row) => row.id.toLowerCase().startsWith(query));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0)
    throw new Error(
      `"${idOrPrefix}" гэсэн ID/дугаартай ${what} олдсонгүй — list_* tool-оор шалгана уу`
    );
  throw new Error(`"${idOrPrefix}" гэхэд ${matches.length} ${what} таарлаа — бүтэн ID өгнө үү`);
}

/**
 * Журналыг ДУГААРААР (GL-26-000001) эсвэл ID-гаар олно. Хэрэглэгч чатад
 * дугаараа бичдэг (жагсаалтад ч тэр гардаг) тул эхлээд түүгээр хайж, олдохгүй
 * бол ID угтвар руу шилжинэ — хуучин, дугааргүй бичилт ч ажиллана.
 */
function resolveVoucherRef<
  T extends { id: string; documentNo?: string | null },
>(rows: T[], ref: string): T {
  const query = ref.trim().toLowerCase();
  const byNo = rows.filter((row) => row.documentNo?.toLowerCase() === query);
  if (byNo.length === 1) return byNo[0];
  return resolveByIdPrefix(rows, ref, "журнал");
}

/** Батлах үйлдэл зөвхөн "Шууд бичих" горимд — эс бөгөөс ойлгомжтой татгалзал. */
function assertPostMode(mode: AiWriteMode) {
  if (mode !== "post")
    throw codedError(
      "DIRECT_MODE_REQUIRED",
      "Батлах нь зөвхөн 'Шууд бичих' горимд зөвшөөрөгдөнө. Entry → AI холболт хуудаснаас горимоо солих эсвэл вэб дээрээс өөрөө батална уу."
    );
}

function assertPostLimit(total: number) {
  const limit = currentAiPostLimit();
  if (total > limit)
    throw codedError(
      "AMOUNT_LIMIT_EXCEEDED",
      `${fmt(total)}₮ нь ${fmt(limit)}₮-ийн хязгаараас их — нягтланч вэб дээрээс шалгаж батална уу`
    );
}

async function runPostJournal(
  orgId: string,
  input: { voucherId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.organizationId, orgId),
    columns: {
      id: true,
      documentNo: true,
      status: true,
      description: true,
      date: true,
    },
    with: { lines: { columns: { debit: true } } },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
  const voucher = resolveVoucherRef(vouchers, input.voucherId);
  if (voucher.status !== "draft")
    throw new Error(`Журнал ноорог биш байна (төлөв: ${voucher.status})`);
  const total = voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  assertPostLimit(total);

  const posted = unwrapAction(await postVoucher(voucher.id));
  return {
    resultText: `Журнал батлагдлаа. ${voucher.date} · ${voucher.description} · ${fmt(total)}₮${posted.warning ? `\n⚠ ${posted.warning}` : ""}`,
    action: {
      kind: "voucher",
      id: voucher.id,
      title: voucher.description || "Журнал",
      status: "posted",
    },
  };
}

async function runDeleteJournal(
  orgId: string,
  input: { voucherId: string }
): Promise<AiToolResult> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.organizationId, orgId),
    columns: {
      id: true,
      documentNo: true,
      status: true,
      description: true,
      date: true,
    },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
  const voucher = resolveVoucherRef(vouchers, input.voucherId);
  // SIM2-046: батлагдсан журнал устгагдахгүй — буцаалтаар залруулна.
  if (voucher.status !== "draft")
    throw codedError(
      "USE_REVERSAL",
      `${voucher.documentNo ?? voucher.id.slice(0, 8)} батлагдсан журналыг устгахгүй — reverse_journal_voucher-оор буцаана (аудитын мөр хадгалагдана)`
    );
  unwrapAction(await deleteVoucher(voucher.id));
  return {
    resultText: `Ноорог журнал устгагдлаа: ${voucher.date} · ${voucher.description}`,
  };
}

async function runPostCash(
  orgId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const documents = await db.query.cashDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(cashDocuments.organizationId, orgId), refCondition({ id: cashDocuments.id, documentNo: cashDocuments.documentNo, externalRef: cashDocuments.externalRef }, input.documentId)),
    columns: {
      id: true,
      status: true,
      description: true,
      date: true,
      amount: true,
      baseAmount: true,
      documentNo: true,
      externalRef: true,
    },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 50,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  if (document.status !== "draft")
    throw new Error(`Баримт ноорог биш байна (төлөв: ${document.status})`);
  assertPostLimit(Number(document.baseAmount ?? document.amount));

  unwrapAction(await postCashDocument(document.id));
  return {
    resultText: `Мөнгөн хөрөнгийн баримт батлагдаж GL-д бичигдлээ. ${document.date} · ${document.description}`,
    action: {
      kind: "cash",
      id: document.id,
      title: document.description,
      status: "posted",
    },
  };
}

async function runDeleteCash(
  orgId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const documents = await db.query.cashDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(cashDocuments.organizationId, orgId), refCondition({ id: cashDocuments.id, documentNo: cashDocuments.documentNo, externalRef: cashDocuments.externalRef }, input.documentId)),
    columns: {
      id: true,
      status: true,
      description: true,
      date: true,
      amount: true,
      baseAmount: true,
      documentNo: true,
      externalRef: true,
    },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 50,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  if (document.status !== "draft") {
    assertPostMode(mode);
    assertPostLimit(Number(document.baseAmount ?? document.amount));
  }
  unwrapAction(await deleteCashDocument(document.id));
  return {
    resultText: `${document.status === "draft" ? "Ноорог кассын баримт" : "Батлагдсан кассын баримт GL-тэй нь хамт"} устгагдлаа: ${document.date} · ${document.description}`,
  };
}

async function runPostArap(
  orgId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const documents = await db.query.arApDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(arApDocuments.organizationId, orgId), refCondition({ id: arApDocuments.id, documentNo: arApDocuments.documentNo, externalRef: arApDocuments.externalRef }, input.documentId)),
    columns: {
      id: true,
      status: true,
      documentNo: true,
      description: true,
      totalAmount: true,
      baseTotalAmount: true,
      externalRef: true,
    },
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 50,
  });
  // Нэхэмжлэхийн дугаараар ч, ID-гаар ч олно.
  const byNo = documents.filter(
    (doc) => doc.documentNo.toLowerCase() === input.documentId.trim().toLowerCase()
  );
  const document =
    byNo.length === 1
      ? byNo[0]
      : resolveByIdPrefix(documents, input.documentId, "нэхэмжлэх");
  if (document.status !== "draft")
    throw new Error(`Нэхэмжлэх ноорог биш байна (төлөв: ${document.status})`);
  assertPostLimit(Number(document.baseTotalAmount ?? document.totalAmount));

  unwrapAction(await postArApDocument(document.id));
  return {
    resultText: `Нэхэмжлэх батлагдаж GL-д бичигдлээ: ${document.documentNo}`,
    action: {
      kind: "arap",
      id: document.id,
      title: document.documentNo,
      status: "posted",
    },
  };
}

/** Кредит нэхэмжлэл / дебит нэхэмжлэх (ENT-029) — createCreditNote action. */
async function runCreateCreditNote(
  orgId: string,
  input: {
    sourceDocument: string;
    preview?: boolean;
    date?: string;
    reason?: string;
    lines?: { lineNo: number; quantity?: number; amount?: number }[];
    externalRef?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const source = await findArapDocument(orgId, input.sourceDocument);
  const { source: view } = unwrapAction(await getCreditNoteSource(source.id));
  const unit = view.currency === "MNT" ? "₮" : ` ${view.currency}`;
  const lineText = view.lines
    .map(
      (line) =>
        `  #${line.lineNo} ${line.description}${line.isVat ? " (НӨАТ — автоматаар)" : ""} · дүн ${fmt(line.amount)}${unit}${line.quantity != null ? ` · тоо ${line.quantity}` : ""} · үлдэгдэл ${fmt(line.remainingAmount)}${unit}${line.remainingQuantity != null ? ` / ${line.remainingQuantity} ш` : ""}`
    )
    .join("\n");
  if (input.preview)
    return {
      resultText: `${view.documentNo} (${view.counterpartyName}, ${view.date}) → ${view.creditTypeLabel}${view.blocker ? `\n⚠ ${view.blocker}` : ""}\nМөрүүд:\n${lineText}\nНээлттэй үлдэгдэл: ${fmt(view.openAmount)}${unit}`,
    };
  if (view.blocker) throw new Error(view.blocker);

  const byNo = new Map(view.lines.map((line) => [line.lineNo, line]));
  const lines = (input.lines ?? []).map((line) => {
    const target = byNo.get(Number(line.lineNo));
    if (!target)
      throw codedError(
        "CREDIT_LINE_NOT_FOUND",
        `${view.documentNo}-д #${line.lineNo} мөр алга — preview:true-гээр мөрүүдийг харна уу:\n${lineText}`
      );
    return { sourceLineId: target.id, quantity: line.quantity, amount: line.amount };
  });
  const date = input.date?.trim() || ulaanbaatarToday();

  const created = unwrapAction(
    await createCreditNote({
      sourceDocumentId: source.id,
      date,
      reason: input.reason,
      lines,
      externalRef: input.externalRef,
    })
  );
  if (created.dedup)
    return {
      resultText: `Энэ externalRef-тэй баримт аль хэдийн бий: ${created.documentNo} — давхар үүсгээгүй`,
      action: { kind: "arap", id: created.id, title: created.documentNo, status: "draft" },
    };

  const total = created.total ?? 0;
  const baseTotal = view.currency !== "MNT" ? total * (Number(source.exchangeRate) || 0) : total;
  let status: "draft" | "posted" = "draft";
  let note = "";
  if (mode === "post") {
    const futureNote = futurePeriodDraftNote(date);
    if (futureNote) note = futureNote;
    else if (baseTotal > currentAiPostLimit())
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`;
    else {
      const posted = await postArApDocument(created.id);
      if (posted.error) note = ` (ноорог үлдэв — батлахад: ${posted.error})`;
      else status = "posted";
    }
  }
  return {
    resultText: `${view.creditTypeLabel} үүслээ: ${created.documentNo} (эх ${view.documentNo}), дүн ${fmt(total)}${unit}, төлөв: ${status === "posted" ? "батлагдсан — эх нэхэмжлэхийн үлдэгдэлд тооцогдов" : "ноорог"}${note}`,
    action: { kind: "arap", id: created.id, title: created.documentNo, status },
  };
}

/** АР↔АП харилцан суутган тооцоо — settleArApOffset action-ийг дуудна. */
async function runSettleArApOffset(
  orgId: string,
  input: { arInvoice: string; apBill: string; amount?: number; date?: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const refColumns = {
    id: arApDocuments.id,
    documentNo: arApDocuments.documentNo,
    externalRef: arApDocuments.externalRef,
  };
  const documents = await db.query.arApDocuments.findMany({
    // Цонхгүй — хоёр лавлагаагаар шууд (ENT-033).
    where: and(
      eq(arApDocuments.organizationId, orgId),
      or(refCondition(refColumns, input.arInvoice), refCondition(refColumns, input.apBill))
    ),
    columns: {
      id: true,
      status: true,
      documentNo: true,
      documentType: true,
      totalAmount: true,
      paidAmount: true,
    },
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 100,
  });
  const resolveDocument = (ref: string, label: string) => {
    const byNo = documents.filter(
      (doc) => doc.documentNo.toLowerCase() === ref.trim().toLowerCase()
    );
    return byNo.length === 1 ? byNo[0] : resolveByIdPrefix(documents, ref, label);
  };
  const arDoc = resolveDocument(input.arInvoice, "авлагын нэхэмжлэл");
  const apDoc = resolveDocument(input.apBill, "өглөгийн нэхэмжлэх");

  const amount =
    input.amount ??
    Math.min(
      Number(arDoc.totalAmount) - Number(arDoc.paidAmount),
      Number(apDoc.totalAmount) - Number(apDoc.paidAmount)
    );
  assertPostLimit(amount);
  const date = input.date?.trim() || new Date().toISOString().slice(0, 10);

  unwrapAction(
    await settleArApOffset({
      arDocumentId: arDoc.id,
      apDocumentId: apDoc.id,
      amount: Math.round(amount * 100) / 100,
      date,
    })
  );
  return {
    resultText: `Суутган тооцоо хийгдлээ: ${arDoc.documentNo} ↔ ${apDoc.documentNo}, дүн ${fmt(Math.round(amount * 100) / 100)}₮ — хоёр талын хяналтын дансаар GL-д бичигдэв. Хоёр талын үлдэгдэл энэ дүнгээр буурсан.`,
    action: {
      kind: "arap",
      id: arDoc.id,
      title: `${arDoc.documentNo} ↔ ${apDoc.documentNo}`,
      status: "posted",
    },
  };
}

// ── Лавлах гүйцэтгэгчид ─────────────────────────────────────────────────────

async function runListGlAccounts(
  orgId: string,
  input: { query?: string }
): Promise<AiToolResult> {
  const accounts = await db.query.chartOfAccounts.findMany({
    where: and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.isEnabled, true)),
    columns: { number: true, name: true },
    orderBy: (account, { asc }) => [asc(account.number)],
  });
  const query = input.query?.trim().toLowerCase();
  const filtered = query
    ? accounts.filter(
        (account) =>
          account.number.includes(query) ||
          account.name.toLowerCase().includes(query)
      )
    : accounts;
  if (filtered.length === 0)
    return {
      resultText: `"${input.query}" гэсэн данс олдсонгүй — query-гүйгээр бүх дансыг харна уу`,
    };
  return {
    resultText: filtered
      .slice(0, 100)
      .map((account) => `${account.number} — ${account.name}`)
      .join("\n"),
  };
}

async function runListCounterparties(
  orgId: string,
  input: { query?: string; includeInactive?: boolean; limit?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const kinds = await loadEntityKinds(orgId);
  const list = await db.query.counterparties.findMany({
    where: input.includeInactive
      ? eq(counterparties.organizationId, orgId)
      : and(eq(counterparties.organizationId, orgId), eq(counterparties.isActive, true)),
  });
  const q = input.query?.trim().toLowerCase();
  const filtered = q
    ? list.filter(
        (entry) =>
          entry.name.toLowerCase().includes(q) ||
          (entry.code ?? "").toLowerCase().includes(q) ||
          (entry.registerNo ?? "").toLowerCase().includes(q)
      )
    : list;
  if (filtered.length === 0) return { resultText: "Тохирох харилцагч олдсонгүй" };
  // Сегменттэй бүтэн кодыг биш зөвхөн 8 оронтой үндсэн дугаарыг харуулна.
  const mainOf = (code: string | null) =>
    code ? (parseSegParts(code, [3])[3] ?? code) : null;
  return {
    resultText: filtered
      .slice(0, limit)
      .map((entry) => {
        const ar = mainOf(entry.defaultReceivableAccountNumber);
        const ap = mainOf(entry.defaultPayableAccountNumber);
        return [
          entry.id.slice(0, 8),
          entry.name,
          entry.code ? `Код ${entry.code}` : null,
          entry.registerNo ? `${baseKindOf(entry.entityKind, kinds) === "individual" ? "РД" : "ТТД"} ${entry.registerNo}` : null,
          entry.email || null,
          cpKindNote(entry.entityKind, kinds),
          CP_TYPE_LABELS[entry.counterpartyType] ?? entry.counterpartyType,
          entry.defaultCurrency,
          `${entry.paymentTermsDays} хоног`,
          ar || ap
            ? [ar ? `Дт ${ar}` : null, ap ? `Кт ${ap}` : null]
                .filter(Boolean)
                .join(" / ")
            : null,
          entry.isActive ? null : "ИДЭВХГҮЙ",
        ]
          .filter(Boolean)
          .join(" · ");
      })
      .join("\n"),
  };
}

async function runListInventory(
  orgId: string,
  input: { query?: string }
): Promise<AiToolResult> {
  const [items, whList, issueTypes] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
    }),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.organizationId, orgId),
    }),
  ]);
  const filteredItems = input.query
    ? items.filter(
        (item) =>
          item.code.toLowerCase().includes(input.query!.toLowerCase()) ||
          item.name.toLowerCase().includes(input.query!.toLowerCase())
      )
    : items;
  return {
    resultText: [
      `Бараа (${filteredItems.length}):`,
      ...filteredItems.slice(0, 40).map((item) => `  ${item.code} — ${item.name}`),
      `Агуулах (${whList.length}):`,
      ...whList.map((wh) => `  ${wh.code} — ${wh.name}`),
      `Зарлагын төрөл:`,
      ...issueTypes
        .filter((entry) => entry.isActive)
        .map((entry) => `  ${entry.name}`),
    ].join("\n"),
  };
}

async function runListJournalVouchers(
  orgId: string,
  input: { from?: string; to?: string; status?: string; limit?: number; offset?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const offset = Math.max(Number(input.offset) || 0, 0);
  // SIM2-044: шүүлт SQL-д — өмнө нь сүүлийн 400-г татаад JS-д шүүдэг тул
  // хуучин (хаагдсан) сарын журнал «олдсонгүй» гэж гардаг байв.
  const conditions = [
    eq(journalVouchers.organizationId, orgId),
    ...(input.from ? [gte(journalVouchers.date, input.from)] : []),
    ...(input.to ? [lte(journalVouchers.date, input.to)] : []),
    ...(input.status ? [eq(journalVouchers.status, input.status)] : []),
  ];
  const [total, filtered] = await Promise.all([
    db.$count(journalVouchers, and(...conditions)),
    db.query.journalVouchers.findMany({
      where: and(...conditions),
      with: { lines: { columns: { debit: true } } },
      orderBy: [desc(journalVouchers.date), desc(journalVouchers.createdAt)],
      limit,
      offset,
    }),
  ]);
  const statusLabels: Record<string, string> = {
    draft: "ноорог",
    posted: "батлагдсан",
    reversed: "буцаагдсан",
  };
  if (filtered.length === 0)
    return { resultText: total > 0 ? `Нийт ${total} журнал — offset ${offset}-оос хойш мөр алга` : "Тохирох журнал олдсонгүй" };
  const header =
    total > filtered.length
      ? `Нийт ${total}-ээс ${offset + 1}–${offset + filtered.length} харуулав${offset + filtered.length < total ? ` (дараагийнх: offset ${offset + filtered.length})` : ""}\n`
      : "";
  return {
    resultText: header + filtered
      .map((voucher) => {
        const total = voucher.lines.reduce(
          (sum, line) => sum + Number(line.debit),
          0
        );
        // Дугаартай бол ТҮҮГЭЭР нэрлэнэ (хэрэглэгч журналаа үүгээр таньдаг);
        // дугааргүй хуучин бичилтэд ID-гаар. Бүтэн ID нь хэрэгтэй үед tool-д
        // угтвараар ч дамждаг тул хоёулаа ажиллана.
        return `${voucher.date} · ${voucher.documentNo ?? `ID ${voucher.id.slice(0, 8)}`} · ${voucher.description || "(утгагүй)"} · ${fmt(total)}₮ · ${statusLabels[voucher.status] ?? voucher.status}`;
      })
      .join("\n"),
  };
}

async function runListCashAccounts(orgId: string): Promise<AiToolResult> {
  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
  });
  if (accounts.length === 0) return { resultText: "Идэвхтэй мөнгөн данс олдсонгүй" };
  // ENT-014: үлдэгдэл (дансны валютаар — snapshot + delta), нээлт, GL-ийн ₮.
  const today = ulaanbaatarToday();
  const glNumbers = [...new Set(accounts.map((entry) => entry.glAccountNumber))];
  const mainExpr = sql<string>`case when position('.' in ${journalLines.accountNumber}) > 0 then split_part(${journalLines.accountNumber}, '.', 3) else ${journalLines.accountNumber} end`;
  const [balances, glRows] = await Promise.all([
    loadCashBalancesFast(orgId, accounts),
    // SQL нийлбэр — бүх журналыг JS-д ачаалахгүй (П28).
    db
      .select({
        main: mainExpr,
        net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          inArray(journalVouchers.status, ["posted", "reversed"]),
          lte(journalVouchers.date, today),
          inArray(mainExpr, glNumbers)
        )
      )
      .groupBy(mainExpr),
  ]);
  const glNet = new Map(glRows.map((row) => [row.main, Number(row.net)]));
  const glShared = new Map<string, number>();
  for (const entry of accounts)
    glShared.set(entry.glAccountNumber, (glShared.get(entry.glAccountNumber) ?? 0) + 1);
  return {
    resultText: accounts
      .map((entry) => {
        const unit = entry.currency === "MNT" ? "₮" : ` ${entry.currency}`;
        const opening = Number(entry.openingBalance ?? 0);
        const gl = glNet.get(entry.glAccountNumber) ?? 0;
        const glText =
          (glShared.get(entry.glAccountNumber) ?? 0) > 1
            ? `GL ${entry.glAccountNumber} ${fmt(gl)}₮ (данс ${glShared.get(entry.glAccountNumber)} мөнгөн дансанд хуваалцагдсан)`
            : `GL ${entry.glAccountNumber} ${fmt(gl)}₮`;
        return (
          `${entry.name} — ${entry.accountType === "bank" ? `банк (${entry.bankName ?? "?"})` : "касс"}, ${entry.currency} · ` +
          `үлдэгдэл ${fmt(balances.get(entry.id) ?? 0)}${unit} (${today}) · ` +
          `нээлт ${fmt(opening)}${unit}${entry.openingDate ? ` (${entry.openingDate})` : ""} · ${glText}`
        );
      })
      .join("\n"),
  };
}

// ── Мастер дата гүйцэтгэгчид ────────────────────────────────────────────────

async function runCreateGlAccount(
  _orgId: string,
  input: { number: string; name: string }
): Promise<AiToolResult> {
  const number = String(input.number ?? "").trim();
  if (!/^\d{8}$/.test(number))
    throw new Error("Дансны дугаар 8 оронтой тоо байх ёстой");
  const result = await createAccount({ number, name: String(input.name ?? "").trim() });
  if (result && "error" in result) throw new Error(result.error);
  return { resultText: `Данс нээгдлээ: ${number} — ${input.name}` };
}

const CP_TYPE_LABELS: Record<string, string> = {
  customer: "Авлага",
  supplier: "Өглөг",
  both: "Авлага/Өглөг",
};

/** Субъектийн төрөл — «Хувь хүн» бол л ил бичнэ (байгууллага default тул чимээгүй). */
function cpKindNote(entityKind: string | null | undefined, kinds: EntityKindOption[]): string | null {
  // Default (байгууллага)-ыг бичихгүй — бусад төрлийн НЭРИЙГ ил.
  return entityKind && entityKind !== DEFAULT_COUNTERPARTY_ENTITY_KIND ? entityKindName(entityKind, kinds) : null;
}

async function runCreateCounterparty(
  orgId: string,
  input: {
    name: string;
    counterpartyType: "customer" | "supplier" | "both";
    entityKind?: string;
    code?: string;
    registerNo?: string;
    email?: string;
    defaultReceivableAccount?: string;
    defaultPayableAccount?: string;
    currency?: string;
    paymentTermsDays?: number;
    phone?: string;
    address?: string;
    contactPerson?: string;
    bankName?: string;
    bankAccountNo?: string;
  }
): Promise<AiToolResult> {
  // Нэр нормчлол: trim + доторх давхар зайг нэг болгоно ("Би  Ти Эф " → "Би Ти Эф").
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Харилцагчийн нэр оруулна уу");
  const registerNo = input.registerNo?.trim() || undefined;
  const code = normalizeCounterpartyCode(input.code);
  // Төрөл: байгууллагын жагсаалтаас (систем + нэмсэн) код эсвэл нэрээр.
  // Өгөөгүй ч регистр нь иргэний РД хэлбэртэй бол «Хувь хүн» (таамаглал биш —
  // хэлбэр нь тодорхой); байгууллагын дугаар / тодорхойгүй бол default.
  const kinds = await loadEntityKinds(orgId);
  const kindResult = resolveEntityKindCode(
    input.entityKind?.trim() ||
      (inferEntityKindFromRegisterNo(registerNo) === "individual" ? "individual" : DEFAULT_COUNTERPARTY_ENTITY_KIND),
    kinds
  );
  if ("error" in kindResult) throw new Error(`[VALIDATION] ${kindResult.error}`);
  const entityKind = kindResult.code;

  // Давхардлын шалгалт: нэр case-insensitive, ТТД / КОД яг таарлаар (идэвхгүйг
  // ч оруулна — идэвхгүй харилцагчтай ижил нэр DB unique-д унана).
  const existingList = await db.query.counterparties.findMany({
    where: eq(counterparties.organizationId, orgId),
  });
  const duplicate = existingList.find(
    (entry) =>
      entry.name.toLowerCase() === name.toLowerCase() ||
      (registerNo != null && entry.registerNo === registerNo) ||
      (code != null && entry.code === code)
  );
  // SIM2-002: нэр/ТТД ижил харилцагчийг ӨӨР чиглэлээр (customer ↔ supplier)
  // дахин өгвөл «both» болгон нэгтгэнэ — алгасаад дараа нь АП нэхэмжлэх
  // чиглэлийн шалгалтад унадаг байв. Бусад талбарыг хөндөхгүй.
  if (
    duplicate &&
    input.counterpartyType &&
    duplicate.counterpartyType !== "both" &&
    input.counterpartyType !== duplicate.counterpartyType
  ) {
    await db
      .update(counterparties)
      .set({ counterpartyType: "both" })
      .where(and(eq(counterparties.id, duplicate.id), eq(counterparties.organizationId, orgId)));
    return {
      resultText: `Аль хэдийн бүртгэгдсэн "${duplicate.name}" — чиглэлийг нэгтгэв: ${CP_TYPE_LABELS[duplicate.counterpartyType] ?? duplicate.counterpartyType} → ${CP_TYPE_LABELS.both ?? "both"} (ID ${duplicate.id})`,
      dedup: true,
    };
  }
  if (duplicate) {
    return {
      resultText: `[CONFLICT] Аль хэдийн бүртгэгдсэн байна. ID: ${duplicate.id}, "${duplicate.name}"${duplicate.code ? ` (код ${duplicate.code})` : ""}${duplicate.registerNo ? ` (ТТД ${duplicate.registerNo})` : ""}, ${CP_TYPE_LABELS[duplicate.counterpartyType] ?? duplicate.counterpartyType}${duplicate.isActive ? "" : " — ИДЭВХГҮЙ (update_counterparty-аар идэвхжүүлж болно)"}`,
      dedup: true,
    };
  }

  // Сегмент дүрэм: default дансыг бүтэн 10-part 0-padded кодоор хадгална.
  let receivableCode: string | undefined;
  let payableCode: string | undefined;
  if (input.defaultReceivableAccount || input.defaultPayableAccount) {
    const ctx = await accountContext(orgId);
    if (input.defaultReceivableAccount)
      receivableCode = resolveAccount(input.defaultReceivableAccount, ctx).code;
    if (input.defaultPayableAccount)
      payableCode = resolveAccount(input.defaultPayableAccount, ctx).code;
  }
  const { id } = unwrapAction(
    await createCounterparty({
    name,
    counterpartyType: input.counterpartyType,
    entityKind,
    code: code ?? undefined,
    registerNo,
    email: input.email,
    defaultReceivableAccountNumber: receivableCode,
    defaultPayableAccountNumber: payableCode,
    defaultCurrency: input.currency,
    paymentTermsDays: input.paymentTermsDays,
    phone: input.phone,
    address: input.address,
    contactPerson: input.contactPerson,
    bankName: input.bankName,
    bankAccountNo: input.bankAccountNo,
    })
  );
  return {
    resultText: `Харилцагч үүслээ. ID: ${id}, "${name}"${code ? ` (код ${code})` : ""}${registerNo ? ` (${baseKindOf(entityKind, kinds) === "individual" ? "РД" : "ТТД"} ${registerNo})` : ""}${input.email?.trim() ? ` · ${input.email.trim()}` : ""}, ${entityKindName(entityKind, kinds)}, ${CP_TYPE_LABELS[input.counterpartyType]}, ${input.currency?.trim().toUpperCase() || "MNT"}, ${input.paymentTermsDays ?? 30} хоног`,
  };
}

/** POS талбарууд — model-ийн input (сонголтоор, өгсөн нь л дамжина). */
type ItemPosInput = {
  salesPrice?: number;
  minSalesPrice?: number;
  barcode?: string;
  vatMode?: "standard" | "exempt" | "zero";
  categoryCode?: string;
  revenueAccountNumber?: string;
  ebarimtClassificationCode?: string;
  ebarimtTaxProductCode?: string;
  barcodeType?: string;
  description?: string;
  brand?: string;
  manufacturer?: string;
  originCountry?: string;
};

/** Зөвхөн ӨГӨГДСӨН POS талбарыг дамжуулна — өгөөгүй нь хөндөгдөхгүй (update-д чухал). */
function itemPosFieldsOf(input: ItemPosInput) {
  const fields: {
    salesPrice?: number;
    minSalesPrice?: number;
    barcode?: string | null;
    vatMode?: "standard" | "exempt" | "zero";
    categoryCode?: string | null;
    revenueAccountNumber?: string | null;
    ebarimtClassificationCode?: string | null;
    ebarimtTaxProductCode?: string | null;
    barcodeType?: string | null;
    description?: string | null;
    brand?: string | null;
    manufacturer?: string | null;
    originCountry?: string | null;
  } = {};
  // Текст талбарууд — хоосон мөр = арилгах (server action ДАХИН шалгана).
  for (const key of [
    "ebarimtClassificationCode",
    "ebarimtTaxProductCode",
    "barcodeType",
    "description",
    "brand",
    "manufacturer",
    "originCountry",
  ] as const) {
    const value = input[key];
    if (value != null) fields[key] = String(value).trim() || null;
  }
  if (input.salesPrice != null) fields.salesPrice = Number(input.salesPrice);
  if (input.minSalesPrice != null) fields.minSalesPrice = Number(input.minSalesPrice);
  if (input.barcode != null) fields.barcode = input.barcode.trim() || null;
  if (input.vatMode != null) {
    if (!["standard", "exempt", "zero"].includes(input.vatMode))
      throw new Error("vatMode нь standard / exempt / zero байна");
    fields.vatMode = input.vatMode;
  }
  if (input.categoryCode != null) fields.categoryCode = input.categoryCode.trim() || null;
  if (input.revenueAccountNumber != null)
    fields.revenueAccountNumber = input.revenueAccountNumber.trim() || null;
  return fields;
}

async function runCreateItem(
  _orgId: string,
  input: { code: string; name: string; unit?: string } & ItemPosInput
): Promise<AiToolResult> {
  const pos = itemPosFieldsOf(input);
  unwrapAction(
    await createInventoryItem(  {
      code: input.code,
      name: input.name,
      unit: input.unit ?? "ш",
      ...pos,
    }
    )
  );
  const extras = [
    pos.salesPrice != null ? `үнэ ${pos.salesPrice.toLocaleString()}₮` : null,
    pos.barcode ? `баркод ${pos.barcode}` : null,
    pos.vatMode && pos.vatMode !== "standard" ? `НӨАТ ${pos.vatMode}` : null,
    pos.categoryCode ? `бүлэг ${pos.categoryCode}` : null,
  ].filter(Boolean);
  return {
    resultText: `Бараа бүртгэгдлээ: ${input.code} — ${input.name}${extras.length ? ` (${extras.join(", ")})` : ""}`,
  };
}

async function runCreateWarehouse(
  _orgId: string,
  input: { code: string; name: string }
): Promise<AiToolResult> {
  unwrapAction(
    await createWarehouse({ code: input.code, name: input.name })
  );
  return { resultText: `Агуулах бүртгэгдлээ: ${input.code} — ${input.name}` };
}

async function runUpdateCounterparty(
  orgId: string,
  input: {
    counterparty: string;
    newName?: string;
    counterpartyType?: "customer" | "supplier" | "both";
    entityKind?: string;
    paymentTermsDays?: number;
    defaultReceivableAccount?: string;
    defaultPayableAccount?: string;
    currency?: string;
    code?: string;
    registerNo?: string;
    email?: string;
    phone?: string;
    address?: string;
    contactPerson?: string;
    bankName?: string;
    bankAccountNo?: string;
    isActive?: boolean;
  }
): Promise<AiToolResult> {
  const list = await db.query.counterparties.findMany({
    where: eq(counterparties.organizationId, orgId),
  });
  const counterparty = requireSingle(
    nameMatches(list, (entry) => entry.name, input.counterparty),
    (entry) => entry.name,
    "харилцагч",
    input.counterparty
  );

  const changes: Record<string, unknown> = {};
  if (input.newName?.trim()) changes.name = input.newName.trim();
  if (input.counterpartyType) {
    if (!["customer", "supplier", "both"].includes(input.counterpartyType))
      throw new Error("Харилцагчийн төрөл буруу байна");
    changes.counterpartyType = input.counterpartyType;
  }
  if (input.entityKind != null && input.entityKind.trim()) {
    const kindResult = resolveEntityKindCode(input.entityKind, await loadEntityKinds(orgId), counterparty.entityKind);
    if ("error" in kindResult) throw new Error(`[VALIDATION] ${kindResult.error}`);
    changes.entityKind = kindResult.code;
  }
  if (input.paymentTermsDays != null)
    changes.paymentTermsDays = Math.max(0, Math.round(input.paymentTermsDays));
  if (input.currency?.trim())
    changes.defaultCurrency = input.currency.trim().toUpperCase();
  if (input.code != null) {
    const code = normalizeCounterpartyCode(input.code);
    await assertCounterpartyCodeAvailable(orgId, code, counterparty.id);
    changes.code = code;
  }
  if (input.registerNo != null)
    changes.registerNo = input.registerNo.trim() || null;
  if (input.email != null) {
    const email = input.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("И-мэйл хаяг буруу байна");
    changes.email = email || null;
  }
  if (input.phone != null) changes.phone = input.phone.trim() || null;
  if (input.address != null) changes.address = input.address.trim() || null;
  if (input.contactPerson != null)
    changes.contactPerson = input.contactPerson.trim() || null;
  if (input.bankName != null) changes.bankName = input.bankName.trim() || null;
  if (input.bankAccountNo != null)
    changes.bankAccountNo = input.bankAccountNo.trim() || null;
  if (input.isActive != null) changes.isActive = input.isActive;
  if (input.defaultReceivableAccount != null || input.defaultPayableAccount != null) {
    const ctx = await accountContext(orgId);
    // Сегмент дүрэм: бүтэн 10-part 0-padded кодоор хадгална — UI-ийн
    // сегмент picker болон нэхэмжлэхийн default энэ форматыг хүлээдэг.
    if (input.defaultReceivableAccount)
      changes.defaultReceivableAccountNumber = resolveAccount(
        input.defaultReceivableAccount,
        ctx
      ).code;
    if (input.defaultPayableAccount)
      changes.defaultPayableAccountNumber = resolveAccount(
        input.defaultPayableAccount,
        ctx
      ).code;
  }
  if (Object.keys(changes).length === 0)
    throw new Error("Өөрчлөх талбар өгөгдөөгүй байна");

  await db
    .update(counterparties)
    .set(changes)
    .where(and(eq(counterparties.id, counterparty.id), eq(counterparties.organizationId, orgId)));
  return {
    resultText: `Харилцагч шинэчлэгдлээ: ${counterparty.name}${input.newName ? ` → ${input.newName}` : ""} (${Object.keys(changes).join(", ")})`,
  };
}

/** Харилцагч устгах — deleteCounterparty action (баримттай бол татгалзана). */
async function runDeleteCounterparty(
  orgId: string,
  input: { counterparty: string }
): Promise<AiToolResult> {
  const list = await db.query.counterparties.findMany({
    where: eq(counterparties.organizationId, orgId),
  });
  const counterparty = requireSingle(
    nameMatches(list, (entry) => entry.name, input.counterparty),
    (entry) => entry.name,
    "харилцагч",
    input.counterparty
  );
  const result = unwrapAction(await deleteCounterparty(counterparty.id));
  return {
    resultText: `Харилцагч устгагдлаа: ${result.name}`,
  };
}

/** Бараа устгах — deleteInventoryItem action (түүхтэй бол татгалзана). */
async function runDeleteItem(
  orgId: string,
  input: { itemCode: string }
): Promise<AiToolResult> {
  const items = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.organizationId, orgId),
  });
  const item = requireSingle(
    nameMatches(items, (entry) => entry.code, input.itemCode),
    (entry) => `${entry.code} (${entry.name})`,
    "бараа",
    input.itemCode
  );
  const result = unwrapAction(await deleteInventoryItem(item.id));
  return { resultText: `Бараа устгагдлаа: ${result.code} — ${result.name}` };
}

async function runUpdateItem(
  orgId: string,
  input: { itemCode: string; name?: string; unit?: string; isActive?: boolean } & ItemPosInput
): Promise<AiToolResult> {
  const items = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.organizationId, orgId),
  });
  const item = requireSingle(
    nameMatches(items, (entry) => entry.code, input.itemCode),
    (entry) => `${entry.code} (${entry.name})`,
    "бараа",
    input.itemCode
  );
  const pos = itemPosFieldsOf(input);
  const changed = Object.keys(pos);
  if (input.name != null) changed.push("name");
  if (input.unit != null) changed.push("unit");
  if (changed.length > 0)
    unwrapAction(
      await updateInventoryItem(  item.id, {
        name: input.name ?? item.name,
        unit: input.unit ?? item.unit,
        ...pos,
      }
      )
    );
  if (input.isActive != null) {
    await toggleInventoryItem(item.id, input.isActive);
    changed.push("isActive");
  }
  if (changed.length === 0) throw new Error("Өөрчлөх талбар өгөгдөөгүй байна");
  return { resultText: `Бараа шинэчлэгдлээ: ${item.code} (${changed.join(", ")})` };
}

async function runUpdateMovement(
  orgId: string,
  input: {
    movementId: string;
    date?: string;
    quantity?: number;
    description?: string;
    itemCode?: string;
    warehouseCode?: string;
    toWarehouseCode?: string;
    issueType?: string;
  }
): Promise<AiToolResult> {
  const movements = await db.query.inventoryMovements.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(inventoryMovements.organizationId, orgId), refCondition({ id: inventoryMovements.id, documentNo: inventoryMovements.documentNo }, input.movementId)),
    orderBy: [desc(inventoryMovements.createdAt)],
    limit: 50,
  });
  const movement = resolveByIdPrefix(movements, input.movementId, "хөдөлгөөн");
  if (movement.status !== "draft")
    throw new Error(`Зөвхөн ноорог хөдөлгөөнийг засна (төлөв: ${movement.status})`);

  const [items, whList, issueTypes] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
    }),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.organizationId, orgId),
    }),
  ]);
  const findItem = (code: string) =>
    requireSingle(
      nameMatches(items, (entry) => entry.code, code),
      (entry) => entry.code,
      "бараа",
      code
    );
  const findWh = (code: string) =>
    requireSingle(
      nameMatches(whList, (entry) => entry.code, code),
      (entry) => entry.code,
      "агуулах",
      code
    );

  const itemId = input.itemCode ? findItem(input.itemCode).id : movement.itemId;
  const warehouseId = input.warehouseCode
    ? findWh(input.warehouseCode).id
    : movement.warehouseId;
  if (!itemId || !warehouseId)
    throw new Error("Хөдөлгөөнд бараа/агуулах дутуу — itemCode, warehouseCode өгнө үү");

  let issueTypeId = movement.issueTypeId ?? undefined;
  if (input.issueType) issueTypeId = resolveIssueType(issueTypes, input.issueType).id;

  unwrapAction(await updateInventoryMovement(movement.id, {
    movementType: movement.movementType as
      | "receipt"
      | "issue"
      | "transfer"
      | "adjustment"
      | "return_in"
      | "return_out",
    date: input.date ?? movement.date,
    itemId,
    warehouseId,
    toWarehouseId: input.toWarehouseCode
      ? findWh(input.toWarehouseCode).id
      : (movement.toWarehouseId ?? undefined),
    quantity: input.quantity != null ? Number(input.quantity) : Number(movement.quantity),
    description: input.description ?? movement.description ?? undefined,
    issueTypeId,
  }));
  return { resultText: `Ноорог хөдөлгөөн шинэчлэгдлээ: ${movement.documentNo}` };
}

async function runRecordCount(
  orgId: string,
  input: {
    date: string;
    warehouseCode: string;
    counts: { itemCode: string; countedQty: number }[];
  }
): Promise<AiToolResult> {
  const [items, whList] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
    }),
  ]);
  const warehouse = requireSingle(
    nameMatches(whList, (entry) => entry.code, input.warehouseCode),
    (entry) => entry.code,
    "агуулах",
    input.warehouseCode
  );
  const counts = (input.counts ?? []).map((count) => ({
    itemId: requireSingle(
      nameMatches(items, (entry) => entry.code, count.itemCode),
      (entry) => entry.code,
      "бараа",
      count.itemCode
    ).id,
    countedQty: Number(count.countedQty),
  }));
  const result = unwrapAction(await recordInventoryCount({
    date: input.date,
    warehouseId: warehouse.id,
    counts,
  }));
  const created = "created" in result ? result.created : 0;
  return {
    resultText:
      created === 0
        ? "Тооллого системийн үлдэгдэлтэй яг таарч байна — тохируулга хэрэггүй"
        : `Тооллого бүртгэгдлээ: ${created} зөрүүнд тохируулгын НООРОГ хөдөлгөөн үүслээ — баталгаажуулахаар шалгана уу`,
  };
}

async function runCreateCashAccount(
  orgId: string,
  input: {
    name: string;
    accountType: "cash" | "bank";
    bankName?: string;
    accountNumber?: string;
    bankCode?: string;
    accountHolder?: string;
    iban?: string;
    qpayPayout?: boolean;
    qpayDefault?: boolean;
    currency?: string;
    glAccount: string;
    openingBalance?: number;
    openingDate?: string;
    openingRate?: number;
  }
): Promise<AiToolResult> {
  const ctx = await accountContext(orgId);
  const result = unwrapAction(
    await createCashAccount({
      name: input.name,
      accountType: input.accountType,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      accountHolder: input.accountHolder,
      iban: input.iban,
      qpayPayout: input.qpayPayout,
      qpayDefault: input.qpayDefault,
      currency: input.currency?.trim().toUpperCase() || "MNT",
      glAccountNumber: resolveAccount(input.glAccount, ctx).main,
      openingBalance: input.openingBalance,
      openingDate: input.openingDate,
      openingRate: input.openingRate,
    })
  );
  return {
    resultText: `Мөнгөн данс бүртгэгдлээ: ${input.name}${input.qpayPayout ? " (QPay төлбөр хүлээн авна)" : ""}${
      result.warning ? `. Анхаар: ${result.warning}` : ""
    }`,
  };
}

async function findAssetByCode(orgId: string, assetCode: string) {
  const assets = await db.query.fixedAssets.findMany({
    where: eq(fixedAssets.organizationId, orgId),
  });
  return requireSingle(
    nameMatches(assets, (entry) => entry.code, assetCode),
    (entry) => `${entry.code} (${entry.name})`,
    "хөрөнгө",
    assetCode
  );
}

async function runActivateFixedAsset(
  orgId: string,
  input: {
    assetCode: string;
    name?: string;
    cost?: number;
    salvageValue?: number;
    usefulLifeMonths?: number;
    custodian?: string;
    depreciationStartMonth?: string;
    openingAccumulatedDepreciation?: number;
    openingAsOf?: string;
    assetAccountNumber?: string;
    accumDepAccountNumber?: string;
    depExpenseAccountNumber?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const asset = await findAssetByCode(orgId, input.assetCode);
  if (asset.status !== "draft")
    throw new Error(`Зөвхөн ноорог картыг идэвхжүүлнэ (төлөв: ${asset.status})`);
  // SIM2-037: ноорог капиталжуулах журналтай карт идэвхжихэд журнал батлагдана.
  const capitalization = asset.sourceVoucherId
    ? await db.query.journalVouchers.findFirst({
        where: and(
          eq(journalVouchers.id, asset.sourceVoucherId),
          eq(journalVouchers.status, "draft"),
          sql`${journalVouchers.externalRef} like 'fa-capitalize:%'`
        ),
        columns: { id: true },
      })
    : null;
  if (capitalization) {
    assertPostMode(mode);
    assertPostLimit(input.cost ?? Number(asset.cost));
  }

  unwrapAction(
    await activateFixedAsset(  asset.id, {
      code: asset.code,
      name: input.name ?? asset.name,
      acquisitionDate: asset.acquisitionDate,
      cost: input.cost ?? Number(asset.cost),
      salvageValue: input.salvageValue ?? Number(asset.salvageValue),
      usefulLifeMonths: input.usefulLifeMonths ?? asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod as
        | "straight_line"
        | "declining_balance",
      // Ноорог картад хариуцагч/эхлэх сар хоосон байж болно — идэвхжүүлэхэд
      // заавал тул моделиос нөхөж өгөхийг шаардана.
      custodian:
        input.custodian ??
        asset.custodian ??
        (() => {
          throw new Error("Хариуцагч (custodian) өгнө үү — ноорог картад хоосон байна");
        })(),
      depreciationStartMonth:
        input.depreciationStartMonth ??
        asset.depreciationStartMonth ??
        (() => {
          throw new Error(
            "Элэгдэл эхлэх сар (depreciationStartMonth, YYYY-MM) өгнө үү — ноорог картад хоосон байна"
          );
        })(),
      // Картын бусад утга хэвээр үлдэнэ (идэвхжүүлэлт тэдгээрийг арилгахгүй).
      location: asset.location ?? undefined,
      subLocation: asset.subLocation ?? undefined,
      depreciationStartDate: asset.depreciationStartDate ?? undefined,
      taxUsefulLifeMonths: asset.taxUsefulLifeMonths,
      taxDepreciationMethod: asset.taxDepreciationMethod,
      openingAccumulatedDepreciation:
        input.openingAccumulatedDepreciation ?? Number(asset.openingAccumulatedDepreciation ?? 0),
      openingTaxAccumulated: Number(asset.openingTaxAccumulated ?? 0),
      openingAsOf: input.openingAsOf ?? asset.openingAsOf,
      assetAccountNumber: input.assetAccountNumber ?? asset.assetAccountNumber,
      accumDepAccountNumber: input.accumDepAccountNumber ?? asset.accumDepAccountNumber,
      depExpenseAccountNumber:
        input.depExpenseAccountNumber ?? asset.depExpenseAccountNumber,
    }
    )
  );
  return {
    resultText: `Хөрөнгө идэвхжлээ: ${asset.code} · ${input.name ?? asset.name} — элэгдэл ${input.depreciationStartMonth ?? asset.depreciationStartMonth} сараас бодогдоно`,
  };
}

async function runDeleteFixedAsset(
  orgId: string,
  input: { assetCode: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const asset = await findAssetByCode(orgId, input.assetCode);
  if (asset.status !== "draft") assertPostMode(mode);
  unwrapAction(await deleteFixedAsset(asset.id));
  return { resultText: `Хөрөнгийн карт устгагдлаа: ${asset.code} · ${asset.name}` };
}

async function runReverseFaDepreciation(
  orgId: string,
  input: { month: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const entries = await db.query.faDepreciationEntries.findMany({
    where: and(
      eq(faDepreciationEntries.organizationId, orgId),
      eq(faDepreciationEntries.periodMonth, input.month),
      eq(faDepreciationEntries.status, "posted")
    ),
    columns: { id: true, amount: true },
  });
  if (entries.length === 0)
    return { resultText: `${input.month} сард батлагдсан элэгдлийн бичилт алга` };
  const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  assertPostLimit(total);
  for (const entry of entries)
    unwrapAction(await reverseDepreciationEntry(entry.id));
  return {
    resultText: `${input.month} сарын элэгдэл буцаагдлаа: ${entries.length} бичилт, нийт ${fmt(total)}₮`,
  };
}

// ── GL нэмэлт гүйцэтгэгчид ──────────────────────────────────────────────────

async function loadVouchers(orgId: string) {
  return db.query.journalVouchers.findMany({
    where: eq(journalVouchers.organizationId, orgId),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
}

async function runGetJournal(
  orgId: string,
  input: { voucherId: string }
): Promise<AiToolResult> {
  const ctx = await accountContext(orgId);
  const voucher = resolveVoucherRef(await loadVouchers(orgId), input.voucherId);
  const statusLabels: Record<string, string> = {
    draft: "ноорог",
    posted: "батлагдсан",
    reversed: "буцаагдсан",
  };
  const lines = voucher.lines.map(
    (line) =>
      `  ${fmtAccountDisplay(line.accountNumber, ctx.activeSegIds)} ${ctx.enabledByMain.get(parseSegParts(line.accountNumber, [3])[3] ?? "") ?? ""} | Дт ${fmt(Number(line.debit))} | Кт ${fmt(Number(line.credit))} | ${line.description ?? ""}`
  );
  return {
    resultText: [
      `${voucher.date} · ${voucher.documentNo ?? "(дугааргүй)"} · ${voucher.description} · ${statusLabels[voucher.status] ?? voucher.status} · ID ${voucher.id}`,
      ...lines,
    ].join("\n"),
  };
}

async function runUpdateJournal(
  orgId: string,
  input: {
    voucherId: string;
    date?: string;
    description?: string;
    lines?: JournalLineInput[];
  }
): Promise<AiToolResult> {
  const ctx = await accountContext(orgId);
  const voucher = resolveVoucherRef(await loadVouchers(orgId), input.voucherId);
  if (voucher.status !== "draft")
    throw new Error(`Зөвхөн ноорог журналыг засна (төлөв: ${voucher.status})`);

  const lines = input.lines
    ? input.lines.map((line) => {
        const { code } = resolveAccount(line.account, ctx);
        const debit = Number(line.debit ?? 0);
        const credit = Number(line.credit ?? 0);
        if (debit > 0 && credit > 0)
          throw new Error("Нэг мөрөнд дебет, кредит зэрэг байж болохгүй");
        return { account: code, debit, credit, description: line.description ?? "" };
      })
    : voucher.lines.map((line) => ({
        account: line.accountNumber,
        debit: Number(line.debit),
        credit: Number(line.credit),
        description: line.description ?? "",
      }));

  unwrapAction(await updateVoucher(voucher.id, {
    date: input.date ?? voucher.date,
    description: input.description ?? voucher.description,
    lines,
    status: "draft",
  }));
  return {
    resultText: `Ноорог журнал шинэчлэгдлээ (${input.date ?? voucher.date})`,
    action: {
      kind: "voucher",
      id: voucher.id,
      title: input.description ?? voucher.description ?? "Журнал",
      status: "draft",
    },
  };
}

async function runReverseJournal(
  orgId: string,
  input: { voucherId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const voucher = resolveVoucherRef(await loadVouchers(orgId), input.voucherId);
  if (voucher.status !== "posted")
    throw new Error(`Зөвхөн батлагдсан журналыг буцаана (төлөв: ${voucher.status})`);
  const total = voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  assertPostLimit(total);
  unwrapAction(await unpostVoucher(voucher.id));
  return {
    resultText: `Буцаалтын бичилт үүсч эх журнал "Буцаагдсан" боллоо: ${voucher.date} · ${voucher.description}`,
  };
}

async function runGetTrialBalance(
  orgId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.to ?? ""))
    throw new Error("from/to огноо YYYY-MM-DD форматтай байх ёстой");
  const [accounts, configs] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || configMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);

  // П28 — snapshot + SQL delta (статусын шүүлт ижил: posted/reversed);
  // ваучерууд JS-д ачаалагдахгүй.
  const rows = await loadBalanceRowsFast(
    orgId,
    input.from,
    input.to,
    accounts,
    activeSegIds
  );
  if (rows.length === 0) return { resultText: "Бичилт олдсонгүй" };

  const lines = rows.map(
    (row) =>
      `${row.activeKey} ${row.name} | Нээлт Дт ${fmt(row.totals.openDebit)} Кт ${fmt(row.totals.openCredit)} | Гүйлгээ Дт ${fmt(row.totals.periodDebit)} Кт ${fmt(row.totals.periodCredit)} | Хаалт Дт ${fmt(row.totals.closeDebit)} Кт ${fmt(row.totals.closeCredit)}`
  );
  const totalPeriodDebit = rows.reduce((sum, row) => sum + row.totals.periodDebit, 0);
  const totalPeriodCredit = rows.reduce((sum, row) => sum + row.totals.periodCredit, 0);
  return {
    resultText: [
      `Гүйлгээ баланс ${input.from} — ${input.to} (батлагдсан бичилтээр):`,
      ...lines,
      `НИЙТ гүйлгээ: Дт ${fmt(totalPeriodDebit)} / Кт ${fmt(totalPeriodCredit)}`,
    ].join("\n"),
  };
}

// ── Санхүүгийн тайлангийн гүйцэтгэгчид ──────────────────────────────────────
// Вэбийн тайлангуудтай (components/gl/*view.tsx) ИЖИЛ цэвэр функцуудыг
// (lib/reports/balances.ts, bs-lines.ts) ашиглана — тусдаа тооцооны зам гаргахгүй.

function assertDates(...values: string[]) {
  for (const value of values)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? ""))
      throw new Error("Огноо YYYY-MM-DD форматтай байх ёстой");
}

/** Тайлангийн түүхий дата — батлагдсан журнал + бүх данс (нэр тайлбарт хэрэгтэй). */
async function loadReportData(orgId: string) {
  const [vouchers, accounts] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    }),
  ]);
  return { vouchers, accounts };
}

const IS_EXPENSE_GROUPS = [
  { prefix: "6", label: "Борлуулсан бараа/үйлчилгээний өртөг" },
  { prefix: "7", label: "Үйл ажиллагааны зардал" },
  { prefix: "8", label: "Санхүүгийн зардал" },
] as const;

async function runIncomeStatement(
  orgId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  assertDates(input.from, input.to);
  const accounts = await db.query.chartOfAccounts.findMany({
    where: eq(chartOfAccounts.organizationId, orgId),
  });
  // П28 — snapshot + SQL delta; ваучер ачаалахгүй.
  const rows = await loadBalanceRowsFast(orgId, input.from, input.to, accounts, [3]);
  const pnl = computeNetIncome(rows);

  const out: string[] = [`ОРЛОГЫН ТАЙЛАН ${input.from} — ${input.to}`, "Орлого:"];
  const revenueRows = rows
    .filter((row) => row.cls === "revenue")
    .map((row) => ({
      row,
      amount: row.totals.periodCredit - row.totals.periodDebit,
    }))
    .filter((entry) => Math.abs(entry.amount) > 0.005);
  for (const entry of revenueRows)
    out.push(`  ${entry.row.mainAccount} ${entry.row.name} — ${fmt(entry.amount)}`);
  out.push(`  Нийт орлого: ${fmt(pnl.revenue)}`);

  for (const group of IS_EXPENSE_GROUPS) {
    const items = rows
      .filter((row) => row.mainAccount.startsWith(group.prefix))
      .map((row) => ({
        row,
        amount: row.totals.periodDebit - row.totals.periodCredit,
      }))
      .filter((entry) => Math.abs(entry.amount) > 0.005);
    if (items.length === 0) continue;
    out.push(`${group.label}:`);
    for (const entry of items)
      out.push(`  ${entry.row.mainAccount} ${entry.row.name} — ${fmt(entry.amount)}`);
    out.push(`  Дэд дүн: ${fmt(items.reduce((sum, entry) => sum + entry.amount, 0))}`);
  }
  out.push(`Нийт зардал: ${fmt(pnl.expense)}`);
  out.push(
    `ТАЙЛАНТ ҮЕИЙН ЦЭВЭР ${pnl.netIncome >= 0 ? "АШИГ" : "АЛДАГДАЛ"}: ${fmt(pnl.netIncome)}`
  );
  return { resultText: out.join("\n") };
}

async function runBalanceSheet(
  orgId: string,
  input: { asOf: string }
): Promise<AiToolResult> {
  assertDates(input.asOf);
  const [accounts, mappings] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    }),
    db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.organizationId, orgId),
        eq(reportLineMappings.reportType, "balance-sheet")
      ),
    }),
  ]);
  // П28 — snapshot + SQL delta; asOf хүртэлх кумулятив (from маш эрт тул
  // бүх дүн periodDebit/Credit-д хуримтлагдана — өмнөх aggregateBalances-тай
  // яг ижил семантик).
  const rows = await loadBalanceRowsFast(orgId, "1900-01-01", input.asOf, accounts, [3]);
  const byMain = new Map(rows.map((row) => [row.mainAccount, row]));
  // Вэбийн балансын тайлантай НЭГ функц (lib/reports/bs-resolve.ts): хоосон
  // override нь default-даа үлдэнэ, аль ч мөрөнд ороогүй данс «Ангилагдаагүй»
  // мөрөнд ил гарна (ENT-072).
  type Line = ResolvedBsLine;
  const lines = resolveBsLines(accounts, mappings);

  const amountOf = (line: Line) =>
    line.accountNumbers.reduce((sum, code) => {
      const row = byMain.get(code);
      if (!row) return sum;
      const debitNet = row.totals.closeDebit - row.totals.closeCredit;
      return sum + (line.sign === "debit" ? debitNet : -debitNet);
    }, 0);

  const pnl = computeNetIncome(rows);
  const out: string[] = [`БАЛАНС ${input.asOf}-ны байдлаар`];
  const sectionTotals: Record<BsSection, number> = { assets: 0, liabilities: 0, equity: 0 };
  for (const section of ["assets", "liabilities", "equity"] as const) {
    const label =
      section === "assets" ? "ХӨРӨНГӨ" : section === "liabilities" ? "ӨР ТӨЛБӨР" : "ЭЗДИЙН ӨМЧ";
    out.push(`${label}:`);
    let lastGroup = "";
    for (const line of lines.filter((entry) => entry.section === section)) {
      const amount = amountOf(line);
      sectionTotals[section] += amount;
      if (Math.abs(amount) <= 0.005) continue;
      if (line.groupLabel !== lastGroup) {
        out.push(`  ${line.groupLabel}:`);
        lastGroup = line.groupLabel;
      }
      out.push(`    ${line.label} — ${fmt(amount)}`);
    }
    if (section === "equity") {
      out.push(
        `    Тайлант үеийн цэвэр ${pnl.netIncome >= 0 ? "ашиг" : "алдагдал"} — ${fmt(pnl.netIncome)}`
      );
    }
  }
  const totalEquity = sectionTotals.equity + pnl.netIncome;
  const totalLiabAndEquity = sectionTotals.liabilities + totalEquity;
  out.push(`НИЙТ ХӨРӨНГӨ: ${fmt(sectionTotals.assets)}`);
  out.push(`НИЙТ ӨР ТӨЛБӨР: ${fmt(sectionTotals.liabilities)}`);
  out.push(`НИЙТ ЭЗДИЙН ӨМЧ: ${fmt(totalEquity)}`);
  out.push(`НИЙТ ӨР ТӨЛБӨР + ЭЗДИЙН ӨМЧ: ${fmt(totalLiabAndEquity)}`);
  out.push(
    isBalanced(sectionTotals.assets, totalLiabAndEquity)
      ? "Тэнцэл: ✓ Актив = Пассив"
      : `Тэнцэл: ✗ ЗӨРҮҮ ${fmt(sectionTotals.assets - totalLiabAndEquity)} — reconcile_modules-оор шалтгааныг хайна уу`
  );
  return { resultText: out.join("\n") };
}

async function runCashFlow(
  orgId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  assertDates(input.from, input.to);
  // Вэбийн тайлантай НЭГ логик: cash-flow mapping (данс + S8 код) →
  // resolveCfLines → buildMappedCashFlow (lib/reports/cf-lines.ts).
  const [{ vouchers, accounts }, mappings, voucherCfCodes] = await Promise.all([
    loadReportData(orgId),
    db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.organizationId, orgId),
        eq(reportLineMappings.reportType, "cash-flow")
      ),
    }),
    loadVoucherCfCodes(orgId),
  ]);
  const resolved = resolveCfLines(mappings, accounts);
  const report = buildMappedCashFlow(
    vouchers,
    input.from,
    input.to,
    resolved,
    new Map(Object.entries(voucherCfCodes))
  );

  // Мөнгөн хөрөнгийн (10x/11x) нээлт/хаалт — ваучерын мөрүүдээс шууд.
  let open = 0;
  let periodNet = 0;
  for (const voucher of vouchers) {
    if (voucher.date > input.to) continue;
    for (const line of voucher.lines) {
      const main = extractMainAccount(line.accountNumber);
      if (!isCashMainAccount(main)) continue;
      const net = Number(line.debit) - Number(line.credit);
      if (voucher.date < input.from) open += net;
      else periodNet += net;
    }
  }
  const close = open + periodNet;

  const sectionLabels = {
    operating: "Үндсэн үйл ажиллагаа",
    investing: "Хөрөнгө оруулалт",
    financing: "Санхүүгийн үйл ажиллагаа",
  } as const;
  const out: string[] = [`МӨНГӨН ГҮЙЛГЭЭНИЙ ТАЙЛАН ${input.from} — ${input.to}`];
  for (const section of ["operating", "investing", "financing"] as const) {
    const sec = report.sections[section];
    out.push(`${sectionLabels[section]}: ${fmt(report.totals[section])}`);
    for (const line of sec.lines) {
      if (Math.abs(line.amount) <= 0.005) continue;
      out.push(`  ${line.label} — ${fmt(line.amount)}`);
    }
    if (Math.abs(sec.unmapped) > 0.005)
      out.push(`  Ангилагдаагүй урсгал — ${fmt(sec.unmapped)}`);
  }
  out.push(`ЦЭВЭР МӨНГӨН УРСГАЛ: ${fmt(report.totals.net)}`);
  if (report.uncodedVouchers > 0)
    out.push(
      `S8 ангилалгүй мөнгөн гүйлгээ: ${report.uncodedVouchers} журнал — харьцах дансаар ангилсан; нарийвчлахад кассын баримтад cashFlowCode өгнө (list_segment_values {segment: 8})`
    );
  if (Math.abs(report.totals.fxEffect) > 0.005)
    out.push(`Валютын ханшийн өөрчлөлтийн нөлөө: ${fmt(report.totals.fxEffect)}`);
  out.push(`Мөнгөний эхний үлдэгдэл: ${fmt(open)} · эцсийн үлдэгдэл: ${fmt(close)}`);
  const reconciled = open + report.totals.net + report.totals.fxEffect;
  out.push(
    isBalanced(reconciled, close)
      ? "Тулгалт: ✓ эхний + урсгал + ханшийн нөлөө = эцсийн"
      : `Тулгалт: ✗ зөрүү ${fmt(reconciled - close)}`
  );
  return { resultText: out.join("\n") };
}

async function runAccountLedger(
  orgId: string,
  input: { account: string; from: string; to: string; limit?: number }
): Promise<AiToolResult> {
  assertDates(input.from, input.to);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const ctx = await accountContext(orgId);
  const { main } = resolveAccount(input.account, ctx);
  const { vouchers } = await loadReportData(orgId);

  let opening = 0;
  const entries: {
    date: string;
    description: string;
    debit: number;
    credit: number;
  }[] = [];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      if ((parseSegParts(line.accountNumber, [3])[3] ?? line.accountNumber) !== main)
        continue;
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      if (voucher.date < input.from) opening += debit - credit;
      else if (voucher.date <= input.to)
        entries.push({
          date: voucher.date,
          description: line.description || voucher.description,
          debit,
          credit,
        });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const name = ctx.enabledByMain.get(main) ?? "";
  const out: string[] = [
    `ДАНСНЫ ХУУЛГА ${main} ${name} · ${input.from} — ${input.to}`,
    `Эхний үлдэгдэл: ${fmt(opening)}`,
  ];
  let running = opening;
  for (const entry of entries.slice(0, limit)) {
    running += entry.debit - entry.credit;
    out.push(
      `${entry.date} · ${entry.description} · Дт ${fmt(entry.debit)} / Кт ${fmt(entry.credit)} · үлдэгдэл ${fmt(running)}`
    );
  }
  if (entries.length > limit)
    out.push(`… ${entries.length - limit} мөр хасагдав (limit=${limit})`);
  const closing = entries.reduce((sum, entry) => sum + entry.debit - entry.credit, opening);
  out.push(`Эцсийн үлдэгдэл: ${fmt(closing)}`);
  return { resultText: out.join("\n") };
}

async function runYearEndClosing(
  orgId: string,
  input: { year: string }
): Promise<AiToolResult> {
  const year = String(input.year ?? "").trim();
  if (!/^\d{4}$/.test(year)) throw new Error("Жил YYYY форматтай байх ёстой");
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const marker = `Жилийн хаалт ${year}`;
  const refPrefix = `year-end-${year}`;

  const { vouchers, accounts } = await loadReportData(orgId);
  // Idempotency: ноорог ч бай, батлагдсан ч бай — нэг жилд нэг л хаалт.
  // Гол түлхүүр нь externalRef (year-end-YYYY-N) — тайлбарыг засварлаад
  // хамгаалалтыг тойрч чадахгүй; хуучин (ref-гүй) хаалтуудыг тайлбараар нь
  // нэмэлт байдлаар таньсаар байна.
  const dupes = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.organizationId, orgId),
    columns: { id: true, description: true, status: true, externalRef: true },
  });
  const already = dupes.find(
    (voucher) =>
      (voucher.externalRef ?? "").startsWith(`${refPrefix}-`) ||
      voucher.description.startsWith(marker)
  );
  if (already)
    return {
      resultText: `[CONFLICT] ${year} оны хаалтын бичилт аль хэдийн байна (ID ${already.id.slice(0, 8)}, төлөв: ${already.status}) — дахин үүсгэсэнгүй. Дахин хийх бол эхлээд хуучныг устгаж/буцаана уу.`,
      dedup: true,
    };

  const ctx = await accountContext(orgId);
  const plSummary = resolveAccount("44000099", ctx);
  const retained = resolveAccount("44000001", ctx);

  const rows = aggregateBalances(vouchers, accounts, [3], from, to);
  const revenue = rows
    .map((row) => ({
      main: row.mainAccount,
      amount: row.totals.periodCredit - row.totals.periodDebit,
    }))
    .filter((entry) => entry.main.startsWith("5") && Math.abs(entry.amount) > 0.005);
  const expense = rows
    .map((row) => ({
      main: row.mainAccount,
      amount: row.totals.periodDebit - row.totals.periodCredit,
    }))
    .filter((entry) => /^[678]/.test(entry.main) && Math.abs(entry.amount) > 0.005);
  const totalRevenue = revenue.reduce((sum, entry) => sum + entry.amount, 0);
  const totalExpense = expense.reduce((sum, entry) => sum + entry.amount, 0);
  const net = Math.round((totalRevenue - totalExpense) * 100) / 100;
  if (revenue.length === 0 && expense.length === 0)
    throw new Error(`${year} онд хаах орлого/зардлын гүйлгээ алга`);

  // Сөрөг үлдэгдэлтэй данс талаа сольж бичигдэнэ (контра орлого г.м).
  const side = (amount: number, normal: "debit" | "credit") => {
    const debitSide = (normal === "debit") === (amount >= 0);
    return {
      debit: debitSide ? Math.abs(amount) : 0,
      credit: debitSide ? 0 : Math.abs(amount),
    };
  };

  const created: string[] = [];
  if (revenue.length > 0) {
    const { id } = unwrapAction(await createVoucher({
      date: to,
      description: `${marker} 1/3: орлогын дансдыг хаав`,
      status: "draft",
      externalRef: `${refPrefix}-1`,
      lines: [
        ...revenue.map((entry) => ({
          account: resolveAccount(entry.main, ctx).code,
          description: "Орлого хаах",
          ...side(entry.amount, "debit"),
        })),
        {
          account: plSummary.code,
          description: "Орлогын дүн",
          ...side(totalRevenue, "credit"),
        },
      ],
    }));
    created.push(`1/3 орлого ${fmt(totalRevenue)} (ID ${id.slice(0, 8)})`);
  }
  if (expense.length > 0) {
    const { id } = unwrapAction(await createVoucher({
      date: to,
      description: `${marker} 2/3: зардлын дансдыг хаав`,
      status: "draft",
      externalRef: `${refPrefix}-2`,
      lines: [
        {
          account: plSummary.code,
          description: "Орлогын дүн",
          ...side(totalExpense, "debit"),
        },
        ...expense.map((entry) => ({
          account: resolveAccount(entry.main, ctx).code,
          description: "Зардал хаах",
          ...side(entry.amount, "credit"),
        })),
      ],
    }));
    created.push(`2/3 зардал ${fmt(totalExpense)} (ID ${id.slice(0, 8)})`);
  }
  if (Math.abs(net) > 0.005) {
    const { id } = unwrapAction(await createVoucher({
      date: to,
      description: `${marker} 3/3: цэвэр дүнг хуримтлагдсан ашигт`,
      status: "draft",
      externalRef: `${refPrefix}-3`,
      lines: [
        {
          account: plSummary.code,
          description: "Орлогын дүн хаах",
          ...side(net, "debit"),
        },
        {
          account: retained.code,
          description: "Хуримтлагдсан ашиг",
          ...side(net, "credit"),
        },
      ],
    }));
    created.push(`3/3 цэвэр дүн ${fmt(net)} (ID ${id.slice(0, 8)})`);
  }

  return {
    resultText: [
      `${year} оны хаалтын НООРОГ бичилтүүд ${to} огноогоор үүслээ:`,
      ...created.map((line) => `  ${line}`),
      `Нийт орлого ${fmt(totalRevenue)} − зардал ${fmt(totalExpense)} = ЦЭВЭР ${net >= 0 ? "АШИГ" : "АЛДАГДАЛ"} ${fmt(net)}`,
      "Нягтланч вэбээс (Ерөнхий журнал → Журналын жагсаалт) шалгаж батална.",
    ].join("\n"),
  };
}

// ── АР/АП нэмэлт гүйцэтгэгчид ───────────────────────────────────────────────

/** Жагсаалтын товч шошго: АР / АП, буцаалтын баримтад төрлийн нэр. */
function arapShortLabel(documentType: string): string {
  if (isCreditDocument(documentType)) return documentTypeLabel(documentType);
  return arapLedger(documentType) === "ar" ? "АР" : "АП";
}

const ARAP_STATUS_LABELS: Record<string, string> = {
  draft: "ноорог",
  posted: "батлагдсан",
  partially_paid: "хэсэгчлэн төлсөн",
  paid: "төлсөн",
  reversed: "буцаагдсан",
};

async function runListArapDocuments(
  orgId: string,
  input: {
    documentType?: string;
    counterparty?: string;
    status?: string;
    from?: string;
    to?: string;
    openOnly?: boolean;
    limit?: number;
  }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const documents = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.organizationId, orgId),
    with: { counterparty: { columns: { name: true } } },
    orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
    limit: 400,
  });
  const cpQuery = input.counterparty?.trim().toLowerCase();
  const filtered = documents
    .filter((doc) => {
      const balance = Number(doc.totalAmount) - Number(doc.paidAmount);
      if (input.documentType && doc.documentType !== input.documentType) return false;
      if (input.status && doc.status !== input.status) return false;
      if (cpQuery && !(doc.counterparty?.name ?? "").toLowerCase().includes(cpQuery))
        return false;
      if (input.from && doc.date < input.from) return false;
      if (input.to && doc.date > input.to) return false;
      if (input.openOnly && !(balance > 0.01 && doc.status !== "draft" && doc.status !== "reversed"))
        return false;
      return true;
    })
    .slice(0, limit);
  if (filtered.length === 0) return { resultText: "Тохирох нэхэмжлэх олдсонгүй" };
  return {
    resultText: filtered
      .map((doc) => {
        const total = Number(doc.totalAmount);
        const paid = Number(doc.paidAmount);
        const balance = total - paid;
        // Валюттай баримт: дүнг өөрийн валютаар + ₮ ойролцоо (base) дүнгээр.
        // Legacy MNT баримтад base талбар 0 байж болно — nominal-руу унана.
        if (doc.currency !== "MNT") {
          const baseTotal =
            Number(doc.baseTotalAmount) !== 0 ? Number(doc.baseTotalAmount) : total;
          const basePaid =
            Number(doc.basePaidAmount) !== 0 ? Number(doc.basePaidAmount) : paid;
          return `${doc.date} · ${doc.documentNo} · ${doc.counterparty?.name ?? "?"} · ${arapShortLabel(doc.documentType)} · нийт ${fmt(total)} ${doc.currency} (≈${fmt(baseTotal)}₮) · төлөгдсөн ${fmt(paid)} ${doc.currency} · үлдэгдэл ${fmt(balance)} ${doc.currency} (≈${fmt(baseTotal - basePaid)}₮) · ${ARAP_STATUS_LABELS[doc.status] ?? doc.status} · ID ${doc.id.slice(0, 8)}${doc.externalRef ? ` · ref ${doc.externalRef}` : ""}`;
        }
        return `${doc.date} · ${doc.documentNo} · ${doc.counterparty?.name ?? "?"} · ${arapShortLabel(doc.documentType)} · нийт ${fmt(total)} · төлөгдсөн ${fmt(paid)} · үлдэгдэл ${fmt(balance)} · ${ARAP_STATUS_LABELS[doc.status] ?? doc.status} · ID ${doc.id.slice(0, 8)}${doc.externalRef ? ` · ref ${doc.externalRef}` : ""}`;
      })
      .join("\n"),
  };
}

async function runPayArap(
  orgId: string,
  input: {
    documentId: string;
    cashAccount: string;
    date: string;
    amount?: number;
    exchangeRate?: number;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const documents = await db.query.arApDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(arApDocuments.organizationId, orgId), refCondition({ id: arApDocuments.id, documentNo: arApDocuments.documentNo, externalRef: arApDocuments.externalRef }, input.documentId)),
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 50,
  });
  const byNo = documents.filter(
    (doc) => doc.documentNo.toLowerCase() === input.documentId.trim().toLowerCase()
  );
  const document =
    byNo.length === 1
      ? byNo[0]
      : resolveByIdPrefix(documents, input.documentId, "нэхэмжлэх");
  if (!["posted", "partially_paid"].includes(document.status))
    throw new Error(
      `Зөвхөн батлагдсан/хэсэгчлэн төлсөн нэхэмжлэхийг төлнө (төлөв: ${ARAP_STATUS_LABELS[document.status] ?? document.status})`
    );

  const balance = Number(document.totalAmount) - Number(document.paidAmount);
  const amount = input.amount != null ? Number(input.amount) : balance;
  if (!(amount > 0)) throw new Error("Төлөх дүн 0-ээс их байх ёстой");
  if (amount > balance + 0.01)
    throw new Error(`Төлөх дүн үлдэгдлээс их байна (үлдэгдэл ${fmt(balance)}₮)`);

  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
  });
  const cashAccount = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "мөнгөн данс",
    input.cashAccount
  );

  // Мөнгө орох (нэхэмжлэл, дебит нэхэмжлэх) эсвэл гарах (өглөг, кредит
  // нэхэмжлэлийн илүүдлийг буцаан олгох) — ENT-029.
  const isAr = settlementCashType(document.documentType) === "receipt";
  // Лимит ЗААВАЛ MNT-ээр — валютын нэхэмжлэхийн дүнг ханшаар үржинэ.
  const baseAmount =
    document.currency !== "MNT"
      ? amount * (Number(document.exchangeRate) || 0)
      : amount;
  let postNow = false;
  let note = "";
  if (mode === "post") {
    if (baseAmount > currentAiPostLimit() || !(baseAmount > 0))
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`;
    else postNow = true;
  }

  // ENT-037: валютын данснаас төлөхөд ханш өгөөгүй бол төлбөрийн ӨДРИЙН
  // албан ханш (ИЛ тэмдэглэнэ — банкны бодит ханш өөр бол exchangeRate өгнө).
  // Олдохгүй бол ЗОХИОХГҮЙ — аль параметр дутууг нэрлэж татгалзана.
  let exchangeRate = input.exchangeRate;
  let rateNote = "";
  if (cashAccount.currency !== "MNT" && !(Number(exchangeRate) > 0)) {
    try {
      const lookup = await getOfficialRateForDate(cashAccount.currency, input.date);
      exchangeRate = lookup.rate;
      rateNote = `, ханш ${lookup.rate} (Монголбанкны албан ханш ${lookup.rateDate} — банкны бодит ханш өөр бол exchangeRate-ээр дахин)`;
    } catch {
      throw codedError(
        "RATE_REQUIRED",
        `${cashAccount.name} (${cashAccount.currency}) данснаас төлөхөд ${input.date}-ны ханш олдсонгүй — exchangeRate (1 ${cashAccount.currency} = ? ₮) параметрийг өгнө үү`
      );
    }
  }

  const { id } = unwrapAction(await createCashDocument({
    documentType: isAr ? "receipt" : "payment",
    date: input.date,
    toCashAccountId: isAr ? cashAccount.id : undefined,
    fromCashAccountId: isAr ? undefined : cashAccount.id,
    counterAccountNumber: parseSegParts(document.controlAccountNumber, [3])[3] ??
      document.controlAccountNumber,
    description: `${document.documentNo} төлөлт`,
    amount,
    // Валютын данснаас төлөхөд createCashDocument ханш (>0) шаарддаг.
    exchangeRate,
    arApDocumentId: document.id,
    postNow,
  }));

  const unit = document.currency === "MNT" ? "₮" : ` ${document.currency}`;
  const balanceNote = postNow && !isAr ? await negativeCashBalanceNote(orgId, cashAccount.id) : "";
  return {
    resultText: `Төлбөрийн баримт үүслээ: ${document.documentNo}, ${fmt(amount)}${unit}, ${cashAccount.name}${rateNote}, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}${balanceNote}`,
    action: {
      kind: "cash",
      id,
      title: `${document.documentNo} төлөлт`,
      status: postNow ? "posted" : "draft",
    },
  };
}

/** АР/АП баримтыг ID, дугаар, эсвэл externalRef-ээр олно. */
async function findArapDocument(orgId: string, idOrNo: string) {
  const documents = await db.query.arApDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(arApDocuments.organizationId, orgId), refCondition({ id: arApDocuments.id, documentNo: arApDocuments.documentNo, externalRef: arApDocuments.externalRef }, idOrNo)),
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 50,
  });
  const query = idOrNo.trim().toLowerCase();
  const byNo = documents.filter((doc) => doc.documentNo.toLowerCase() === query);
  if (byNo.length === 1) return byNo[0];
  const byRef = documents.filter(
    (doc) => query.length > 0 && (doc.externalRef ?? "").toLowerCase() === query
  );
  if (byRef.length === 1) return byRef[0];
  return resolveByIdPrefix(documents, idOrNo, "нэхэмжлэх");
}

// ── ECL нөөц, найдваргүй авлага (ENT-065) ────────────────────────────────────

function fmtEclPlan(plan: EclProvisionPlan): string[] {
  const lines = plan.buckets.map(
    (bucket) =>
      `  ${bucket.label}: ${fmt(bucket.balance)}₮ (${bucket.count} баримт) × ${bucket.ratePct}% = ${fmt(bucket.required)}₮`
  );
  lines.push(
    `Нийт авлага ${fmt(plan.grossBalance)}₮ → шаардлагатай нөөц ${fmt(plan.requiredAllowance)}₮; GL-ийн одоогийн нөөц ${fmt(plan.currentAllowance)}₮; бичигдэх delta ${fmt(plan.allowanceDelta)}₮`
  );
  lines.push(
    plan.deferredTax
      ? `Хойшлогдсон татвар (IAS 12, ${plan.deferredTax.ratePct}%): шаардлагатай DTA ${fmt(plan.deferredTax.requiredAsset)}₮, одоо ${fmt(plan.deferredTax.currentAsset)}₮, delta ${fmt(plan.deferredTax.delta)}₮`
      : "Хойшлогдсон татвар бодогдоогүй — ААНОАТ-ын хувийг Авлага → ECL нөөц → Тохиргоо-д оруулна (хувь зохиохгүй)"
  );
  return lines;
}

async function runGetEclProvision(input: { asOf?: string }): Promise<AiToolResult> {
  const asOf = input.asOf?.trim() || ulaanbaatarToday();
  const overview = unwrapAction(await getEclOverview(asOf));
  return {
    resultText: [
      `ECL нөөц (IFRS 9, хялбаршуулсан арга) — ${asOf}:`,
      ...fmtEclPlan(overview.plan),
      overview.drafts.length > 0
        ? `Ноорог ECL журнал байна: ${overview.drafts.map((draft) => draft.documentNo ?? draft.id.slice(0, 8)).join(", ")}`
        : "Ноорог ECL журнал алга — run_ecl_provision-оор үүсгэнэ",
    ].join("\n"),
  };
}

async function runRunEclProvision(input: { asOf: string }): Promise<AiToolResult> {
  const result = unwrapAction(await runEclProvision({ asOf: input.asOf?.trim() }));
  if (!result.voucherId)
    return {
      resultText: [`ECL нөөцөд өөрчлөлт алга (${input.asOf}) — журнал үүсээгүй.`, ...fmtEclPlan(result.plan)].join("\n"),
    };
  return {
    resultText: [
      `ECL нөөцийн НООРОГ журнал үүслээ: ${result.documentNo}${result.replacedDrafts > 0 ? ` (өмнөх ${result.replacedDrafts} ноорог солигдов)` : ""}. Нягтланч шалгаад батална.`,
      ...fmtEclPlan(result.plan),
    ].join("\n"),
    action: { kind: "voucher", id: result.voucherId, title: result.documentNo ?? "ECL", status: "draft" },
  };
}

async function runWriteOffArap(
  orgId: string,
  input: { document: string; date?: string; amount?: number; reason?: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const doc = await findArapDocument(orgId, input.document);
  const open = Number(doc.totalAmount) - Number(doc.paidAmount);
  const amount = input.amount != null ? Number(input.amount) : open;
  assertPostLimit(open > 0 ? (Number(doc.baseTotalAmount) - Number(doc.basePaidAmount)) * (amount / open) : amount);
  const result = unwrapAction(
    await writeOffArApDocument({
      documentId: doc.id,
      date: input.date?.trim() || ulaanbaatarToday(),
      amount: input.amount ?? null,
      reason: input.reason ?? "",
    })
  );
  return {
    resultText: `${doc.documentNo} найдваргүй болгож хасагдлаа: ${fmt(result.baseAmount)}₮ (ECL нөөцөөс ${fmt(result.fromAllowance)}₮, шууд зардалд ${fmt(result.toExpense)}₮), журнал ${result.documentNo}. Мөнгө орвол recover_arap_write_off.`,
    action: { kind: "arap", id: doc.id, title: doc.documentNo, status: "posted" },
  };
}

async function runRecoverArapWriteOff(
  orgId: string,
  input: { document: string; date?: string; amount?: number },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const doc = await findArapDocument(orgId, input.document);
  const writeOff = await db.query.arapWriteOffs.findFirst({
    where: and(
      eq(arapWriteOffs.organizationId, orgId),
      eq(arapWriteOffs.documentId, doc.id),
      eq(arapWriteOffs.status, "active")
    ),
    orderBy: [desc(arapWriteOffs.createdAt)],
  });
  if (!writeOff) throw codedError("WRITE_OFF_NOT_FOUND", `${doc.documentNo}-д идэвхтэй хасалт алга`);
  const remaining = Number(writeOff.amount) - Number(writeOff.recoveredAmount);
  const amount = input.amount != null ? Number(input.amount) : remaining;
  assertPostLimit(remaining > 0 ? (Number(writeOff.baseAmount) - Number(writeOff.recoveredBaseAmount)) * (amount / remaining) : amount);
  const result = unwrapAction(
    await recoverArApWriteOff({
      writeOffId: writeOff.id,
      date: input.date?.trim() || ulaanbaatarToday(),
      amount: input.amount ?? null,
    })
  );
  return {
    resultText: `${doc.documentNo}-ийн хасалтаас ${fmt(result.baseAmount)}₮ сэргээв (Dr авлага / Cr ECL зардал), журнал ${result.documentNo}. Нэхэмжлэлийн үлдэгдэл дахин нээгдсэн — орлогыг create_cash_transaction (applyTo: ${doc.documentNo})-оор бүртгэнэ.`,
    action: { kind: "arap", id: doc.id, title: doc.documentNo, status: "posted" },
  };
}

async function runSendInvoiceEmail(
  orgId: string,
  input: { documentId: string; to?: string }
): Promise<AiToolResult> {
  const document = await findArapDocument(orgId, input.documentId);
  let recipient = input.to?.trim();
  if (!recipient) {
    const counterparty = await db.query.counterparties.findFirst({
      where: and(
        eq(counterparties.id, document.counterpartyId),
        eq(counterparties.organizationId, orgId)
      ),
      columns: { name: true, email: true },
    });
    recipient = counterparty?.email ?? undefined;
    if (!recipient)
      throw codedError(
        "EMAIL_MISSING",
        `"${counterparty?.name ?? "?"}" харилцагчид и-мэйл бүртгэгдээгүй — update_counterparty-гаар и-мэйл нэмэх эсвэл to параметр өгнө үү`
      );
  }
  // sendInvoiceEmail өөрөө "зөвхөн posted АР нэхэмжлэх" дүрмээ шалгана.
  const result = unwrapAction(await sendInvoiceEmail(document.id, recipient));
  return {
    resultText: `Нэхэмжлэх и-мэйлээр илгээгдлээ: ${result.documentNo} → ${result.sentTo} (PDF хавсралт + онлайн линктэй)`,
  };
}

async function runCreateInvoiceLink(
  orgId: string,
  input: { documentId: string }
): Promise<AiToolResult> {
  const document = await findArapDocument(orgId, input.documentId);
  // ActionResult-ийг задлахгүй бол алдаанд «→ undefined» гэж буцаадаг байв (ENT-057).
  const { url } = unwrapAction(await createInvoiceLink(document.id));
  return {
    resultText: `Нэхэмжлэхийн public линк үүслээ: ${document.documentNo} → ${url}`,
  };
}

async function runDeleteArap(
  orgId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const documents = await db.query.arApDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(arApDocuments.organizationId, orgId), refCondition({ id: arApDocuments.id, documentNo: arApDocuments.documentNo, externalRef: arApDocuments.externalRef }, input.documentId)),
    columns: {
      id: true,
      status: true,
      documentNo: true,
      date: true,
      totalAmount: true,
      baseTotalAmount: true,
      externalRef: true,
    },
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 50,
  });
  const byNo = documents.filter(
    (doc) => doc.documentNo.toLowerCase() === input.documentId.trim().toLowerCase()
  );
  const document =
    byNo.length === 1
      ? byNo[0]
      : resolveByIdPrefix(documents, input.documentId, "нэхэмжлэх");
  // Батлагдсан бичилтийг устгах нь эргэлт буцалтгүй — зөвхөн "Шууд бичих"
  // горимд, батлахтай ИЖИЛ дүнгийн лимиттэй зөвшөөрнө (ноорог устгалт
  // аль ч горимд чөлөөтэй).
  if (document.status !== "draft") {
    assertPostMode(mode);
    assertPostLimit(Number(document.baseTotalAmount ?? document.totalAmount));
  }
  unwrapAction(await deleteArApDocument(document.id));
  return {
    // ENT-032: батлагдсан нэхэмжлэхийг «ноорог» гэж буруу мэдэгддэг байв.
    resultText: `${document.status === "draft" ? "Ноорог нэхэмжлэх" : "Батлагдсан нэхэмжлэх GL-тэй нь хамт"} устгагдлаа: ${document.date} · ${document.documentNo} · ${fmt(Number(document.totalAmount))}₮`,
  };
}

// Хугацааны задаргааны багцууд (asOf − dueDate хоногоор).
const AGING_BUCKETS = [
  { label: "хугацаа болоогүй", min: -Infinity, max: -1 },
  { label: "0-30", min: 0, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "90+", min: 91, max: Infinity },
] as const;

async function runCounterpartyBalance(
  orgId: string,
  input: { counterparty?: string; asOf?: string; aging?: boolean }
): Promise<AiToolResult> {
  const asOf = input.asOf?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    throw new Error("asOf огноо YYYY-MM-DD форматтай байна");

  // Зөвхөн asOf-д НЭЭЛТТЭЙ байж болох баримт: одоо үлдэгдэлтэй, эсвэл
  // asOf-оос ХОЙШ төлөгдсөн (тэр үед нээлттэй байсан). Бүх түүх ачаалахгүй.
  const openAsOfScope = and(
    eq(arApDocuments.organizationId, orgId),
    lte(arApDocuments.date, asOf),
    notInArray(arApDocuments.status, ["draft", "reversed"]),
    or(
      sql`${arApDocuments.totalAmount} <> ${arApDocuments.paidAmount}`,
      sql`exists (
        select 1 from ${arApSettlements}
        where ${arApSettlements.documentId} = ${arApDocuments.id}
          and ${arApSettlements.settlementDate} > ${asOf}
      )`
    )
  );
  // Raw `exists` нь гадна хүснэгтийг «ar_ap_documents» нэрээр иш татдаг —
  // relational query API (db.query) хүснэгтийг alias-аар нэрлэдэг тул
  // «missing FROM-clause entry» болж tool ҮРГЭЛЖ унадаг байв (ENT-069).
  // Шүүлтийг core select-ээр НЭГ удаа гүйцэтгэж ID-гаар ачаална.
  const openIds = (
    await db.select({ id: arApDocuments.id }).from(arApDocuments).where(openAsOfScope)
  ).map((row) => row.id);
  const [documents, settlements] =
    openIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.query.arApDocuments.findMany({
            where: inArray(arApDocuments.id, openIds),
            with: { counterparty: { columns: { id: true, name: true } } },
          }),
          db.query.arApSettlements.findMany({
            where: and(
              eq(arApSettlements.organizationId, orgId),
              inArray(arApSettlements.documentId, openIds)
            ),
          }),
        ]);
  // asOf-оор түүхэн үлдэгдэл: paidAmount биш settlement-ийн огноогоор тоолно.
  // Хоёр хэмжүүрээр: nominal (баримтын валютаар — нээлттэй эсэхийг шийднэ)
  // болон base (₮ — нийлбэр/aging-д валют хольж болохгүй тул MNT-ээр нэгтгэнэ).
  const paidAsOf = new Map<string, number>();
  const paidBaseAsOf = new Map<string, number>();
  for (const settlement of settlements) {
    if (settlement.settlementDate > asOf) continue;
    paidAsOf.set(
      settlement.documentId,
      (paidAsOf.get(settlement.documentId) ?? 0) + Number(settlement.amount)
    );
    // Legacy МНТ мөрөнд baseAmount 0 байж болно — nominal-руу унана.
    const base =
      Number(settlement.baseAmount) !== 0
        ? Number(settlement.baseAmount)
        : Number(settlement.amount);
    paidBaseAsOf.set(
      settlement.documentId,
      (paidBaseAsOf.get(settlement.documentId) ?? 0) + base
    );
  }
  type ArapDoc = (typeof documents)[number];
  const baseTotalOf = (doc: ArapDoc) =>
    Number(doc.baseTotalAmount) !== 0
      ? Number(doc.baseTotalAmount)
      : Number(doc.totalAmount);
  /** Үлдэгдэл ₮-өөр (asOf) — нийлбэр, aging бүгд үүгээр нэгтгэгдэнэ. */
  const baseBalanceOf = (doc: ArapDoc) =>
    baseTotalOf(doc) - (paidBaseAsOf.get(doc.id) ?? 0);

  const cpQuery = input.counterparty?.trim().toLowerCase();
  const open = documents.filter((doc) => {
    if (doc.status === "draft" || doc.status === "reversed") return false;
    if (doc.date > asOf) return false;
    if (cpQuery && !(doc.counterparty?.name ?? "").toLowerCase().includes(cpQuery))
      return false;
    const balance = Number(doc.totalAmount) - (paidAsOf.get(doc.id) ?? 0);
    return balance > 0.01;
  });
  if (open.length === 0)
    return {
      resultText: `${asOf}-ны байдлаар ${cpQuery ? `"${input.counterparty}" харилцагчид` : ""} үлдэгдэлтэй нэхэмжлэх алга`,
    };

  const daysOverdue = (dueDate: string) =>
    Math.floor(
      (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000
    );
  const bucketOf = (dueDate: string) => {
    const days = daysOverdue(dueDate);
    return AGING_BUCKETS.find((bucket) => days >= bucket.min && days <= bucket.max)!;
  };

  // Кредит нэхэмжлэл / дебит нэхэмжлэх нь дэвтрийнхээ үлдэгдлийг БУУРУУЛНА
  // (ENT-029) — хасах тэмдгээр нэгтгэнэ.
  const signedBaseBalanceOf = (doc: ArapDoc) => ledgerSign(doc.documentType) * baseBalanceOf(doc);
  const sections: string[] = [];
  for (const ledger of ["ar", "ap"] as const) {
    const docs = open.filter((doc) => arapLedger(doc.documentType) === ledger);
    if (docs.length === 0) continue;
    const label = ledger === "ar" ? "АВЛАГА" : "ӨГЛӨГ";
    const byCp = new Map<string, typeof docs>();
    for (const doc of docs) {
      const key = doc.counterparty?.name ?? "?";
      byCp.set(key, [...(byCp.get(key) ?? []), doc]);
    }
    const lines: string[] = [];
    let sectionTotal = 0;
    for (const [cpName, cpDocs] of [...byCp.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      // Нийлбэр ЗААВАЛ ₮-өөр — USD + MNT дүнг шууд нэмж болохгүй.
      const cpTotal = cpDocs.reduce((sum, doc) => sum + signedBaseBalanceOf(doc), 0);
      sectionTotal += cpTotal;
      lines.push(`  ${cpName} — ${fmt(cpTotal)}₮`);
      for (const doc of cpDocs) {
        const sign = ledgerSign(doc.documentType);
        const balance = sign * (Number(doc.totalAmount) - (paidAsOf.get(doc.id) ?? 0));
        const partial =
          Math.abs(balance) < Number(doc.totalAmount) - 0.01 ? ", хэсэгчилсэн" : "";
        const kindNote = sign < 0 ? ` · ${documentTypeLabel(doc.documentType).toLowerCase()}` : "";
        // Валюттай баримтын мөр: өөрийн валютаар + ₮ ойролцоо дүн.
        const amountText =
          doc.currency !== "MNT"
            ? `${fmt(balance)} ${doc.currency} (≈${fmt(signedBaseBalanceOf(doc))}₮)`
            : `${fmt(balance)}₮`;
        lines.push(
          `    ${doc.date} · ${doc.documentNo}${kindNote} · үлдэгдэл ${amountText}${partial}${input.aging ? ` · ${bucketOf(doc.dueDate).label}` : ""}`
        );
      }
    }
    if (input.aging) {
      const bucketTotals = AGING_BUCKETS.map((bucket) => ({
        bucket,
        total: docs
          .filter((doc) => bucketOf(doc.dueDate) === bucket)
          .reduce((sum, doc) => sum + signedBaseBalanceOf(doc), 0),
      })).filter((entry) => Math.abs(entry.total) > 0.01);
      lines.push(
        `  Задаргаа: ${bucketTotals.map((entry) => `${entry.bucket.label} ${fmt(entry.total)}₮`).join(" · ")}`
      );
    }
    sections.push(`${label} (${asOf}-ны байдлаар): нийт ${fmt(sectionTotal)}₮\n${lines.join("\n")}`);
  }
  return { resultText: sections.join("\n\n") };
}

// ── Batch (бөөн оруулалт) гүйцэтгэгчид ──────────────────────────────────────

/** Partial success: мөр бүр тусдаа — нэг мөрийн алдаа бусдыг унагахгүй (спек §9). */
async function runCreateBatch(
  items: unknown[] | undefined,
  runOne: (item: unknown, index: number) => Promise<AiToolResult>
): Promise<AiToolResult> {
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("items хоосон байна");
  if (items.length > 100) throw new Error("Нэг batch-д хамгийн ихдээ 100 мөр");
  const lines: string[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, item] of items.entries()) {
    try {
      const result = await runOne(item, index);
      if (result.dedup) {
        skipped += 1;
        lines.push(`#${index} алгассан — ${result.resultText}`);
      } else {
        created += 1;
        lines.push(`#${index} үүссэн — ${result.resultText}`);
      }
    } catch (caught) {
      failed += 1;
      lines.push(`#${index} АЛДАА — ${errorText(caught)}`);
    }
  }
  return {
    resultText: [
      `Нийт ${items.length} · үүссэн ${created} · алгассан ${skipped} · алдаатай ${failed}`,
      ...lines,
    ].join("\n"),
  };
}

/** Бөөнөөр батлах: хязгаараас хэтэрсэн нь вэб дээрээс батлах жагсаалт болно (спек §10). */
async function runPostBatch(
  ids: string[] | undefined,
  mode: AiWriteMode,
  postOne: (id: string) => Promise<AiToolResult>
): Promise<AiToolResult> {
  assertPostMode(mode);
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error("ID-ийн жагсаалт хоосон байна");
  if (ids.length > 100) throw new Error("Нэг batch-д хамгийн ихдээ 100 баримт");
  const lines: string[] = [];
  const needsManual: string[] = [];
  let posted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const result = await postOne(String(id));
      posted += 1;
      lines.push(`${id} батлагдсан — ${result.resultText}`);
    } catch (caught) {
      const message = errorText(caught);
      failed += 1;
      if (message.startsWith("[AMOUNT_LIMIT_EXCEEDED]")) needsManual.push(String(id));
      lines.push(`${id} АЛДАА — ${message}`);
    }
  }
  const summary = [
    `Нийт ${ids.length} · батлагдсан ${posted} · алдаатай ${failed}`,
    ...lines,
  ];
  if (needsManual.length > 0)
    summary.push(
      `Вэб дээрээс нягтланч батлах шаардлагатай (${fmt(currentAiPostLimit())}₮-с их): ${needsManual.join(", ")}`
    );
  return { resultText: summary.join("\n") };
}

// ── Касс нэмэлт гүйцэтгэгчид ────────────────────────────────────────────────

async function runListCashDocuments(
  orgId: string,
  input: {
    documentType?: string;
    status?: string;
    from?: string;
    to?: string;
    cashAccount?: string;
    limit?: number;
    offset?: number;
  }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const offset = Math.max(Number(input.offset) || 0, 0);
  // SIM2-012: шүүлт SQL-д (cashAccount өмнө нь огт үйлчилдэггүй байв).
  let accountFilter: ReturnType<typeof or> | undefined;
  if (input.cashAccount?.trim()) {
    const accounts = await db.query.cashAccounts.findMany({
      where: eq(cashAccounts.organizationId, orgId),
    });
    const account = requireSingle(
      nameMatches(accounts, (entry) => entry.name, input.cashAccount),
      (entry) => entry.name,
      "мөнгөн данс",
      input.cashAccount,
      { allNames: accounts.map((entry) => entry.name) }
    );
    accountFilter = or(
      eq(cashDocuments.fromCashAccountId, account.id),
      eq(cashDocuments.toCashAccountId, account.id)
    );
  }
  const conditions = and(
    eq(cashDocuments.organizationId, orgId),
    ...(input.documentType ? [eq(cashDocuments.documentType, input.documentType)] : []),
    ...(input.status ? [eq(cashDocuments.status, input.status)] : []),
    ...(input.from ? [gte(cashDocuments.date, input.from)] : []),
    ...(input.to ? [lte(cashDocuments.date, input.to)] : []),
    ...(accountFilter ? [accountFilter] : [])
  );
  const [total, filtered] = await Promise.all([
    db.$count(cashDocuments, conditions),
    db.query.cashDocuments.findMany({
      where: conditions,
      orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
      limit,
      offset,
    }),
  ]);
  const typeLabels: Record<string, string> = {
    receipt: "орлого",
    payment: "зарлага",
    transfer: "шилжүүлэг",
  };
  if (filtered.length === 0) return { resultText: "Тохирох баримт олдсонгүй" };
  const header =
    total > filtered.length
      ? `Нийт ${total}-ээс ${offset + 1}–${offset + filtered.length} харуулав${offset + filtered.length < total ? ` (дараагийнх: offset ${offset + filtered.length})` : ""}\n`
      : "";
  return {
    resultText: header + filtered
      .map(
        (doc) =>
          `${doc.date} · ${doc.documentNo} · ${typeLabels[doc.documentType] ?? doc.documentType} · ${doc.description} · ${fmt(Number(doc.amount))} · ${doc.status} · ID ${doc.id.slice(0, 8)}${doc.externalRef ? ` · ref ${doc.externalRef}` : ""}`
      )
      .join("\n"),
  };
}

async function runReverseCash(
  orgId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const documents = await db.query.cashDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(cashDocuments.organizationId, orgId), refCondition({ id: cashDocuments.id, documentNo: cashDocuments.documentNo, externalRef: cashDocuments.externalRef }, input.documentId)),
    columns: { id: true, status: true, description: true, date: true, amount: true, baseAmount: true, documentNo: true, externalRef: true },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 50,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  if (document.status !== "posted")
    throw new Error(`Зөвхөн батлагдсан баримтыг буцаана (төлөв: ${document.status})`);
  assertPostLimit(Number(document.baseAmount ?? document.amount));
  unwrapAction(await reverseCashDocument(document.id));
  return {
    resultText: `Кассын баримт буцаагдлаа (буцаалтын журнал үүссэн): ${document.date} · ${document.description}`,
  };
}

// ── Бараа материал нэмэлт гүйцэтгэгчид ──────────────────────────────────────

async function runListMovements(
  orgId: string,
  input: {
    status?: string;
    movementType?: string;
    from?: string;
    to?: string;
    itemCode?: string;
    warehouseCode?: string;
    limit?: number;
  }
): Promise<AiToolResult> {
  // ENT-045: шүүлт DB дээр — сүүлийн 400 мөрийн цонх биш.
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 200);
  const conditions: SQL[] = [eq(inventoryMovements.organizationId, orgId)];
  if (input.status) conditions.push(eq(inventoryMovements.status, input.status));
  if (input.movementType) conditions.push(eq(inventoryMovements.movementType, input.movementType));
  if (input.from) conditions.push(gte(inventoryMovements.date, input.from));
  if (input.to) conditions.push(lte(inventoryMovements.date, input.to));
  if (input.itemCode?.trim()) {
    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.organizationId, orgId),
        sql`lower(${inventoryItems.code}) = ${input.itemCode.trim().toLowerCase()}`
      ),
      columns: { id: true },
    });
    if (!item) throw new Error(`"${input.itemCode}" кодтой бараа олдсонгүй`);
    conditions.push(eq(inventoryMovements.itemId, item.id));
  }
  if (input.warehouseCode?.trim()) {
    const warehouse = await db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.organizationId, orgId),
        sql`lower(${warehouses.code}) = ${input.warehouseCode.trim().toLowerCase()}`
      ),
      columns: { id: true },
    });
    if (!warehouse) throw new Error(`"${input.warehouseCode}" кодтой агуулах олдсонгүй`);
    conditions.push(
      or(
        eq(inventoryMovements.warehouseId, warehouse.id),
        eq(inventoryMovements.toWarehouseId, warehouse.id)
      )!
    );
  }
  const movements = await db.query.inventoryMovements.findMany({
    where: and(...conditions),
    with: {
      item: { columns: { code: true, name: true } },
      warehouse: { columns: { code: true } },
      toWarehouse: { columns: { code: true } },
    },
    orderBy: [desc(inventoryMovements.date), desc(inventoryMovements.createdAt)],
    limit,
  });
  const typeLabels: Record<string, string> = {
    receipt: "орлого",
    issue: "зарлага",
    transfer: "шилжүүлэг",
    adjustment: "тохируулга",
    return_in: "буцаан авалт",
    return_out: "буцаалт",
  };
  if (movements.length === 0) return { resultText: "Тохирох хөдөлгөөн олдсонгүй" };
  return {
    resultText: movements
      .map(
        (movement) =>
          `${movement.date} · ${movement.documentNo} · ${typeLabels[movement.movementType] ?? movement.movementType} · ${movement.item?.code ?? "(бараагүй)"} × ${Number(movement.quantity)} · ${movement.warehouse?.code ?? "?"}${movement.toWarehouse ? ` → ${movement.toWarehouse.code}` : ""} · ${movement.status} · ID ${movement.id.slice(0, 8)}`
      )
      .join("\n"),
  };
}

async function runConfirmMovement(
  orgId: string,
  input: { movementId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const movements = await db.query.inventoryMovements.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(inventoryMovements.organizationId, orgId), refCondition({ id: inventoryMovements.id, documentNo: inventoryMovements.documentNo }, input.movementId)),
    columns: { id: true, status: true, documentNo: true },
    orderBy: [desc(inventoryMovements.createdAt)],
    limit: 50,
  });
  const movement = resolveByIdPrefix(movements, input.movementId, "хөдөлгөөн");
  if (movement.status !== "draft")
    throw new Error(`Зөвхөн ноорог хөдөлгөөнийг баталгаажуулна (төлөв: ${movement.status})`);
  unwrapAction(await confirmInventoryMovement(movement.id));
  return {
    resultText: `Хөдөлгөөн баталгаажлаа: ${movement.documentNo}. Өртгийн үнэлгээ сар хаахад хийгдэнэ.`,
  };
}

async function runDeleteMovement(
  orgId: string,
  input: { movementId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const movements = await db.query.inventoryMovements.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(inventoryMovements.organizationId, orgId), refCondition({ id: inventoryMovements.id, documentNo: inventoryMovements.documentNo }, input.movementId)),
    columns: { id: true, status: true, documentNo: true },
    orderBy: [desc(inventoryMovements.createdAt)],
    limit: 50,
  });
  const movement = resolveByIdPrefix(movements, input.movementId, "хөдөлгөөн");
  if (movement.status !== "draft") assertPostMode(mode);
  unwrapAction(await deleteInventoryMovement(movement.id));
  // ENT-010: баталгаажсан хөдөлгөөнийг «ноорог» гэж буруу мэдэгддэг байв.
  return {
    resultText: `${movement.status === "draft" ? "Ноорог хөдөлгөөн" : "Баталгаажсан хөдөлгөөн"} устгагдлаа: ${movement.documentNo}`,
  };
}

async function runGetStockBalances(
  orgId: string,
  input: { itemCode?: string; warehouseCode?: string; limit?: number; offset?: number }
): Promise<AiToolResult> {
  const [movements, items, whList] = await Promise.all([
    db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.status, "confirmed")
      ),
    }),
    db.query.inventoryItems.findMany({ where: eq(inventoryItems.organizationId, orgId) }),
    db.query.warehouses.findMany({ where: eq(warehouses.organizationId, orgId) }),
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const whById = new Map(whList.map((wh) => [wh.id, wh]));

  // item|warehouse → үлдэгдэл (transfer нь гарах талдаа хасагдаж, орох
  // талдаа нэмэгдэнэ).
  const balances = new Map<string, number>();
  for (const movement of movements) {
    if (!movement.itemId || !movement.warehouseId) continue;
    const qty = Number(movement.quantity);
    const add = (warehouseId: string, delta: number) => {
      const key = `${movement.itemId}|${warehouseId}`;
      balances.set(key, Math.round(((balances.get(key) ?? 0) + delta) * 10000) / 10000);
    };
    if (movement.movementType === "transfer" && movement.toWarehouseId) {
      add(movement.warehouseId, -qty);
      add(movement.toWarehouseId, qty);
    } else if (["receipt", "return_in"].includes(movement.movementType)) {
      add(movement.warehouseId, qty);
    } else if (["issue", "return_out"].includes(movement.movementType)) {
      add(movement.warehouseId, -qty);
    } else {
      // adjustment — тэмдэгтэйгээ (+ илүүдэл, − дутагдал).
      add(movement.warehouseId, qty);
    }
  }

  const rows = [...balances.entries()]
    .map(([key, qty]) => {
      const [itemId, warehouseId] = key.split("|");
      const item = itemById.get(itemId);
      const wh = whById.get(warehouseId);
      return { item, wh, qty };
    })
    .filter(
      (row) =>
        row.item &&
        row.wh &&
        (!input.itemCode ||
          row.item.code.toLowerCase().includes(input.itemCode.toLowerCase())) &&
        (!input.warehouseCode ||
          row.wh.code.toLowerCase().includes(input.warehouseCode.toLowerCase()))
    )
    .filter((row) => row.qty !== 0)
    .sort((a, b) => a.item!.code.localeCompare(b.item!.code) || a.wh!.code.localeCompare(b.wh!.code));
  if (rows.length === 0) return { resultText: "Үлдэгдэл олдсонгүй" };
  // SIM2-048: чимээгүй тасрахгүй — нийт тоо + хуудаслалт.
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const page = rows.slice(offset, offset + limit);
  const header =
    rows.length > page.length
      ? `Нийт ${rows.length}-ээс ${offset + 1}–${offset + page.length} харуулав${offset + page.length < rows.length ? ` (дараагийнх: offset ${offset + page.length}; эсвэл warehouseCode-оор шүүнэ)` : ""}\n`
      : "";
  return {
    resultText:
      header +
      page.map((row) => `${row.item!.code} (${row.item!.name}) · ${row.wh!.code} · ${row.qty}`).join("\n"),
  };
}

// ── Үндсэн хөрөнгө нэмэлт гүйцэтгэгчид ──────────────────────────────────────

async function runListFixedAssets(
  orgId: string,
  input: { status?: string }
): Promise<AiToolResult> {
  const assets = await db.query.fixedAssets.findMany({
    where: eq(fixedAssets.organizationId, orgId),
    orderBy: [desc(fixedAssets.createdAt)],
    limit: 200,
  });
  const filtered = assets.filter(
    (asset) => !input.status || asset.status === input.status
  );
  if (filtered.length === 0) return { resultText: "Хөрөнгө олдсонгүй" };
  return {
    resultText: filtered
      .map(
        (asset) =>
          `${asset.code} · ${asset.name} · өртөг ${fmt(Number(asset.cost))} · ${asset.usefulLifeMonths} сар · ${asset.status}`
      )
      .join("\n"),
  };
}

async function runFaDepreciation(
  _orgId: string,
  input: { month: string }
): Promise<AiToolResult> {
  const result = unwrapAction(await runDepreciation({ month: input.month }));
  return {
    resultText:
      result.created === 0
        ? `${input.month} сард шинээр бодох элэгдэл алга (бүгд бодогдсон эсвэл идэвхтэй хөрөнгө байхгүй)`
        : `${input.month} сарын элэгдэл: ${result.created} хөрөнгөд НООРОГ бичилт үүслээ — /fa/depreciation дээрээс шалгаж батлана`,
  };
}

async function runPostFaDepreciation(
  orgId: string,
  input: { month: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const entries = await db.query.faDepreciationEntries.findMany({
    where: and(
      eq(faDepreciationEntries.organizationId, orgId),
      eq(faDepreciationEntries.periodMonth, input.month),
      eq(faDepreciationEntries.status, "draft")
    ),
    columns: { id: true, amount: true },
  });
  if (entries.length === 0)
    return { resultText: `${input.month} сард ноорог элэгдлийн бичилт алга` };
  const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  assertPostLimit(total);
  // Вэбийн дэлгэцтэй ИЖИЛ зам: сарын бүх элэгдэл НЭГ журналаар бичигдэнэ
  // (хөрөнгө тус бүрд тусдаа журнал үүсгэхгүй).
  const posted = unwrapAction(await postDepreciationMonth(input.month));
  return {
    resultText: `${input.month} сарын элэгдэл НЭГ журналаар батлагдлаа: ${posted.posted} хөрөнгө, нийт ${fmt(posted.amount)}₮`,
  };
}

// ── Период гүйцэтгэгчид ─────────────────────────────────────────────────────

async function runListPeriods(): Promise<AiToolResult> {
  const periods = await listPeriods();
  if (periods.length === 0) return { resultText: "Тайлант үе бүртгэгдээгүй (бүх сар нээлттэй)" };
  return {
    resultText: periods
      .map(
        (period) =>
          `${period.code} · ${period.status === "closed" ? "ХААЛТТАЙ" : "нээлттэй"} · бичилт ${period.voucherCount} (ноорог ${period.draftVoucherCount})`
      )
      .join("\n"),
  };
}

async function runClosePeriod(
  _orgId: string,
  input: { code: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const result = await closePeriod(input.code);
  if (!result.ok) {
    if (result.code === "has-drafts")
      throw new Error(
        `${input.code} сард ноорог бичилт үлдсэн тул хаагдахгүй — эхлээд ноорогуудыг батлах эсвэл устгана`
      );
    if (result.code === "open-purchase-orders")
      throw new Error(
        `${input.code} сард баталгаажсан хүлээн авалттай НЭЭЛТТЭЙ захиалга (PO) байгаа тул хаагдахгүй — list_purchase_orders openOnly=true-гээр олж, get_purchase_order-оор дутуугаа нөхөөд close_purchase_order-оор хаана`
      );
    if (result.code === "open-pos-shifts")
      throw new Error(
        `${input.code} сард нээлттэй кассын ээлж байгаа тул хаагдахгүй — get_pos_status-оор олж close_pos_shift-ээр хаана`
      );
    if (result.code === "unvalued-movements")
      throw new Error(
        `${input.code} сарын өртгийн тооцоололд ороогүй буюу зогссон (хасах үлдэгдэл, өртөггүй орлого) бараа хөдөлгөөн байгаа тул хаагдахгүй — run_monthly_costing ажиллуулж, блоклогдсон барааг орлого/тооллогоор засаад дахин тооц`
      );
    if (result.code === "previous-open")
      throw new Error(
        `${input.code}-ийн өмнөх тайлант үе нээлттэй тул хаагдахгүй — тайлант үеийг дарааллаар нь (өмнөх сараас эхлэн) хаана`
      );
    throw new Error(`Тайлант үе хаагдсангүй (${result.code})`);
  }
  return { resultText: `${input.code} тайлант үе ХААГДЛАА — цаашид энэ сар руу бичилт хийгдэхгүй` };
}

async function runReopenPeriod(
  _orgId: string,
  input: { code: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const result = await reopenPeriod(input.code);
  if (!result.ok)
    throw new Error(
      result.code === "later-closed"
        ? `${input.code}-ээс хойших тайлант үе хаалттай тул нээгдэхгүй — эхлээд сүүлийн хаалттай үеийг нээнэ`
        : `Тайлант үе нээгдсэнгүй (${result.code})`
    );
  return { resultText: `${input.code} тайлант үе дахин НЭЭГДЛЭЭ` };
}

// ── Цалин гүйцэтгэгчид ──────────────────────────────────────────────────────

async function runCreateEmployee(
  input: Omit<EmployeeInput, "employerSiPercent"> & {
    employerSiPercent?: number;
  }
): Promise<AiToolResult> {
  unwrapAction(
    await upsertEmployee({
      ...input,
      id: undefined,
      employerSiPercent: input.employerSiPercent ?? 12.5,
    })
  );
  return {
    resultText: `Ажилтан бүртгэгдлээ: ${[input.lastName, input.name].filter(Boolean).join(" ")}, үндсэн цалин ${fmt(input.baseSalary)}₮, АО-НДШ ${input.employerSiPercent ?? 12.5}%${input.registerNo ? `, РД ${input.registerNo}` : ""}`,
  };
}

async function runPayrollCalc(input: { period: string }): Promise<AiToolResult> {
  unwrapAction(await calculatePayrollRun(input.period));
  return await runPayrollSummary(input);
}

async function runPayrollSummary(input: {
  period: string;
}): Promise<AiToolResult> {
  const data = await getPayrollRunData(input.period);
  if (data.lines.length === 0)
    return {
      resultText: `${input.period} сард цалингийн бодолт хийгдээгүй байна (идэвхтэй ажилтан: ${data.activeEmployeeCount}). run_payroll-оор бодолт хийнэ.`,
    };
  const totals = data.lines.reduce(
    (sum, line) => ({
      earnings: sum.earnings + line.earnings,
      employeeSi: sum.employeeSi + line.employeeSi,
      employerSi: sum.employerSi + line.employerSi,
      pit: sum.pit + line.pit,
      net: sum.net + line.netSalary,
      advance: sum.advance + line.advanceAmount,
      finalNet: sum.finalNet + line.finalNet,
    }),
    {
      earnings: 0,
      employeeSi: 0,
      employerSi: 0,
      pit: 0,
      net: 0,
      advance: 0,
      finalNet: 0,
    }
  );
  // Урьдчилгаа олгосон сард гарт олгох дүн ХОЁР төлбөр болж хуваагдана —
  // вэбийн дэлгэцтэй ижил задаргааг чатад ч харуулна.
  const hasAdvance = totals.advance > 0;
  const voucherText = data.voucher
    ? `GL журнал: ${data.voucher.status === "draft" ? "ноорог (батлах хүлээгдэж буй)" : data.voucher.status === "posted" ? "батлагдсан" : data.voucher.status}`
    : "GL журнал үүсээгүй (create_payroll_voucher)";
  return {
    resultText: [
      `Цалингийн бодолт ${input.period} — ${data.lines.length} ажилтан:`,
      ...data.lines.map(
        (line) =>
          `  ${line.employeeName}${line.employmentNote ? ` [${line.employmentNote}]` : ""}: олголт ${fmt(line.earnings)}₮, НДШ ${fmt(line.employeeSi)}₮, ХАОАТ ${fmt(line.pit)}₮ → гарт ${fmt(line.netSalary)}₮` +
          (line.advanceAmount > 0
            ? ` (урьдчилгаа ${fmt(line.advanceAmount)}₮ / ${line.advanceHours} цаг + сүүл ${fmt(line.finalNet)}₮)`
            : "")
      ),
      `Нийт: олголт ${fmt(totals.earnings)}₮ · НДШ (ажилтан) ${fmt(totals.employeeSi)}₮ · АО НДШ ${fmt(totals.employerSi)}₮ · ХАОАТ ${fmt(totals.pit)}₮ · гарт олгох ${fmt(totals.net)}₮`,
      ...(hasAdvance
        ? [
            `Олголтын хуваарь: урьдчилгаа ${fmt(totals.advance)}₮ + сүүл цалин ${fmt(totals.finalNet)}₮ = ${fmt(totals.net)}₮`,
          ]
        : []),
      `Тайлан: НДШ дараа сарын 5, ХАОАТ дараа сарын 10 дотор. ${voucherText}`,
    ].join("\n"),
  };
}

async function runCreatePayrollVoucher(input: {
  period: string;
}): Promise<AiToolResult> {
  const result = unwrapAction(await createPayrollVoucher(input.period));
  // ENT-026: журналын ДУГААРЫГ буцаана (post_journal_voucher шууд авна).
  const voucher = await db.query.journalVouchers.findFirst({
    where: eq(journalVouchers.id, result.id),
    columns: { documentNo: true, status: true },
  });
  const ref = voucher?.documentNo ?? result.id.slice(0, 8);
  return {
    resultText: result.dedup
      ? `${input.period} сарын цалингийн журнал аль хэдийн үүссэн байна: ${ref} (${voucher?.status ?? "?"})`
      : `${input.period} сарын цалингийн НООРОГ журнал үүслээ: ${ref} — шалгаад post_journal_voucher {voucherId: "${ref}"}-ээр батална`,
    action: {
      kind: "voucher",
      id: result.id,
      title: `Цалингийн бичилт ${input.period}`,
      status: "draft",
    },
    dedup: result.dedup,
  };
}

// ── Сар хаалтын шалгах хуудас ───────────────────────────────────────────────

async function runMonthEndChecklist(input: {
  period: string;
}): Promise<AiToolResult> {
  const checklist = await getMonthEndChecklist(input.period);
  const statusLabel = (status: string) =>
    status === "done"
      ? "✓ бэлэн"
      : status === "attention"
        ? "⚠ анхаарах"
        : status === "pending"
          ? "○ хийгдээгүй"
          : "— хамааралгүй";
  const { fa, fx, costing, vat, procurement, pos, drafts, opening } = checklist;
  const fxDetail = fx.accounts
    .map(
      (account) =>
        `${account.done ? "✓" : "○"} ${account.name} (${account.currency})`
    )
    .join(", ");
  const draftDetail = [
    ["журнал", drafts.journal],
    ["касс", drafts.cash],
    ["АР/АП", drafts.arap],
    ["бараа", drafts.inventory],
    ["элэгдэл", drafts.faDep],
    ["өртөг", drafts.costEntries],
    ["хүлээн авалт", drafts.goodsReceipts],
  ]
    .filter(([, n]) => Number(n) > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(", ");
  return {
    resultText: [
      `Сар хаалтын шалгах хуудас ${checklist.periodCode} (төлөв: ${checklist.periodStatus === "closed" ? "ХААГДСАН" : "нээлттэй"}):`,
      `1. Элэгдэл: ${statusLabel(fa.status)} — идэвхтэй хөрөнгө ${fa.activeAssets}, батлагдсан ${fa.postedEntries}, ноорог ${fa.draftEntries}`,
      `2. FX тэгшитгэл: ${statusLabel(fx.status)}${fxDetail ? ` — ${fxDetail}` : ""}`,
      `3. Өртөг тооцоо: ${statusLabel(costing.status)} — тооцогдсон ${costing.calculated}, блоклогдсон ${costing.blocked}, ноорог бичилт ${costing.draftEntries}`,
      `4. Цалин: ${statusLabel(checklist.payroll.status)} — идэвхтэй ажилтан ${checklist.payroll.activeEmployees}, бодолтын мөр ${checklist.payroll.lineCount}, GL журнал: ${checklist.payroll.voucherStatus === "none" ? "үүсээгүй" : checklist.payroll.voucherStatus}`,
      `5. НӨАТ: ${statusLabel(vat.status)} — гаралт ${fmt(vat.outputVat)}₮, оролт ${fmt(vat.inputVat)}₮, ${vat.payableVat > 0 ? `төлөх ${fmt(vat.payableVat)}₮ (${vat.deadline} дотор)` : `шилжүүлэх ${fmt(vat.refundableVat)}₮`}, тооцоо: ${vat.settlementStatus === "none" ? "үүсээгүй" : vat.settlementStatus}`,
      `6. Хангамж: ${statusLabel(procurement.status)} — хүлээн авалттай нээлттэй захиалга ${procurement.openOrdersWithReceipts}${procurement.openOrdersWithReceipts > 0 ? " (хаагдтал сар ХААГДАХГҮЙ — close_purchase_order)" : ""}, ноорог хүлээн авалт ${procurement.draftReceipts}, хуваарилагдаагүй зардлын мөр ${procurement.unallocatedCostLines}`,
      `7. POS / бараа: ${statusLabel(pos.status)} — нээлттэй ээлж ${pos.openShifts}${pos.openShifts > 0 ? " (close_pos_shift — хаагдтал сар ХААГДАХГҮЙ)" : ""}, сарын өртгийн тооцоололд ороогүй/зогссон хөдөлгөөн ${pos.unvaluedMovements}${pos.unvaluedMovements > 0 ? " (run_monthly_costing; хасах үлдэгдлийг орлого/тооллогоор засах — засагдтал сар ХААГДАХГҮЙ)" : ""}, хасах үлдэгдэлтэй бараа×агуулах ${pos.negativeStockScopes}, урьдчилсан COGS ${fmt(pos.provisionalCogs)}₮ (сар хаалтад залруулагдана)`,
      `8. Ноорог: ${drafts.total === 0 ? "✓ цэвэр" : `⚠ ${drafts.total} үлдсэн (${draftDetail})`}`,
      ...(opening
        ? [
            `   Нээлтийн зөрүүний данс ${opening.differenceAccount}: ${Math.abs(opening.balance) > 0.005 ? `⚠ ${fmt(opening.balance)}₮ — 0 болтол cut-off сарыг хаахгүй (R6)` : "✓ 0"}`,
          ]
        : []),
      `9. Хаалт: ${checklist.periodStatus === "closed" ? "✓ хаагдсан" : procurement.openOrdersWithReceipts > 0 ? "хүлээн авалттай нээлттэй захиалга хаагдсаны дараа хаана" : pos.openShifts > 0 || pos.unvaluedMovements > 0 ? "POS ээлж хаагдаж, зогссон бараа засагдсаны дараа хаана" : opening && Math.abs(opening.balance) > 0.005 ? "нээлтийн зөрүүг залруулсны дараа хаана (R6)" : drafts.total === 0 ? "хаахад бэлэн (close_period)" : "ноорог цэвэрлэсний дараа хаана"}`,
    ].join("\n"),
  };
}

// ── НӨАТ гүйцэтгэгчид ───────────────────────────────────────────────────────

async function runGetVatReturn(
  orgId: string,
  input: { period: string }
): Promise<AiToolResult> {
  const data = await getVatReturnData(input.period);
  const { summary } = data;
  const settlementText = data.settlement
    ? `\nТооцооны журнал: ${data.settlement.date} · ${
        data.settlement.status === "draft" ? "ноорог" : data.settlement.status
      } (ID: ${data.settlement.id.slice(0, 8)})`
    : "";
  const balanceText =
    summary.payableVat > 0
      ? `ТӨЛӨХ: ${fmt(summary.payableVat)}₮ (${summary.deadline} дотор; хоцорвол 0.1%/хоног алданги)`
      : summary.refundableVat > 0
        ? `Дараа сард шилжүүлэх: ${fmt(summary.refundableVat)}₮`
        : "Төлөх дүн 0";
  // SIM2-027: шилжсэн кредитийг задлан — өмнөх сарын «дараа сард шилжүүлэх»
  // дүнтэй тулгагдана; төлөгдөөгүй гаралтын НӨАТ (нээлт г.м.) тусдаа.
  const { inputOpening, unpaidOutputOpening } = data.carriedBreakdown;
  const carriedText =
    inputOpening > 0 || unpaidOutputOpening > 0
      ? `\n  Өмнөх саруудаас шилжсэн оролтын НӨАТ: ${fmt(inputOpening)}₮` +
        (unpaidOutputOpening > 0
          ? `\n  Төлөгдөөгүй НӨАТ өглөг (үеийн эхэнд): ${fmt(unpaidOutputOpening)}₮\n  Цэвэр шилжсэн кредит (тооцоонд): ${fmt(summary.carriedInVat)}₮`
          : "")
      : "";
  // SIM2-015: тооцоо хийсний дараа батлагдсан баримт — ИЛ анхааруулга.
  const staleText =
    data.settlement && data.settlementDelta.needed
      ? `\n  ⚠ Тооцоо тайлантай зөрүүтэй: бичигдсэн гаралт ${fmt(data.settled.output)}₮ vs тайлан ${fmt(summary.outputVat)}₮ (нэмэлт төлөх ${fmt(data.settlementDelta.payableDelta)}₮) — create_vat_settlement дахин дуудахад нэмэлт тооцоо үүснэ`
      : "";
  return {
    resultText: [
      `НӨАТ тайлан ${summary.periodCode}:`,
      `  Гаралтын НӨАТ (борлуулалт): ${fmt(summary.outputVat)}₮ (${summary.outputLineCount} мөр, данс ${data.settings.outputVatAccountNumber})`,
      `  Оролтын НӨАТ (худалдан авалт): ${fmt(summary.inputVat)}₮ (${summary.inputLineCount} мөр, данс ${data.settings.inputVatAccountNumber})${carriedText}`,
      `  ${balanceText}${settlementText}${staleText}`,
    ].join("\n"),
  };
}

async function runCreateVatSettlement(
  orgId: string,
  input: { period: string; cashAccount?: string }
): Promise<AiToolResult> {
  let cashAccountId: string | undefined;
  if (input.cashAccount?.trim()) {
    const accounts = await db.query.cashAccounts.findMany({
      where: and(
        eq(cashAccounts.organizationId, orgId),
        eq(cashAccounts.isActive, true)
      ),
    });
    cashAccountId = requireSingle(
      nameMatches(accounts, (entry) => entry.name, input.cashAccount),
      (entry) => entry.name,
      "мөнгөн данс",
      input.cashAccount,
      { allNames: accounts.map((entry) => entry.name) }
    ).id;
  }
  const result = unwrapAction(
    await createVatSettlementDraft({
      periodCode: input.period,
      cashAccountId,
    })
  );
  return {
    resultText: result.dedup
      ? `${input.period} сарын НӨАТ тооцоо аль хэдийн үүссэн, тайлантай таарч байна (ID: ${result.id.slice(0, 8)})`
      : result.supplement
        ? `${input.period} сарын НӨАТ НЭМЭЛТ тооцооны НООРОГ үүслээ (өмнөх тооцооноос хойш батлагдсан баримтууд) — GL журналаас шалгаад батална уу`
        : `${input.period} сарын НӨАТ тооцооны НООРОГ журнал үүслээ — GL журналаас шалгаад батална уу`,
    action: {
      kind: "voucher",
      id: result.id,
      title: `НӨАТ тооцоо ${input.period}`,
      status: "draft",
    },
    dedup: result.dedup,
  };
}

// ── Өртөг гүйцэтгэгчид ──────────────────────────────────────────────────────

async function runMonthlyCosting(
  _orgId: string,
  input: { period: string }
): Promise<AiToolResult> {
  const result = await computeMonthlyCosting(input.period);
  if (!result.ok)
    throw new Error(result.message ?? `Өртөг тооцоо амжилтгүй (${result.code})`);
  const blockerText =
    result.blockers.length > 0
      ? `\nБЛОКЛОГДСОН (${result.blockers.length}): ${result.blockers
          .slice(0, 10)
          .map((blocker) => `${blocker.label} — ${blocker.reason}`)
          .join("; ")}`
      : "";
  return {
    resultText: `${input.period} сарын өртөг тооцогдлоо: шинээр үнэлэгдсэн ${result.valued}, өмнө нь үнэлэгдсэн ${result.alreadyValued}${result.trueUps > 0 ? `, дундаж өөрчлөгдсөн тул COGS залруулга (cogs_true_up ноорог) ${result.trueUps} — post_cost_entries-ээр батална` : ""}, тэг дүнтэй ${result.zeroValued}${result.blockedMovements > 0 ? `, блоклогдсон хүрээнд үнэлэгдээгүй ${result.blockedMovements}` : ""}.${blockerText}`,
  };
}

async function runPostCostEntries(
  orgId: string,
  input: { month: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  if (!/^\d{4}-\d{2}$/.test(input.month ?? ""))
    throw new Error("Сар YYYY-MM форматтай байх ёстой");
  const entries = await db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), eq(costEntries.status, "draft")),
    columns: { id: true, date: true, amount: true },
  });
  const monthEntries = entries.filter((entry) => entry.date.startsWith(input.month));
  if (monthEntries.length === 0)
    return { resultText: `${input.month} сард ноорог өртгийн бичилт алга` };
  const total = monthEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  assertPostLimit(total);
  const result = unwrapAction(
    await postCostEntries(monthEntries.map((entry) => entry.id))
  );
  const failures =
    "failures" in result && Array.isArray(result.failures) ? result.failures : [];
  return {
    resultText: `${input.month} сарын өртгийн бичилт: ${monthEntries.length - failures.length} батлагдав, нийт ${fmt(total)}₮${failures.length > 0 ? `; амжилтгүй ${failures.length}` : ""}`,
  };
}

const COST_ENTRY_TYPE_LABELS: Record<string, string> = {
  receipt_capitalize: "орлогын капитализаци",
  issue_cogs: "зарлагын өртөг",
  landed_cost: "орлогдох зардал",
  adjustment_gain: "тохируулга (илүүдэл)",
  adjustment_loss: "тохируулга (дутагдал)",
  nrv_writedown: "NRV бууралт",
  nrv_reversal: "NRV сэргээлт",
  return_in: "буцаан авалт",
  return_out: "буцаалт",
  cogs_true_up: "COGS залруулга",
};

/** Өртгийн бичилтийг ID / ID-угтвараар олно (list_cost_entries-ийн гаралттай нийцүүлэв). */
async function findCostEntry(orgId: string, ref: string) {
  const value = (ref ?? "").trim();
  if (value.length < 6)
    throw new Error("Өртгийн бичилтийн ID-г дор хаяж 6 тэмдэгтээр өгнө (list_cost_entries-ээс)");
  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      sql`${costEntries.id}::text like ${`${value.toLowerCase()}%`}`
    ),
    with: {
      movement: { columns: { documentNo: true } },
      item: { columns: { code: true, name: true } },
    },
    limit: 20,
  });
  return resolveByIdPrefix(entries, value, "өртгийн бичилт");
}

function costEntryLabel(entry: {
  date: string;
  entryType: string;
  amount: string;
  movement?: { documentNo: string | null } | null;
  item?: { code: string | null } | null;
}) {
  const doc = entry.movement?.documentNo ?? entry.item?.code ?? "—";
  const type = COST_ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType;
  return `${entry.date} · ${doc} · ${type} · ${fmt(Number(entry.amount))}₮`;
}

async function runListCostEntries(
  orgId: string,
  input: {
    month?: string;
    from?: string;
    to?: string;
    itemCode?: string;
    status?: string;
    entryType?: string;
    limit?: number;
    offset?: number;
  }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 200);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const conditions: SQL[] = [eq(costEntries.organizationId, orgId)];
  if (input.month?.trim()) {
    if (!/^\d{4}-\d{2}$/.test(input.month.trim()))
      throw new Error("Сар YYYY-MM форматтай байх ёстой");
    conditions.push(sql`${costEntries.date} like ${`${input.month.trim()}%`}`);
  }
  if (input.from) conditions.push(gte(costEntries.date, input.from));
  if (input.to) conditions.push(lte(costEntries.date, input.to));
  if (input.status) conditions.push(eq(costEntries.status, input.status));
  if (input.entryType) conditions.push(eq(costEntries.entryType, input.entryType));
  if (input.itemCode?.trim()) {
    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.organizationId, orgId),
        sql`lower(${inventoryItems.code}) = ${input.itemCode.trim().toLowerCase()}`
      ),
      columns: { id: true },
    });
    if (!item) throw new Error(`"${input.itemCode}" кодтой бараа олдсонгүй`);
    // Бичилт нь хөдөлгөөнөөр (ердийн) эсвэл шууд бараагаар (NRV) холбогдоно.
    const movements = await db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.itemId, item.id)
      ),
      columns: { id: true },
    });
    const movementIds = movements.map((movement) => movement.id);
    conditions.push(
      or(
        eq(costEntries.itemId, item.id),
        movementIds.length > 0 ? inArray(costEntries.movementId, movementIds) : sql`false`
      )!
    );
  }
  const [total, entries] = await Promise.all([
    db.$count(costEntries, and(...conditions)),
    db.query.costEntries.findMany({
      where: and(...conditions),
      with: {
        movement: { columns: { documentNo: true } },
        item: { columns: { code: true, name: true } },
      },
      orderBy: [desc(costEntries.date), desc(costEntries.createdAt), desc(costEntries.id)],
      limit,
      offset,
    }),
  ]);
  if (entries.length === 0) return { resultText: "Тохирох өртгийн бичилт олдсонгүй" };
  // SIM2-048: нийт тоо + offset (өмнө нь эхний хуудас л давтагддаг байв).
  const header =
    total > entries.length
      ? `Нийт ${total}-ээс ${offset + 1}–${offset + entries.length} харуулав${offset + entries.length < total ? ` (дараагийнх: offset ${offset + entries.length})` : ""}\n`
      : "";
  return {
    resultText: header + entries
      .map(
        (entry) =>
          `${costEntryLabel(entry)} · ${Number(entry.quantity)} × ${fmt(Number(entry.unitCost))}₮ · ${entry.status} · ${entry.valuationSource} · ID ${entry.id.slice(0, 8)}`
      )
      .join("\n"),
  };
}

async function runReverseCostEntry(
  orgId: string,
  input: { entryId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const entry = await findCostEntry(orgId, input.entryId);
  if (entry.status !== "posted")
    throw new Error(
      `Зөвхөн батлагдсан бичилтийг буцаана (төлөв: ${entry.status})${entry.status === "draft" ? " — ноорогийг delete_cost_entry-ээр устгана" : ""}`
    );
  assertPostLimit(Math.abs(Number(entry.amount)));
  unwrapAction(await reverseCostEntry(entry.id));
  return {
    resultText: `Өртгийн бичилт БУЦААГДЛАА: ${costEntryLabel(entry)} — GL журнал эсрэг бичилтээр буцаж, бичилт 'reversed' болов. Хөдөлгөөнийг дараагийн run_monthly_costing дахин үнэлнэ.`,
  };
}

async function runDeleteCostEntry(
  orgId: string,
  input: { entryId: string }
): Promise<AiToolResult> {
  const entry = await findCostEntry(orgId, input.entryId);
  if (entry.status !== "draft")
    throw new Error(
      `Зөвхөн ноорог бичилтийг устгана (төлөв: ${entry.status})${entry.status === "posted" ? " — эхлээд reverse_cost_entry" : ""}`
    );
  unwrapAction(await deleteCostEntry(entry.id));
  return {
    resultText: `Ноорог өртгийн бичилт устгагдлаа: ${costEntryLabel(entry)}`,
  };
}

async function runFixCashOpening(
  orgId: string,
  input: { cashAccount: string; counterAccount?: string; date?: string; exchangeRate?: number }
): Promise<AiToolResult> {
  const accounts = await db.query.cashAccounts.findMany({
    where: eq(cashAccounts.organizationId, orgId),
  });
  const account = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "мөнгөн данс",
    input.cashAccount
  );
  let counter: string | undefined;
  if (input.counterAccount) {
    const ctx = await accountContext(orgId);
    counter = resolveAccount(input.counterAccount, ctx).main;
  }
  const result = unwrapAction(
    await createCashOpeningVoucher({
      cashAccountId: account.id,
      counterAccountNumber: counter,
      date: input.date,
      exchangeRate: input.exchangeRate,
    })
  );
  const fcText =
    result.currency === "MNT"
      ? ""
      : ` (${fmt(result.amountFc)} ${result.currency} × ${result.rate})`;
  return {
    resultText: `Нээлтийн ноорог журнал үүслээ: ${account.name}, ${result.date}, ${fmt(result.amount)}₮${fcText}, харьцах данс ${result.counterAccountNumber}. Батлагдмагц тулгалтын зөрүү арилна.`,
    action: {
      kind: "voucher",
      id: result.id,
      title: `Нээлтийн үлдэгдэл — ${account.name}`,
      status: "draft",
    },
  };
}

// ── Тулгалт ─────────────────────────────────────────────────────────────────

/**
 * Журналын мөрүүдээс үндсэн данс бүрийн цэвэр үлдэгдэл (Дт−Кт).
 * "reversed" журнал GL-д тооцогдсон хэвээр (GL тайлантай ижил) — эх бичилт +
 * posted буцаалт нэт 0. Зөвхөн posted тоолбол буцаасан гүйлгээ бүр хий зөрүү
 * үзүүлдэг.
 */
async function glNetByMain(orgId: string, upTo: string): Promise<Map<string, number>> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      inArray(journalVouchers.status, ["posted", "reversed"])
    ),
    with: { lines: { columns: { accountNumber: true, debit: true, credit: true } } },
    columns: { date: true },
  });
  const net = new Map<string, number>();
  for (const voucher of vouchers) {
    if (voucher.date > upTo) continue;
    for (const line of voucher.lines) {
      const main = parseSegParts(line.accountNumber, [3])[3] ?? line.accountNumber;
      net.set(main, (net.get(main) ?? 0) + Number(line.debit) - Number(line.credit));
    }
  }
  return net;
}

async function runSyncStandardAccounts(): Promise<AiToolResult> {
  const result = unwrapAction(await syncStandardAccounts());
  const { orgId } = await getActiveOrg();
  const total = await db.$count(chartOfAccounts, eq(chartOfAccounts.organizationId, orgId));
  return {
    resultText:
      result.added > 0
        ? `Стандарт данс ${result.added} нэмэгдлээ (нийт ${total}). Байгаа данс хөндөгдөөгүй.`
        : `Стандарт данс бүгд бэлэн байна (нийт ${total}) — нэмэх зүйлгүй.`,
  };
}

async function runListSegmentValues(
  orgId: string,
  input: { segment: number; includeDisabled?: boolean }
): Promise<AiToolResult> {
  const segment = Number(input.segment);
  if (!Number.isInteger(segment) || segment < 1 || segment > 10 || segment === 3)
    throw new Error("segment нь 1–10 (3-аас бусад — данс нь list_gl_accounts)");
  const rows = await db.query.segmentValues.findMany({
    where: and(
      eq(segmentValues.organizationId, orgId),
      eq(segmentValues.segmentId, segment),
      ...(input.includeDisabled ? [] : [eq(segmentValues.isEnabled, true)])
    ),
    orderBy: (value, { asc }) => [asc(value.code)],
  });
  if (rows.length === 0)
    return {
      resultText: `S${segment}-д утга алга.${segment === 8 ? " Мөнгөн гүйлгээний ангилал кассын баримт үүсгэхэд автоматаар суурилна; вэбд Тохиргоо → Ерөнхий журнал → Сегментийн утга → S8 → «Стандарт утга татах»." : ""}`,
    };
  return {
    resultText: `S${segment} утгууд (${rows.length}):\n${rows
      .map((row) => `${row.code} · ${row.name}${row.isEnabled ? "" : " (идэвхгүй)"}`)
      .join("\n")}`,
  };
}

async function runReconcileModules(
  orgId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.to ?? ""))
    throw new Error("from/to огноо YYYY-MM-DD форматтай байх ёстой");

  const EPS = 0.01;
  const sections: string[] = [];
  const problems: string[] = [];
  const glNet = await glNetByMain(orgId, input.to);

  // 1. Касс/банк: GL данс vs модулийн үлдэгдэл (нээлт + батлагдсан баримт).
  // Валютын дансны модулийн ₮ үлдэгдэл ТҮҮХЭН ханшаараа хадгалагддаг бол
  // FX тэгшитгэл ЗӨВХӨН GL-д журнал бичдэг — тиймээс хүлээгдэх GL =
  // модуль + батлагдсан (буцаагдаагүй) тэгшитгэлийн Σ дүн
  // (expectedCashGlBalance — яагаад энэ хувилбар болохыг тэнд тайлбарласан).
  // GL-д гараар бичсэн бичилт expected-ээс зөрж ХЭВЭЭР илэрнэ.
  {
    const [accounts, documents, draftDocuments, revaluations] = await Promise.all([
      db.query.cashAccounts.findMany({
        where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
      }),
      db.query.cashDocuments.findMany({
        where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.status, "posted")),
      }),
      db.query.cashDocuments.findMany({
        where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.status, "draft")),
        columns: { fromCashAccountId: true, toCashAccountId: true, date: true },
      }),
      db.query.cashFxRevaluations.findMany({
        where: eq(cashFxRevaluations.organizationId, orgId),
      }),
    ]);
    // ENT-020: валютын дансны нээлт нь ВАЛЮТААР — ₮-өөр нэмэхийн тулд
    // нээлтийн журналын бодит ₮ эсвэл нээлтийн ханш хэрэгтэй (зохиохгүй).
    const openingVoucherRows = await db
      .select({
        voucherId: journalVouchers.id,
        cashAccountId: journalLines.cashAccountId,
        accountNumber: journalLines.accountNumber,
        debit: journalLines.debit,
        credit: journalLines.credit,
        date: journalVouchers.date,
        currency: journalVouchers.currency,
        documentNo: journalVouchers.documentNo,
        externalRef: journalVouchers.externalRef,
        description: journalVouchers.description,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          // Буцаагдсан нээлт (ба түүний ref-гүй буцаалт) нь хамтдаа 0 — зөвхөн
          // идэвхтэй нээлт (аудит M1: «буцаагаад дахин бичнэ» засварын дараа).
          eq(journalVouchers.status, "posted"),
          sql`${journalVouchers.externalRef} like 'cash-opening:%'`
        )
      );
    // SIM2-006: вэбээс засаж батласан нээлтийн журналын мөр кассын тэмдгээ
    // алдсан байж болно — тэр үед externalRef-ийн дансны ID + GL дансаар танина.
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const openingByVoucher = new Map<string, typeof openingVoucherRows>();
    for (const row of openingVoucherRows)
      openingByVoucher.set(row.voucherId, [...(openingByVoucher.get(row.voucherId) ?? []), row]);
    const openingVouchers: { cashAccountId: string; debit: string; credit: string; date: string; currency: string; documentNo: string | null }[] = [];
    for (const rows of openingByVoucher.values()) {
      const tagged = rows.filter((row) => row.cashAccountId);
      if (tagged.length > 0) {
        for (const row of tagged) openingVouchers.push({ ...row, cashAccountId: row.cashAccountId! });
        continue;
      }
      const account = accountById.get(cashOpeningAccountIdOf(rows[0]) ?? "");
      if (!account) continue;
      for (const row of rows)
        if (mainAccountOf(row.accountNumber) === account.glAccountNumber)
          openingVouchers.push({ ...row, cashAccountId: account.id });
    }
    const openingVoucherMnt = new Map<string, number>();
    const accountCurrency = new Map(accounts.map((account) => [account.id, account.currency]));
    for (const row of openingVouchers) {
      if (row.date > input.to) continue;
      // ENT-011-ийн өмнөх журнал: валютын дансны нээлтийг ханшгүй ₮ гэж бичсэн
      // — түүний ₮-ийг үнэн гэж тооцвол тулгалт «OK» мэт худал харагдана.
      const currency = accountCurrency.get(row.cashAccountId) ?? "MNT";
      if (currency !== "MNT" && row.currency === "MNT") {
        problems.push(
          `Касс: ${row.documentNo ?? "нээлтийн журнал"} нь ${currency} дансны нээлтийг ханшгүй ₮-өөр бичсэн — буцаагаад fix_cash_opening_balance {date, exchangeRate}-ээр FC × ханшаар дахин бичнэ`
        );
        continue;
      }
      openingVoucherMnt.set(
        row.cashAccountId,
        (openingVoucherMnt.get(row.cashAccountId) ?? 0) + Number(row.debit) - Number(row.credit)
      );
    }
    const openingMnt = new Map<string, number | null>(
      accounts.map((account) => [
        account.id,
        cashOpeningMnt({
          currency: account.currency,
          openingBalance: Number(account.openingBalance ?? 0),
          openingRate: account.openingRate === null ? null : Number(account.openingRate),
          openingVoucherMnt: openingVoucherMnt.get(account.id) ?? null,
        }),
      ])
    );
    const moduleBalance = new Map<string, number>(
      accounts.map((account) => [account.id, openingMnt.get(account.id) ?? 0])
    );
    // Валютын дүнгээр (FC) — тайлагналд харуулна (нээлт нь валютаар).
    const fcBalance = new Map<string, number>(
      accounts.map((account) => [account.id, Number(account.openingBalance ?? 0)])
    );
    for (const doc of documents) {
      if (doc.date > input.to) continue;
      const amount = Number(doc.baseAmount ?? doc.amount);
      const fcAmount = Number(doc.amount);
      if (doc.toCashAccountId) {
        moduleBalance.set(doc.toCashAccountId, (moduleBalance.get(doc.toCashAccountId) ?? 0) + amount);
        fcBalance.set(doc.toCashAccountId, (fcBalance.get(doc.toCashAccountId) ?? 0) + fcAmount);
      }
      if (doc.fromCashAccountId) {
        moduleBalance.set(doc.fromCashAccountId, (moduleBalance.get(doc.fromCashAccountId) ?? 0) - amount);
        fcBalance.set(doc.fromCashAccountId, (fcBalance.get(doc.fromCashAccountId) ?? 0) - fcAmount);
      }
    }
    const draftCount = new Map<string, number>();
    for (const doc of draftDocuments) {
      if (doc.date > input.to) continue;
      for (const accountId of [doc.fromCashAccountId, doc.toCashAccountId])
        if (accountId) draftCount.set(accountId, (draftCount.get(accountId) ?? 0) + 1);
    }
    // Нээлтийн журналыг «толин» баримтаар ДАХИН тоолсон (SIM2-011-ийн өмнөх
    // өгөгдөл) — нээлт opening_balance-аар аль хэдийн орсон.
    const mirrorVoucherIds = new Set(openingByVoucher.keys());
    const mirrorDocs = documents.filter(
      (doc) => doc.date <= input.to && doc.voucherId && mirrorVoucherIds.has(doc.voucherId)
    );
    const mirrorByAccount = new Map<string, string[]>();
    for (const doc of mirrorDocs)
      for (const accountId of [doc.fromCashAccountId, doc.toCashAccountId])
        if (accountId)
          mirrorByAccount.set(accountId, [...(mirrorByAccount.get(accountId) ?? []), doc.documentNo]);

    type CashRow = {
      account: (typeof accounts)[number];
      subledger: number;
      expected: number | null;
      fxTotal: number;
      fxNote: string;
      fcText: string;
    };
    const rows: CashRow[] = accounts.map((account) => {
      const subledger = moduleBalance.get(account.id) ?? 0;
      const accountRevaluations = revaluations.filter(
        (revaluation) => revaluation.cashAccountId === account.id
      );
      const { expected, fxTotal } = expectedCashGlBalance({
        subledger,
        revaluations: accountRevaluations.map((revaluation) => ({
          adjustmentAmount: Number(revaluation.adjustmentAmount),
          status: revaluation.status,
          valuationDate: revaluation.valuationDate,
        })),
        asOf: input.to,
      });
      // Сүүлийн батлагдсан тэгшитгэл — FC үлдэгдэл, ханшийг үзүүлэхэд.
      const latest = accountRevaluations
        .filter(
          (revaluation) =>
            revaluation.status === "posted" &&
            revaluation.valuationDate <= input.to
        )
        .sort(
          (a, b) =>
            b.valuationDate.localeCompare(a.valuationDate) ||
            b.revision - a.revision
        )[0];
      return {
        account,
        subledger,
        expected: openingMnt.get(account.id) === null ? null : expected,
        fxTotal,
        fxNote:
          Math.abs(fxTotal) > 0.005 && latest
            ? ` + тэгшитгэл ${fmt(fxTotal)} (FC ${fmt(fcBalance.get(account.id) ?? Number(latest.foreignBalance))} × ханш ${Number(latest.closingRate)})`
            : "",
        fcText:
          account.currency === "MNT" ? "" : ` [${fmt(fcBalance.get(account.id) ?? 0)} ${account.currency}]`,
      };
    });
    const lines: string[] = [];
    const describe = (row: CashRow) =>
      `${row.account.name}${row.fcText}: ${fmt(row.subledger)}${row.fxNote}${Math.abs(row.fxTotal) > 0.005 ? ` = ${fmt(row.expected ?? 0)}` : ""}`;
    for (const group of groupCashAccountsByGl(
      rows.map((row) => ({ ...row, glAccountNumber: row.account.glAccountNumber })),
      glNet
    )) {
      const shared = group.accounts.length > 1;
      for (const row of group.accounts.filter((member) => member.expected === null)) {
        lines.push(
          `  ТОДОРХОЙГҮЙ ${row.account.name}${row.fcText}: нээлтийн үлдэгдэл ${fmt(Number(row.account.openingBalance))} ${row.account.currency}-ийн ₮ дүн/ханш алга — ₮-өөр тулгах боломжгүй`
        );
        problems.push(
          `Касс "${row.account.name}": валютын нээлт (${fmt(Number(row.account.openingBalance))} ${row.account.currency}) ханшгүй — fix_cash_opening_balance {date, exchangeRate}-ээр нээлтийн журналыг FC × ханшаар бичнэ (ханш өгөөгүй бол нээлтийн огнооны албан ханш)`
        );
      }
      if (group.diff === null) continue;
      const name = shared
        ? `GL ${group.glAccountNumber} (${group.accounts.length} данс)`
        : group.accounts[0].account.name;
      if (Math.abs(group.diff) > EPS) {
        lines.push(
          shared
            ? `  ЗӨРҮҮ ${name}: Σ модуль ${fmt(group.total ?? 0)} vs GL ${fmt(group.gl)} → зөрүү ${fmt(group.diff)}`
            : `  ЗӨРҮҮ ${group.accounts[0].account.name}${group.accounts[0].fcText}: модуль ${fmt(group.accounts[0].subledger)}${group.accounts[0].fxNote} = ${fmt(group.total ?? 0)} vs GL(${group.glAccountNumber}) ${fmt(group.gl)} → зөрүү ${fmt(group.diff)}`
        );
        const opening = group.accounts.reduce(
          (sum, row) => sum + (openingMnt.get(row.account.id) ?? 0),
          0
        );
        const drafts = group.accounts.reduce(
          (sum, row) => sum + (draftCount.get(row.account.id) ?? 0),
          0
        );
        const mirrors = group.accounts.flatMap((row) => mirrorByAccount.get(row.account.id) ?? []);
        if (mirrors.length > 0)
          problems.push(
            `Касс ${name}: нээлтийн журналыг давхар тоолсон баримт ${mirrors.join(", ")} — delete_cash_document-оор устгана (нээлтийн журнал хөндөгдөхгүй)`
          );
        else if (Math.abs(opening) > 0.005 && Math.abs(group.diff - opening) <= EPS)
          problems.push(
            `Касс ${name}: зөрүү нь НЭЭЛТИЙН үлдэгдэлтэй (${fmt(opening)}₮) тэнцүү — нээлтийн журнал GL-д бичигдээгүй. fix_cash_opening_balance tool-оор ноорог журнал үүсгээд батлана`
          );
        else if (drafts > 0)
          problems.push(
            `Касс ${name}: ${drafts} ноорог кассын баримт батлагдаагүй байна — list_cash_documents status=draft шалгаад батлах/устгах; зөрүү үлдвэл GL-д гараар бичсэн бичилтийг шалгана`
          );
        else
          problems.push(
            `Касс ${name}: GL(${group.glAccountNumber})-д гараар бичсэн журнал байж магадгүй — get_account_ledger-ээр ${input.from} — ${input.to} мужийг мөр мөрөөр тулгана`
          );
      } else
        lines.push(
          shared ? `  OK ${name}: Σ модуль ${fmt(group.total ?? 0)} = GL` : `  OK ${describe(group.accounts[0])}`
        );
      // Нэг GL-ийг хуваалцсан данс бүр — зөвхөн мэдээлэл (тус бүрд GL байхгүй).
      if (shared)
        for (const row of group.accounts.filter((member) => member.expected !== null))
          lines.push(`    · ${describe(row)}`);
    }
    sections.push(`КАСС/БАНК (${input.to}-ний үлдэгдэл):\n${lines.join("\n") || "  данс алга"}`);
  }

  // 1b. ҮХ (SIM2-037): картын өртөг / хуримтлагдсан элэгдэл vs GL данс.
  {
    const [cards, entries] = await Promise.all([
      db.query.fixedAssets.findMany({
        where: eq(fixedAssets.organizationId, orgId),
        columns: {
          id: true,
          code: true,
          status: true,
          acquisitionDate: true,
          disposalDate: true,
          assetAccountNumber: true,
          accumDepAccountNumber: true,
          cost: true,
          openingAccumulatedDepreciation: true,
          sourceVoucherId: true,
        },
      }),
      db.query.faDepreciationEntries.findMany({
        where: eq(faDepreciationEntries.organizationId, orgId),
        columns: { assetId: true, periodMonth: true, amount: true, status: true },
      }),
    ]);
    const sourceIds = cards.map((card) => card.sourceVoucherId).filter((id): id is string => !!id);
    const postedSources = new Set(
      sourceIds.length
        ? (
            await db.query.journalVouchers.findMany({
              where: and(
                eq(journalVouchers.organizationId, orgId),
                inArray(journalVouchers.id, sourceIds),
                inArray(journalVouchers.status, ["posted", "reversed"])
              ),
              columns: { id: true },
            })
          ).map((row) => row.id)
        : []
    );
    const expected = faExpectedGl(
      cards.map((card) => ({
        id: card.id,
        status: card.status,
        acquisitionDate: card.acquisitionDate,
        disposalDate: card.disposalDate,
        assetAccountNumber: card.assetAccountNumber,
        accumDepAccountNumber: card.accumDepAccountNumber,
        cost: Number(card.cost),
        openingAccumulated: Number(card.openingAccumulatedDepreciation ?? 0),
        sourceVoucherPosted: !!card.sourceVoucherId && postedSources.has(card.sourceVoucherId),
      })),
      entries.map((entry) => ({ ...entry, amount: Number(entry.amount) })),
      input.to
    );
    // Картгүй ч GL-д үлдэгдэлтэй ҮХ-ийн өртгийн данс (АП-аар шууд г.м.) ч орно.
    for (const account of FA_COST_ACCOUNTS)
      if (Math.abs(glNet.get(account) ?? 0) > EPS && !expected.has(account)) expected.set(account, 0);
    const lines: string[] = [];
    const costAccounts = new Set(cards.map((card) => card.assetAccountNumber));
    for (const [account, value] of [...expected.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const gl = Math.round((glNet.get(account) ?? 0) * 100) / 100;
      const diff = Math.round((value - gl) * 100) / 100;
      const kind = costAccounts.has(account) || FA_COST_ACCOUNTS.has(account) ? "өртөг" : "хуримт. элэгдэл";
      if (Math.abs(diff) <= EPS) {
        lines.push(`  OK ${account} (${kind}): ${fmt(value)}`);
        continue;
      }
      lines.push(`  ЗӨРҮҮ ${account} (${kind}): бүртгэл ${fmt(value)} vs GL ${fmt(gl)} → зөрүү ${fmt(diff)}`);
      problems.push(
        kind === "өртөг"
          ? diff > 0
            ? `ҮХ ${account}: картын өртөг GL-ээс ${fmt(diff)}₮ илүү — GL журналгүй карт (түр данс 20000099 / өглөгт авсан бол create_fixed_asset capitalizeFrom-оор капиталжуулна, эсвэл Dr ${account} журнал)`
            : `ҮХ ${account}: GL-д картгүй өртөг ${fmt(-diff)}₮ — АП/журналаар орсон хөрөнгийн картыг (ноорог) идэвхжүүлэх эсвэл create_fixed_asset (capitalizeFrom-гүй)`
          : `ҮХ ${account}: хуримтлагдсан элэгдэл бүртгэл ба GL зөрүүтэй — ноорог элэгдлийн журнал (post_fa_depreciation) эсвэл нээлтийн журналыг шалгана`
      );
    }
    if (lines.length > 0) sections.push(`ҮНДСЭН ХӨРӨНГӨ (${input.to}-ний үлдэгдэл):\n${lines.join("\n")}`);
  }

  // 2. АР/АП: хяналтын данс vs нээлттэй баримтын үлдэгдэл.
  {
    const documents = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.organizationId, orgId),
    });
    const open = documents.filter(
      (doc) =>
        ["posted", "partially_paid"].includes(doc.status) && doc.date <= input.to
    );
    // Хяналтын данс бүрийн дэвтрийн (АР — Дт, АП — Кт) үлдэгдэл: кредит
    // нэхэмжлэл / дебит нэхэмжлэх хасах тэмдгээр (ENT-029). Төрлийг эхний
    // баримтаас БИШ дэвтрээс нь — кредит баримт эхэлбэл тэмдэг эргэдэг байв.
    const byControl = new Map<string, { ledger: "ar" | "ap"; sum: number }>();
    for (const doc of open) {
      const main =
        parseSegParts(doc.controlAccountNumber, [3])[3] ?? doc.controlAccountNumber;
      const balance =
        ledgerSign(doc.documentType) *
        (Number(doc.baseTotalAmount) - Number(doc.basePaidAmount));
      const slot = byControl.get(main) ?? { ledger: arapLedger(doc.documentType), sum: 0 };
      slot.sum += balance;
      byControl.set(main, slot);
    }
    const lines: string[] = [];
    for (const [main, slot] of byControl) {
      const gl = glNet.get(main) ?? 0;
      // АР дебет, АП кредит үлдэгдэлтэй — GL-ийн цэвэрийг тохирох тэмдэгтэй нь харна.
      const glSide = slot.ledger === "ar" ? gl : -gl;
      const diff = Math.round((slot.sum - glSide) * 100) / 100;
      if (Math.abs(diff) > EPS) {
        lines.push(
          `  ЗӨРҮҮ ${main}: нээлттэй баримтууд ${fmt(slot.sum)} vs GL ${fmt(glSide)} → зөрүү ${fmt(diff)}`
        );
        // SIM2-038: зөрүү үүсгэж болох ГАР журналууд (GL модулийн дугаартай,
        // нээлтийн бус) — нягтлан аль журналаас гарсныг шууд харна.
        const manual = await db
          .select({
            documentNo: journalVouchers.documentNo,
            date: journalVouchers.date,
            description: journalVouchers.description,
            externalRef: journalVouchers.externalRef,
            debit: journalLines.debit,
            credit: journalLines.credit,
            accountNumber: journalLines.accountNumber,
          })
          .from(journalLines)
          .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
          .where(
            and(
              eq(journalVouchers.organizationId, orgId),
              eq(journalVouchers.status, "posted"),
              sql`${journalVouchers.documentNo} like 'GL-%'`,
              sql`${journalVouchers.date} <= ${input.to}`
            )
          );
        const suspects = manual.filter(
          (row) => mainAccountOf(row.accountNumber) === main && !isGuardExemptRef(row.externalRef)
        );
        const suspectText = suspects.length
          ? ` Гар журнал (${suspects.length}): ${suspects
              .slice(0, 8)
              .map(
                (row) =>
                  `${row.documentNo} ${row.date} ${Number(row.debit) > 0 ? "Дт" : "Кт"} ${fmt(Number(row.debit) || Number(row.credit))} «${(row.description ?? "").slice(0, 40)}»`
              )
              .join("; ")}${suspects.length > 8 ? " …" : ""} — кредит нэхэмжлэл / суутгал / төлбөрөөр дахин хийнэ.`
          : "";
        problems.push(
          `${slot.ledger === "ar" ? "Авлага" : "Өглөг"} ${main}: хяналтын дансанд гараар журнал бичсэн, эсвэл төлөлт нэхэмжлэхтэй холбогдоогүй байж магадгүй — get_trial_balance + list_arap_documents тулгах.${suspectText}`
        );
      } else lines.push(`  OK ${main}: ${fmt(slot.sum)}`);
    }
    sections.push(`АВЛАГА/ӨГЛӨГ:\n${lines.join("\n") || "  нээлттэй баримт алга"}`);
  }

  // 3. Бараа материал: дэд дэвтрийн үнэлгээ vs GL (өртгийн тулгалтын тайлан).
  {
    const recon = await loadInventoryGlReconciliation(orgId, {
      from: input.from,
      to: input.to,
    });
    const lines = recon.rows.map((row) =>
      Math.abs(row.difference) > EPS
        ? `  ЗӨРҮҮ ${row.accountNumber} ${row.accountName}: дэд дэвтэр ${fmt(row.subledgerAmount)}${row.poCloseAmount !== 0 ? ` + PO хаалт ${fmt(row.poCloseAmount)}` : ""}${row.sourceDocAmount !== 0 ? ` + АР/АП баримт ${fmt(row.sourceDocAmount)}` : ""} vs GL ${fmt(row.glAmount)} → ${fmt(row.difference)}${row.unlinkedGlLines > 0 ? ` (гараар бичсэн ${row.unlinkedGlLines} мөр ${fmt(row.unlinkedGlAmount)})` : ""}`
        : `  OK ${row.accountNumber} ${row.accountName}: ${fmt(row.glAmount)}`
    );
    for (const row of recon.rows)
      if (Math.abs(row.difference) > EPS)
        problems.push(
          `Бараа ${row.accountNumber}: өртгийн ноорог бичилт батлагдаагүй (${recon.pendingCount} хүлээгдэж буй, ${fmt(recon.pendingAmount)}₮) эсвэл run_monthly_costing ажиллаагүй — run_monthly_costing → post_cost_entries`
        );
    if (recon.pendingCount > 0)
      lines.push(`  Хүлээгдэж буй ноорог өртгийн бичилт: ${recon.pendingCount} (${fmt(recon.pendingAmount)}₮)`);
    sections.push(`БАРАА МАТЕРИАЛ (${input.from} — ${input.to}):\n${lines.join("\n") || "  тулгах данс алга"}`);
  }

  // 4. Клиринг: бизнес объектоор тулгаж хаагдаагүй үлдэгдлийг үзүүлнэ.
  {
    const clearing = await loadClearingReconciliation(orgId, {
      from: input.from,
      to: input.to,
    });
    const openRows = clearing.rows.filter((row) => Math.abs(row.ending) > EPS);
    const lines = [
      ...openRows
        .slice(0, 15)
        .map(
          (row) =>
            `  ХААГДААГҮЙ ${row.account} · ${row.objectLabel}${row.componentLabel ? ` (${row.componentLabel})` : ""}: ${fmt(row.ending)}`
        ),
      ...(clearing.unknownCount > 0
        ? [
            `  ОБЪЕКТГҮЙ (гар журнал): ${clearing.unknownCount} мөр, нийт ${fmt(clearing.unknownGross)}₮${Math.abs(clearing.unknownAmount) > 0.01 ? ` (цэвэр ${fmt(clearing.unknownAmount)}₮)` : " (хоорондоо тэгширсэн)"}`,
          ]
        : []),
    ];
    if (openRows.length > 0)
      problems.push(
        `Клиринг: ${openRows.length} объект хаагдаагүй — худалдан авалтын өртөг капиталжаагүй (run_monthly_costing → post_cost_entries) эсвэл орлого баталгаажаагүй байж магадгүй`
      );
    if (clearing.unknownCount > 0)
      problems.push(
        "Клирингийн дансанд объектгүй гар журнал бий — эдгээрийг олж буцаах эсвэл зөв дансанд шилжүүлэх"
      );
    sections.push(`КЛИРИНГ (${input.from} — ${input.to}):\n${lines.join("\n") || "  бүгд хаагдсан"}`);
  }

  return {
    resultText: [
      ...sections,
      problems.length === 0
        ? "\n✓ Модуль хоорондын зөрүү илрээгүй."
        : `\nИЛЭРСЭН АСУУДАЛ (${problems.length}):\n${problems.map((problem, index) => `${index + 1}. ${problem}`).join("\n")}`,
    ].join("\n\n"),
  };
}

// ── Анхны нэвтрүүлэлтийн туслах ─────────────────────────────────────────────
// Агуулга docs/deployment/onboarding.md-ээс (product owner баталсан) —
// §2/§3/§4-ийг толгойгоор нь үгчлэн өгнө; төлөв/шат lib/onboarding-оос.

const ONBOARDING_DOC_SECTIONS: Record<
  Exclude<OnboardingSection, "overview" | "status">,
  { number: number; fallback: string }
> = {
  checklist: {
    number: 2,
    fallback:
      "Материалын шалгах жагсаалт: docs/deployment/onboarding.md §2 (server дээр файл олдсонгүй). Заавал: cut-off өдрийн гүйлгээ баланс, дансны жагсаалт, банкны хуулга + үлдэгдэл, татварын байдал, компанийн мэдээлэл. Байвал: АР/АП задаргаа харилцагчаар, барааны үлдэгдэл тоо×өртөг, ҮХ бүртгэл, ажилтан, зээл/урьдчилгаа.",
  },
  rules: {
    number: 3,
    fallback:
      "Зөрүү шийдвэрлэх дүрэм: docs/deployment/onboarding.md §3 (server дээр файл олдсонгүй). R0 TB байхгүй → нээлт хийхгүй; R2/R3/R5 задаргаагүй дүн → хураангуй бүртгэл ([ОНБ-ХУРААНГУЙ], externalRef opening-summary:*); R6 тайлбарлагдахгүй зөрүү → зөрүүний данс руу ноорог журнал (opening-diff:*), хуримтлагдсан ашигт хаахгүй; R7 залруулга шинэ журналаар (opening-adj:*); R8 дэд дэвтэр ба GL давхардуулахгүй; R9 бүх нээлт ноорог, идемпотент.",
  },
  phases: {
    number: 4,
    fallback:
      "Шатууд: 0 судалгаа (gap тайлан, юу ч бичихгүй) → 1 master data → 2 нээлтийн үлдэгдэл (нэг ноорог журнал) → 3 тулгалт (TB мөр мөрөөр, reconcile_modules, зөрүү → R6) → 4 зэрэгцээ сар → 5 хүлээлгэн өгөх (зөрүүний данс 0, cut-off сар хаагдсан).",
  },
};

async function runOnboardingGuide(
  orgId: string,
  input: { section?: string }
): Promise<AiToolResult> {
  const section = (input.section ?? "overview") as OnboardingSection;
  if (!ONBOARDING_SECTIONS.includes(section))
    return {
      resultText: `Ийм хэсэг алга. Боломжит: ${ONBOARDING_SECTIONS.join(", ")}`,
    };

  if (section === "status") {
    const status = await loadOnboardingStatus(orgId);
    return { resultText: formatOnboardingStatus(status) };
  }

  if (section === "overview") {
    const status = await loadOnboardingStatus(orgId);
    return {
      resultText: [
        ONBOARDING_INTRO,
        "",
        "AI-ИЙН АЖИЛЛАХ ХЯЗГААР:",
        ...ONBOARDING_LIMITS.map((limit, index) => `${index + 1}. ${limit}`),
        "",
        formatOnboardingStatus(status),
      ].join("\n"),
    };
  }

  const { number, fallback } = ONBOARDING_DOC_SECTIONS[section];
  const doc = await readOnboardingDoc();
  const text = doc ? extractSection(doc, number) : null;
  return { resultText: text ?? fallback };
}

// ── Ажлын урсгалын заавар ───────────────────────────────────────────────────

const WORKFLOW_GUIDES: Record<string, string> = {
  purchase_inventory: `БАРААТАЙ ХУДАЛДАН АВАЛТ (PO-гүй жижиг, дотоодын) — зөв дараалал:
0. Захиалгатай (импорт, гааль/тээвэртэй, валюттай, олон нэхэмжлэхтэй) худалдан авалт бол ЭНЭ урсгал БИШ — get_workflow_guide purchase_order-ыг унш
1. list_counterparties / list_inventory — нийлүүлэгч, барааны кодоо шалгах (байхгүй бол create_counterparty / create_inventory_item)
2. create_arap_invoice (ap_bill, бараатай мөрөнд itemCode+quantity+warehouseCode) — данс автоматаар клирингт суана
3. post_arap_document — батлахад: GL-д Кт өглөг бичигдэж, бараа ОРЛОГЫН НООРОГ хөдөлгөөн автоматаар үүснэ
4. confirm_inventory_movement — орлого баталгаажиж үлдэгдэлд орно (өртөг нь худалдан авалтын үнээр шууд капиталжина)
5. Төлбөр: pay_arap_document (касс автоматаар холбогдоно)
Сар дуусахад run_monthly_costing клирингээс бараанд капиталжуулна — reconcile_modules-оор шалгана.`,
  purchase_order: `ЗАХИАЛГАТАЙ ХУДАЛДАН АВАЛТ (PO — импорт, нэмэлт зардал, орлогдох өртөг) — зөв дараалал:
① list_counterparties (нийлүүлэгч supplier/both) + list_inventory (бараа, агуулах) — кодуудаа шалгах
② create_purchase_order {supplier, date, currency, lines:[{itemCode, quantity, unitPrice}]} — НООРОГ, GL бичилт ҮГҮЙ (захиалга нь гүйлгээ биш)
③ approve_purchase_order — ноорог → НЭЭЛТТЭЙ (post горим; валюттай бол exchangeRate-ийг хязгаарын шалгалтад өг)
④ create_goods_receipt {purchaseOrderId, date, exchangeRate} — бараа ирэхэд (нэхэмжлэхээс ӨМНӨ ч, ДАРАА ч, хэсэгчилсэн ч болно). Мөр өгөхгүй бол хүлээн аваагүй үлдэгдэл бүхэлдээ
⑤ confirm_goods_receipt — АВТОМАТ капитализаци: тоо × PO нэгж үнэ × ХҮЛЭЭН АВСАН ӨДРИЙН Монголбанкны ханш → Dr барааны нөөц / Cr бараа материалын түр данс. Бараа ЭНЭ ханшаар үнэлэгдэнэ (нэхэмжлэх өөр ханштай байсан ч хөндөгдөхгүй)
⑥ create_ap_invoice_from_po {purchaseOrderId, date, exchangeRate} — НИЙЛҮҮЛЭГЧИЙН нэхэмжлэх (үлдэгдэл автоматаар): Dr өглөгийн түр данс / Cr өглөг. Хөдөлгөөн ҮҮСГЭХГҮЙ (орлого ⑤-аас). Илүү бол [OVER_INVOICED]
⑦ post_arap_document — ноорог үлдсэн бол батлах
⑧ Гааль/тээвэр/брокер (ӨӨР харилцагч): create_arap_invoice {documentType:"ap_bill", counterparty:"Гааль", purchaseOrder:"PO-…", lines:[{amount, costComponentCode:"CUSTOMS"}, {amount, account:"НӨАТ авлагын данс"}]} — бүрэлдэхүүнтэй мөр өглөгийн түр дансанд суун капиталжина, импортын НӨАТ капиталжихгүй (дансыг ИЛ өгнө) → post_arap_document. Нийлүүлэгч ӨӨРӨӨ нэхэмжилсэн тээвэр бол create_ap_invoice_from_po-ийн costLines
⑨ create_cost_allocation {sourceLine (зардлын мөрийн ID — get_purchase_order-оос), allocationBase} — суурийг ХЭРЭГЛЭГЧЭЭС асууна (value/quantity/manual, default БАЙХГҮЙ). Нэг мөрөөс хэсэгчлэн олон удаа хуваарилж болно (Σ ≤ мөрийн ₮ дүн)
⑩ post_cost_entries {month} — landed_cost бичилтүүдийг GL-д (Dr барааны нөөц / Cr бараа материалын түр данс)
⑪ get_landed_cost_summary — бараа бүрийн нэгжид ноогдох өртгийг шалгах; get_purchase_order — хаалтын нөхцөл (Σ хүлээн авсан = захиалсан, Σ нэхэмжилсэн тоо/дүн = захиалга, зардал бүгд хуваарилагдсан)
⑫ close_purchase_order — түр дансдыг тэгшитгэнэ: Dr бараа материалын түр данс / Cr өглөгийн түр данс, ханшийн огнооны зөрүү → ханшийн олз/гарз → хоёр түр данс 0. Их дүнтэй импортыг нягтланч вэб дээрээс хаана
⑬ pay_arap_document — төлбөр (арилжааны банкны ханш; зөрүү нь ханшийн олз/гарз)
⑭ Сар хаалт: тэр сард баталгаажсан хүлээн авалттай НЭЭЛТТЭЙ захиалга байвал close_period ХОРИГЛОГДОНО — эхлээд ⑫-г дуусгана (get_month_end_checklist-ээс харагдана)
Ханш ХЭЗЭЭ Ч зохиогдохгүй: олдохгүй бол алдаа буцна, хэрэглэгчээс ханшийг асууна.`,
  sale: `БОРЛУУЛАЛТ — зөв дараалал:
1. create_arap_invoice (ar_invoice) — орлогын данс мөрөнд (51100000), бараатай бол itemCode+quantity+warehouseCode
2. post_arap_document — GL-д Дт авлага/Кт орлого бичигдэж, бараа ЗАРЛАГЫН НООРОГ үүснэ
3. confirm_inventory_movement — зарлага баталгаажина (тоо хэмжээ хасагдана; ӨРТӨГ нь сар хаахад сарын дундажаар COGS болно)
4. Төлбөр ирэхэд: pay_arap_document (орлогын кассын баримт үүснэ)
5. Сар хаалтад: run_monthly_costing → post_cost_entries — COGS бичигдэнэ
НӨАТ-тай бол: авлага = нийт, орлого = нийт/1.1, НӨАТ өглөг 31410000 = нийт×10/110 гэж мөр хуваана.`,
  pos_sale: `ЖИЖИГЛЭН ХУДАЛДАА (POS — docs/pos) — зөв дараалал:
0. Бараанд борлуулах үнэ (salesPrice), баркод, НӨАТ төрөл байх ёстой — update_inventory_item / create_inventory_items_batch.
   eBarimt асаалттай бол бараа бүрд ТЕГ-ийн ангилалын код (7 орон) ба НӨАТ-гүй/0%-д татварын бүтээгдэхүүний код (3 орон), төлбөрийн хэлбэр бүрд eBarimt код ЗААВАЛ — эдгээргүй бол баримт илгээгдэхгүй (get_ebarimt_status алдааг нэрлэнэ)
1. get_pos_status — нээлттэй ээлж, төлбөрийн хэлбэрийн кодууд (CASH, CARD, CREDIT …), НӨАТ төлөгч эсэх
2. open_pos_shift {cashAccount, warehouseCode, openingFloat} — ээлж байхгүй бол (GL бичилтгүй)
3. create_pos_sale {lines:[{itemCode, quantity}], payments:[{method:"CASH", amount}]} — НЭГ транзакцад: АР нэхэмжлэх posted + кассын баримт (settlement) + confirmed зарлага + урьдчилсан COGS. Хөнгөлөлтийн дүрэм автомат; купон couponCodes-оор; харилцагч өгвөл бүлгийн хөнгөлөлт/зээл. Зөвхөн 'Шууд бичих' горим, ≤10 сая ₮
4. Буцаалт: return_pos_sale {sale, lines?, reason, refundMethod?|storeCredit}
5. Ээлжийн төгсгөлд close_pos_shift {countedCash} — зөрүү кассын илүүдэл/дутагдалд
6. get_pos_sales_report {from, to, groupBy} — борлуулалт, ахиуц (COGS сар хаагдаагүй бол 'урьдчилсан')
Сар хаалт: нээлттэй ээлж (open-pos-shifts) эсвэл сарын өртгийн тооцоололд ороогүй/хасах үлдэгдэлтэй бараа (unvalued-movements) байвал close_period ХОРИГЛОГДОНО — run_monthly_costing нь урьдчилсан COGS-ийг сарын дунджаар залруулна (cogs_true_up ноорог → post_cost_entries).
POS-оос үүссэн АР/касс/хөдөлгөөн/өртгийн бичилтийг тус тусад нь буцаах ХОРИОТОЙ ([POS_SOURCED]) — зөвхөн return_pos_sale.
eBarimt (docs/pos/03): борлуулалт батлагдмагц баримт ТЕГ-д ASYNC илгээгдэнэ (борлуулалт хүлээхгүй) — ДДТД/сугалаа/QR дараа нь баримтад гарна. Байгууллагад зарвал create_pos_sale-д customerTin эсвэл customerRegNo (lookup_tin) өг; иргэнд consumerNo. Буцаалт нь эх ДДТД-г ЦУЦАЛЖ, үлдсэн мөрөөр шинэ баримт илгээнэ. Илгээгдээгүй бол get_ebarimt_status → шалтгааныг зас → resend_ebarimt.`,
  payment: `НЭХЭМЖЛЭХ ТӨЛӨХ/ХААХ:
1. list_arap_documents status=posted (эсвэл partially_paid) — үлдэгдэлтэй баримтаа олох
2. list_cash_accounts — аль данснаас/данс руу
3. pay_arap_document {documentId, cashAccount, date, amount?} — amount өгөхгүй бол үлдэгдлээр бүтэн хаана; АР=орлого, АП=зарлага автоматаар
Кассын баримт нэхэмжлэхтэй холбогдож үлдэгдэл автоматаар хасагдана.`,
  month_end_close: `САР ХААЛТ — ЗААВАЛ энэ дарааллаар (сар: YYYY-MM):
1. list_journal_vouchers status=draft + list_cash_documents status=draft + list_inventory_movements status=draft — ноорогуудыг цэгцлэх (батлах эсвэл устгах; ноорог үлдвэл тайлант үе хаагдахгүй)
2. run_fa_depreciation {month} — элэгдэл бодох → post_fa_depreciation {month}
3. run_monthly_costing {period} — зарлага/тохируулгыг сарын дундажаар үнэлэх; блоклогдсон бараа гарвал шалтгааныг нь шийдэж ДАХИН ажиллуулах
4. post_cost_entries {month} — өртгийн бичилтүүд GL-д
5. reconcile_modules {from: сарын 1, to: сарын сүүлч} — зөрүү 0 болтол засах
6. get_trial_balance — эцсийн шалгалт (ΣДт=ΣКт)
7. close_period {code} — хаах
Хангамж: тухайн сард баталгаажсан хүлээн авалттай НЭЭЛТТЭЙ захиалга (PO) байвал close_period хоригдоно — get_month_end_checklist-ээс шалгаж, get_purchase_order-ийн дутуугаа нөхөөд close_purchase_order-оор хаана.
POS: нээлттэй ээлж (open-pos-shifts), сарын өртгийн тооцоололд ороогүй буюу хасах үлдэгдэлтэй бараа (unvalued-movements) байвал мөн ХОРИГЛОГДОНО — close_pos_shift, орлого/тооллого, run_monthly_costing (урьдчилсан COGS залруулга) → post_cost_entries.
Алхам бүрийн үр дүнг хэрэглэгчид тайлагнаж, дараагийнхыг эхлэхийн өмнө бататгана.`,
  fix_discrepancy: `ЗӨРҮҮ ЗАСАХ — оношилгооны дараалал:
1. reconcile_modules — аль модульд, ямар дансанд, хэдээр зөрж байгааг тогтоох
2. Шалтгаан бүрийн засвар:
   - Касс зөрүү → list_cash_documents status=draft: батлагдаагүй баримт батлах/устгах; GL-д гараар бичсэн кассын бичилт байвал reverse_journal_voucher
   - АР/АП зөрүү → төлөлт нэхэмжлэхгүй бүртгэгдсэн (гар журнал) эсвэл нэхэмжлэх GL-гүй; get_trial_balance + list_arap_documents мөр мөрөөр тулгах
   - Бараа зөрүү → run_monthly_costing ажиллуулаагүй эсвэл post_cost_entries хийгээгүй; блоклогдсон бараа (өртөггүй орлого) байвал эх баримтыг нь засах
   - Клиринг хаагдаагүй → орлого capitalize хийгдээгүй (сар хаалт хүлээж буй бол хэвийн); объектгүй гар журналыг олж буцаах
3. Засвар бүрийн дараа reconcile_modules ДАХИН ажиллуулж 0 болсныг бататгах
Гараар тохируулгын журнал бичихээс ӨМНӨ эх баримтаар нь засахыг үргэлж эрмэлзэнэ.`,
  new_company_setup: `ШИНЭ КОМПАНИЙН ТОХИРГОО — дараалал:
1. sync_standard_accounts — стандарт дансны модыг НЭГ дуудлагаар суулгана (идемпотент); үлдсэн тусгай дансыг create_gl_accounts_batch
2. create_cash_account — касс, банкны данснууд (нээлтийн үлдэгдэлтэй нь)
3. create_counterparty — үндсэн харилцагчид (default данс, нөхцөлтэй нь)
4. create_warehouse + create_inventory_item — агуулах, бараанууд
5. Эхний үлдэгдлүүд: create_journal_voucher-оор нээлтийн баланс (харьцах данс нь эздийн өмч 4XXXXXXX)
6. get_trial_balance — нээлтийн баланс тэнцэж буйг шалгах`,
  fixed_asset_lifecycle: `ҮНДСЭН ХӨРӨНГИЙН МӨЧЛӨГ:
1. Худалдан авалт: create_arap_invoice (ap_bill, хөрөнгийн данс 20000001 мөртэй) → post — ноорог ҮХ карт автоматаар үүснэ; ЭСВЭЛ create_fixed_asset-ээр шууд
   Хуучин системээс шилжүүлсэн хөрөнгө: create_fixed_asset {openingAccumulatedDepreciation, openingAsOf} — нээлтийн журнал (opening-*) карт үүсгэхгүй
2. activate_fixed_asset — картыг бөглөж идэвхжүүлэх (хариуцагч, элэгдэл эхлэх сар заавал)
3. Сар бүр: run_fa_depreciation {month} → post_fa_depreciation {month} (Дт 70000001 / Кт 20000002 — картын хуримтлагдсан элэгдлийн данс); ашиглалтын хугацаа дуусмагц элэгдэл зогсоно
4. Алдаатай бол: reverse_fa_depreciation {month}
5. Данснаас хасах (актлах/борлуулах/хандивлах): dispose_fixed_asset {assetCode, disposalType, date, proceeds, proceedsAccount, gainLossAccount} — нээлтийн + системийн хуримтлагдсан элэгдлийг хамт хааж олз/гарзыг бичнэ (Шууд бичих горим). Тухайн сарын ноорог элэгдлийг эхлээд батална.`,
};

function runWorkflowGuide(input: { workflow: string }): AiToolResult {
  const guide = WORKFLOW_GUIDES[input.workflow];
  if (!guide)
    return {
      resultText: `Ийм урсгал алга. Боломжит: ${Object.keys(WORKFLOW_GUIDES).join(", ")}`,
    };
  return { resultText: guide };
}


// ── Нэмэлт гүйцэтгэгчид: FX тэгшитгэл, ҮХ хасалт, ажилтан, компани, аудит ───

async function runFxRevaluation(
  orgId: string,
  input: {
    valuationDate: string;
    cashAccount?: string;
    rate?: number;
    manualReason?: string;
    gainAccount?: string;
    lossAccount?: string;
    replaceExisting?: boolean;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.valuationDate ?? ""))
    throw new Error("valuationDate огноо YYYY-MM-DD форматтай байна");

  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
  });
  let targets = accounts.filter((account) => account.currency !== "MNT");
  if (input.cashAccount) {
    const found = requireSingle(
      nameMatches(targets, (entry) => entry.name, input.cashAccount),
      (entry) => entry.name,
      "валютын данс",
      input.cashAccount,
      { allNames: targets.map((entry) => entry.name) }
    );
    targets = [found];
  }
  if (targets.length === 0)
    return { resultText: "Валютын идэвхтэй касс/банкны данс алга — тэгшитгэл хэрэггүй" };

  const manualRate = input.rate != null ? Number(input.rate) : undefined;
  if (manualRate != null && targets.length > 1)
    throw new Error("Гар ханш өгөхдөө cashAccount-ыг заавал зааж өгнө (валют бүр өөр ханштай)");

  const ctx = await accountContext(orgId);
  const gainMain = resolveAccount(input.gainAccount?.trim() || "51800001", ctx).main;
  const lossMain = resolveAccount(input.lossAccount?.trim() || "87000003", ctx).main;

  // Монголбанкны албан ханш — гар ханшгүй үед л авна. STORE-FIRST
  // (`getOfficialRateForDate`): хадгалсан түүх → Монголбанк → ШИДНЭ.
  // Тиймээс өмнөх үеийн (эхний үлдэгдлийн) огноонд ч ажиллана.
  const rateByCurrency = new Map<string, { rate: number; date: string; url: string }>();
  if (manualRate == null) {
    const currencies = [...new Set(targets.map((entry) => entry.currency))];
    const rateErrors: string[] = [];
    for (const currency of currencies) {
      try {
        const lookup = await getOfficialRateForDate(currency, input.valuationDate);
        rateByCurrency.set(currency, {
          rate: lookup.rate,
          date: lookup.rateDate,
          url: lookup.sourceUrl,
        });
      } catch (caught) {
        rateErrors.push(`${currency}: ${errorText(caught)}`);
      }
    }
    if (rateByCurrency.size === 0)
      throw new Error(
        `Монголбанкны ханш олдсонгүй (${rateErrors.join("; ")}) — түүхэн ханшийг Мөнгөн хөрөнгө → Ханшийн түүх хэсгээс татна уу (sync_exchange_rates), эсвэл rate параметрээр гар ханш өгнө үү`
      );
  }

  const lines: string[] = [];
  let done = 0;
  for (const account of targets) {
    try {
      const quote = rateByCurrency.get(account.currency);
      if (manualRate == null && !quote)
        throw new Error(
          `${account.currency} ханш ${input.valuationDate}-нд олдсонгүй — түүхэн ханшийг Мөнгөн хөрөнгө → Ханшийн түүх хэсгээс татна уу (sync_exchange_rates), эсвэл rate параметрээр гар ханш өгнө үү`
        );
      await postCashFxRevaluation({
        cashAccountId: account.id,
        valuationDate: input.valuationDate,
        closingRate: manualRate ?? quote!.rate,
        rateSource: manualRate != null ? "manual" : "mongolbank",
        rateBasis: "official",
        sourceDate: manualRate != null ? null : quote!.date,
        sourceUrl: manualRate != null ? null : quote!.url,
        manualOverrideReason:
          manualRate != null
            ? input.manualReason?.trim() || "AI туслахаар өгсөн гар ханш"
            : null,
        gainAccountNumber: gainMain,
        lossAccountNumber: lossMain,
        replaceExisting: input.replaceExisting ?? false,
      });
      done += 1;
      lines.push(
        `  ${account.name} (${account.currency}) @ ${fmt(manualRate ?? quote!.rate)} — тэгшитгэгдэв`
      );
    } catch (caught) {
      lines.push(`  ${account.name}: АЛДАА — ${errorText(caught)}`);
    }
  }
  return {
    resultText: [
      `Ханшийн тэгшитгэл ${input.valuationDate}: ${done}/${targets.length} данс`,
      ...lines,
      "Журналууд шууд бичигдсэн — get_trial_balance-аар 51800001/87000003-ыг шалгаж болно.",
    ].join("\n"),
  };
}

async function runReverseFxRevaluation(
  orgId: string,
  input: { cashAccount: string; valuationDate: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
  });
  const account = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "мөнгөн данс",
    input.cashAccount,
    { allNames: accounts.map((entry) => entry.name) }
  );
  const rows = await db.query.cashFxRevaluations.findMany({
    where: and(
      eq(cashFxRevaluations.organizationId, orgId),
      eq(cashFxRevaluations.cashAccountId, account.id),
      eq(cashFxRevaluations.valuationDate, input.valuationDate),
      eq(cashFxRevaluations.status, "posted")
    ),
  });
  if (rows.length === 0)
    throw new Error(
      `${account.name} дансанд ${input.valuationDate}-ны идэвхтэй тэгшитгэл олдсонгүй`
    );
  const latest = rows.sort((a, b) => b.revision - a.revision)[0];
  await reverseCashFxRevaluation(latest.id);
  return {
    resultText: `Ханшийн тэгшитгэл буцаагдлаа: ${account.name} · ${input.valuationDate} (буцаалтын журнал үүссэн)`,
  };
}

// ── Ханшийн түүх (нийтийн лавлах — GL хөндөхгүй тул горим шалгахгүй) ────────

async function runSyncExchangeRates(input: {
  from: string;
  to: string;
  currencies?: string[];
}): Promise<AiToolResult> {
  const result = unwrapAction(
    await syncMongolbankRates({
      from: input.from,
      to: input.to,
      currencies: Array.isArray(input.currencies) ? input.currencies : undefined,
    })
  );
  return {
    resultText: [
      `Монголбанкны ханшийн түүх татагдлаа: ${result.from} — ${result.to} (${result.days} хоног)`,
      `Хадгалагдсан мөр: ${fmt(result.saved)}`,
      "Энэ нь нийтийн лавлах дата — журнал үүсээгүй. Одооноос get_exchange_rate / run_fx_revaluation нь энэ түүхээс шууд уншина.",
    ].join("\n"),
  };
}

async function runGetExchangeRate(input: {
  currency: string;
  date: string;
}): Promise<AiToolResult> {
  const result = unwrapAction(
    await getStoredRateForDate({ currency: input.currency, date: input.date })
  );
  const code = String(input.currency ?? "").trim().toUpperCase();
  // Хүссэн огноонд ханш нийтлэгдээгүй бол өмнөх ажлын өдрийнх гарна — ИЛ хэлнэ.
  const shifted =
    result.rateDate === String(input.date ?? "").trim()
      ? ""
      : ` (${input.date}-нд ханш нийтлэгдээгүй тул ${result.rateDate}-ны ханш)`;
  return {
    resultText: `${code} албан ханш ${result.rateDate}: ${fmt(result.rate)}₮ · эх сурвалж ${result.source} · ${
      result.stored ? "хадгалсан түүхээс" : "эх сурвалжаас шинээр татав"
    }${shifted}`,
  };
}

const DISPOSAL_TYPE_LABELS: Record<FaDisposalType, string> = {
  scrap: "Акталсан",
  sale: "Борлуулсан",
  donation: "Хандивласан",
};

async function runDisposeFixedAsset(
  orgId: string,
  input: {
    assetCode: string;
    disposalType: FaDisposalType;
    date: string;
    proceeds?: number;
    proceedsAccount?: string;
    gainLossAccount: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const asset = await findAssetByCode(orgId, input.assetCode);
  // Хасалтын журналын нийт дүнгээр (анхны өртөг + олз) бусад шууд батлах
  // замтай ИЖИЛ хязгаар (аудит M: энэ tool хязгааргүй байсан).
  const postedAccum = (
    await db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        eq(faDepreciationEntries.assetId, asset.id),
        eq(faDepreciationEntries.status, "posted")
      ),
      columns: { amount: true },
    })
  ).reduce((sum, entry) => sum + Number(entry.amount), 0);
  const { gainLoss } = computeFaDisposal({
    cost: Number(asset.cost),
    openingAccum: Number(asset.openingAccumulatedDepreciation ?? 0),
    postedAccum,
    proceeds: Number(input.proceeds ?? 0),
  });
  assertPostLimit(faDisposalJournalTotal({ cost: Number(asset.cost), gainLoss }));
  const ctx = await accountContext(orgId);
  unwrapAction(
    await disposeFixedAsset(  asset.id, {
      disposalType: input.disposalType,
      date: input.date,
      proceeds: input.proceeds,
      proceedsAccountNumber: input.proceedsAccount
        ? resolveAccount(input.proceedsAccount, ctx).main
        : undefined,
      gainLossAccountNumber: resolveAccount(input.gainLossAccount, ctx).main,
    }
    )
  );
  return {
    resultText: `Үндсэн хөрөнгө данснаас хасагдлаа: ${asset.code} · ${asset.name} — ${DISPOSAL_TYPE_LABELS[input.disposalType]}, ${input.date}${input.proceeds ? `, үнэ ${fmt(Number(input.proceeds))}₮` : ""} (GL журнал бичигдсэн)`,
  };
}

async function runListEmployees(
  orgId: string,
  input: { includeInactive?: boolean }
): Promise<AiToolResult> {
  const rows = await db.query.employees.findMany({
    where: eq(employees.organizationId, orgId),
  });
  const filtered = input.includeInactive ? rows : rows.filter((row) => row.isActive);
  if (filtered.length === 0) return { resultText: "Ажилтан бүртгэлгүй байна" };
  return {
    resultText: filtered
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (row) =>
          `${row.name}${row.position ? ` · ${row.position}` : ""} · цалин ${fmt(Number(row.baseSalary))}₮ · АО-НДШ ${Number(row.employerSiPercent)}%${row.hireDate ? ` · орсон ${row.hireDate}` : ""}${row.terminationDate ? ` · ГАРСАН ${row.terminationDate}` : ""}${row.isActive ? "" : " · ИДЭВХГҮЙ"}`
      )
      .join("\n"),
  };
}

async function runUpdateEmployee(
  orgId: string,
  input: Partial<Omit<EmployeeInput, "id">> & {
    employee: string;
    newName?: string;
  }
): Promise<AiToolResult> {
  const rows = await db.query.employees.findMany({
    where: eq(employees.organizationId, orgId),
  });
  const employee = requireSingle(
    nameMatches(rows, (entry) => entry.name, input.employee),
    (entry) => entry.name,
    "ажилтан",
    input.employee,
    { allNames: rows.map((entry) => entry.name) }
  );
  unwrapAction(
    await upsertEmployee({
      id: employee.id,
      name: input.newName?.trim() || employee.name,
      lastName: input.lastName ?? employee.lastName,
      registerNo: input.registerNo ?? employee.registerNo ?? undefined,
      birthDate: input.birthDate ?? employee.birthDate ?? undefined,
      phone: input.phone ?? employee.phone ?? undefined,
      email: input.email ?? employee.email ?? undefined,
      homeAddress: input.homeAddress ?? employee.homeAddress ?? undefined,
      bankName: input.bankName ?? employee.bankName ?? undefined,
      bankAccountNo: input.bankAccountNo ?? employee.bankAccountNo ?? undefined,
      iban: input.iban ?? employee.iban ?? undefined,
      hireDate: input.hireDate ?? employee.hireDate ?? undefined,
      terminationDate:
        input.terminationDate ?? employee.terminationDate ?? undefined,
      department: input.department ?? employee.department,
      employmentType:
        input.employmentType ??
        (employee.employmentType as EmploymentType | undefined),
      position: input.position ?? employee.position ?? "",
      baseSalary: input.baseSalary ?? Number(employee.baseSalary),
      employerSiPercent:
        input.employerSiPercent ?? Number(employee.employerSiPercent),
      isActive: input.isActive ?? employee.isActive,
    })
  );
  return {
    resultText: `Ажилтан шинэчлэгдлээ: ${employee.name}${input.newName ? ` → ${input.newName}` : ""}`,
  };
}

async function runGetOrganizationProfile(): Promise<AiToolResult> {
  const settings = await getOrganizationProfile();
  if (!settings?.name)
    return {
      resultText:
        "Компанийн мэдээлэл тохируулаагүй — update_company_settings-ээр нэрээ өгнө үү (нэхэмжлэх илгээхэд заавал)",
    };
  return {
    resultText: [
      `Нэр: ${settings.name}`,
      `Регистр: ${settings.registerNo ?? "—"} · НӨАТ: ${settings.vatPayerNo ?? "—"}`,
      `Хаяг: ${settings.address ?? "—"} · Утас: ${settings.phone ?? "—"} · И-мэйл: ${settings.email ?? "—"}`,
      settings.bankAccounts.length > 0
        ? `Банкны данс:\n${settings.bankAccounts.map((account) => `  ${account.bankName} · ${account.accountNo} · ${account.accountName}`).join("\n")}`
        : "Банкны данс: бүртгэлгүй",
      `Лого: ${settings.logo ? "бий" : "—"} · Тамга: ${settings.stamp ? "бий" : "—"} · Гарын үсэг: ${settings.signatures.length}`,
      `Нэхэмжлэх илгээгч: ${settings.invoiceFromEmail ?? "— (env default)"}${settings.invoiceFromEmail ? (settings.emailDomainVerified ? " · домэйн баталгаажсан" : " · ⚠ домэйн БАТАЛГААЖААГҮЙ") : ""}${settings.invoiceReplyTo ? ` · reply-to: ${settings.invoiceReplyTo}` : ""}`,
      `AI шууд батлах хязгаар: ${fmt(resolveAiPostLimit(settings.aiPostLimitMnt))}₮${settings.aiPostLimitMnt == null ? " (default)" : ""} · Том дүнгийн мэдэгдэл: ${fmt(resolveAiPostLimit(settings.largeAmountAlertMnt))}₮${settings.largeAmountAlertMnt == null ? " (default)" : ""} · Хяналтын дансанд гар журнал: ${settings.controlAccountGuard === "block" ? "хориглоно" : "анхааруулна"}`,
    ].join("\n"),
  };
}

/** Багц, төлбөр — гишүүн бүр уншина (docs/billing §5); засах нь Console-д. */
// ── Мэдлэгийн сан (docs/knowledge/00-proposal.md) ──────────────────────────
// Хандалт = Console-оос асаасан `knowledge` боломж (D2); хэсгээр л уншина (D3);
// өдрийн квот DB-д тоологдоно (D5); уншилт бүр knowledge_reads-д (D6) —
// аудит БИШ (харилцагчийн /settings/audit-ыг бөглөхгүй).

async function assertKnowledgeAccess(orgId: string): Promise<void> {
  await requireFeature(orgId, KNOWLEDGE_FEATURE);
}

async function runListKnowledgeTopics(
  orgId: string,
  args: { category?: unknown }
): Promise<AiToolResult> {
  await assertKnowledgeAccess(orgId);
  const category = isKnowledgeCategory(args?.category) ? args.category : undefined;
  if (args?.category !== undefined && args?.category !== "" && !category)
    throw new Error(
      `[VALIDATION] category танигдсангүй: ${String(args.category)} — ${KNOWLEDGE_CATEGORIES.join(" | ")}`
    );
  const topics = await listKnowledgeTopics(category);
  return { resultText: formatTopicIndex(topics, category) };
}

async function runReadKnowledgeSection(
  orgId: string,
  userId: string,
  args: { topic?: unknown; section?: unknown }
): Promise<AiToolResult> {
  await assertKnowledgeAccess(orgId);
  const slug = normalizeTopicSlug(args?.topic);
  if (!slug) throw new Error("[VALIDATION] topic шаардлагатай — list_knowledge_topics-ийн slug (ж: ifrs/ias-16)");
  const section = normalizeSectionSlug(args?.section);
  if (args?.section && !section)
    throw new Error("[VALIDATION] section нь хэсгийн нэр байна (ж: overview, элэгдэл-depreciation)");

  const used = await countKnowledgeReadsToday(orgId);
  if (used >= KNOWLEDGE_DAILY_READ_LIMIT)
    throw new Error(
      `[KNOWLEDGE_LIMIT] Энэ байгууллага сүүлийн 24 цагт ${KNOWLEDGE_DAILY_READ_LIMIT} хэсэг уншсан — өдрийн квот дууслаа, маргааш үргэлжилнэ`
    );

  const view = await readKnowledgeSection(slug, section);
  if (!view)
    throw new Error(
      `[KNOWLEDGE_NOT_FOUND] «${slug}${section ? `#${section}` : ""}» олдсонгүй — list_knowledge_topics-оор зөв slug/хэсгээ шалга`
    );
  await recordKnowledgeRead({ organizationId: orgId, userId, slug: view.slug, section: view.section });
  return { resultText: formatSection(view) };
}

async function runGetBillingOverview(): Promise<AiToolResult> {
  const overview = await getBillingOverview();
  const ent = overview.entitlements;
  const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
  const limit = (value: number | null) => (value === null ? "хязгааргүй" : String(value));
  const lines: string[] = [];
  lines.push(`Байгууллага: ${overview.orgName || "—"} · Горим: ${DEPLOYMENT_MODE_LABELS[ent.mode]}`);
  if (ent.mode === "dedicated") {
    lines.push("Тусдаа сервис — багцын хязгаар хамаарахгүй, бүх боломж нээлттэй (лицензээр удирдагдана).");
    lines.push(`Гишүүд: ${overview.membersCount} · суудал ашигласан: ${overview.seatsUsed}`);
    return { resultText: lines.join("\n") };
  }
  lines.push(
    `Багц: ${BILLING_PLAN_LABELS[ent.planId]} · Статус: ${SUBSCRIPTION_STATUS_LABELS[ent.status]}` +
      (overview.pricePerSeatMnt !== null && overview.pricePerSeatMnt > 0
        ? ` · ${fmt(overview.pricePerSeatMnt)}₮ / суудал / сар`
        : "")
  );
  lines.push(
    ent.writable
      ? "Бичих эрх: НЭЭЛТТЭЙ"
      : `Бичих эрх: ЗӨВХӨН УНШИХ — ${ent.readOnlyReason ? READ_ONLY_MESSAGES[ent.readOnlyReason] : "шалтгаан тодорхойгүй"}`
  );
  if (ent.status === "trialing" && ent.trialEndsAt)
    lines.push(
      `Trial дуусах: ${day(ent.trialEndsAt)}` +
        (ent.daysLeft !== null ? ` (${ent.daysLeft <= 0 ? "өнөөдөр" : `${ent.daysLeft} хоног үлдсэн`})` : "")
    );
  if (ent.status === "past_due" && ent.graceEndsAt)
    lines.push(
      `Төлбөр хоцорсон — grace дуусах: ${day(ent.graceEndsAt)}` +
        (ent.daysLeft !== null ? ` (${ent.daysLeft <= 0 ? "өнөөдөр" : `${ent.daysLeft} хоног үлдсэн`})` : "")
    );
  lines.push(
    `Суудал: ${overview.seatsUsed} / ${limit(ent.limits.seats)} (гишүүд ${overview.membersCount}) · Компани: ${limit(ent.limits.companies)}`
  );
  lines.push(
    "Боломжууд: " +
      FEATURE_KEYS.map((key) => `${ent.features[key] ? "✓" : "✗"} ${FEATURE_LABELS[key]}`).join(" · ")
  );
  if (overview.note) lines.push(`Тэмдэглэл: ${overview.note}`);
  lines.push("Багц солих, суудал нэмэх, төлбөр — Entry-ийн платформын админтай холбогдоно (апп дотор засагдахгүй). Вэб: Тохиргоо → Багц, төлбөр (/settings/billing).");
  return { resultText: lines.join("\n") };
}

async function runUpdateOrganizationProfile(input: {
  name?: string;
  registerNo?: string;
  vatPayerNo?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankAccounts?: { bankName: string; accountNo: string; accountName: string; bankCode?: string; iban?: string; isDefault?: boolean }[];
  invoiceFromEmail?: string;
  invoiceReplyTo?: string;
  emailDomainVerified?: boolean;
  largeAmountAlertMnt?: number;
  aiPostLimitMnt?: number;
  controlAccountGuard?: "warn" | "block";
}): Promise<AiToolResult> {
  const current = await getOrganizationProfile();
  // SIM2-038: хамгаалалтыг AI сулруулахгүй (post limit-тэй ижил зарчим).
  if (
    input.controlAccountGuard === "warn" &&
    current?.controlAccountGuard === "block"
  )
    throw codedError(
      "HUMAN_REQUIRED",
      "Хяналтын дансны хоригийг зөвхөн вэбийн Тохиргоо → Компанийн мэдээлэл хуудсаас админ хүн сулруулна"
    );
  const name = input.name?.trim() || current?.name || "";
  if (!name) throw new Error("Компанийн нэр заавал (одоо тохируулаагүй байна)");

  // AI өөрийн таазыг ХЯЗГААРГҮЙ өргөхийг хориглоно — баримтанд суулгасан
  // зааварчилгаа (prompt injection) агентаар лимитээ өсгүүлэх замыг хаана.
  // Бууруулах нь чөлөөтэй; өсгөх нь AI_POST_LIMIT_TOOL_MAX_MNT (1 тэрбум ₮)
  // хүртэл таазтай, дээш нь [HUMAN_REQUIRED] (lib/ai/post-limit.ts).
  let aiPostLimitMnt: number | null | undefined;
  let limitNote = "";
  if (input.aiPostLimitMnt !== undefined) {
    const requested = Number(input.aiPostLimitMnt) > 0 ? Number(input.aiPostLimitMnt) : null;
    const plan = planAiPostLimitChange({
      currentMnt: resolveAiPostLimit(current?.aiPostLimitMnt),
      requestedMnt: requested,
      viaTool: true,
    });
    if (!plan.ok) throw codedError(plan.code, plan.message);
    aiPostLimitMnt = plan.valueMnt;
    if (plan.direction !== "same")
      limitNote = ` · AI шууд батлах хязгаар: ${fmt(plan.effectiveMnt)}₮${plan.valueMnt === null ? " (default)" : ""}`;
  }

  unwrapAction(await updateOrganizationProfile({
    name,
    registerNo: input.registerNo ?? current?.registerNo ?? null,
    vatPayerNo: input.vatPayerNo ?? current?.vatPayerNo ?? null,
    address: input.address ?? current?.address ?? null,
    phone: input.phone ?? current?.phone ?? null,
    email: input.email ?? current?.email ?? null,
    bankAccounts: input.bankAccounts ?? current?.bankAccounts ?? [],
    // Лого/тамга/гарын үсэг — undefined = хөндөхгүй (вэбээс удирдана).
    signatures: current?.signatures ?? [],
    autoStamp: current?.autoStamp ?? true,
    // undefined = хөндөхгүй; хоосон string = цэвэрлэх (action null болгоно).
    invoiceFromEmail: input.invoiceFromEmail,
    invoiceReplyTo: input.invoiceReplyTo,
    emailDomainVerified: input.emailDomainVerified,
    largeAmountAlertMnt:
      input.largeAmountAlertMnt === undefined
        ? undefined
        : Number(input.largeAmountAlertMnt) > 0
          ? Number(input.largeAmountAlertMnt)
          : null,
    aiPostLimitMnt,
    controlAccountGuard: input.controlAccountGuard,
  }));
  return {
    resultText: `Компанийн мэдээлэл шинэчлэгдлээ: ${name}${limitNote}${input.controlAccountGuard ? ` · хяналтын данс: ${input.controlAccountGuard === "block" ? "хориг" : "анхааруулга"}` : ""}`,
  };
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Эзэн",
  admin: "Админ",
  accountant: "Нягтлан",
  viewer: "Үзэгч",
};

async function runListCompanies(): Promise<AiToolResult> {
  const { orgId, userId } = await getActiveOrg();
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      registryNo: organizations.registryNo,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(organizations.name));
  if (rows.length === 0)
    return { resultText: "Хандах эрхтэй компани алга." };
  return {
    resultText: rows
      .map((row) => {
        const active = row.id === orgId ? " ← идэвхтэй" : "";
        return `${row.name} · ${ROLE_LABELS[row.role] ?? row.role} · рег: ${row.registryNo ?? "—"} · id: ${row.id}${active}`;
      })
      .join("\n"),
  };
}

async function runGetActiveCompany(): Promise<AiToolResult> {
  const { orgId, role } = await getActiveOrg();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { id: true, name: true, registryNo: true },
  });
  if (!org) return { resultText: "Идэвхтэй компани олдсонгүй." };
  return {
    resultText: [
      `Нэр: ${org.name}`,
      `Регистр: ${org.registryNo ?? "—"}`,
      `Таны эрх: ${ROLE_LABELS[role] ?? role}`,
      `id: ${org.id}`,
    ].join("\n"),
  };
}

async function runCreateCompany(input: {
  name?: string;
  registerNo?: string;
  vatPayerNo?: string;
  address?: string;
  phone?: string;
  email?: string;
}): Promise<AiToolResult> {
  const { userId } = await getActiveOrg();
  const name = input.name?.trim();
  if (!name) throw new Error("Компанийн нэр оруулна уу");
  const { orgId } = await createOrganizationForUser({
    userId,
    name,
    registryNo: input.registerNo ?? null,
    vatPayerNo: input.vatPayerNo ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    seedAccounts: true,
  });
  return {
    resultText: [
      `Шинэ компани үүслээ: ${name}`,
      `id: ${orgId}`,
      "Та owner болсон · стандарт дансны мод суулгагдсан.",
      "Идэвхтэй компани СОЛИГДООГҮЙ — энэ түлхүүр өмнөх компанидаа хэвээр ажиллана.",
    ].join("\n"),
  };
}

async function runDeleteCompany(
  input: { companyId?: string; confirmName?: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const { orgId, userId } = await getActiveOrg();
  const companyId = input.companyId?.trim();
  if (!companyId) throw new Error("companyId шаардлагатай (list_companies-ээс аваарай)");
  if (!input.confirmName?.trim())
    throw new Error("Баталгаажуулахын тулд компанийн нэрийг бичнэ үү");
  const { deletedName } = await deleteOrganizationForUser({
    userId,
    orgId: companyId,
    confirmName: input.confirmName,
  });
  const activeNote =
    companyId === orgId
      ? "⚠ Энэ нь энэ түлхүүрийн ИДЭВХТЭЙ компани байсан — түлхүүр одоо хүчингүй, вэбээс өөр компани сонгоно уу."
      : "Идэвхтэй компани хэвээр — энэ түлхүүр өмнөх компанидаа ажиллана.";
  return {
    resultText: [`Компани устгагдлаа: ${deletedName} (id: ${companyId})`, activeNote].join(
      "\n"
    ),
  };
}

async function runListAuditEvents(
  orgId: string,
  input: { entityType?: string; action?: string; from?: string; to?: string; limit?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const rows = await db.query.auditEvents.findMany({
    where: eq(auditEvents.organizationId, orgId),
    orderBy: [desc(auditEvents.createdAt)],
    limit: 400,
  });
  const filtered = rows
    .filter((row) => {
      const date = row.createdAt.toISOString().slice(0, 10);
      if (input.entityType && row.entityType !== input.entityType) return false;
      if (input.action && row.action !== input.action) return false;
      if (input.from && date < input.from) return false;
      if (input.to && date > input.to) return false;
      return true;
    })
    .slice(0, limit);
  if (filtered.length === 0) return { resultText: "Тохирох аудитын бичлэг олдсонгүй" };
  return {
    resultText: filtered
      .map(
        (row) =>
          `${fmtDateTimeUb(row.createdAt)} · ${row.entityType}/${row.action} · ${row.summary || row.entityId.slice(0, 8)}`
      )
      .join("\n"),
  };
}

async function runInventoryValuation(
  orgId: string,
  input: { itemCode?: string; limit?: number; offset?: number } = {}
): Promise<AiToolResult> {
  const [byItem, items] = await Promise.all([
    latestClosingByItem(orgId),
    db.query.inventoryItems.findMany({
      where: eq(inventoryItems.organizationId, orgId),
    }),
  ]);
  if (byItem.size === 0)
    return {
      resultText:
        "Тооцоологдсон өртгийн үнэлгээ алга — эхлээд run_monthly_costing ажиллуулна уу",
    };
  const nameOf = new Map(items.map((item) => [item.id, `${item.code} ${item.name}`]));
  // SIM2-050: itemCode шүүлт (өмнө нь үл тоомсорлодог байв) — яг таарсан
  // код түрүүлж, үгүй бол угтвар.
  const wanted = input.itemCode?.trim().toLowerCase();
  const exact = wanted ? items.filter((item) => item.code.toLowerCase() === wanted) : [];
  const allowed = wanted
    ? new Set(
        (exact.length ? exact : items.filter((item) => item.code.toLowerCase().startsWith(wanted))).map(
          (item) => item.id
        )
      )
    : null;
  if (allowed && allowed.size === 0)
    throw codedError("ITEM_NOT_FOUND", `"${input.itemCode}" кодтой бараа олдсонгүй — list_inventory-оор шалгана`);
  let total = 0;
  const lines: string[] = [];
  for (const [itemId, closing] of byItem) {
    if (allowed && !allowed.has(itemId)) continue;
    if (Math.abs(closing.qty) < 0.0001 && Math.abs(closing.amount) < 0.01) continue;
    total += closing.amount;
    const unit = closing.qty > 0 ? closing.amount / closing.qty : 0;
    lines.push(
      `${nameOf.get(itemId) ?? itemId.slice(0, 8)} — ${fmt(closing.qty)} ш × ${fmt(unit)}₮ = ${fmt(closing.amount)}₮ (${closing.periodCode} хаалтаар)`
    );
  }
  lines.sort();
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const page = lines.slice(offset, offset + limit);
  return {
    resultText: [
      "БАРАА МАТЕРИАЛЫН ҮНЭЛГЭЭ (сүүлийн тооцоологдсон сарын хаалтаар):",
      ...(lines.length > page.length
        ? [`Нийт ${lines.length}-ээс ${offset + 1}–${offset + page.length} харуулав${offset + page.length < lines.length ? ` (дараагийнх: offset ${offset + page.length})` : ""}`]
        : []),
      ...page,
      lines.length === 0 && allowed ? "Энэ барааны тооцоологдсон үнэлгээ алга" : "",
      `НИЙТ${allowed ? " (шүүсэн)" : ""}: ${fmt(total)}₮`,
      "GL 14-бүлэгтэй тулгахад reconcile_modules ашиглана.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function runUpdateArapDocument(
  orgId: string,
  input: {
    documentId: string;
    date?: string;
    dueDate?: string;
    description?: string;
    controlAccount?: string;
    lines?: {
      account?: string;
      description?: string;
      amount: number;
      itemCode?: string;
      quantity?: number;
      warehouseCode?: string;
    }[];
  }
): Promise<AiToolResult> {
  const document = await findArapDocument(orgId, input.documentId);
  const ctx = await accountContext(orgId);

  let lines:
    | {
        account: string;
        description: string;
        amount: number;
        itemId?: string;
        quantity?: number;
        warehouseId?: string;
      }[]
    | undefined;
  if (input.lines) {
    const [items, whList, costingAccounts] = await Promise.all([
      db.query.inventoryItems.findMany({
        where: and(
          eq(inventoryItems.organizationId, orgId),
          eq(inventoryItems.isActive, true)
        ),
      }),
      db.query.warehouses.findMany({
        where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
      }),
      loadCostingAccountSettings(orgId),
    ]);
    const itemsByCode = new Map(items.map((item) => [item.code.toLowerCase(), item]));
    const whByCode = new Map(whList.map((wh) => [wh.code.toLowerCase(), wh]));
    const isAp = arapLedger(document.documentType) === "ap";
    lines = input.lines.map((line) => {
      let itemId: string | undefined;
      let warehouseId: string | undefined;
      if (line.itemCode) {
        const item = itemsByCode.get(line.itemCode.trim().toLowerCase());
        if (!item)
          throw new Error(`"${line.itemCode}" кодтой бараа олдсонгүй (list_inventory-оор шалгана уу)`);
        itemId = item.id;
        if (!(Number(line.quantity) > 0))
          throw new Error(`"${item.name}" мөрөнд тоо хэмжээ 0-ээс их байх ёстой`);
        const wh = line.warehouseCode
          ? whByCode.get(line.warehouseCode.trim().toLowerCase())
          : undefined;
        if (!wh)
          throw new Error("Бараатай мөрөнд агуулахын код заавал (list_inventory-оор шалгана уу)");
        warehouseId = wh.id;
      }
      const accountRaw =
        itemId && isAp ? costingAccounts.clearingAccountNumber : line.account?.trim();
      if (!accountRaw)
        throw new Error("Мөр бүрд данс хэрэгтэй (АП-ийн бараатай мөрөөс бусад)");
      return {
        account: resolveAccount(accountRaw, ctx).code,
        description: line.description ?? "",
        amount: Number(line.amount),
        itemId,
        quantity: itemId ? Number(line.quantity) : undefined,
        warehouseId,
      };
    });
  }

  const { documentNo } = await updateArApDocument(document.id, {
    date: input.date,
    dueDate: input.dueDate,
    description: input.description,
    controlAccountNumber: input.controlAccount
      ? resolveAccount(input.controlAccount, ctx).code
      : undefined,
    lines,
  });
  const changed = [
    input.date && "огноо",
    input.dueDate && "төлөх огноо",
    input.description && "утга",
    input.controlAccount && "хяналтын данс",
    input.lines && `мөрүүд (${input.lines.length})`,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    resultText: `Ноорог нэхэмжлэх шинэчлэгдлээ: ${documentNo}${changed ? ` — ${changed}` : ""}`,
    action: { kind: "arap", id: document.id, title: documentNo, status: "draft" },
  };
}

async function runUpdateCashDocument(
  orgId: string,
  input: {
    documentId: string;
    date?: string;
    amount?: number;
    description?: string;
    counterAccount?: string;
    counterparty?: string;
    exchangeRate?: number;
  }
): Promise<AiToolResult> {
  const documents = await db.query.cashDocuments.findMany({
    // Цонхгүй — лавлагаагаар шууд (ENT-033: хуучин баримт олдохгүй байв).
    where: and(eq(cashDocuments.organizationId, orgId), refCondition({ id: cashDocuments.id, documentNo: cashDocuments.documentNo, externalRef: cashDocuments.externalRef }, input.documentId)),
    columns: {
      id: true,
      documentNo: true,
      status: true,
      description: true,
      date: true,
      externalRef: true,
    },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 50,
  });
  const found = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  let counterMain: string | undefined;
  if (input.counterAccount != null) {
    const ctx = await accountContext(orgId);
    counterMain = resolveAccount(input.counterAccount, ctx).main;
  }
  const { documentNo } = await updateCashDocument(found.id, {
    date: input.date,
    amount: input.amount,
    description: input.description,
    counterAccountNumber: counterMain,
    counterparty: input.counterparty,
    exchangeRate: input.exchangeRate,
  });
  return {
    resultText: `Ноорог кассын баримт шинэчлэгдлээ: ${documentNo}`,
    action: { kind: "cash", id: found.id, title: input.description ?? found.description, status: "draft" },
  };
}

// ── Өртгийн мастер датаны гүйцэтгэгчид ──────────────────────────────────────

/** MasterDataResult-ийн алдааг тексттэй нь шиднэ. */
function assertMasterDataOk(result: { ok: boolean; message?: string; code?: string }) {
  if (!result.ok)
    throw new Error(result.message || `Хадгалж чадсангүй (${result.code ?? "алдаа"})`);
}

async function runGetCostingSettings(orgId: string): Promise<AiToolResult> {
  const [accounts, issueTypes, components] = await Promise.all([
    loadCostingAccountSettings(orgId),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.organizationId, orgId),
    }),
    db.query.costComponents.findMany({
      where: eq(costComponents.organizationId, orgId),
    }),
  ]);
  return {
    resultText: [
      "ДАНСНЫ РОЛЬУУД:",
      `  Бараа материалын түр (клиринг) данс: ${accounts.clearingAccountNumber} · Өглөгийн түр данс (PO-той нэхэмжлэх/PO хаалт): ${accounts.apClearingAccountNumber}`,
      `  Тооллогын илүүдэл: ${accounts.adjustmentGainAccountNumber} · дутагдал: ${accounts.adjustmentLossAccountNumber}`,
      `  NRV зардал: ${accounts.nrvExpenseAccountNumber} · NRV нөөц: ${accounts.nrvReserveAccountNumber}`,
      `  Ханшийн олз: ${accounts.fxGainAccountNumber} · гарз: ${accounts.fxLossAccountNumber} (PO хаалтын зөрүү)`,
      `ЗАРЛАГЫН ТӨРӨЛ (${issueTypes.length}):`,
      ...issueTypes.map(
        (entry) =>
          `  ${entry.code} · ${entry.name} · ${entry.debitAccountSource === "fixed" ? `тогтмол ${entry.debitAccountNumber}` : "барааны COGS данс"}${entry.isActive ? "" : " · ИДЭВХГҮЙ"}`
      ),
      `ӨРТГИЙН БҮРЭЛДЭХҮҮН (${components.length}):`,
      ...components.map(
        (entry) =>
          `  ${entry.code} · ${entry.name}${entry.accountNumber ? ` · ${entry.accountNumber}` : ""}${entry.isActive ? "" : " · ИДЭВХГҮЙ"}`
      ),
    ].join("\n"),
  };
}

async function runSaveIssueType(
  orgId: string,
  input: {
    code: string;
    name: string;
    destinationClass?: string;
    debitAccountSource: "fixed" | "item_cogs";
    debitAccount?: string;
  }
): Promise<AiToolResult> {
  const existing = await db.query.inventoryIssueTypes.findFirst({
    where: and(
      eq(inventoryIssueTypes.organizationId, orgId),
      eq(inventoryIssueTypes.code, String(input.code ?? "").trim().toUpperCase())
    ),
    columns: { id: true },
  });
  const result = await saveIssueType({
    id: existing?.id,
    code: input.code,
    name: input.name,
    destinationClass: input.destinationClass?.trim() || "Борлуулалтын өртөг (COGS)",
    debitAccountSource: input.debitAccountSource,
    debitAccountNumber: input.debitAccount ?? "",
  });
  assertMasterDataOk(result);
  return {
    resultText: `Зарлагын төрөл ${existing ? "шинэчлэгдлээ" : "үүслээ"}: ${input.code.toUpperCase()} · ${input.name}`,
  };
}

async function runSaveCostComponent(
  orgId: string,
  input: { code: string; name: string; classification?: string; account?: string }
): Promise<AiToolResult> {
  const existing = await db.query.costComponents.findFirst({
    where: and(
      eq(costComponents.organizationId, orgId),
      eq(costComponents.code, String(input.code ?? "").trim().toUpperCase())
    ),
    columns: { id: true },
  });
  const result = await saveCostComponent({
    id: existing?.id,
    code: input.code,
    name: input.name,
    classification: input.classification?.trim() || "",
    accountNumber: input.account ?? "",
  });
  assertMasterDataOk(result);
  return {
    resultText: `Өртгийн бүрэлдэхүүн ${existing ? "шинэчлэгдлээ" : "үүслээ"}: ${input.code.toUpperCase()} · ${input.name}`,
  };
}

async function runUpdateCostingAccounts(
  orgId: string,
  input: {
    clearingAccount?: string;
    apClearingAccount?: string;
    adjustmentGainAccount?: string;
    adjustmentLossAccount?: string;
    nrvExpenseAccount?: string;
    nrvReserveAccount?: string;
    openPoCloseMode?: "block" | "warn";
  }
): Promise<AiToolResult> {
  const current = await loadCostingAccountSettings(orgId);
  const result = await saveCostingAccountSettings({
    clearingAccountNumber: input.clearingAccount ?? current.clearingAccountNumber,
    apClearingAccountNumber:
      input.apClearingAccount ?? current.apClearingAccountNumber,
    adjustmentGainAccountNumber:
      input.adjustmentGainAccount ?? current.adjustmentGainAccountNumber,
    adjustmentLossAccountNumber:
      input.adjustmentLossAccount ?? current.adjustmentLossAccountNumber,
    nrvExpenseAccountNumber: input.nrvExpenseAccount ?? current.nrvExpenseAccountNumber,
    nrvReserveAccountNumber: input.nrvReserveAccount ?? current.nrvReserveAccountNumber,
    openPoCloseMode: input.openPoCloseMode,
  });
  assertMasterDataOk(result);
  return {
    resultText: `Өртгийн дансны рольууд шинэчлэгдлээ${input.openPoCloseMode ? ` · нээлттэй PO-той сар хаалт: ${input.openPoCloseMode === "warn" ? "анхааруулга" : "хориг"}` : ""}`,
  };
}

async function runImportBankStatement(
  orgId: string,
  input: {
    cashAccount: string;
    bankName?: string;
    statementRef?: string;
    rows: {
      date: string;
      description?: string;
      counterparty?: string;
      counterAccount?: string;
      income?: number;
      expense?: number;
      counterGlAccount?: string;
      exchangeRate?: number;
      settleInvoice?: string;
      ewalletSettlement?: boolean;
      paymentMethod?: string;
    }[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  for (const [index, row] of input.rows.entries())
    if (!row.ewalletSettlement && !row.counterGlAccount?.trim())
      throw codedError("INVALID_INPUT", `rows[${index}].counterGlAccount заавал (ewalletSettlement мөрд л хэрэггүй)`);
  if (!Array.isArray(input.rows) || input.rows.length === 0)
    throw new Error("rows хоосон байна");
  if (input.rows.length > 500)
    throw new Error("MCP-ээр нэг удаад 500 хүртэл мөр импортолно");

  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
  });
  const account = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "мөнгөн данс",
    input.cashAccount,
    { allNames: accounts.map((entry) => entry.name) }
  );

  // Сегмент кодыг КАССЫН posting builder-ээр бүтээнэ (create_cash_transaction-
  // тай ЯГ НЭГ цөм — lib/gl/posting-code.ts): идэвхтэй утгуудаас default,
  // S9="CA". resolveAccount-ын түүхий 0-padding нь S9="GL" гэх мэт зөрүү
  // үүсгэж импортын validation-д унадаг байсан (Bug: S1 idle default).
  const ctx = await accountContext(orgId);
  const [segConfigs, enabledSegValues] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);
  const buildCashCode = postingCodeBuilderFromData({
    configs: segConfigs,
    values: enabledSegValues,
    moduleTag: "CA",
    cashFlowCode: null,
  });
  const bankCode = buildCashCode(account.glAccountNumber);

  // settleInvoice лавлагаануудыг урьдчилан ID болгоно.
  const settleIdByRef = new Map<string, string>();
  for (const row of input.rows) {
    const ref = row.settleInvoice?.trim();
    if (ref && !settleIdByRef.has(ref))
      settleIdByRef.set(ref, (await findArapDocument(orgId, ref)).id);
  }

  const dates = input.rows.map((row) => String(row.date)).sort();
  const parsedRows = input.rows.map((row, index) => {
    const income = Math.round(Number(row.income ?? 0) * 100) / 100;
    const expense = Math.round(Number(row.expense ?? 0) * 100) / 100;
    // Харьцах данс: оршин буйг resolveAccount-оор шалгаад, кодыг кассын
    // builder-ээр (create_cash_transaction-ий counterAccount-тай ижил).
    // Settlement мөрд түр дансны GL доор (санал таарсны дараа) бөглөгдөнө.
    const counterCode = row.ewalletSettlement
      ? ""
      : buildCashCode(resolveAccount(row.counterGlAccount as string, ctx).main);
    return {
      id: randomUUID(),
      rowNumber: index + 1,
      transactionDate: String(row.date),
      description: row.description?.trim() || "Банкны гүйлгээ",
      counterparty: row.counterparty?.trim() || "",
      counterAccount: row.counterAccount?.trim() || "",
      income,
      expense,
      exchangeRate: row.exchangeRate != null ? Number(row.exchangeRate) : null,
      baseAmount: null,
      debitAccountNumber: income > 0 ? bankCode : counterCode,
      creditAccountNumber: income > 0 ? counterCode : bankCode,
      settleInvoiceId: row.settleInvoice?.trim()
        ? settleIdByRef.get(row.settleInvoice.trim())
        : null,
      ewalletSettlement: null as EwalletSettlementRowInput | null,
      rawData: {} as Record<string, string>,
    };
  });

  // ── Э-хэтэвчийн settlement мөрүүд — серверт FIFO тулгалт ────────────────
  // Вэбийн «Ашиглах»-тай ИЖИЛ цэвэр логик (lib/cash/ewallet-settlement.ts);
  // мөр таарахгүй бол бүх импортыг зогсооно (хагас бичихгүй).
  const settlementIndexes = input.rows
    .map((row, index) => (row.ewalletSettlement ? index : -1))
    .filter((index) => index >= 0);
  if (settlementIndexes.length) {
    const context = await loadEwalletSettlementContext(orgId);
    const methodFor = (code?: string) => {
      const wanted = code?.trim().toUpperCase();
      return wanted
        ? context.methods.filter(
            (method) =>
              method.methodCode.toUpperCase() === wanted ||
              method.methodName.toUpperCase() === wanted
          )
        : context.methods;
    };
    for (const index of settlementIndexes) {
      const row = parsedRows[index];
      const methods = methodFor(input.rows[index].paymentMethod);
      if (methods.length === 0)
        throw codedError(
          "EWALLET_SETTLEMENT_UNMATCHED",
          `rows[${index}]: идэвхтэй, түр данстай ewallet хэлбэр олдсонгүй (get_pos_status; save_pos_payment_method kind=ewallet + cashAccount)`
        );
      // Мөр бүрийг дангаар тулгаж, таарсан орлогуудыг дараагийн мөрөөс хасна
      // (suggestEwalletSettlements дотроо ижил дүрэмтэй — ганц мөрөөр дуудна).
      const [suggestion] = suggestEwalletSettlements([row], methods)[row.id] ?? [];
      if (!suggestion) {
        const open = methods.map((method) => `${method.methodName}: ${fmt(method.openReceipts.reduce((sum, receipt) => sum + receipt.amount, 0))}₮ (${method.openReceipts.length} орлого${method.feePercent != null ? `, шимтгэл ${method.feePercent}%` : ", шимтгэл тохируулаагүй"})`).join("; ");
        throw codedError(
          "EWALLET_SETTLEMENT_UNMATCHED",
          `rows[${index}] (${row.transactionDate}, ${fmt(row.income)}₮): түр дансны тулгагдаагүй орлогуудын FIFO нийлбэр − шимтгэл энэ дүнтэй таарсангүй. Тулгагдаагүй: ${open || "байхгүй"}. Хэлбэрийн feePercent-ийг шалгах (save_pos_payment_method) эсвэл мөрийг counterGlAccount-оор энгийн орлого болгож, дараа нь гараар тулгана`
        );
      }
      const method = methods.find((entry) => entry.paymentMethodId === suggestion.paymentMethodId)!;
      // Дараагийн settlement мөрд ижил орлого дахин орохгүй.
      method.openReceipts = method.openReceipts.filter((receipt) => !suggestion.receiptIds.includes(receipt.id));
      row.creditAccountNumber = buildCashCode(method.glAccountNumber);
      row.ewalletSettlement = {
        paymentMethodId: suggestion.paymentMethodId,
        grossAmount: suggestion.grossAmount,
        feeAmount: suggestion.feeAmount,
      };
    }
  }

  // Идемпотент hash — ижил данс + ижил мөрүүд хоёр дахь удаад импортлогдохгүй.
  const fileHash = createHash("sha256")
    .update(JSON.stringify({ cashAccountId: account.id, rows: input.rows }))
    .digest("hex");

  const result = await saveBankStatement({
    cashAccountId: account.id,
    fileName:
      input.statementRef?.trim() ||
      `MCP импорт · ${account.name} · ${dates[0]} — ${dates[dates.length - 1]}`,
    fileHash,
    bankName: input.bankName?.trim() || account.bankName || "",
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    rows: parsedRows,
  });

  const settled = parsedRows.filter((row) => row.settleInvoiceId).length;
  const ewalletSettled = parsedRows.filter((row) => row.ewalletSettlement);
  const totalIncome = parsedRows.reduce((sum, row) => sum + row.income, 0);
  const totalExpense = parsedRows.reduce((sum, row) => sum + row.expense, 0);
  return {
    resultText: [
      `Банкны хуулга импортлогдлоо: ${account.name}, ${result.rowCount} мөр (орлого ${fmt(totalIncome)}₮ / зарлага ${fmt(totalExpense)}₮)`,
      `Мөр бүрд кассын баримт + GL журнал бичигдсэн${settled > 0 ? `; ${settled} мөр нэхэмжлэхтэй холбогдож төлсөн дүн шинэчлэгдсэн` : ""}${ewalletSettled.length ? `; ${ewalletSettled.length} э-хэтэвчийн settlement — түр данс → банк шилжүүлэг нийт ${fmt(ewalletSettled.reduce((sum, row) => sum + row.ewalletSettlement!.grossAmount, 0))}₮, шимтгэл ${fmt(ewalletSettled.reduce((sum, row) => sum + row.ewalletSettlement!.feeAmount, 0))}₮` : ""}.`,
      `Statement ID: ${result.id.slice(0, 8)} — вэб: Мөнгөн хөрөнгө → Хуулгууд.`,
    ].join("\n"),
  };
}

// ── Хангамж (PO + орлогдох өртөг) гүйцэтгэгчид ──────────────────────────────
//
// Бүх бичилт lib/actions/procurement.ts ба lib/actions/cost-allocation.ts-ийн
// server action-уудаар явна (шалгалт нэг газар — период, эрх, түр дансдын
// сахилга, аудит тэнд). Энд зөвхөн лавлах унших + горим/хязгаарын хамгаалалт.

const PO_STATUS_LABELS: Record<string, string> = {
  draft: "ноорог",
  open: "нээлттэй",
  closed: "хаагдсан",
  cancelled: "цуцлагдсан",
};

const GR_STATUS_LABELS: Record<string, string> = {
  draft: "ноорог",
  confirmed: "баталгаажсан",
  reversed: "буцаагдсан",
};

const PO_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "open",
  "closed",
  "cancelled",
];

function poActionStatus(status: string): AiAction["status"] {
  if (status === "open") return "open";
  if (status === "closed") return "closed";
  if (status === "cancelled") return "cancelled";
  return "draft";
}

/** Захиалгыг дугаар, externalRef эсвэл ID-гаар олно (findArapDocument-тай ижил). */
async function findPurchaseOrder(orgId: string, idOrNo: string) {
  const orders = await db.query.purchaseOrders.findMany({
    where: eq(purchaseOrders.organizationId, orgId),
    columns: {
      id: true,
      documentNo: true,
      externalRef: true,
      status: true,
      date: true,
      currency: true,
      totalAmount: true,
    },
    orderBy: [desc(purchaseOrders.createdAt)],
    limit: 1000,
  });
  const raw = String(idOrNo ?? "");
  const query = raw.trim().toLowerCase();
  const byNo = orders.filter(
    (order) => order.documentNo.toLowerCase() === query
  );
  if (byNo.length === 1) return byNo[0];
  const byRef = orders.filter(
    (order) =>
      query.length > 0 && (order.externalRef ?? "").toLowerCase() === query
  );
  if (byRef.length === 1) return byRef[0];
  return resolveByIdPrefix(orders, raw, "захиалга");
}

/** Хүлээн авалтыг дугаар (GR-…) эсвэл ID-гаар олно. */
async function findGoodsReceipt(orgId: string, idOrNo: string) {
  const receipts = await db.query.goodsReceipts.findMany({
    where: eq(goodsReceipts.organizationId, orgId),
    columns: { id: true, documentNo: true, status: true, date: true },
    orderBy: [desc(goodsReceipts.createdAt)],
    limit: 1000,
  });
  const raw = String(idOrNo ?? "");
  const byNo = receipts.filter(
    (receipt) => receipt.documentNo.toLowerCase() === raw.trim().toLowerCase()
  );
  if (byNo.length === 1) return byNo[0];
  return resolveByIdPrefix(receipts, raw, "хүлээн авалт");
}

/** Хуваарилалтыг дугаар (ALLOC-…) эсвэл ID-гаар олно. */
async function findCostAllocation(orgId: string, idOrNo: string) {
  const rows = await db.query.costAllocations.findMany({
    where: eq(costAllocations.organizationId, orgId),
    columns: {
      id: true,
      documentNo: true,
      date: true,
      totalAmount: true,
      allocationBase: true,
    },
    orderBy: [desc(costAllocations.createdAt)],
    limit: 1000,
  });
  const raw = String(idOrNo ?? "");
  const byNo = rows.filter(
    (row) => row.documentNo.toLowerCase() === raw.trim().toLowerCase()
  );
  if (byNo.length === 1) return byNo[0];
  return resolveByIdPrefix(rows, raw, "хуваарилалт");
}

/** Нийлүүлэгч (supplier|both), бараа, агуулахын лавлах — кодоор нь. */
async function procurementRefs(orgId: string) {
  const [cpList, items, whList] = await Promise.all([
    db.query.counterparties.findMany({
      where: and(
        eq(counterparties.organizationId, orgId),
        eq(counterparties.isActive, true)
      ),
      columns: { id: true, name: true, counterpartyType: true },
    }),
    db.query.inventoryItems.findMany({
      where: and(
        eq(inventoryItems.organizationId, orgId),
        eq(inventoryItems.isActive, true)
      ),
      columns: { id: true, code: true, name: true },
    }),
    db.query.warehouses.findMany({
      where: and(
        eq(warehouses.organizationId, orgId),
        eq(warehouses.isActive, true)
      ),
      columns: { id: true, code: true, name: true },
    }),
  ]);
  return {
    // Нийлүүлэгч = supplier эсвэл both (дизайн §3.6a).
    suppliers: cpList.filter((entry) => entry.counterpartyType !== "customer"),
    itemsByCode: new Map(items.map((item) => [item.code.toLowerCase(), item])),
    warehousesByCode: new Map(whList.map((wh) => [wh.code.toLowerCase(), wh])),
  };
}

type ProcurementRefs = Awaited<ReturnType<typeof procurementRefs>>;

function requireWarehouseId(refs: ProcurementRefs, code: string): string {
  const wh = refs.warehousesByCode.get(String(code).trim().toLowerCase());
  if (!wh)
    throw new Error(
      `"${code}" кодтой агуулах олдсонгүй (list_inventory-оор шалгана уу)`
    );
  return wh.id;
}

type PoLineToolInput = {
  itemCode: string;
  quantity: number;
  unitPrice: number;
  warehouseCode?: string;
  description?: string;
};

function purchaseOrderLineInputs(
  refs: ProcurementRefs,
  lines: PoLineToolInput[] | undefined
) {
  if (!Array.isArray(lines) || lines.length === 0)
    throw new Error("Захиалгад дор хаяж нэг мөр хэрэгтэй");
  return lines.map((line) => {
    const item = refs.itemsByCode.get(
      String(line.itemCode ?? "").trim().toLowerCase()
    );
    if (!item)
      throw new Error(
        `"${line.itemCode}" кодтой бараа олдсонгүй (list_inventory-оор шалгана уу)`
      );
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (!(quantity > 0))
      throw new Error(`${item.code}: тоо хэмжээ 0-ээс их байх ёстой`);
    if (!(unitPrice > 0))
      throw new Error(`${item.code}: нэгж үнэ 0-ээс их байх ёстой`);
    return {
      itemId: item.id,
      quantity,
      unitPrice,
      warehouseId: line.warehouseCode
        ? requireWarehouseId(refs, line.warehouseCode)
        : undefined,
      description: line.description?.trim() || undefined,
    };
  });
}

/**
 * Хязгаарын шалгалт ЗААВАЛ ₮-ээр. Захиалга нь өөрийн валютаараа хадгалагддаг
 * (ханш нь хүлээн авалт/нэхэмжлэх бүрд тусдаа) тул валюттай захиалгад ханшийг
 * ил шаардана — ханш ЗОХИОХГҮЙ (дизайн §3.5).
 */
function purchaseOrderBaseTotal(
  order: { currency: string; totalAmount: string; documentNo: string },
  exchangeRate?: number
): number {
  const total = Number(order.totalAmount);
  if (order.currency.toUpperCase() === "MNT") return total;
  const rate = Number(exchangeRate);
  if (!(rate > 0))
    throw codedError(
      "EXCHANGE_RATE_REQUIRED",
      `${order.documentNo} нь ${order.currency} валюттай — 10 сая ₮-ийн хязгаарыг шалгахын тулд exchangeRate (1 ${order.currency} = ? ₮) өгнө үү, эсвэл вэб дээрээс батална уу`
    );
  return total * rate;
}

async function requirePurchaseOrderDetail(
  orgId: string,
  purchaseOrderId: string
): Promise<PurchaseOrderDetail> {
  const detail = await loadPurchaseOrderDetail(orgId, purchaseOrderId);
  if (!detail) throw codedError("PO_NOT_FOUND", "Захиалга олдсонгүй");
  return detail;
}

/** Захиалгын мөрийг ID эсвэл барааны кодоор нь олно. */
function resolvePurchaseOrderLine(
  detail: PurchaseOrderDetail,
  line: { purchaseOrderLineId?: string; itemCode?: string }
): PurchaseOrderLineView {
  const lineId = line.purchaseOrderLineId?.trim();
  if (lineId) {
    const exact = detail.lines.filter(
      (entry) => entry.id.toLowerCase() === lineId.toLowerCase()
    );
    if (exact.length === 1) return exact[0];
    return resolveByIdPrefix(detail.lines, lineId, "захиалгын мөр");
  }
  const code = line.itemCode?.trim();
  if (code) {
    const matches = detail.lines.filter(
      (entry) => entry.itemCode.toLowerCase() === code.toLowerCase()
    );
    if (matches.length === 1) return matches[0];
    if (matches.length === 0)
      throw new Error(
        `"${code}" кодтой мөр ${detail.documentNo} захиалгад алга (get_purchase_order-оор шалгана уу)`
      );
    throw new Error(
      `"${code}" кодтой ${matches.length} мөр байна — purchaseOrderLineId-гаар заана уу`
    );
  }
  throw new Error("Мөр бүрд purchaseOrderLineId эсвэл itemCode хэрэгтэй");
}

/** Идэвхтэй өртгийн бүрэлдэхүүнийг КОДООР нь олно (лавлах — кодод хаалттай жагсаалт байхгүй). */
async function requireCostComponentByCode(orgId: string, code: string) {
  const trimmed = String(code ?? "").trim().toUpperCase();
  if (!trimmed) throw new Error("Өртгийн бүрэлдэхүүний код хэрэгтэй");
  const component = await db.query.costComponents.findFirst({
    where: and(
      eq(costComponents.organizationId, orgId),
      eq(costComponents.code, trimmed),
      eq(costComponents.isActive, true)
    ),
    columns: { id: true, code: true, name: true },
  });
  if (!component)
    throw new Error(
      `"${code}" кодтой идэвхтэй өртгийн бүрэлдэхүүн олдсонгүй (get_costing_settings-оор шалгана уу, эсвэл save_cost_component-оор нэмнэ)`
    );
  return component;
}

const QTY_TOLERANCE = 0.0001;

async function runCreatePurchaseOrder(
  orgId: string,
  input: {
    supplier: string;
    date: string;
    expectedDate?: string;
    currency?: string;
    exchangeRate?: number;
    warehouseCode?: string;
    description: string;
    documentNo?: string;
    externalRef?: string;
    lines: PoLineToolInput[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    const existing = await db.query.purchaseOrders.findFirst({
      where: and(
        eq(purchaseOrders.organizationId, orgId),
        eq(purchaseOrders.externalRef, externalRef)
      ),
    });
    if (existing)
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.documentNo}, ${fmt(Number(existing.totalAmount))} ${existing.currency}, төлөв: ${PO_STATUS_LABELS[existing.status] ?? existing.status}`,
        action: {
          kind: "purchase_order",
          id: existing.id,
          title: existing.documentNo,
          status: poActionStatus(existing.status),
        },
        dedup: true,
      };
  }

  const refs = await procurementRefs(orgId);
  const supplier = requireSingle(
    nameMatches(refs.suppliers, (entry) => entry.name, input.supplier),
    (entry) => entry.name,
    "нийлүүлэгч",
    input.supplier,
    {
      codePrefix: "COUNTERPARTY",
      allNames: refs.suppliers.map((entry) => entry.name),
    }
  );
  const lines = purchaseOrderLineInputs(refs, input.lines);
  const currency = input.currency?.trim().toUpperCase() || "MNT";
  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0
  );
  // Хязгаар ₮-ээр: валюттай захиалгад ханш ил өгөгдөөгүй бол ноорог үлдэнэ.
  const baseTotal =
    currency === "MNT" ? total : total * (Number(input.exchangeRate) || 0);
  let approveNow = false;
  let note = "";
  if (mode === "post") {
    if (!(baseTotal > 0))
      note =
        " (₮ дүн тодорхойгүй — exchangeRate ил өгөөгүй тул ноорог үлдэв; approve_purchase_order-оор батална)";
    else if (baseTotal > currentAiPostLimit())
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`;
    else approveNow = true;
  }

  const created = unwrapAction(
    await createPurchaseOrder({
      counterpartyId: supplier.id,
      date: input.date,
      expectedDate: input.expectedDate?.trim() || undefined,
      currency,
      warehouseId: input.warehouseCode
        ? requireWarehouseId(refs, input.warehouseCode)
        : undefined,
      description: input.description,
      documentNo: input.documentNo?.trim() || undefined,
      externalRef,
      lines,
      approveNow,
    })
  );
  if (created.dedup)
    return {
      resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${created.id}, ${created.documentNo}`,
      action: {
        kind: "purchase_order",
        id: created.id,
        title: created.documentNo,
        status: "draft",
      },
      dedup: true,
    };

  return {
    resultText: `Захиалга үүслээ. Дугаар: ${created.documentNo}, нийлүүлэгч: ${supplier.name}, дүн: ${fmt(total)} ${currency}, ${lines.length} мөр, төлөв: ${approveNow ? "нээлттэй" : "ноорог"}${note}`,
    action: {
      kind: "purchase_order",
      id: created.id,
      title: `${created.documentNo} · ${supplier.name}`,
      status: approveNow ? "open" : "draft",
    },
  };
}

async function runUpdatePurchaseOrder(
  orgId: string,
  input: {
    purchaseOrderId: string;
    date?: string;
    expectedDate?: string;
    warehouseCode?: string;
    description?: string;
    lines?: (PoLineToolInput & { purchaseOrderLineId?: string })[];
  }
): Promise<AiToolResult> {
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  const refs = await procurementRefs(orgId);
  let lines:
    | (ReturnType<typeof purchaseOrderLineInputs>[number] & { id?: string })[]
    | undefined;
  if (input.lines) {
    const prepared = purchaseOrderLineInputs(refs, input.lines);
    // Байгаа мөрийн ID-г ХАДГАЛНА — эс бөгөөс хүлээн авсан/нэхэмжилсэн мөр
    // хасагдаж [OVER_RECEIVED] гарна (үнэ засах нь хэвийн урсгал, §3.4).
    const detail = await requirePurchaseOrderDetail(orgId, order.id);
    const codeOf = (line: { itemCode?: string }) =>
      String(line.itemCode ?? "").trim().toLowerCase();
    const givenLines = input.lines;
    lines = prepared.map((line, index) => {
      const given = givenLines[index];
      if (given.purchaseOrderLineId?.trim())
        return {
          ...line,
          id: resolvePurchaseOrderLine(detail, {
            purchaseOrderLineId: given.purchaseOrderLineId,
          }).id,
        };
      const code = codeOf(given);
      const existing = detail.lines.filter(
        (entry) => entry.itemCode.toLowerCase() === code
      );
      const givenSameCode = givenLines.filter(
        (entry) => codeOf(entry) === code
      );
      // Ижил бараа хоёр мөрөнд байвал таамаглахгүй — шинэ мөр болно.
      if (existing.length === 1 && givenSameCode.length === 1)
        return { ...line, id: existing[0].id };
      return line;
    });
  }
  unwrapAction(
    await updatePurchaseOrder({
      id: order.id,
      date: input.date?.trim() || undefined,
      expectedDate: input.expectedDate?.trim() || undefined,
      warehouseId: input.warehouseCode
        ? requireWarehouseId(refs, input.warehouseCode)
        : undefined,
      description: input.description?.trim() || undefined,
      lines,
    })
  );
  return {
    resultText: `Захиалга шинэчлэгдлээ: ${order.documentNo}${lines ? `, ${lines.length} мөр` : ""} (төлөв: ${PO_STATUS_LABELS[order.status] ?? order.status})`,
    action: {
      kind: "purchase_order",
      id: order.id,
      title: order.documentNo,
      status: poActionStatus(order.status),
    },
  };
}

async function runApprovePurchaseOrder(
  orgId: string,
  input: { purchaseOrderId: string; exchangeRate?: number },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  if (order.status !== "draft")
    throw new Error(
      `${order.documentNo} захиалга ноорог биш (төлөв: ${PO_STATUS_LABELS[order.status] ?? order.status}) — батлах шаардлагагүй`
    );
  assertPostLimit(purchaseOrderBaseTotal(order, input.exchangeRate));
  unwrapAction(await approvePurchaseOrder({ id: order.id }));
  return {
    resultText: `Захиалга батлагдаж НЭЭЛТТЭЙ болов: ${order.documentNo}, ${fmt(Number(order.totalAmount))} ${order.currency} — одооноос хүлээн авалт (create_goods_receipt) ба нэхэмжлэх (create_ap_invoice_from_po) бүртгэнэ. GL бичилт үүсээгүй (захиалга нь гүйлгээ биш)`,
    action: {
      kind: "purchase_order",
      id: order.id,
      title: order.documentNo,
      status: "open",
    },
  };
}

async function runClosePurchaseOrder(
  orgId: string,
  input: {
    purchaseOrderId: string;
    closeDate?: string;
    shortClose?: boolean;
    reason?: string;
    writeOffAccount?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  if (order.status === "closed")
    throw codedError(
      "PO_CLOSED",
      `${order.documentNo} захиалга аль хэдийн хаагдсан байна`
    );
  if (order.status !== "open")
    throw codedError(
      "PO_NOT_OPEN",
      `${order.documentNo} захиалга нээлттэй биш (төлөв: ${PO_STATUS_LABELS[order.status] ?? order.status}) — хаах боломжгүй`
    );
  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  const short = input.shortClose === true;
  if (!short && detail.blockers.length > 0)
    throw codedError(
      "PO_NOT_READY",
      `${order.documentNo} хаах нөхцөл биелээгүй: ${detail.blockers.join("; ")}${
        detail.shortClose && detail.shortClose.blockers.length === 0
          ? ` — бараа бүрэн ирэхгүй бол shortClose: true + reason-оор ДУТУУ хаана (цуцлах үлдэгдэл ${detail.shortClose.cancelledQuantity} нэгж${detail.shortClose.writeOffMnt > 0 ? `, илүү нэхэмжлэл ${fmt(detail.shortClose.writeOffMnt)}₮ → writeOffAccount заавал` : ""})`
          : ""
      }`
    );
  if (short && detail.shortClose && detail.shortClose.blockers.length > 0)
    throw codedError(
      "PO_NOT_READY",
      `${order.documentNo} дутуу хаах нөхцөл биелээгүй: ${detail.shortClose.blockers.join("; ")}`
    );
  // Хаалтын журналын дүн (түр дансдын үлдэгдэл) АЛЬ ХЭДИЙН ₮-ээр.
  assertPostLimit(
    Math.max(
      Math.abs(detail.clearing.inventory),
      Math.abs(detail.clearing.payable)
    )
  );
  const closeDate =
    input.closeDate?.trim() || new Date().toISOString().slice(0, 10);
  const closed = unwrapAction(
    await closePurchaseOrder({
      id: order.id,
      closeDate,
      shortClose: short
        ? {
            reason: input.reason ?? "",
            writeOffAccount: input.writeOffAccount?.trim() || null,
          }
        : null,
    })
  );
  const { voucherId } = closed;
  return {
    resultText: [
      `Захиалга ${short ? "ДУТУУ " : ""}ХААГДЛАА: ${order.documentNo} (${closeDate}).`,
      ...(short
        ? [
            `Хүлээн аваагүй ${closed.cancelledQuantity ?? 0} нэгж цуцлагдав${
              (closed.writeOffMnt ?? 0) > 0
                ? `; хүлээн авснаас илүү нэхэмжлэл ${fmt(closed.writeOffMnt ?? 0)}₮ зардалд (Dr ${input.writeOffAccount})`
                : ""
            }. Шалтгаан аудитад бичигдэв; дахин нээхэд цуцлалт сэргэнэ.`,
          ]
        : []),
      `Түр дансдыг тэгшитгэсэн журнал бичигдэв (ID ${voucherId.slice(0, 8)}): Dr бараа материалын түр данс ${fmt(Math.abs(detail.clearing.inventory))}₮ / Cr өглөгийн түр данс ${fmt(Math.abs(detail.clearing.payable))}₮; зөрүү нь ханшийн олз/гарз дансанд.`,
      "Хоёр түр данс энэ захиалгаар 0 болов — reconcile_modules-оор шалгаж болно.",
    ].join("\n"),
    action: {
      kind: "purchase_order",
      id: order.id,
      title: order.documentNo,
      status: "closed",
    },
  };
}

async function runCancelPurchaseOrder(
  orgId: string,
  input: { purchaseOrderId: string; exchangeRate?: number },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  if (order.status === "closed")
    throw codedError(
      "PO_CLOSED",
      `${order.documentNo} хаагдсан захиалгыг цуцлах боломжгүй`
    );
  if (order.status === "cancelled")
    throw new Error(`${order.documentNo} захиалга аль хэдийн цуцлагдсан байна`);
  // Цуцлалт GL-д нөлөөгүй (хүлээн авалт/нэхэмжлэхтэй PO цуцлагдахгүй) тул
  // батлах хязгаар, ханш шаардахгүй (SIM2-025).
  const cancelled = unwrapAction(await cancelPurchaseOrder({ id: order.id }));
  return {
    resultText: `Захиалга цуцлагдлаа: ${order.documentNo}${cancelled.deletedReceipts.length ? ` · ноорог хүлээн авалт устгагдав: ${cancelled.deletedReceipts.join(", ")}` : ""}`,
    action: {
      kind: "purchase_order",
      id: order.id,
      title: order.documentNo,
      status: "cancelled",
    },
  };
}

async function runListPurchaseOrders(
  orgId: string,
  input: {
    supplier?: string;
    status?: string;
    from?: string;
    to?: string;
    openOnly?: boolean;
    limit?: number;
  }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const status = PO_STATUSES.includes(input.status as PurchaseOrderStatus)
    ? (input.status as PurchaseOrderStatus)
    : undefined;
  const orders = await loadPurchaseOrders(orgId, {
    status,
    from: input.from?.trim() || undefined,
    to: input.to?.trim() || undefined,
  });
  const supplierQuery = input.supplier?.trim().toLowerCase();
  const filtered = orders
    .filter((order) => {
      if (
        supplierQuery &&
        !order.counterpartyName.toLowerCase().includes(supplierQuery)
      )
        return false;
      if (input.openOnly && order.status !== "open") return false;
      return true;
    })
    .slice(0, limit);
  if (filtered.length === 0)
    return { resultText: "Тохирох захиалга олдсонгүй" };
  return {
    resultText: filtered
      .map(
        (order) =>
          `${order.date} · ${order.documentNo} · ${order.counterpartyName} · ${fmt(order.totalAmount)} ${order.currency} · хүлээн авсан ${order.receivedPct}% · нэхэмжилсэн ${order.invoicedPct}% · ${PO_STATUS_LABELS[order.status] ?? order.status} · ID ${order.id.slice(0, 8)}`
      )
      .join("\n"),
  };
}

async function runGetPurchaseOrder(
  orgId: string,
  input: { purchaseOrderId: string }
): Promise<AiToolResult> {
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  const sections: string[] = [
    [
      `ЗАХИАЛГА ${detail.documentNo} · ${detail.counterpartyName} · ${detail.date}`,
      `Төлөв: ${PO_STATUS_LABELS[detail.status] ?? detail.status} · дүн ${fmt(detail.totalAmount)} ${detail.currency} · хүлээн авсан ${detail.receivedPct}% · нэхэмжилсэн ${detail.invoicedPct}%${detail.warehouseName ? ` · агуулах ${detail.warehouseName}` : ""}`,
      detail.description ? `Утга: ${detail.description}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "МӨРҮҮД (захиалсан / хүлээн авсан / нэхэмжилсэн):",
      ...detail.lines.map(
        (line) =>
          `  ${line.itemCode} ${line.itemName} — захиалсан ${fmt(line.quantity)} × ${fmt(line.unitPrice)} = ${fmt(line.amount)} ${detail.currency} · хүлээн авсан ${fmt(line.receivedQuantity)} · нэхэмжилсэн ${fmt(line.invoicedQuantity)} (${fmt(line.invoicedAmount)} ${detail.currency}) · мөрийн ID ${line.id.slice(0, 8)}`
      ),
    ].join("\n"),
  ];
  sections.push(
    detail.receipts.length > 0
      ? [
          "ХҮЛЭЭН АВАЛТУУД:",
          ...detail.receipts.map(
            (receipt) =>
              `  ${receipt.date} · ${receipt.documentNo} · ${receipt.warehouseName} · ханш ${fmt(receipt.exchangeRate)} · ${fmt(receipt.totalAmountMnt)}₮ · ${GR_STATUS_LABELS[receipt.status] ?? receipt.status} · ID ${receipt.id.slice(0, 8)}`
          ),
        ].join("\n")
      : "ХҮЛЭЭН АВАЛТУУД: алга (create_goods_receipt)"
  );
  sections.push(
    detail.invoices.length > 0
      ? [
          "НЭХЭМЖЛЭХҮҮД:",
          ...detail.invoices.map(
            (invoice) =>
              `  ${invoice.date} · ${invoice.documentNo} · ${fmt(invoice.totalAmount)} ${invoice.currency} (≈${fmt(invoice.baseTotalAmount)}₮) · ${ARAP_STATUS_LABELS[invoice.status] ?? invoice.status}${invoice.isCostInvoice ? " · нэмэлт зардал" : ""} · ID ${invoice.id.slice(0, 8)}`
          ),
        ].join("\n")
      : "НЭХЭМЖЛЭХҮҮД: алга (create_ap_invoice_from_po)"
  );
  // Хуваарилах зорилтууд — "гараар" суурьд мөр бүрийн дүнг бичихэд
  // movementId хэрэгтэй (үнийн дүнгийн жин нь D6=(а) дүрмээр).
  if (detail.receipts.some((receipt) => receipt.status === "confirmed")) {
    const options = await loadPoAllocationTargets(detail.id);
    if (options.length > 0)
      sections.push(
        [
          "ХУВААРИЛАХ ЗОРИЛТУУД (баталгаажсан орлогууд — create_cost_allocation-ийн targets):",
          ...options.map(
            (option) =>
              `  ${option.date} · ${option.itemLabel} · ${option.warehouseLabel} · ${fmt(option.quantity)} ш · үнэлгээ ${fmt(option.value)}₮ · movementId ${option.movementId.slice(0, 8)}`
          ),
        ].join("\n")
      );
  }
  if (detail.costLines.length > 0)
    sections.push(
      [
        "ХУВААРИЛАГДААГҮЙ НЭМЭЛТ ЗАРДАЛ (create_cost_allocation-ийн sourceLine):",
        ...detail.costLines.map(
          (line) =>
            `  ${line.documentNo} · ${line.costComponentName} · дүн ${fmt(line.amountMnt)}₮ · хуваарилсан ${fmt(line.allocatedMnt)}₮ · үлдэгдэл ${fmt(line.remainingMnt)}₮ · мөрийн ID ${line.lineId.slice(0, 8)}`
        ),
      ].join("\n")
    );
  sections.push(
    `ТҮР ДАНСДЫН ҮЛДЭГДЭЛ (энэ захиалгаар): бараа материалын түр данс ${fmt(detail.clearing.inventory)}₮ · өглөгийн түр данс ${fmt(detail.clearing.payable)}₮ (хаалтад хоёул 0 болно)`
  );
  const cancelled = detail.lines.filter((line) => line.cancelledQuantity > 0);
  sections.push(
    detail.status !== "open"
      ? // Хаагдсан/цуцлагдсан захиалгад хаалтын нөхцөл хамаарахгүй (ENT-064).
        `Төлөв: ${PO_STATUS_LABELS[detail.status] ?? detail.status}${
          detail.shortCloseReason
            ? ` — ДУТУУ хаагдсан: цуцалсан ${cancelled.map((line) => `${line.itemCode} ${fmt(line.cancelledQuantity)}`).join(", ") || "үлдэгдэлгүй"}; шалтгаан: ${detail.shortCloseReason}`
            : ""
        }`
      : detail.blockers.length > 0
        ? `ХААХАД ДУТУУ: ${detail.blockers.join("; ")}${
            detail.shortClose && detail.shortClose.blockers.length === 0
              ? ` — бараа бүрэн ирэхгүй бол close_purchase_order {shortClose: true, reason} (цуцлах ${fmt(detail.shortClose.cancelledQuantity)} нэгж${detail.shortClose.writeOffMnt > 0 ? `, илүү нэхэмжлэл ${fmt(detail.shortClose.writeOffMnt)}₮ → writeOffAccount` : ""})`
              : ""
          }`
        : "ХААХАД БЭЛЭН — close_purchase_order"
  );
  return { resultText: sections.join("\n\n") };
}

async function runCreateGoodsReceipt(
  orgId: string,
  input: {
    purchaseOrderId: string;
    date: string;
    warehouseCode?: string;
    exchangeRate?: number;
    documentNo?: string;
    description?: string;
    lines?: {
      purchaseOrderLineId?: string;
      itemCode?: string;
      quantity: number;
    }[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  if (order.status === "closed")
    throw codedError(
      "PO_CLOSED",
      `${order.documentNo} хаагдсан захиалгад хүлээн авалт нэмэгдэхгүй`
    );
  if (order.status !== "open")
    throw codedError(
      "PO_NOT_OPEN",
      `${order.documentNo} захиалга нээлттэй биш (төлөв: ${PO_STATUS_LABELS[order.status] ?? order.status}) — эхлээд approve_purchase_order`
    );
  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  const refs = input.warehouseCode ? await procurementRefs(orgId) : null;

  // Мөр өгөгдөөгүй бол үлдэгдлийг server action өөрөө бодно (бөөрөнхийлөл
  // нэг газар) — энд зөвхөн ₮ дүнг тооцоолж горим/хязгаарыг шалгана.
  const explicitLines = Array.isArray(input.lines) && input.lines.length > 0;
  const requested = explicitLines
    ? (input.lines ?? []).map((line) => {
        const poLine = resolvePurchaseOrderLine(detail, line);
        const quantity = Number(line.quantity);
        if (!(quantity > 0))
          throw new Error(`${poLine.itemCode}: тоо хэмжээ 0-ээс их байна`);
        const remaining = poLine.quantity - poLine.receivedQuantity;
        if (quantity > remaining + QTY_TOLERANCE)
          throw codedError(
            "OVER_RECEIVED",
            `${poLine.itemCode}: хүлээн авах үлдэгдэл ${fmt(remaining)}, оруулсан ${fmt(quantity)}`
          );
        return {
          purchaseOrderLineId: poLine.id,
          quantity,
          unitPrice: poLine.unitPrice,
        };
      })
    : detail.lines
        .map((line) => ({
          purchaseOrderLineId: line.id,
          quantity: line.quantity - line.receivedQuantity,
          unitPrice: line.unitPrice,
        }))
        .filter((line) => line.quantity > QTY_TOLERANCE);
  if (requested.length === 0)
    throw new Error(
      `${order.documentNo}: хүлээн авах үлдэгдэл алга — захиалга бүхэлдээ хүлээн авагдсан`
    );

  // Капитализацийн ₮ дүн = тоо × PO нэгж үнэ × ханш. Ханш ил өгөгдөөгүй
  // валюттай захиалгад (МБ ханш нь action дотор татагдана) ноорог үлдэнэ —
  // хязгаарыг ₮-гүйгээр шалгаж болохгүй.
  const rate =
    order.currency.toUpperCase() === "MNT"
      ? 1
      : Number(input.exchangeRate) || 0;
  const baseTotal = requested.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice * rate,
    0
  );
  let confirmNow = false;
  let note = "";
  if (mode === "post") {
    if (!(baseTotal > 0))
      note =
        " (₮ дүн тодорхойгүй — exchangeRate ил өгөөгүй тул ноорог үлдэв; confirm_goods_receipt-оор батална)";
    else if (baseTotal > currentAiPostLimit())
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`;
    else confirmNow = true;
  }

  const created = unwrapAction(
    await createGoodsReceipt({
      purchaseOrderId: order.id,
      date: input.date,
      warehouseId:
        refs && input.warehouseCode
          ? requireWarehouseId(refs, input.warehouseCode)
          : undefined,
      exchangeRate:
        input.exchangeRate != null ? Number(input.exchangeRate) : undefined,
      documentNo: input.documentNo?.trim() || undefined,
      description: input.description?.trim() || undefined,
      lines: explicitLines
        ? requested.map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantity: line.quantity,
          }))
        : undefined,
      confirmNow,
    })
  );

  return {
    resultText: `Хүлээн авалт ${confirmNow ? "бүртгэгдэж БАТАЛГААЖЛАА" : "ноорог болж үүслээ"}: ${created.documentNo} (${order.documentNo}), ${input.date}, ${requested.length} мөр${baseTotal > 0 ? `, капиталжих дүн ~${fmt(baseTotal)}₮` : ""}${note}${confirmNow ? " — Dr барааны нөөц / Cr бараа материалын түр данс" : " — confirm_goods_receipt-оор батална"}`,
    action: {
      kind: "goods_receipt",
      id: created.id,
      title: `${created.documentNo} · ${order.documentNo}`,
      status: confirmNow ? "confirmed" : "draft",
    },
  };
}

async function runConfirmGoodsReceipt(
  orgId: string,
  input: { receiptId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const receipt = await findGoodsReceipt(orgId, input.receiptId);
  if (receipt.status !== "draft")
    throw codedError(
      "GR_NOT_DRAFT",
      `${receipt.documentNo} хүлээн авалт ноорог биш (төлөв: ${GR_STATUS_LABELS[receipt.status] ?? receipt.status})`
    );
  const detail = await loadGoodsReceiptDetail(orgId, receipt.id);
  if (!detail) throw new Error("Хүлээн авалт олдсонгүй");
  assertPostLimit(detail.totalAmountMnt);
  const result = unwrapAction(await confirmGoodsReceipt({ id: receipt.id }));
  return {
    resultText: `Хүлээн авалт БАТАЛГААЖЛАА: ${detail.documentNo} (${detail.purchaseOrderNo}), ${detail.lineCount} мөр, ханш ${fmt(detail.exchangeRate)} → капиталжсан дүн ${fmt(result.amountMnt)}₮ (Dr барааны нөөц / Cr бараа материалын түр данс). Бараа үлдэгдэлд орлоо.`,
    action: {
      kind: "goods_receipt",
      id: receipt.id,
      title: `${detail.documentNo} · ${detail.purchaseOrderNo}`,
      status: "confirmed",
    },
  };
}

async function runReverseGoodsReceipt(
  orgId: string,
  input: { receiptId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const receipt = await findGoodsReceipt(orgId, input.receiptId);
  if (receipt.status !== "confirmed")
    throw codedError(
      "GR_NOT_CONFIRMED",
      receipt.status === "draft"
        ? `${receipt.documentNo} ноорог хүлээн авалт — буцаах биш delete_goods_receipt-ээр устгана`
        : `${receipt.documentNo} хүлээн авалт баталгаажаагүй (төлөв: ${GR_STATUS_LABELS[receipt.status] ?? receipt.status}) — буцаах шаардлагагүй`
    );
  const detail = await loadGoodsReceiptDetail(orgId, receipt.id);
  if (!detail) throw new Error("Хүлээн авалт олдсонгүй");
  assertPostLimit(detail.totalAmountMnt);
  unwrapAction(await reverseGoodsReceipt({ id: receipt.id }));
  return {
    resultText: `Хүлээн авалт БУЦААГДЛАА: ${detail.documentNo} (${detail.purchaseOrderNo}), ${fmt(detail.totalAmountMnt)}₮ — капитализацийн журнал эсрэг мөрөөр буцаж, орлогын хөдөлгөөн цуцлагдав`,
    action: {
      kind: "goods_receipt",
      id: receipt.id,
      title: `${detail.documentNo} · ${detail.purchaseOrderNo}`,
      status: "reversed",
    },
  };
}

/** Ноорог хүлээн авалтыг устгана (SIM2-026) — GL/бараанд нөлөөгүй тул аль ч горимд. */
async function runDeleteGoodsReceipt(
  orgId: string,
  input: { receiptId: string }
): Promise<AiToolResult> {
  const receipt = await findGoodsReceipt(orgId, input.receiptId);
  if (receipt.status !== "draft")
    throw codedError(
      "GR_NOT_DRAFT",
      `${receipt.documentNo} ноорог биш (төлөв: ${GR_STATUS_LABELS[receipt.status] ?? receipt.status}) — баталгаажсаныг reverse_goods_receipt-ээр буцаана`
    );
  unwrapAction(await deleteGoodsReceipt({ id: receipt.id }));
  return { resultText: `Ноорог хүлээн авалт устгагдлаа: ${receipt.documentNo}` };
}

async function runCreateApInvoiceFromPo(
  orgId: string,
  input: {
    purchaseOrderId: string;
    date: string;
    dueDate?: string;
    exchangeRate?: number;
    description?: string;
    documentNo?: string;
    externalRef?: string;
    lines?: {
      purchaseOrderLineId?: string;
      itemCode?: string;
      quantity: number;
      unitPrice?: number;
    }[];
    costLines?: {
      costComponentCode: string;
      amount: number;
      description?: string;
    }[];
    otherLines?: { account: string; amount: number; description?: string }[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    const existing = await db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.externalRef, externalRef)
      ),
    });
    if (existing)
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.documentNo}, ${fmt(Number(existing.totalAmount))}₮, төлөв: ${ARAP_STATUS_LABELS[existing.status] ?? existing.status}`,
        action: {
          kind: "arap",
          id: existing.id,
          title: existing.documentNo,
          status: existing.status === "draft" ? "draft" : "posted",
        },
        dedup: true,
      };
  }

  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  if (order.status === "closed")
    throw codedError(
      "PO_CLOSED",
      `${order.documentNo} хаагдсан захиалгад нэхэмжлэх нэмэгдэхгүй`
    );
  if (order.status !== "open")
    throw codedError(
      "PO_NOT_OPEN",
      `${order.documentNo} захиалга нээлттэй биш (төлөв: ${PO_STATUS_LABELS[order.status] ?? order.status}) — эхлээд approve_purchase_order`
    );
  const detail = await requirePurchaseOrderDetail(orgId, order.id);

  // Мөр өгөгдөөгүй бол нэхэмжлээгүй үлдэгдлийг server action өөрөө бодно —
  // энд зөвхөн ₮ дүнг тооцоолж горим/хязгаарыг шалгана.
  const explicitLines = Array.isArray(input.lines) && input.lines.length > 0;
  const itemLines = explicitLines
    ? (input.lines ?? []).map((line) => {
        const poLine = resolvePurchaseOrderLine(detail, line);
        const quantity = Number(line.quantity);
        if (!(quantity > 0))
          throw new Error(`${poLine.itemCode}: тоо хэмжээ 0-ээс их байна`);
        const remaining = poLine.quantity - poLine.invoicedQuantity;
        if (quantity > remaining + QTY_TOLERANCE)
          throw codedError(
            "OVER_INVOICED",
            `${poLine.itemCode}: нэхэмжлэх үлдэгдэл ${fmt(remaining)}, оруулсан ${fmt(quantity)}`
          );
        const unitPrice =
          line.unitPrice != null ? Number(line.unitPrice) : poLine.unitPrice;
        if (!(unitPrice > 0))
          throw new Error(`${poLine.itemCode}: нэгж үнэ 0-ээс их байна`);
        return {
          purchaseOrderLineId: poLine.id,
          quantity,
          unitPrice,
        };
      })
    : detail.lines
        .map((line) => ({
          purchaseOrderLineId: line.id,
          quantity: line.quantity - line.invoicedQuantity,
          unitPrice: line.unitPrice,
        }))
        .filter((line) => line.quantity > QTY_TOLERANCE);

  const costLines: {
    costComponentId: string;
    amount: number;
    description?: string;
  }[] = [];
  for (const line of input.costLines ?? []) {
    const component = await requireCostComponentByCode(
      orgId,
      line.costComponentCode
    );
    const amount = Number(line.amount);
    if (!(amount > 0))
      throw new Error(`${component.code}: зардлын дүн 0-ээс их байна`);
    costLines.push({
      costComponentId: component.id,
      amount,
      description: line.description?.trim() || undefined,
    });
  }

  const otherLines: { account: string; amount: number; description?: string }[] =
    [];
  if ((input.otherLines ?? []).length > 0) {
    const ctx = await accountContext(orgId);
    for (const line of input.otherLines ?? []) {
      const amount = Number(line.amount);
      if (!(amount > 0)) throw new Error("Мөрийн дүн 0-ээс их байна");
      otherLines.push({
        account: resolveAccount(line.account, ctx).code,
        amount,
        description: line.description?.trim() || undefined,
      });
    }
  }

  if (
    itemLines.length === 0 &&
    costLines.length === 0 &&
    otherLines.length === 0
  )
    throw new Error(
      `${order.documentNo}: нэхэмжлэх үлдэгдэл алга — нэмэлт зардлын мөрөөр (costLines) нэхэмжлэх үүсгэнэ`
    );

  const currencyTotal =
    itemLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) +
    costLines.reduce((sum, line) => sum + line.amount, 0) +
    otherLines.reduce((sum, line) => sum + line.amount, 0);
  const rate =
    order.currency.toUpperCase() === "MNT"
      ? 1
      : Number(input.exchangeRate) || 0;
  const baseTotal = currencyTotal * rate;
  let postNow = false;
  let note = "";
  if (mode === "post") {
    if (!(baseTotal > 0))
      note =
        " (₮ дүн тодорхойгүй — exchangeRate ил өгөөгүй тул ноорог үлдэв; post_arap_document-оор батална)";
    else if (baseTotal > currentAiPostLimit())
      note = ` (${fmt(currentAiPostLimit())}₮-с их тул ноорог үлдэв)`;
    else postNow = true;
  }

  const created = unwrapAction(
    await createApInvoiceFromPo({
      purchaseOrderId: order.id,
      date: input.date,
      dueDate: input.dueDate?.trim() || undefined,
      exchangeRate:
        input.exchangeRate != null ? Number(input.exchangeRate) : undefined,
      description: input.description?.trim() || undefined,
      documentNo: input.documentNo?.trim() || undefined,
      externalRef,
      postNow,
      lines: explicitLines ? itemLines : undefined,
      costLines: costLines.length > 0 ? costLines : undefined,
      otherLines: otherLines.length > 0 ? otherLines : undefined,
    })
  );
  if (created.dedup)
    return {
      resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${created.id}, ${created.documentNo}`,
      action: {
        kind: "arap",
        id: created.id,
        title: created.documentNo,
        status: "draft",
      },
      dedup: true,
    };

  return {
    resultText: `Захиалгын нэхэмжлэх үүслээ: ${created.documentNo} (${order.documentNo}), дүн ${fmt(currencyTotal)} ${order.currency}${costLines.length > 0 ? `, нэмэлт зардлын мөр ${costLines.length}` : ""}, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note} — Dr өглөгийн түр данс / Cr өглөг (хөдөлгөөн үүсэхгүй, орлого нь хүлээн авалтаас)${costLines.length > 0 ? ". Нэмэлт зардлыг create_cost_allocation-оор хуваарилна" : ""}${created.warning ? `\n⚠ ${created.warning}` : ""}`,
    action: {
      kind: "arap",
      id: created.id,
      title: `${created.documentNo} · ${detail.counterpartyName}`,
      status: postNow ? "posted" : "draft",
    },
  };
}

async function runCreateCostAllocation(
  orgId: string,
  input: {
    allocationBase?: string;
    sourceLine?: string;
    date?: string;
    totalAmount?: number;
    component?: string;
    description?: string;
    documentNo?: string;
    targets?: { movementId: string; manualAmount?: number }[];
  }
): Promise<AiToolResult> {
  const base = String(input.allocationBase ?? "").trim() as AllocationBase;
  // OD-017: суурь урьдчилан СОНГОГДОХГҮЙ — default-д нуухгүй.
  if (!["value", "quantity", "manual"].includes(base))
    throw new Error(
      "allocationBase-ийг ил өгнө үү: value (үнийн дүнгээр), quantity (тоо хэмжээгээр) эсвэл manual (гараар). Систем өөрөө сонгохгүй — хэрэглэгчээс асууна уу"
    );

  let sourceLineId: string | undefined;
  let purchaseOrderId: string | undefined;
  let date = input.date?.trim() || "";
  let totalAmount = input.totalAmount != null ? Number(input.totalAmount) : NaN;
  let componentId = "";
  let label = "";

  const sourceLine = input.sourceLine?.trim();
  if (sourceLine) {
    const query = sourceLine.toLowerCase();
    if (query.length < 6)
      throw new Error("Зардлын мөрийн ID дор хаяж 6 тэмдэгт байх ёстой");
    const rows = await loadUnallocatedCostLines(orgId);
    const matches = rows.filter(
      (row) =>
        row.lineId.toLowerCase() === query ||
        row.lineId.toLowerCase().startsWith(query)
    );
    if (matches.length === 0)
      throw new Error(
        `"${sourceLine}" ID-тай хуваарилагдаагүй зардлын мөр олдсонгүй — get_purchase_order-оор шалгана уу (нэхэмжлэх БАТЛАГДСАН байх ёстой; бүхэлдээ хуваарилагдсан мөр энд харагдахгүй)`
      );
    if (matches.length > 1)
      throw new Error(
        `"${sourceLine}" гэхэд ${matches.length} мөр таарлаа — бүтэн мөрийн ID өгнө үү`
      );
    const row = matches[0];
    sourceLineId = row.lineId;
    purchaseOrderId = row.purchaseOrderId;
    componentId = row.costComponentId;
    if (!date) date = row.date;
    if (!Number.isFinite(totalAmount)) totalAmount = row.remainingMnt;
    label = `${row.documentNo} · ${row.costComponentName}`;
    if (totalAmount > row.remainingMnt + 0.01)
      throw codedError(
        "ALLOCATION_EXCEEDS_LINE",
        `${row.documentNo} мөрийн хуваарилагдаагүй үлдэгдэл ${fmt(row.remainingMnt)}₮ — ${fmt(totalAmount)}₮ хуваарилах боломжгүй`
      );
  } else {
    if (!input.component?.trim())
      throw new Error(
        "sourceLine (зардлын нэхэмжлэхийн мөрийн ID) эсвэл component (бүрэлдэхүүний код) аль нэгийг өгнө үү"
      );
    const component = await requireCostComponentByCode(orgId, input.component);
    componentId = component.id;
    label = `${component.code} · ${component.name}`;
  }
  if (!date) throw new Error("Хуваарилалтын огноо (date) хэрэгтэй");
  if (!(totalAmount > 0))
    throw new Error("Хуваарилах дүн (totalAmount) 0-ээс их байх ёстой");

  let targets = (input.targets ?? []).map((target) => ({
    movementId: String(target.movementId ?? "").trim(),
    manualAmount:
      target.manualAmount != null ? Number(target.manualAmount) : undefined,
  }));
  if (targets.some((target) => !target.movementId))
    throw new Error("Зорилт бүрд movementId хэрэгтэй");
  if (targets.length > 0) {
    // Угтвар ID-г бүтэн болгоно — server action бүтэн UUID шаарддаг.
    const movements = await db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
      columns: { id: true },
      orderBy: [desc(inventoryMovements.createdAt)],
      limit: 1000,
    });
    targets = targets.map((target) => ({
      ...target,
      movementId: resolveByIdPrefix(
        movements,
        target.movementId,
        "орлогын хөдөлгөөн"
      ).id,
    }));
  }
  if (targets.length === 0) {
    if (!purchaseOrderId)
      throw new Error(
        "targets (хуваарилах орлогууд) өгнө үү — list_inventory_movements-ээс movementId авна"
      );
    const options = await loadPoAllocationTargets(purchaseOrderId);
    if (options.length === 0)
      throw new Error(
        "Хуваарилах баталгаажсан хүлээн авалт алга — эхлээд confirm_goods_receipt"
      );
    targets = options.map((option) => ({
      movementId: option.movementId,
      manualAmount: undefined,
    }));
  }
  if (base === "manual") {
    // Σ таарах шалгалт нь хуваарилах хөдөлгөгчид (allocate) — энд зөвхөн
    // дүн өгөгдсөн эсэх, сөрөг эсэхийг шалгана.
    if (targets.every((target) => target.manualAmount == null))
      throw new Error(
        "manual суурьд зорилт бүрд manualAmount өгнө (Σ нь хуваарилах дүнтэй ТААРНА)"
      );
    if (targets.some((target) => Number(target.manualAmount ?? 0) < 0))
      throw new Error("manual суурьд сөрөг дүн оруулж болохгүй");
  }

  const result = await createCostAllocation({
    date,
    costComponentId: componentId,
    totalAmount,
    allocationBase: base,
    description: input.description?.trim() || undefined,
    documentNo: input.documentNo?.trim() || undefined,
    sourceLineId,
    targets,
  });
  if (!result.ok)
    throw new Error(
      result.message ||
        (result.code === "unauthenticated"
          ? "Зардлын хуваарилалт хийхэд нягтлангийн эрх шаардлагатай"
          : `Хуваарилалт хадгалагдсангүй (${result.code})`)
    );
  return {
    resultText: `Зардлын хуваарилалт үүслээ: ${result.documentNo} · ${label} · ${ALLOCATION_BASE_LABELS[base]} · ${fmt(totalAmount)}₮ · ${result.lineCount} орлого — НООРОГ landed_cost бичилт (Dr барааны нөөц / Cr бараа материалын түр данс). post_cost_entries-ээр батална.`,
  };
}

async function runReverseCostAllocation(
  orgId: string,
  input: { allocationId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const allocation = await findCostAllocation(orgId, input.allocationId);
  assertPostLimit(Number(allocation.totalAmount));
  const result = await reverseCostAllocation({ allocationId: allocation.id });
  if (!result.ok)
    throw new Error(
      result.message ||
        (result.code === "unauthenticated"
          ? "Хуваарилалтыг буцаахад нягтлангийн эрх шаардлагатай"
          : `Хуваарилалт буцаагдсангүй (${result.code})`)
    );
  return {
    resultText: `Зардлын хуваарилалт БУЦААГДЛАА: ${allocation.documentNo}, ${fmt(Number(allocation.totalAmount))}₮ — батлагдсан бичилтүүд эсрэг журналаар буцаж, мөрийн хуваарилагдаагүй дүн сэргэв`,
  };
}

async function runGetLandedCostSummary(
  orgId: string,
  input: { purchaseOrderId: string }
): Promise<AiToolResult> {
  const order = await findPurchaseOrder(orgId, input.purchaseOrderId);
  const summary = unwrapAction(
    await getLandedCostSummary({ purchaseOrderId: order.id })
  );
  if (summary.items.length === 0)
    return {
      resultText: `${order.documentNo}: баталгаажсан хүлээн авалт алга — орлогдох өртөг тооцоогдоогүй (confirm_goods_receipt)`,
    };
  const lines = summary.items.map((item) => {
    const components =
      item.components.length > 0
        ? item.components
            .map((component) => `${component.name} ${fmt(component.amount)}₮`)
            .join(" + ")
        : "нэмэлт зардал алга";
    return `  ${item.itemCode} ${item.itemName} — ${fmt(item.quantity)} ш · худалдан авалт ${fmt(item.purchaseMnt)}₮ · ${components} → нийт ${fmt(item.landedTotal)}₮ · нэгжид ${fmt(item.unitLanded)}₮`;
  });
  const total = summary.items.reduce((sum, item) => sum + item.landedTotal, 0);
  return {
    resultText: [
      `ОРЛОГДОХ ӨРТӨГ — ${order.documentNo} (валют ${summary.currency}):`,
      ...lines,
      `НИЙТ: ${fmt(total)}₮`,
    ].join("\n"),
  };
}

/**
 * Core + custom/ tool-ийн нийлбэр — чат, OpenAI adapter, MCP, REST API
 * БҮГД энийг ашиглана (AI_TOOLS нь зөвхөн core). Lazy: custom/index.ts
 * core action-уудыг import хийдэг тул модулийн top-level-д дуудвал цикл үүснэ.
 */
let mergedTools: AiToolDef[] | null = null;
export function allAiTools(): AiToolDef[] {
  if (!mergedTools)
    mergedTools = [
      ...AI_TOOLS,
      ...customToolDefs(AI_TOOLS.map((tool) => tool.name)),
    ];
  return mergedTools;
}

/** Тухайн замд нээлттэй tools — surfaces өгөөгүй tool бүх замд (D4). */
export function aiToolsForSurface(surface: AiToolSurface): AiToolDef[] {
  return allAiTools().filter((tool) => !tool.surfaces || tool.surfaces.includes(surface));
}


// ── Мэдэгдэл (docs/notifications §4.6) ──────────────────────────────────────

async function runListNotifications(input: {
  unreadOnly?: boolean;
  limit?: number;
}): Promise<AiToolResult> {
  const { rows, unread } = await listNotifications({
    unreadOnly: input.unreadOnly ?? true,
    limit: Math.min(Math.max(Number(input.limit) || 20, 1), 100),
  });
  if (rows.length === 0)
    return {
      resultText:
        input.unreadOnly === false
          ? "Мэдэгдэл алга"
          : "Уншаагүй мэдэгдэл алга — анхаарах зүйл байхгүй",
    };
  const lines = rows.map((row) => {
    const mark = row.severity === "danger" ? "‼" : row.severity === "warning" ? "⚠" : "•";
    const when = row.createdAt.slice(0, 16).replace("T", " ");
    return (
      `${mark} [${row.id.slice(0, 8)}] ${when} · ${notificationTypeLabel(row.type)} · ${row.title}` +
      (row.body ? ` — ${row.body}` : "") +
      (row.readAt ? "" : " (уншаагүй)")
    );
  });
  return {
    resultText: `Уншаагүй нийт: ${unread}\n` + lines.join("\n"),
  };
}

async function runMarkNotificationsRead(input: {
  ids?: string[];
  all?: boolean;
}): Promise<AiToolResult> {
  if (input.all) {
    const n = await markAllNotificationsRead();
    return { resultText: `${n} мэдэгдэл уншсан гэж тэмдэглэгдлээ` };
  }
  const prefixes = (input.ids ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (prefixes.length === 0)
    throw new Error("[VALIDATION] ids эсвэл all=true өгнө");
  if (prefixes.some((prefix) => prefix.length < 6))
    throw new Error("[VALIDATION] ID нь бүтэн эсвэл 6+ тэмдэгтийн угтвар байна");
  // Угтварыг өөрийн inbox дотроос л тааруулна (org/user хамгаалалт server action-д).
  const { rows } = await listNotifications({ limit: 500 });
  const ids = rows
    .filter((row) => prefixes.some((prefix) => row.id.startsWith(prefix)))
    .map((row) => row.id);
  if (ids.length === 0) throw new Error("[NOT_FOUND] Ийм ID-тэй мэдэгдэл олдсонгүй");
  const n = await markNotificationsRead(ids);
  return { resultText: `${n} мэдэгдэл уншсан гэж тэмдэглэгдлээ` };
}

// ── Нэгдсэн диспетчер ───────────────────────────────────────────────────────

/**
 * Tool-ийг гүйцэтгэнэ. Алдааг ХЭЗЭЭ Ч шидэхгүй — модельд ойлгомжтой
 * монгол текстээр буцаана (модель засаад дахин оролдох эсвэл хэрэглэгчээс
 * тодруулах боломжтой).
 */
// ── POS гүйцэтгэгчид (docs/pos/00-proposal.md) — бүгд lib/actions/pos.ts-ийн
// server action-уудыг дуудна (шалгалт нэг газар); борлуулалт/буцаалт/ээлж
// хаалт нь GL-д шууд бичигддэг тул post горим + ≤10M.

async function findPosSale(orgId: string, idOrNo: string) {
  const query = idOrNo.trim();
  if (!query) throw codedError("SALE_NOT_FOUND", "Борлуулалтын дугаар эсвэл ID өгнө үү");
  const rows = await db.query.posSales.findMany({
    where: eq(posSales.organizationId, orgId),
    columns: { id: true, documentNo: true, isReturn: true, status: true, total: true, date: true },
    orderBy: [desc(posSales.soldAt)],
    limit: 1000,
  });
  const lower = query.toLowerCase();
  const byNo = rows.filter((row) => row.documentNo.toLowerCase() === lower);
  if (byNo.length === 1) return byNo[0];
  if (query.length >= 6) {
    const byId = rows.filter((row) => row.id.startsWith(lower));
    if (byId.length === 1) return byId[0];
    if (byId.length > 1)
      throw codedError("SALE_AMBIGUOUS", `"${query}" угтвартай ${byId.length} борлуулалт таарлаа — бүтэн ID өгнө үү`);
  }
  throw codedError("SALE_NOT_FOUND", `"${query}" борлуулалт олдсонгүй (сүүлийн 1000 баримтаас хайв) — list_pos_sales-ээр шалгана уу`);
}

async function posShiftFor(orgId: string, warehouseCode?: string, shiftRef?: string) {
  const shifts = await loadShiftViews(orgId, { openOnly: true });
  if (shifts.length === 0)
    throw codedError("NO_OPEN_SHIFT", "Нээлттэй кассын ээлж алга — эхлээд open_pos_shift-ээр ээлж нээнэ үү");
  if (shiftRef?.trim()) {
    const query = shiftRef.trim().toLowerCase();
    const hit = shifts.find((shift) => shift.documentNo.toLowerCase() === query || shift.id.startsWith(query));
    if (!hit) throw codedError("SHIFT_NOT_FOUND", `"${shiftRef}" нээлттэй ээлж олдсонгүй`);
    return hit;
  }
  if (warehouseCode?.trim()) {
    const warehouse = await db.query.warehouses.findFirst({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, warehouseCode.trim())),
      columns: { id: true },
    });
    const hit = warehouse ? shifts.find((shift) => shift.warehouseId === warehouse.id) : undefined;
    if (hit) return hit;
  }
  if (shifts.length === 1) return shifts[0];
  throw codedError(
    "SHIFT_AMBIGUOUS",
    `${shifts.length} нээлттэй ээлж байна: ${shifts.map((shift) => `${shift.documentNo} (${shift.cashAccountName} · ${shift.warehouseName})`).join(", ")} — shift эсвэл warehouseCode-оор заана уу`
  );
}

async function runGetPosStatus(orgId: string): Promise<AiToolResult> {
  // SIM2-018: ensurePosSettings default хэлбэрүүдийг (CASH, CREDIT) seed хийдэг —
  // ДАРАА нь уншина (зэрэг уншвал эхний дуудлагад жагсаалт хоосон гардаг байв).
  const settings = await ensurePosSettings(orgId);
  const [methods, shifts, vat, ewallet] = await Promise.all([
    loadPaymentMethodViews(orgId),
    loadShiftViews(orgId, { openOnly: true }),
    loadVatSettings(orgId),
    loadEwalletSettlementContext(orgId),
  ]);
  const unsettledEwallet = ewallet.methods.filter((method) => method.openReceipts.length > 0);
  const issueType = settings.issueTypeId
    ? ((await db.query.inventoryIssueTypes.findFirst({
        where: and(
          eq(inventoryIssueTypes.organizationId, orgId),
          eq(inventoryIssueTypes.id, settings.issueTypeId)
        ),
        columns: { name: true, debitAccountSource: true, debitAccountNumber: true },
      })) ?? null)
    : null;
  const issueTypeWarning = posIssueTypeWarning(issueType);
  const lines = [
    ...(issueTypeWarning ? [`⚠ ${issueTypeWarning}`] : []),
    `НӨАТ төлөгч: ${vat.isVatPayer ? "тийм (үнэ НӨАТ орсон)" : "үгүй (НӨАТ мөр үүсэхгүй)"}`,
    ...(vat.isVatPayer
      ? [
          `НӨАТ-гүй борлуулалтын данс: ${
            settings.nonVatRevenueAccountNumber && settings.nonVatReceivableAccountNumber
              ? `орлого ${settings.nonVatRevenueAccountNumber} · авлага ${settings.nonVatReceivableAccountNumber}`
              : "тохируулаагүй — НӨАТ-гүй борлуулалт хийгдэхгүй (update_pos_settings nonVatRevenueAccount / nonVatReceivableAccount)"
          }`,
        ]
      : []),
    `Урьдчилсан COGS: ${settings.provisionalCogs ? "асаалттай" : "унтраалттай"} · Хасах үлдэгдэл: ${settings.allowNegativeStock ? "зөвшөөрнө (мэдэгдэлтэй)" : "хориглоно"} · Хөнгөлөлт: гар max ${Number(settings.maxManualDiscountPercent)}%, нийт max ${Number(settings.maxTotalDiscountPercent)}%, ${settings.discountStacking} · Бөөрөнхийлөл ${settings.cashRoundingUnit}₮`,
    `Нээлттэй ээлж (${shifts.length}): ${
      shifts.length
        ? shifts.map((shift) => `${shift.documentNo} · ${shift.cashAccountName} · ${shift.warehouseName} · эхний ${fmt(shift.openingFloat)}₮ · борлуулалт ${shift.salesCount} (${fmt(shift.salesTotal)}₮)`).join("\n  ")
        : "байхгүй — open_pos_shift"
    }`,
    `eBarimt: ${
      settings.ebarimtEnabled
        ? `автомат (${settings.ebarimtMode === "browser" ? "кассын PC" : "сервер"}), ТТД ${settings.ebarimtMerchantTin || "?"} · салбар ${settings.ebarimtBranchNo || "?"} · касс ${settings.ebarimtPosNo || "?"}`
        : "унтраалттай — ДДТД гараар (get_ebarimt_status)"
    }`,
    `Төлбөрийн хэлбэр: ${methods
      .filter((method) => method.isActive)
      // SIM2-017: хэлбэр бүрийн ӨӨРИЙН нэр (ижил төрлийн CASH / CASH2 ялгагдана).
      .map((method) => `${method.code} «${method.name}» (${PAYMENT_KIND_LABELS[method.kind]}${method.cashAccountName ? ` → ${method.cashAccountName}` : ""}${method.currency !== "MNT" ? `, ${method.currency}` : ""}${method.requiresReference ? ", лавлах заавал" : ""})`)
      .join(", ")}`,
    ...(unsettledEwallet.length
      ? [
          `Э-хэтэвчийн түр данс тулгагдаагүй: ${unsettledEwallet
            .map((method) => `${method.methodName} → «${method.cashAccountName}» ${fmt(method.openReceipts.reduce((sum, receipt) => sum + receipt.amount, 0))}₮ (${method.openReceipts.length} орлого${method.feePercent != null ? `, шимтгэл ${method.feePercent}%` : ", feePercent тохируулаагүй"})`)
            .join("; ")} — провайдер банкинд шилжүүлмэгц import_bank_statement мөрд ewalletSettlement=true (шимтгэлийн данс ${ewallet.feeAccountNumber})`,
        ]
      : []),
  ];
  return { resultText: lines.join("\n") };
}

async function runUpdatePosSettings(
  orgId: string,
  input: {
    allowNegativeStock?: boolean;
    provisionalCogs?: boolean;
    discountPosting?: "net" | "contra";
    discountStacking?: "best_single" | "cumulative";
    maxManualDiscountPercent?: number;
    maxTotalDiscountPercent?: number;
    cashRoundingUnit?: number;
    receiptHeader?: string;
    receiptFooter?: string;
    revenueAccount?: string;
    discountAccount?: string;
    giftCardLiabilityAccount?: string;
    storeCreditLiabilityAccount?: string;
    customerAdvanceAccount?: string;
    cashOverAccount?: string;
    cashShortAccount?: string;
    roundingAccount?: string;
    nonVatRevenueAccount?: string;
    nonVatReceivableAccount?: string;
    ewalletFeeAccount?: string;
  }
): Promise<AiToolResult> {
  const before = await ensurePosSettings(orgId);
  const ctx = await accountContext(orgId);
  // Данс нь нэрээр ч өгөгдөж болно — paste/Excel-тэй ИЖИЛ resolve (§9a).
  const account = (value?: string) =>
    value?.trim() ? resolveAccount(value, ctx).main : undefined;
  const patch = {
    allowNegativeStock: input.allowNegativeStock,
    provisionalCogs: input.provisionalCogs,
    discountPosting: input.discountPosting,
    discountStacking: input.discountStacking,
    maxManualDiscountPercent:
      input.maxManualDiscountPercent == null ? undefined : String(input.maxManualDiscountPercent),
    maxTotalDiscountPercent:
      input.maxTotalDiscountPercent == null ? undefined : String(input.maxTotalDiscountPercent),
    cashRoundingUnit: input.cashRoundingUnit,
    receiptHeader: input.receiptHeader,
    receiptFooter: input.receiptFooter,
    revenueAccountNumber: account(input.revenueAccount),
    discountAccountNumber: account(input.discountAccount),
    giftCardLiabilityAccountNumber: account(input.giftCardLiabilityAccount),
    storeCreditLiabilityAccountNumber: account(input.storeCreditLiabilityAccount),
    customerAdvanceAccountNumber: account(input.customerAdvanceAccount),
    cashOverAccountNumber: account(input.cashOverAccount),
    cashShortAccountNumber: account(input.cashShortAccount),
    roundingAccountNumber: account(input.roundingAccount),
    nonVatRevenueAccountNumber: account(input.nonVatRevenueAccount),
    nonVatReceivableAccountNumber: account(input.nonVatReceivableAccount),
    ewalletFeeAccountNumber: account(input.ewalletFeeAccount),
  };
  const given = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (given.length === 0)
    throw new Error("Өөрчлөх талбар өгөөгүй байна — get_pos_status-оос одоогийн утгыг харна уу");
  const { settings } = unwrapAction(
    await updatePosSettings(Object.fromEntries(given) as Parameters<typeof updatePosSettings>[0])
  );
  const changed: string[] = [];
  if (input.allowNegativeStock != null && before.allowNegativeStock !== settings.allowNegativeStock)
    changed.push(
      `Хасах үлдэгдэл: ${settings.allowNegativeStock ? "ЗӨВШӨӨРНӨ — үлдэгдэлгүй бараа зарагдвал сарын өртөг тооцогдохгүй, сар хаалт блоклогдоно" : "ХОРИГЛОНО"}`
    );
  if (input.provisionalCogs != null && before.provisionalCogs !== settings.provisionalCogs)
    changed.push(`Урьдчилсан COGS: ${settings.provisionalCogs ? "асаалттай" : "унтраалттай"}`);
  return {
    resultText: `POS тохиргоо шинэчлэгдлээ (${given.length} талбар).${changed.length ? ` ${changed.join("; ")}` : ""}`,
  };
}

async function runSavePosPaymentMethod(
  orgId: string,
  input: {
    code: string;
    name?: string;
    kind?: string;
    cashAccount?: string;
    ebarimtCode?: string;
    provider?: string;
    requiresReference?: boolean;
    allowsRefund?: boolean;
    isActive?: boolean;
    sortOrder?: number;
    feePercent?: number;
  }
): Promise<AiToolResult> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw codedError("VALIDATION", "Хэлбэрийн код оруулна уу");
  const methods = await loadPaymentMethodViews(orgId);
  const existing = methods.find((method) => method.code === code) ?? null;
  if (!existing && !input.name?.trim())
    throw codedError("VALIDATION", `"${code}" хэлбэр байхгүй — шинээр үүсгэхэд name ЗААВАЛ`);
  const kind = (input.kind?.trim() || existing?.kind) as PaymentKind | undefined;
  if (!kind || !PAYMENT_KINDS.includes(kind))
    throw codedError("VALIDATION", `Төлбөрийн төрөл буруу — ${PAYMENT_KINDS.join(" | ")}`);

  // Касс/банк/түр дансыг НЭРЭЭР олно — ID таамаглахгүй (лавлах дүрэм).
  let cashAccountId = existing?.cashAccountId ?? null;
  if (input.cashAccount?.trim()) {
    const accounts = await db.query.cashAccounts.findMany({
      where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
      columns: { id: true, name: true },
    });
    cashAccountId = requireSingle(
      nameMatches(accounts, (entry) => entry.name, input.cashAccount),
      (entry) => entry.name,
      "касс/банкны данс",
      input.cashAccount
    ).id;
  }

  const savedName = input.name?.trim() || existing?.name || code;
  // SIM2-017: ижил нэртэй идэвхтэй хэлбэр — анхааруулга.
  const duplicate = methods.find(
    (method) => method.code !== code && method.isActive && method.name.trim().toLowerCase() === savedName.toLowerCase()
  );
  unwrapAction(
    await savePaymentMethod({
      id: existing?.id ?? null,
      code,
      name: savedName,
      kind,
      cashAccountId,
      requiresReference: input.requiresReference ?? existing?.requiresReference ?? false,
      allowsChange: existing?.allowsChange ?? true,
      allowsRefund: input.allowsRefund ?? existing?.allowsRefund ?? true,
      feePercent: input.feePercent ?? existing?.feePercent ?? null,
      ebarimtCode:
        input.ebarimtCode === undefined ? (existing?.ebarimtCode ?? null) : input.ebarimtCode.trim() || null,
      provider: input.provider === undefined ? (existing?.provider ?? null) : input.provider.trim() || null,
      isActive: input.isActive ?? existing?.isActive ?? true,
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
    })
  );
  return {
    resultText: `${existing ? "Шинэчлэгдлээ" : "Үүслээ"}: ${code} «${savedName}» · ${PAYMENT_KIND_LABELS[kind]}${
      input.ebarimtCode ? ` · eBarimt ${input.ebarimtCode.trim().toUpperCase()}` : ""
    }${input.isActive === false ? " · ИДЭВХГҮЙ" : ""}${
      duplicate ? `\n⚠ «${savedName}» нэртэй өөр идэвхтэй хэлбэр (${duplicate.code}) бий — кассчин ялгахгүй, нэрийг өөрчилнө үү` : ""
    }`,
  };
}

async function runDeletePosPaymentMethod(
  orgId: string,
  input: { code: string }
): Promise<AiToolResult> {
  const code = input.code.trim().toUpperCase();
  const methods = await loadPaymentMethodViews(orgId);
  const method = methods.find((entry) => entry.code === code);
  if (!method) throw codedError("NOT_FOUND", `"${input.code}" төлбөрийн хэлбэр олдсонгүй`);
  const { deactivated } = unwrapAction(await deletePaymentMethod(method.id));
  return {
    resultText: deactivated
      ? `${code} (${method.name}) нь түүхэн борлуулалтад ашиглагдсан тул устгаагүй — ИДЭВХГҮЙ болголоо (тайлан, баримт хэвээр)`
      : `${code} (${method.name}) төлбөрийн хэлбэр устлаа`,
  };
}

async function runOpenPosShift(
  orgId: string,
  input: { cashAccount: string; warehouseCode: string; openingFloat?: number; fxRates?: Record<string, number>; note?: string }
): Promise<AiToolResult> {
  const [accounts, warehouse] = await Promise.all([
    db.query.cashAccounts.findMany({
      where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
      columns: { id: true, name: true, accountType: true, currency: true },
    }),
    db.query.warehouses.findFirst({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, input.warehouseCode.trim()), eq(warehouses.isActive, true)),
      columns: { id: true, name: true },
    }),
  ]);
  if (!warehouse) throw codedError("WAREHOUSE_NOT_FOUND", `"${input.warehouseCode}" агуулах олдсонгүй`);
  const account = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "кассын данс",
    input.cashAccount,
    { codePrefix: "CASH_ACCOUNT", allNames: accounts.map((entry) => entry.name) }
  );
  const result = unwrapAction(
    await openShift({
      cashAccountId: account.id,
      warehouseId: warehouse.id,
      openingFloat: Number(input.openingFloat ?? 0),
      fxRates: input.fxRates,
      note: input.note,
    })
  );
  return {
    resultText: `Ээлж нээгдлээ: ${result.documentNo} · ${account.name} · ${warehouse.name} · эхний мөнгө ${fmt(Number(input.openingFloat ?? 0))}₮`,
  };
}

async function runClosePosShift(
  orgId: string,
  input: { shift?: string; countedCash: number; note?: string; confirmLargeVariance?: boolean },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const shift = await posShiftFor(orgId, undefined, input.shift);
  const expected = Math.round((shift.openingFloat + shift.cashReceipts - shift.cashRefunds) * 100) / 100;
  assertPostLimit(Math.abs(Number(input.countedCash) - expected));
  const result = unwrapAction(
    await closeShift(shift.id, {
      countedCash: Number(input.countedCash),
      note: input.note,
      confirmLargeVariance: input.confirmLargeVariance === true,
    })
  );
  return {
    resultText: `Ээлж ${shift.documentNo} хаагдлаа. Систем ${fmt(result.systemCash)}₮, тоолсон ${fmt(Number(input.countedCash))}₮, зөрүү ${fmt(result.variance)}₮${
      Math.abs(result.variance) >= 0.01 ? ` (${result.variance > 0 ? "илүүдэл" : "дутагдал"} — кассын баримт бичигдэв)` : ""
    }. Борлуулалт ${shift.salesCount} (${fmt(shift.salesTotal)}₮), буцаалт ${fmt(shift.returnsTotal)}₮.${
      // Хэлбэрээр задаргаа — «систем 3,780 vs тоолсон 0» зөрүү QPay/карт/зээлээс
      // үүссэн эсэх нь хариунаас шууд харагдана (D9-ийн дараах SIM).
      shift.paymentsByMethod.length > 0
        ? ` Төлбөрийн хэлбэрээр: ${shift.paymentsByMethod.map((method) => `${method.code} ${fmt(method.amount)}₮`).join(" · ")}.`
        : ""
    }`,
  };
}

async function posItemByCode(orgId: string, code: string) {
  const query = code.trim();
  const item = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.organizationId, orgId),
      eq(inventoryItems.isActive, true),
      or(eq(inventoryItems.code, query), eq(inventoryItems.barcode, query))
    ),
    columns: { id: true, code: true, name: true, salesPrice: true },
  });
  if (!item) throw codedError("ITEM_NOT_FOUND", `"${code}" кодтой/баркодтой идэвхтэй бараа олдсонгүй — list_inventory-оор шалгана уу`);
  return item;
}

async function posMethodByRef(orgId: string, ref: string) {
  const methods = (await loadPaymentMethodViews(orgId)).filter((method) => method.isActive);
  const query = ref.trim().toLowerCase();
  const byCode = methods.filter((method) => method.code.toLowerCase() === query);
  if (byCode.length === 1) return byCode[0];
  return requireSingle(nameMatches(methods, (entry) => entry.name, ref), (entry) => `${entry.code} ${entry.name}`, "төлбөрийн хэлбэр", ref, {
    codePrefix: "PAYMENT_METHOD",
    allNames: methods.map((entry) => `${entry.code} (${entry.name})`),
  });
}

async function runCreatePosSale(
  orgId: string,
  input: {
    lines: { itemCode: string; quantity: number; unitPrice?: number; discountPercent?: number; discountAmount?: number }[];
    payments: { method: string; amount: number; reference?: string; giftCardCode?: string }[];
    customer?: string;
    warehouseCode?: string;
    couponCodes?: string[];
    receiptDiscountPercent?: number;
    receiptDiscountAmount?: number;
    note?: string;
    ebarimtId?: string;
    managerApproval?: boolean;
    consumerNo?: string;
    customerTin?: string;
    customerRegNo?: string;
    skipEbarimt?: boolean;
    nonVat?: boolean;
    nonVatReason?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error("Борлуулах бараа өгнө үү");
  const shift = await posShiftFor(orgId, input.warehouseCode);
  let counterpartyId: string | null = null;
  if (input.customer?.trim()) {
    const cpList = await db.query.counterparties.findMany({
      where: and(eq(counterparties.organizationId, orgId), eq(counterparties.isActive, true)),
      columns: { id: true, name: true, counterpartyType: true },
    });
    const customer = requireSingle(
      nameMatches(cpList.filter((cp) => cp.counterpartyType !== "supplier"), (entry) => entry.name, input.customer),
      (entry) => entry.name,
      "харилцагч",
      input.customer,
      { codePrefix: "COUNTERPARTY", allNames: cpList.map((entry) => entry.name) }
    );
    counterpartyId = customer.id;
  }
  const lines: SaleLineInput[] = [];
  for (const line of input.lines) {
    const item = await posItemByCode(orgId, line.itemCode);
    lines.push({
      itemId: item.id,
      quantity: Number(line.quantity),
      unitPrice: line.unitPrice == null ? null : Number(line.unitPrice),
      manualDiscountPercent: line.discountPercent == null ? null : Number(line.discountPercent),
      manualDiscountAmount: line.discountAmount == null ? null : Number(line.discountAmount),
    });
  }
  const quoteInput: SaleQuoteInput = {
    counterpartyId,
    lines,
    couponCodes: input.couponCodes ?? [],
    receiptDiscountPercent: input.receiptDiscountPercent ?? null,
    receiptDiscountAmount: input.receiptDiscountAmount ?? null,
    nonVat: input.nonVat === true,
    nonVatReason: input.nonVatReason ?? null,
  };
  const { quote } = unwrapAction(await quotePosSale(quoteInput));
  assertPostLimit(quote.total);
  // ENT-054: эзэн/менежерийн token-той агент pos:post эрхтэй тул хязгаарыг
  // ЧИМЭЭГҮЙ давдаг байв — AI-аас ирсэн бол ИЛ зөвшөөрөл шаардана.
  if (quote.approvalReasons.length > 0 && input.managerApproval !== true)
    throw codedError(
      "APPROVAL_REQUIRED",
      `Менежерийн зөвшөөрөл шаардлагатай: ${quote.approvalReasons.join("; ")} — хэрэглэгчээс ИЛ асууж, зөвшөөрвөл managerApproval: true-гээр дахин дуудна`
    );
  const payments: PaymentInput[] = [];
  for (const payment of input.payments ?? []) {
    const method = await posMethodByRef(orgId, payment.method);
    payments.push({
      paymentMethodId: method.id,
      amount: Number(payment.amount),
      reference: payment.reference ?? null,
      giftCardCode: payment.giftCardCode ?? null,
    });
  }
  const warehouseId = input.warehouseCode?.trim()
    ? (
        await db.query.warehouses.findFirst({
          where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, input.warehouseCode.trim())),
          columns: { id: true },
        })
      )?.id ?? null
    : null;
  const result = unwrapAction(
    await createPosSale({
      ...quoteInput,
      shiftId: shift.id,
      warehouseId,
      payments,
      note: input.note ?? null,
      ebarimtId: input.ebarimtId ?? null,
      ebarimtConsumerNo: input.consumerNo ?? null,
      ebarimtCustomerTin: input.customerTin ?? null,
      ebarimtCustomerRegNo: input.customerRegNo ?? null,
      skipEbarimt: input.skipEbarimt === true,
    })
  );
  const receipt = result.receipt;
  // Аудит M: AI/MCP/REST-ийн ИЛ managerApproval нь хүний шийдвэрийг орлох тул
  // аудитын мөрд ТУСДАА үлдэнэ (эрхтэй token-ий эзэн хэн болохыг хамт).
  if (quote.approvalReasons.length > 0) {
    const { userId } = await getActiveOrg();
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "manager_approval",
      entityType: "pos_sale",
      entityId: result.id,
      summary: `POS борлуулалт ${receipt.documentNo}${approvalAuditNote(quote.approvalReasons, "ai")}`,
    });
  }
  const text = [
    `Борлуулалт ${receipt.documentNo} бүртгэгдлээ (${receipt.date}, ээлж ${shift.documentNo}).`,
    ...receipt.lines.map((line) => `  ${line.name} × ${line.quantity} × ${fmt(line.unitPrice)}${line.discount ? ` − хөнг. ${fmt(line.discount)}` : ""} = ${fmt(line.total)}₮`),
    `Нийт ${fmt(receipt.grossAmount)}₮ · хөнгөлөлт ${fmt(receipt.discountTotal)}₮ · цэвэр ${fmt(receipt.netAmount)}₮ · НӨАТ ${fmt(receipt.vatAmount)}₮${receipt.roundingAmount ? ` · бөөрөнхийлөл ${fmt(receipt.roundingAmount)}₮` : ""} · ТӨЛӨХ ${fmt(receipt.total)}₮`,
    `Төлбөр: ${receipt.payments.map((payment) => `${payment.name} ${fmt(payment.baseAmount)}₮${payment.change ? ` (хариулт ${fmt(payment.change)}₮)` : ""}`).join(", ")}`,
    quote.approvalReasons.length ? `Менежерийн зөвшөөрлөөр: ${quote.approvalReasons.join("; ")}` : "",
    receipt.negativeStock.length
      ? `⚠ Хасах үлдэгдэл: ${receipt.negativeStock.map((entry) => `${entry.itemName} (${entry.warehouseName}) ${entry.balanceAfter}`).join(", ")} — орлого/тооллого бүртгэтэл сар хаагдахгүй`
      : "",
    receipt.ebarimtStatus === "pending"
      ? "eBarimt: ТЕГ рүү илгээгдэж байна — ДДТД хэдхэн секундын дараа баримтад гарна (get_ebarimt_status)."
      : receipt.ebarimtStatus === "skipped"
        ? "eBarimt: илгээгээгүй (skipEbarimt) — шаардлагатай бол resend_ebarimt-ээр илгээнэ."
      : receipt.ebarimtId
        ? `eBarimt ДДТД: ${receipt.ebarimtId}${receipt.ebarimtLottery ? ` · сугалаа ${receipt.ebarimtLottery} (зөвхөн энэ мөчид — хадгалагдахгүй)` : ""}`
        : "",
    "GL: Dr Авлага / Cr Орлого (+НӨАТ); төлбөр бүрд Dr Касс|түр данс / Cr Авлага; урьдчилсан Dr COGS / Cr Бараа (сар хаалтад залруулагдана).",
  ].filter(Boolean);
  return {
    resultText: text.join("\n"),
    action: { kind: "pos_sale", id: result.id, title: `${receipt.documentNo} · ${fmt(receipt.total)}₮`, status: "posted" },
  };
}

async function runReturnPosSale(
  orgId: string,
  input: { sale: string; lines?: { itemCode: string; quantity: number }[]; reason: string; refundMethod?: string; storeCredit?: boolean },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const found = await findPosSale(orgId, input.sale);
  const { sale } = unwrapAction(await getPosSaleDetail(found.id));
  const requested: { lineId: string; quantity: number }[] = [];
  if (Array.isArray(input.lines) && input.lines.length > 0) {
    for (const request of input.lines) {
      const code = request.itemCode.trim().toLowerCase();
      const line = sale.lines.find((entry) => entry.itemCode.toLowerCase() === code);
      if (!line) throw codedError("LINE_NOT_FOUND", `${sale.documentNo}-д "${request.itemCode}" бараа алга`);
      requested.push({ lineId: line.id, quantity: Number(request.quantity) });
    }
  } else
    for (const line of sale.lines) {
      const remaining = line.quantity - line.returnedQty;
      if (remaining > 0) requested.push({ lineId: line.id, quantity: remaining });
    }
  if (requested.length === 0) throw new Error("Буцаах мөр алга — бүгд буцаагдсан байна");
  const refundTotal = requested.reduce((sum, request) => {
    const line = sale.lines.find((entry) => entry.id === request.lineId)!;
    return sum + (line.lineTotal * request.quantity) / line.quantity;
  }, 0);
  assertPostLimit(refundTotal);
  let refunds: PaymentInput[] = [];
  if (!input.storeCredit) {
    let method = input.refundMethod?.trim() ? await posMethodByRef(orgId, input.refundMethod) : null;
    if (!method) {
      const methods = (await loadPaymentMethodViews(orgId)).filter((entry) => entry.isActive && entry.allowsRefund);
      const originalCash = sale.payments.find((payment) => payment.kind === "cash");
      method = methods.find((entry) => entry.id === originalCash?.methodId) ?? methods.find((entry) => entry.kind === "cash") ?? null;
    }
    if (!method) throw codedError("REFUND_METHOD_REQUIRED", "Буцаан олгох хэлбэр олдсонгүй — refundMethod өгнө үү");
    refunds = [{ paymentMethodId: method.id, amount: Math.round(refundTotal * 100) / 100 }];
  }
  const result = unwrapAction(
    await returnPosSale({ saleId: sale.id, lines: requested, reason: input.reason, refunds, storeCredit: !!input.storeCredit })
  );
  return {
    resultText: `Буцаалт ${result.documentNo} бүртгэгдлээ ← ${sale.documentNo}: ${fmt(result.refundTotal)}₮ ${input.storeCredit ? "дэлгүүрийн кредитээр" : "буцаан олгов"}. GL: Dr Орлого (+НӨАТ) / Cr Авлага; return_in хөдөлгөөн; урьдчилсан COGS урвуу.`,
    action: { kind: "pos_sale", id: result.id, title: `${result.documentNo} · буцаалт ${fmt(result.refundTotal)}₮`, status: "posted" },
  };
}

async function runListPosSales(
  orgId: string,
  input: { from?: string; to?: string; status?: string; customer?: string; limit?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
  let counterpartyId: string | undefined;
  if (input.customer?.trim()) {
    const cpList = await db.query.counterparties.findMany({
      where: eq(counterparties.organizationId, orgId),
      columns: { id: true, name: true },
    });
    counterpartyId = requireSingle(nameMatches(cpList, (entry) => entry.name, input.customer), (entry) => entry.name, "харилцагч", input.customer, {
      codePrefix: "COUNTERPARTY",
      allNames: cpList.map((entry) => entry.name),
    }).id;
  }
  const sales = await loadSaleViews(orgId, { from: input.from, to: input.to, status: input.status, counterpartyId, limit });
  if (sales.length === 0) return { resultText: "Борлуулалт олдсонгүй" };
  return {
    resultText: sales
      .map(
        (sale) =>
          `${sale.date} ${sale.soldAt.slice(11, 16)} · ${sale.documentNo}${sale.isReturn ? ` (буцаалт ← ${sale.originalSaleNo})` : ""} · ${sale.counterpartyName} · ${sale.lineCount} мөр · ${fmt(sale.total)}₮ · ${sale.paymentSummary} · ${SALE_STATUS_LABELS[sale.status] ?? sale.status} · ID ${sale.id.slice(0, 8)}`
      )
      .join("\n"),
  };
}

async function runGetPosSale(orgId: string, input: { sale: string }): Promise<AiToolResult> {
  const found = await findPosSale(orgId, input.sale);
  const { sale } = unwrapAction(await getPosSaleDetail(found.id));
  const lines = [
    `${sale.documentNo}${sale.isReturn ? ` (буцаалт ← ${sale.originalSaleNo}: ${sale.returnReason ?? ""})` : ""} · ${sale.date} · ${sale.warehouseName} · ${sale.counterpartyName} · кассчин ${sale.cashierName} · ${SALE_STATUS_LABELS[sale.status] ?? sale.status}`,
    ...sale.lines.map(
      (line) =>
        `  ${line.itemCode} ${line.itemName} × ${line.quantity} × ${fmt(line.unitPrice)} − хөнг. ${fmt(line.discountAmount)}${line.discountDetail.length ? ` [${line.discountDetail.map((detail) => `${detail.ruleCode ?? detail.kind} ${fmt(detail.amount)}`).join(", ")}]` : ""} = цэвэр ${fmt(line.netAmount)} + НӨАТ ${fmt(line.vatAmount)} = ${fmt(line.lineTotal)}₮${line.returnedQty ? ` · буцаасан ${line.returnedQty}` : ""} · урьдчилсан COGS ${line.provisionalCost == null ? "—" : fmt(line.provisionalCost)}`
    ),
    `Нийт ${fmt(sale.grossAmount)} · хөнгөлөлт ${fmt(sale.discountTotal)} · цэвэр ${fmt(sale.netAmount)} · НӨАТ ${fmt(sale.vatAmount)} · төлөх ${fmt(sale.total)}₮`,
    `Төлбөр: ${sale.payments.map((payment) => `${payment.methodName} ${fmt(payment.baseAmount)}${payment.changeGiven ? ` (хариулт ${fmt(payment.changeGiven)})` : ""}${payment.reference ? ` реф ${payment.reference}` : ""}`).join(", ") || "—"}`,
    `АР нэхэмжлэх: ${sale.arApDocumentNo ?? "—"} (${sale.arApStatus ?? "—"}) · журнал ${sale.voucherIds.length} · буцаалт: ${sale.returns.map((ret) => `${ret.documentNo} ${fmt(ret.total)}₮`).join(", ") || "—"}${sale.ebarimtId ? ` · eBarimt ${sale.ebarimtId}` : ""}`,
    `eBarimt: ${sale.ebarimtStatus ? EBARIMT_STATUS_LABELS[sale.ebarimtStatus as EbarimtStatus] ?? sale.ebarimtStatus : "илгээгдээгүй"}${sale.ebarimtDate ? ` · ${sale.ebarimtDate}` : ""}${sale.ebarimtCustomerTin ? ` · худалдан авагч ТТД ${sale.ebarimtCustomerTin}` : sale.ebarimtConsumerNo ? ` · иргэн ${sale.ebarimtConsumerNo}` : ""}`,
  ];
  return { resultText: lines.join("\n") };
}

async function runGetPosSalesReport(
  orgId: string,
  input: { from: string; to: string; groupBy?: string; warehouseCode?: string; limit?: number }
): Promise<AiToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to))
    throw new Error("Огноо YYYY-MM-DD хэлбэртэй байна");
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 200);
  let warehouseId: string | undefined;
  if (input.warehouseCode?.trim()) {
    const warehouse = await db.query.warehouses.findFirst({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, input.warehouseCode.trim())),
      columns: { id: true },
    });
    if (!warehouse) throw codedError("WAREHOUSE_NOT_FOUND", `"${input.warehouseCode}" агуулах олдсонгүй`);
    warehouseId = warehouse.id;
  }
  const report = await loadSalesReport(orgId, { from: input.from, to: input.to, warehouseId });
  const summary = summarize(report.lines);
  const header = `${input.from} … ${input.to}: борлуулалт ${summary.salesCount} (буцаалт ${summary.returnsCount}) · нийт ${fmt(summary.gross)} · хөнгөлөлт ${fmt(summary.discount)} · цэвэр ${fmt(summary.net)} · НӨАТ ${fmt(summary.vat)} · төлөх ${fmt(summary.total)}₮ · дундаж чек ${fmt(summary.averageTicket)}₮ · COGS ${summary.cogs == null ? "—" : fmt(summary.cogs)} · ахиуц ${summary.margin == null ? "—" : `${fmt(summary.margin)}₮ (${summary.marginPercent}%)`} [${COGS_BASIS_LABELS[summary.cogsBasis]}]`;
  const groupBy = input.groupBy ?? "summary";
  const money = (value: number | null) => (value == null ? "—" : fmt(value));
  const rowText = (row: AggRow) =>
    `${row.label}${row.sublabel ? ` (${row.sublabel})` : ""} · чек ${row.count} · тоо ${row.quantity} · нийт ${fmt(row.gross)} · хөнг. ${fmt(row.discount)} · цэвэр ${fmt(row.net)} · НӨАТ ${fmt(row.vat)} · төлөх ${fmt(row.total)} · COGS ${money(row.cogs)} · ахиуц ${money(row.margin)}${row.marginPercent == null ? "" : ` (${row.marginPercent}%)`}${row.cogsBasis !== "final" ? ` [${COGS_BASIS_LABELS[row.cogsBasis]}]` : ""}`;
  let body: string[] = [];
  switch (groupBy) {
    case "item":
      body = aggregateBy(report.lines, (line) => ({ key: line.itemId, label: `${line.itemCode} ${line.itemName}`, sublabel: line.categoryCode ?? undefined })).slice(0, limit).map(rowText);
      break;
    case "day":
      body = aggregateBy(report.lines, (line) => ({ key: line.date, label: line.date })).sort((a, b) => a.label.localeCompare(b.label)).slice(0, limit).map(rowText);
      break;
    case "cashier":
      body = aggregateBy(report.lines, (line) => ({ key: line.cashierName, label: line.cashierName })).slice(0, limit).map(rowText);
      break;
    case "customer":
      body = aggregateBy(report.lines, (line) => ({ key: line.counterpartyId, label: line.counterpartyName, sublabel: line.customerGroup ?? undefined })).slice(0, limit).map(rowText);
      break;
    case "rule":
      body = aggregateBy(
        report.lines.filter((line) => line.discountRules.length > 0),
        (line) => ({ key: line.discountRules.join("+"), label: line.discountRules.join(" + ") })
      ).slice(0, limit).map(rowText);
      break;
    case "method":
      body = aggregatePayments(report.payments).slice(0, limit).map((row) => `${row.methodName} (${PAYMENT_KIND_LABELS[row.kind]}) · гүйлгээ ${row.count} · ${fmt(row.amount)}₮`);
      break;
    default:
      body = aggregatePayments(report.payments).map((row) => `  ${row.methodName}: ${fmt(row.amount)}₮`);
  }
  return { resultText: [header, ...body].join("\n") };
}

// ── eBarimt 3.0 ─────────────────────────────────────────────────────────────

async function runGetEbarimtStatus(orgId: string): Promise<AiToolResult> {
  const settings = await ensurePosSettings(orgId);
  const [status, readiness] = await Promise.all([
    ebarimtStatusWithPosApi(orgId, settings, todayInUlaanbaatar()),
    loadEbarimtReadiness(orgId),
  ]);
  const problems = ebarimtSettingsProblems(settingsInputOf(settings));
  const lines = [
    `eBarimt автомат илгээлт: ${status.enabled ? `АСААЛТТАЙ (${status.mode === "browser" ? "кассын PC-ийн PosAPI" : "серверийн PosAPI"})` : "УНТРААЛТТАЙ — ДДТД гараар бичигдэнэ"}`,
    problems.length ? `Тохиргооны дутуу: ${problems.join("; ")}` : "Тохиргоо бүрэн",
    readiness.ready
      ? "Кодын бэлэн байдал: бараа ба төлбөрийн хэлбэр бүрэн"
      : `Кодын дутуу (баримт илгээгдэхгүй): ${readiness.problems.join("; ")}`,
    status.enabled && status.mode === "server"
      ? status.posApi
        ? `PosAPI: ${status.posApi.operatorName ?? "оператор ?"} · posNo ${status.posApi.posNo ?? "?"} · үлдсэн сугалаа ${status.posApi.leftLotteries ?? "?"} · ТЕГ рүү сүүлд ${status.posApi.lastSentDate ?? "?"} · мерчант бүртгэлтэй: ${status.posApi.merchantRegistered == null ? "тодорхойгүй" : status.posApi.merchantRegistered ? "тийм" : "ҮГҮЙ — operator.ebarimt.mn-ээс хүсэлт илгээж харилцагчаар батлуулна"}`
        : "PosAPI: ХҮРЭХГҮЙ байна (/rest/info хариулсангүй) — URL, сүлжээ, үйлчилгээ ажиллаж буйг шалгана"
      : "",
    `Дараалал: хүлээгдэж байгаа ${status.pending} · алдаатай ${status.failed} · өнөөдөр илгээсэн ${status.sentToday}${status.lastSentAt ? ` · сүүлд ${status.lastSentAt.slice(0, 19).replace("T", " ")}` : ""}`,
    status.lastError ? `Сүүлийн алдаа: ${status.lastError.slice(0, 300)}` : "",
    status.failed > 0
      ? "Алдаатай баримтыг: шалтгааныг зассаны дараа resend_ebarimt-аар дахин илгээнэ (ангилалын код — барааны карт, төлбөрийн код — Борлуулалт → Тохиргоо → Төлбөрийн хэлбэр)."
      : "",
  ].filter(Boolean);
  return { resultText: lines.join("\n") };
}

/** QPay — getQpayStatus action-тай НЭГ loader (qpayStatusSummary + readiness); нууц буцахгүй. */
async function runGetQpayStatus(orgId: string): Promise<AiToolResult> {
  const settings = await ensurePosSettings(orgId);
  const [status, readiness] = await Promise.all([
    qpayStatusSummary(orgId, settings, todayInUlaanbaatar()),
    loadQpayReadiness(orgId, settings),
  ]);
  const lines = [
    `QPay төлбөр: ${status.enabled ? "АСААЛТТАЙ" : status.configured ? "тохируулсан, УНТРААЛТТАЙ" : "ТОХИРУУЛААГҮЙ — Борлуулалт → Тохиргоо → QPay → [QPay холбох]"}`,
    `Dashboard: ${status.apiUrl}${status.merchantId ? ` · мерчант ${status.merchantId}` : ""}`,
    readiness.ready ? "Бэлэн байдал: бүрэн" : `Бэлэн байдлын дутуу: ${readiness.problems.join("; ")}`,
    readiness.warnings.length ? `Анхааруулга: ${readiness.warnings.join("; ")}` : "",
    `Webhook: ${status.webhookUrl ?? "нийтийн URL алга — төлбөр зөвхөн [Шалгах] товчоор баталгаажина"}`,
    `Нээлттэй QR: ${status.openIntents} · төлөгдсөн ч борлуулалт болоогүй (≥10 мин): ${status.paidUnfinalized} · өнөөдөр QPay-ээр: ${status.finalizedToday} · QR хугацаа ${status.invoiceTtlSec} сек`,
    status.paidUnfinalized > 0
      ? "ЯАРАЛТАЙ: мөнгө орсон ч бараа хасагдаагүй борлуулалт байна — Борлуулалт → жагсаалтын «QPay хүлээгдэж буй» баннераас [Борлуулалт болгох] (эсвэл шалтгаан тодорхой бол [Цуцлах])."
      : "",
  ].filter(Boolean);
  return { resultText: lines.join("\n") };
}

async function runResendEbarimt(
  orgId: string,
  input: { sale: string; kind?: "send" | "cancel" }
): Promise<AiToolResult> {
  const found = await findPosSale(orgId, input.sale);
  const kind = input.kind === "cancel" ? "cancel" : "send";
  const result = unwrapAction(await resendEbarimt(found.id, kind));
  return {
    resultText: `${found.documentNo}: eBarimt ${kind === "cancel" ? "цуцлах" : "илгээх"} хүсэлт дараалалд орлоо — төлөв: ${
      result.status ? EBARIMT_STATUS_LABELS[result.status as EbarimtStatus] ?? result.status : "—"
    }. Илгээлт async тул хэдхэн секундын дараа get_ebarimt_status-аар шалгана.`,
  };
}

async function runLookupTin(input: { regNo: string }): Promise<AiToolResult> {
  const info = unwrapAction(await lookupEbarimtTin(input.regNo));
  return { resultText: `РД ${info.info.regNo} → ТТД ${info.info.tin}${info.info.name ? ` · ${info.info.name}` : ""}` };
}

export async function executeAiTool(
  _userId: string,
  name: string,
  input: unknown,
  mode: AiWriteMode
): Promise<AiToolResult> {
  try {
    // Фаз 01: бүх scoping идэвхтэй байгууллагаар — session (чат) эсвэл
    // runAsOrg (MCP token) контекстоос ирнэ; гишүүнчлэлийг getActiveOrg
    // ДАХИН баталгаажуулна. Хэрэглэгч өөрөө (createdBy) server action-ууд
    // дотроо auth()-оос авагдана.
    const { orgId, userId } = await getActiveOrg();
    // «AI нягтлан» (skills) багц: зөвхөн мэдлэгийн tool — tools/list-ийг
    // тойрч нэрээр нь шууд дуудсан ч энд хаагдана (lib/billing/tool-scope.ts).
    if (!toolInPlan(await getEntitlements(orgId), name))
      throw new EntitlementError(
        "FEATURE_NOT_IN_PLAN",
        "«AI нягтлан» багцад зөвхөн мэдлэгийн сан (list_knowledge_topics, read_knowledge_section) нээлттэй — нягтлан бодох системийн үйлдэлд Standard багц хэрэгтэй"
      );
    // SIM2-016: schema-ийн required талбар дутуу бол executor-т хүргэхгүй.
    const definition = allAiTools().find((tool) => tool.name === name);
    const problem = toolInputProblem(definition?.inputSchema as ToolInputSchema | undefined, input);
    if (problem) throw codedError("INVALID_INPUT", `${name}: ${problem}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = (input ?? {}) as any;
    // Шууд батлах хязгаарыг хүсэлт бүрд НЭГ л удаа уншиж контекстод тавина —
    // гүн дэх assertPostLimit sync хэвээр, зэрэгцээ хүсэлтүүд бие биенийхээ
    // утгыг харахгүй (lib/ai/post-limit.ts).
    const settings = await db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, orgId),
      columns: { aiPostLimitMnt: true },
    });
    return await runWithAiPostLimit(resolveAiPostLimit(settings?.aiPostLimitMnt), async () => {
      const startedAt = Date.now();
      const result = await dispatchAiTool(orgId, userId, name, args, mode);
      await notifyAiDraft(orgId, userId, name, result);
      // AI санал → үр дүнгийн бүртгэл (docs/ai-logging.md). Эх сурвалж
      // (MCP / REST / чат) нь runWithAiLogContext-оос ирнэ; бүртгэл нь
      // ХЭЗЭЭ Ч шидэхгүй тул tool-ийн үр дүнд нөлөөлөхгүй.
      await recordAiToolCall(
        { orgId, userId },
        {
          toolName: name,
          args,
          mode,
          action: result.action,
          dedup: result.dedup,
          latencyMs: Date.now() - startedAt,
        }
      );
      return result;
    });
  } catch (caught) {
    return aiToolErrorResult(name, caught);
  }
}

/** AI/MCP/REST-ээс НООРОГ үүссэн бол батлах эрхтэй бусад гишүүнд мэдэгдэнэ
 *  (docs/notifications §3.1 ai.drafts_created — §9 human-in-the-loop-ийг
 *  «хэн ч анзаараагүй ноорог»-оос хамгаална). Хэзээ ч шидэхгүй. */
async function notifyAiDraft(
  orgId: string,
  userId: string,
  toolName: string,
  result: AiToolResult
): Promise<void> {
  const action = result.action;
  if (!action || result.dedup || action.status !== "draft") return;
  const entityType = AI_ACTION_ENTITY[action.kind];
  if (!entityType) return;
  await emitNotification(
    orgId,
    {
      type: "ai.drafts_created",
      title: `AI ноорог үүсгэлээ — ${action.title}`,
      body: `${toolName} tool-оор үүссэн ноорог батлагдахыг хүлээж байна — шалгаад батлана эсвэл устгана.`,
      href: ENTITY_HREF[entityType],
      entityType,
      entityId: action.id,
      dedupeKey: `ai-draft:${action.id}`,
      audience: { kind: "module", moduleKeys: ENTITY_MODULE_KEYS[entityType] ?? [], minLevel: "post" },
      payload: { tool: toolName, kind: action.kind, action: "create" },
    },
    { actorUserId: userId }
  );
}

/** AiAction.kind → аудитын entityType (панель dispatcher / модулийн эрх). */
const AI_ACTION_ENTITY: Record<AiAction["kind"], string> = {
  voucher: "journal",
  arap: "arap",
  cash: "cash",
  inventory: "inventory",
  fa: "fa",
  purchase_order: "purchase_order",
  goods_receipt: "goods_receipt",
  // POS борлуулалт ноорог байдаггүй (§5c) — notifyAiDraft хэзээ ч мэдэгдэхгүй, гэхдээ бүх kind-ийг бүрэн хамарна.
  pos_sale: "pos_sale",
};

function aiToolErrorResult(name: string, caught: unknown): AiToolResult {
  // DB/Drizzle-ийн түүхий алдааг модель болон гадны MCP клиентэд задлахгүй:
  // SQLSTATE код (cause гинжинд ч), DrizzleQueryError («Failed query: …
  // params: <UUID>») эсвэл SQL-ийн үг агуулсан мессежийг ерөнхий монгол
  // текст + лавлах кодоор орлуулж, жинхэнэ алдааг лог руу бичнэ (ENT-070).
  // [CODE]-той болон монгол validation алдаанууд хэвээр дамжина.
  const classified = classifyToolError(caught);
  if (classified.internal) {
    console.error(`AI tool "${name}" internal error [${classified.logId}]: ${describeErrorChain(caught)}`, caught);
    return { resultText: `Алдаа: ${internalErrorText(classified.logId)}` };
  }
  const message = classified.message;
  // EntitlementError г.м `code`-той алдаа: [CODE] угтварыг баталгаажуулна
  // (REST parseError, модель хоёулаа үүнд найддаг — CLAUDE.md §9a).
  const errorCode = (caught as { code?: unknown } | null)?.code;
  const bracketed =
    typeof errorCode === "string" && /^[A-Z][A-Z_]+$/.test(errorCode) && !message.startsWith("[")
      ? `[${errorCode}] ${message}`
      : message;
  return { resultText: `Алдаа: ${bracketed}` };
}

async function dispatchAiTool(
  orgId: string,
  userId: string,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  mode: AiWriteMode
): Promise<AiToolResult> {
  {
    switch (name) {
      case "create_journal_voucher":
        return await runCreateJournal(orgId, args, mode);
      case "create_arap_invoice":
        return await runCreateArap(orgId, args, mode);
      case "create_cash_transaction":
        return await runCreateCash(orgId, args, mode);
      case "create_inventory_movement":
        return await runCreateMovement(orgId, args, mode);
      case "create_opening_stock":
        return await runCreateOpeningStock(args, mode);
      case "create_fixed_asset":
        return await runCreateFixedAsset(orgId, args, mode);
      case "list_counterparties":
        return await runListCounterparties(orgId, args);
      case "list_inventory":
        return await runListInventory(orgId, args);
      case "post_journal_voucher":
        return await runPostJournal(orgId, args, mode);
      case "delete_journal_voucher":
        return await runDeleteJournal(orgId, args);
      case "post_cash_document":
        return await runPostCash(orgId, args, mode);
      case "delete_cash_document":
        return await runDeleteCash(orgId, args, mode);
      case "post_arap_document":
        return await runPostArap(orgId, args, mode);
      case "settle_arap_offset":
        return await runSettleArApOffset(orgId, args, mode);
      case "create_credit_note":
        return await runCreateCreditNote(orgId, args, mode);
      case "get_ecl_provision":
        return await runGetEclProvision(args);
      case "run_ecl_provision":
        return await runRunEclProvision(args);
      case "write_off_arap_document":
        return await runWriteOffArap(orgId, args, mode);
      case "recover_arap_write_off":
        return await runRecoverArapWriteOff(orgId, args, mode);
      case "list_gl_accounts":
        return await runListGlAccounts(orgId, args);
      case "list_cash_accounts":
        return await runListCashAccounts(orgId);
      case "list_journal_vouchers":
        return await runListJournalVouchers(orgId, args);
      case "create_gl_account":
        return await runCreateGlAccount(orgId, args);
      case "create_counterparty":
        return await runCreateCounterparty(orgId, args);
      case "create_inventory_item":
        return await runCreateItem(orgId, args);
      case "create_warehouse":
        return await runCreateWarehouse(orgId, args);
      case "update_counterparty":
        return await runUpdateCounterparty(orgId, args);
      case "delete_counterparty":
        return await runDeleteCounterparty(orgId, args);
      case "update_inventory_item":
        return await runUpdateItem(orgId, args);
      case "delete_inventory_item":
        return await runDeleteItem(orgId, args);
      case "update_inventory_movement":
        return await runUpdateMovement(orgId, args);
      case "record_inventory_count":
        return await runRecordCount(orgId, args);
      case "create_cash_account":
        return await runCreateCashAccount(orgId, args);
      case "activate_fixed_asset":
        return await runActivateFixedAsset(orgId, args, mode);
      case "delete_fixed_asset":
        return await runDeleteFixedAsset(orgId, args, mode);
      case "reverse_fa_depreciation":
        return await runReverseFaDepreciation(orgId, args, mode);
      case "get_journal_voucher":
        return await runGetJournal(orgId, args);
      case "update_journal_voucher":
        return await runUpdateJournal(orgId, args);
      case "reverse_journal_voucher":
        return await runReverseJournal(orgId, args, mode);
      case "get_trial_balance":
        return await runGetTrialBalance(orgId, args);
      case "get_income_statement":
        return await runIncomeStatement(orgId, args);
      case "get_balance_sheet":
        return await runBalanceSheet(orgId, args);
      case "get_cash_flow":
        return await runCashFlow(orgId, args);
      case "get_account_ledger":
        return await runAccountLedger(orgId, args);
      case "create_year_end_closing":
        return await runYearEndClosing(orgId, args);
      case "list_arap_documents":
        return await runListArapDocuments(orgId, args);
      case "delete_arap_document":
        return await runDeleteArap(orgId, args, mode);
      case "send_invoice_email":
        return await runSendInvoiceEmail(orgId, args);
      case "create_invoice_link":
        return await runCreateInvoiceLink(orgId, args);
      case "get_counterparty_balance":
        return await runCounterpartyBalance(orgId, args);
      case "pay_arap_document":
        return await runPayArap(orgId, args, mode);
      case "list_cash_documents":
        return await runListCashDocuments(orgId, args);
      case "reverse_cash_document":
        return await runReverseCash(orgId, args, mode);
      case "list_inventory_movements":
        return await runListMovements(orgId, args);
      case "confirm_inventory_movement":
        return await runConfirmMovement(orgId, args, mode);
      case "delete_inventory_movement":
        return await runDeleteMovement(orgId, args, mode);
      case "get_stock_balances":
        return await runGetStockBalances(orgId, args);
      case "list_fixed_assets":
        return await runListFixedAssets(orgId, args);
      case "create_journal_vouchers_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateJournal(orgId, item as Parameters<typeof runCreateJournal>[1], mode)
        );
      case "run_fx_revaluation":
        return await runFxRevaluation(orgId, args, mode);
      case "reverse_fx_revaluation":
        return await runReverseFxRevaluation(orgId, args, mode);
      case "sync_exchange_rates":
        return await runSyncExchangeRates(args);
      case "get_exchange_rate":
        return await runGetExchangeRate(args);
      case "dispose_fixed_asset":
        return await runDisposeFixedAsset(orgId, args, mode);
      case "list_employees":
        return await runListEmployees(orgId, args);
      case "update_employee":
        return await runUpdateEmployee(orgId, args);
      case "list_companies":
        return await runListCompanies();
      case "get_active_company":
        return await runGetActiveCompany();
      case "create_company":
        return await runCreateCompany(args);
      case "delete_company":
        return await runDeleteCompany(args, mode);
      case "get_company_settings":
        return await runGetOrganizationProfile();
      case "update_company_settings":
        return await runUpdateOrganizationProfile(args);
      case "get_billing_overview":
        return await runGetBillingOverview();
      case "list_knowledge_topics":
        return await runListKnowledgeTopics(orgId, args);
      case "read_knowledge_section":
        return await runReadKnowledgeSection(orgId, userId, args);
      case "list_audit_events":
        return await runListAuditEvents(orgId, args);
      case "update_arap_document":
        return await runUpdateArapDocument(orgId, args);
      case "update_cash_document":
        return await runUpdateCashDocument(orgId, args);
      case "get_costing_settings":
        return await runGetCostingSettings(orgId);
      case "save_issue_type":
        return await runSaveIssueType(orgId, args);
      case "save_cost_component":
        return await runSaveCostComponent(orgId, args);
      case "update_costing_accounts":
        return await runUpdateCostingAccounts(orgId, args);
      case "import_bank_statement":
        return await runImportBankStatement(orgId, args, mode);
      case "get_inventory_valuation":
        return await runInventoryValuation(orgId, args);
      case "run_fa_depreciation":
        return await runFaDepreciation(orgId, args);
      case "post_fa_depreciation":
        return await runPostFaDepreciation(orgId, args, mode);
      case "list_periods":
        return await runListPeriods();
      case "sync_standard_accounts":
        return await runSyncStandardAccounts();
      case "list_segment_values":
        return await runListSegmentValues(orgId, args);
      case "close_period":
        return await runClosePeriod(orgId, args, mode);
      case "reopen_period":
        return await runReopenPeriod(orgId, args, mode);
      case "create_employee":
        return await runCreateEmployee(args);
      case "run_payroll":
        return await runPayrollCalc(args);
      case "get_payroll_summary":
        return await runPayrollSummary(args);
      case "create_payroll_voucher":
        return await runCreatePayrollVoucher(args);
      case "list_notifications":
        return await runListNotifications(args);
      case "mark_notifications_read":
        return await runMarkNotificationsRead(args);
      case "get_month_end_checklist":
        return await runMonthEndChecklist(args);
      case "get_vat_return":
        return await runGetVatReturn(orgId, args);
      case "create_vat_settlement":
        return await runCreateVatSettlement(orgId, args);
      case "run_monthly_costing":
        return await runMonthlyCosting(orgId, args);
      case "post_cost_entries":
        return await runPostCostEntries(orgId, args, mode);
      case "list_cost_entries":
        return await runListCostEntries(orgId, args);
      case "reverse_cost_entry":
        return await runReverseCostEntry(orgId, args, mode);
      case "delete_cost_entry":
        return await runDeleteCostEntry(orgId, args);
      case "fix_cash_opening_balance":
        return await runFixCashOpening(orgId, args);
      case "reconcile_modules":
        return await runReconcileModules(orgId, args);
      case "get_workflow_guide":
        return runWorkflowGuide(args);
      case "get_onboarding_guide":
        return await runOnboardingGuide(orgId, args);
      case "create_counterparties_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateCounterparty(orgId, item as Parameters<typeof runCreateCounterparty>[1])
        );
      case "create_gl_accounts_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateGlAccount(orgId, item as Parameters<typeof runCreateGlAccount>[1])
        );
      case "create_inventory_items_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateItem(orgId, item as Parameters<typeof runCreateItem>[1])
        );
      case "create_employees_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateEmployee(item as Parameters<typeof runCreateEmployee>[0])
        );
      case "create_fixed_assets_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateFixedAsset(orgId, item as Parameters<typeof runCreateFixedAsset>[1], mode)
        );
      case "create_arap_invoices_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateArap(orgId, item as Parameters<typeof runCreateArap>[1], mode)
        );
      case "create_cash_transactions_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateCash(orgId, item as Parameters<typeof runCreateCash>[1], mode)
        );
      case "post_arap_documents_batch":
        return await runPostBatch(args.documentIds, mode, (id) =>
          runPostArap(orgId, { documentId: id }, mode)
        );
      case "post_cash_documents_batch":
        return await runPostBatch(args.documentIds, mode, (id) =>
          runPostCash(orgId, { documentId: id }, mode)
        );
      case "post_journal_vouchers_batch":
        return await runPostBatch(args.voucherIds, mode, (id) =>
          runPostJournal(orgId, { voucherId: id }, mode)
        );
      // ── Хангамж (PO + орлогдох өртөг) ─────────────────────────────────────
      case "create_purchase_order":
        return await runCreatePurchaseOrder(orgId, args, mode);
      case "update_purchase_order":
        return await runUpdatePurchaseOrder(orgId, args);
      case "approve_purchase_order":
        return await runApprovePurchaseOrder(orgId, args, mode);
      case "close_purchase_order":
        return await runClosePurchaseOrder(orgId, args, mode);
      case "cancel_purchase_order":
        return await runCancelPurchaseOrder(orgId, args, mode);
      case "list_purchase_orders":
        return await runListPurchaseOrders(orgId, args);
      case "get_purchase_order":
        return await runGetPurchaseOrder(orgId, args);
      case "create_goods_receipt":
        return await runCreateGoodsReceipt(orgId, args, mode);
      case "confirm_goods_receipt":
        return await runConfirmGoodsReceipt(orgId, args, mode);
      case "reverse_goods_receipt":
        return await runReverseGoodsReceipt(orgId, args, mode);
      case "delete_goods_receipt":
        return await runDeleteGoodsReceipt(orgId, args);
      case "create_ap_invoice_from_po":
        return await runCreateApInvoiceFromPo(orgId, args, mode);
      case "create_cost_allocation":
        return await runCreateCostAllocation(orgId, args);
      case "reverse_cost_allocation":
        return await runReverseCostAllocation(orgId, args, mode);
      case "get_landed_cost_summary":
        return await runGetLandedCostSummary(orgId, args);
      case "get_pos_status":
        return await runGetPosStatus(orgId);
      case "update_pos_settings":
        return await runUpdatePosSettings(orgId, args);
      case "save_pos_payment_method":
        return await runSavePosPaymentMethod(orgId, args);
      case "delete_pos_payment_method":
        return await runDeletePosPaymentMethod(orgId, args);
      case "open_pos_shift":
        return await runOpenPosShift(orgId, args);
      case "close_pos_shift":
        return await runClosePosShift(orgId, args, mode);
      case "create_pos_sale":
        return await runCreatePosSale(orgId, args, mode);
      case "return_pos_sale":
        return await runReturnPosSale(orgId, args, mode);
      case "list_pos_sales":
        return await runListPosSales(orgId, args);
      case "get_pos_sale":
        return await runGetPosSale(orgId, args);
      case "get_pos_sales_report":
        return await runGetPosSalesReport(orgId, args);
      case "get_ebarimt_status":
        return await runGetEbarimtStatus(orgId);
      case "resend_ebarimt":
        return await runResendEbarimt(orgId, args);
      case "lookup_tin":
        return await runLookupTin(args);
      case "get_qpay_status":
        return await runGetQpayStatus(orgId);
      default: {
        // custom/ багцын tool — core-той ИЖИЛ алдааны боловсруулалттай.
        const custom = findCustomTool(name);
        if (!custom) return { resultText: `"${name}" гэдэг tool байхгүй` };
        return await executeCustomTool(custom, { orgId, userId, mode }, args);
      }
    }
  }
}

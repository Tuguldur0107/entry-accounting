"use server";

// POS (Борлуулалтын цэг) — Server Actions. docs/pos/00-proposal.md §3.3–§3.10.
//
// Борлуулалт = НЭГ транзакц: pos_sales → АР нэхэмжлэх (posted) → зарлага
// (confirmed) → урьдчилсан COGS (posted, явцын дундаж) → төлбөр бүрд кассын
// баримт / settlement. Алдаа гарвал юу ч үлдэхгүй. Бичилтүүд одоогийн
// модулиудын ЯГ ижил мөрийн хэлбэрээр (journal_lines.costEntryId /
// inventoryMovementId / cashAccountId / businessObject) бичигддэг тул тайлан,
// тулгалт, snapshot бүгд өөрчлөлтгүй уншина. Дансны дугаар кодод байхгүй.
//
// Эрх: `pos` түлхүүр — write = борлуулалт/буцаалт/ээлж; post = тохиргоо,
// дүрэм, зөвшөөрөл шаардах хөнгөлөлт, үнэ засах.

import { revalidatePath } from "next/cache";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  arApSettlements,
  cashAccounts,
  cashDocuments,
  costEntries,
  counterparties,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  posDiscountRules,
  posEbarimtSubmissions,
  posGiftCards,
  posPaymentMethods,
  posPayments,
  posSaleDiscounts,
  posSaleLines,
  posSales,
  posSettings,
  posShifts,
  posStoreCredits,
  segmentConfigs,
  segmentValues,
  users,
  warehouses,
} from "@/lib/db/schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { periodCodeOf } from "@/lib/periods/period";
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";
import { roundMoney as round2 } from "@/lib/arap/accounting";
import { findNegativeStock, balanceKey, type MovementRef } from "@/lib/inventory/balances";
import { loadQtyLedgerFast } from "@/lib/inventory/period-balances";
import { toItemVatMode } from "@/lib/inventory/load-data";
import {
  assertEnabledMainAccount,
  itemAccountsFor,
} from "@/lib/costing/posting-helpers";
import {
  defaultIssueType,
  loadIssueTypes,
  resolveIssueDebitAccount,
} from "@/lib/costing/master-data";
import { loadProvisionalUnitCosts } from "@/lib/costing/provisional-cost";
import { scopeKey } from "@/lib/costing/periodic";
import { isOrgVatPayer, loadVatSettings } from "@/lib/vat/settings";
import { applyDiscounts } from "@/lib/pos/discounts";
import { computeSaleTotals, discountNetOf, ulaanbaatarNow } from "@/lib/pos/sale-math";
import { planPayments, planRefund } from "@/lib/pos/payments";
import { enqueueEbarimt, loadEbarimtReadiness } from "@/lib/ebarimt/queue";
import type { EbarimtSaleResult } from "@/lib/ebarimt/types";
import { processPendingEbarimt, sendSubmissionNow } from "@/lib/ebarimt/worker";
import { lookupTinByRegNo } from "@/lib/ebarimt/lookup";
import { ebarimtSettingsProblems, initialSaleEbarimtStatus } from "@/lib/ebarimt/receipt";
import { CONSUMER_NO_RE, DISTRICT_CODE_RE, EBARIMT_INLINE_SEND_TIMEOUT_MS, MERCHANT_TIN_RE } from "@/lib/ebarimt/constants";
import {
  DISCOUNT_RULE_TYPES,
  DISCOUNT_SCOPES,
  DISCOUNT_VALUE_TYPES,
  PAYMENT_KINDS,
  PAYMENT_KINDS_WITH_CASH_ACCOUNT,
  POS_BUSINESS_OBJECT,
  POS_MODULE_KEY,
  POS_MODULE_TAG,
  POS_MOVEMENT_SOURCE_TYPE,
  POS_RETURN_NO_PREFIX,
  POS_SALE_NO_PREFIX,
  POS_SHIFT_NO_PREFIX,
  POS_SOURCE_TYPE,
  PROVISIONAL_VALUATION_SOURCE,
  type PaymentKind,
} from "@/lib/pos/constants";
import {
  ensurePosSettings,
  loadCheckoutData,
  loadDiscountRuleViews,
  loadOpenReceivable,
  loadPaymentMethodViews,
  loadSaleDetail,
  loadSaleViews,
  loadShiftViews,
  toPosSettingsView,
  type CheckoutData,
  type SaleFilter,
} from "@/lib/pos/load-data";
import type {
  CartContext,
  CartLine,
  DiscountRule,
  PaymentInput,
  PaymentMethodView,
  PosSaleDetail,
  PosSaleView,
  PosSettingsView,
  PosShiftView,
  ResolvedPayment,
  TotaledLine,
} from "@/lib/pos/types";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const POS_LOCK_KEY = 7;

function revalidatePos() {
  for (const path of [
    "/inventory",
    "/inventory/pos",
    "/inventory/sales",
    "/inventory/movements",
    "/inventory/reports",
    "/receivables",
    "/receivables/documents",
    "/cash",
    "/cash/transactions",
    "/costing",
    "/costing/entries",
    "/gl/journal",
  ])
    revalidatePath(path);
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

const fmt = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Сар дотор дараалсан дугаар: `PREFIX-YYMM-NNNN` (PO/GR-ийн хэв маяг). */
async function nextSequentialNo(
  tx: DbTx,
  table: typeof posSales | typeof posShifts,
  orgId: string,
  prefix: string,
  date: string,
  width: number
): Promise<string> {
  const stem = `${prefix}-${date.slice(2, 4)}${date.slice(5, 7)}-`;
  const rows = await tx
    .select({ documentNo: table.documentNo })
    .from(table)
    .where(and(eq(table.organizationId, orgId), like(table.documentNo, `${stem}%`)));
  let max = 0;
  for (const row of rows) {
    const suffix = row.documentNo.slice(stem.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return `${stem}${String(max + 1).padStart(width, "0")}`;
}

async function codeBuilders(orgId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.organizationId, orgId), eq(segmentValues.isEnabled, true)),
    }),
  ]);
  return {
    sale: postingCodeBuilderFromData({ configs, values, moduleTag: POS_MODULE_TAG }),
    cash: postingCodeBuilderFromData({ configs, values, moduleTag: "CA" }),
    cost: postingCodeBuilderFromData({ configs, values, moduleTag: "CO" }),
  };
}

// ─── Тохиргоо ────────────────────────────────────────────────────────────────

export async function getPosSettings(): Promise<ActionResult<{ settings: PosSettingsView }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { settings: toPosSettingsView(await ensurePosSettings(orgId, userId)) };
  } catch (caught) {
    return actionError("getPosSettings", caught, "POS тохиргоо уншигдсангүй");
  }
}

export async function updatePosSettings(
  data: Partial<PosSettingsView>
): Promise<ActionResult<{ settings: PosSettingsView }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const current = await ensurePosSettings(orgId, userId);
    const patch: Partial<typeof posSettings.$inferInsert> = {};
    const accountFields = [
      "revenueAccountNumber",
      "discountAccountNumber",
      "giftCardLiabilityAccountNumber",
      "storeCreditLiabilityAccountNumber",
      "customerAdvanceAccountNumber",
      "cashOverAccountNumber",
      "cashShortAccountNumber",
      "roundingAccountNumber",
    ] as const;
    for (const field of accountFields) {
      const value = data[field]?.trim();
      if (value == null) continue;
      if (!/^\d{8}$/.test(value)) throw new Error(`${field}: 8 оронтой данс оруулна уу`);
      await assertEnabledMainAccount(orgId, value);
      patch[field] = value;
    }
    if (data.discountPosting != null) {
      if (!["net", "contra"].includes(data.discountPosting))
        throw new Error("Хөнгөлөлтийн бичилтийн горим буруу");
      patch.discountPosting = data.discountPosting;
    }
    if (data.discountStacking != null) {
      if (!["best_single", "cumulative"].includes(data.discountStacking))
        throw new Error("Хөнгөлөлтийн давхцах бодлого буруу");
      patch.discountStacking = data.discountStacking;
    }
    if (data.provisionalCogs != null) patch.provisionalCogs = !!data.provisionalCogs;
    if (data.allowNegativeStock != null) patch.allowNegativeStock = !!data.allowNegativeStock;
    if (data.maxManualDiscountPercent != null) {
      const value = Number(data.maxManualDiscountPercent);
      if (!(value >= 0 && value <= 100)) throw new Error("Гар хөнгөлөлтийн дээд хувь 0–100");
      patch.maxManualDiscountPercent = String(value);
    }
    if (data.maxTotalDiscountPercent != null) {
      const value = Number(data.maxTotalDiscountPercent);
      if (!(value >= 0 && value <= 100)) throw new Error("Нийт хөнгөлөлтийн тааз 0–100");
      patch.maxTotalDiscountPercent = String(value);
    }
    if (data.cashRoundingUnit != null) {
      const value = Number(data.cashRoundingUnit);
      if (![0, 10, 100].includes(value)) throw new Error("Бөөрөнхийллийн нэгж 0, 10 эсвэл 100");
      patch.cashRoundingUnit = value;
    }
    if (data.receiptHeader != null) patch.receiptHeader = data.receiptHeader;
    if (data.receiptFooter != null) patch.receiptFooter = data.receiptFooter;
    // ── eBarimt (docs/pos/03-ebarimt-integration-plan.md §4.1) ──
    if (data.ebarimtMerchantTin != null) {
      const tin = data.ebarimtMerchantTin.trim();
      if (tin && !MERCHANT_TIN_RE.test(tin)) throw new Error("Мерчантын ТТД 11 эсвэл 14 оронтой тоо байна");
      patch.ebarimtMerchantTin = tin;
    }
    if (data.ebarimtBranchNo != null) patch.ebarimtBranchNo = data.ebarimtBranchNo.trim();
    if (data.ebarimtDistrictCode != null) {
      const code = data.ebarimtDistrictCode.trim();
      if (code && !DISTRICT_CODE_RE.test(code)) throw new Error("Дүүргийн код 4 оронтой байна");
      patch.ebarimtDistrictCode = code;
    }
    if (data.ebarimtPosNo != null) patch.ebarimtPosNo = data.ebarimtPosNo.trim();
    if (data.ebarimtPosApiUrl != null) {
      const url = data.ebarimtPosApiUrl.trim();
      if (url && !/^https?:\/\/\S+$/.test(url)) throw new Error("PosAPI URL http(s)://… хэлбэртэй байна");
      patch.ebarimtPosApiUrl = url || "http://localhost:7080";
    }
    if (data.ebarimtMode != null) {
      if (!["server", "browser"].includes(data.ebarimtMode)) throw new Error("eBarimt горим server эсвэл browser");
      patch.ebarimtMode = data.ebarimtMode;
    }
    if (data.ebarimtEnabled != null) {
      if (data.ebarimtEnabled) {
        const merged = { ...current, ...patch };
        const problems = ebarimtSettingsProblems({
          enabled: true,
          merchantTin: merged.ebarimtMerchantTin,
          branchNo: merged.ebarimtBranchNo,
          districtCode: merged.ebarimtDistrictCode,
          posNo: merged.ebarimtPosNo,
          posApiUrl: merged.ebarimtPosApiUrl,
          mode: merged.ebarimtMode === "browser" ? "browser" : "server",
        });
        if (problems.length > 0) throw new Error(`eBarimt идэвхжүүлэхээс өмнө: ${problems.join("; ")}`);
        // НӨАТ-д хатуу хамаарах feature — зөвхөн НӨАТ төлөгч байгууллага асаана.
        if (!(await isOrgVatPayer(orgId)))
          throw new Error(
            "НӨАТ төлөгч бус байгууллага eBarimt идэвхжүүлэх боломжгүй — Тохиргоо → НӨАТ дээр НӨАТ төлөгчөөр бүртгүүлнэ үү"
          );
        // Кодын бэлэн байдал (docs/deployment/ebarimt.md §3 алхам 2–4): код
        // дутуу бараа/хэлбэр байвал тэр борлуулалт БОЛСНЫ ДАРАА л алдаж,
        // үйлчлүүлэгч баримтгүй үлдэнэ — иймд АСААХААС ӨМНӨ таслана.
        const readiness = await loadEbarimtReadiness(orgId);
        if (!readiness.ready)
          throw new Error(`eBarimt идэвхжүүлэхээс өмнө: ${readiness.problems.join("; ")}`);
      }
      patch.ebarimtEnabled = !!data.ebarimtEnabled;
    }
    if (data.defaultWarehouseId !== undefined)
      patch.defaultWarehouseId = cleanText(data.defaultWarehouseId);
    if (data.issueTypeId !== undefined) {
      const id = cleanText(data.issueTypeId);
      if (id) {
        const types = await loadIssueTypes(orgId, { activeOnly: true });
        if (!types.some((type) => type.id === id)) throw new Error("Зарлагын төрөл олдсонгүй");
      }
      patch.issueTypeId = id;
    }
    if (data.walkInCounterpartyId !== undefined) {
      const id = cleanText(data.walkInCounterpartyId);
      if (id) {
        const cp = await db.query.counterparties.findFirst({
          where: and(eq(counterparties.id, id), eq(counterparties.organizationId, orgId)),
          columns: { id: true },
        });
        if (!cp) throw new Error("Харилцагч олдсонгүй");
      }
      patch.walkInCounterpartyId = id;
    }
    patch.updatedAt = new Date();
    const [updated] = await db
      .update(posSettings)
      .set(patch)
      .where(eq(posSettings.id, current.id))
      .returning();
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "pos_settings",
      entityId: current.id,
      summary: `POS тохиргоо шинэчлэгдэв — ${Object.keys(patch).filter((key) => key !== "updatedAt").join(", ")}`,
    });
    revalidatePos();
    return { settings: toPosSettingsView(updated ?? current) };
  } catch (caught) {
    return actionError("updatePosSettings", caught, "POS тохиргоо хадгалагдсангүй");
  }
}

// ─── Төлбөрийн хэлбэр ─────────────────────────────────────────────────────────

export async function getPaymentMethods(): Promise<ActionResult<{ methods: PaymentMethodView[] }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    await ensurePosSettings(orgId, userId);
    return { methods: await loadPaymentMethodViews(orgId) };
  } catch (caught) {
    return actionError("getPaymentMethods", caught, "Төлбөрийн хэлбэр уншигдсангүй");
  }
}

export async function savePaymentMethod(data: {
  id?: string | null;
  code: string;
  name: string;
  kind: PaymentKind;
  cashAccountId?: string | null;
  currency?: string;
  requiresReference?: boolean;
  allowsChange?: boolean;
  allowsRefund?: boolean;
  feePercent?: number | null;
  /** eBarimt төлбөрийн код (ТЕГ-ийн жагсаалтаас) — хоосон бол энэ хэлбэртэй борлуулалт илгээгдэхгүй. */
  ebarimtCode?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    if (!code) throw new Error("Код оруулна уу");
    if (!name) throw new Error("Нэр оруулна уу");
    if (!PAYMENT_KINDS.includes(data.kind)) throw new Error("Төлбөрийн төрөл буруу");
    const needsAccount = PAYMENT_KINDS_WITH_CASH_ACCOUNT.includes(data.kind);
    const cashAccountId = cleanText(data.cashAccountId);
    let currency = (data.currency?.trim().toUpperCase() || "MNT").slice(0, 3);
    if (needsAccount) {
      if (!cashAccountId) throw new Error("Мөнгө хүлээн авах касс/банк/түр данс сонгоно уу");
      const account = await db.query.cashAccounts.findFirst({
        where: and(
          eq(cashAccounts.id, cashAccountId),
          eq(cashAccounts.organizationId, orgId),
          eq(cashAccounts.isActive, true)
        ),
      });
      if (!account) throw new Error("Идэвхтэй касс/банкны данс олдсонгүй");
      currency = account.currency;
      if (data.kind === "cash" && currency !== "MNT")
        throw new Error("Бэлэн (₮) хэлбэрт MNT данс сонгоно — валютын бэлэнд «Бэлэн (валют)» төрөл");
      if (data.kind === "cash_fx" && currency === "MNT")
        throw new Error("Бэлэн (валют) хэлбэрт валютын кассын данс сонгоно");
    }
    const duplicate = await db.query.posPaymentMethods.findFirst({
      where: and(eq(posPaymentMethods.organizationId, orgId), eq(posPaymentMethods.code, code)),
      columns: { id: true },
    });
    if (duplicate && duplicate.id !== data.id)
      throw new Error(`"${code}" кодтой төлбөрийн хэлбэр бүртгэгдсэн байна`);
    const values = {
      code,
      name,
      kind: data.kind,
      cashAccountId: needsAccount ? cashAccountId : null,
      currency,
      requiresReference: !!data.requiresReference,
      allowsChange: data.kind === "cash" ? !!data.allowsChange : false,
      allowsRefund: data.allowsRefund ?? true,
      feePercent: data.feePercent == null ? null : String(Number(data.feePercent)),
      ebarimtCode: cleanText(data.ebarimtCode)?.toUpperCase() ?? null,
      isActive: data.isActive ?? true,
      sortOrder: Number(data.sortOrder ?? 0),
    };
    let id = data.id ?? null;
    if (id) {
      const [updated] = await db
        .update(posPaymentMethods)
        .set(values)
        .where(and(eq(posPaymentMethods.id, id), eq(posPaymentMethods.organizationId, orgId)))
        .returning({ id: posPaymentMethods.id });
      if (!updated) throw new Error("Төлбөрийн хэлбэр олдсонгүй");
    } else {
      const [inserted] = await db
        .insert(posPaymentMethods)
        .values({ userId, organizationId: orgId, ...values })
        .returning({ id: posPaymentMethods.id });
      id = inserted.id;
    }
    revalidatePos();
    return { id };
  } catch (caught) {
    return actionError("savePaymentMethod", caught, "Төлбөрийн хэлбэр хадгалагдсангүй");
  }
}

// ─── Хөнгөлөлтийн дүрэм ──────────────────────────────────────────────────────

export async function getDiscountRules(): Promise<ActionResult<{ rules: DiscountRule[] }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { rules: await loadDiscountRuleViews(orgId) };
  } catch (caught) {
    return actionError("getDiscountRules", caught, "Хөнгөлөлтийн дүрэм уншигдсангүй");
  }
}

export async function saveDiscountRule(
  data: Partial<DiscountRule> & Pick<DiscountRule, "code" | "name" | "ruleType">
): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    if (!code) throw new Error("Код оруулна уу");
    if (!name) throw new Error("Нэр оруулна уу");
    if (!DISCOUNT_RULE_TYPES.includes(data.ruleType)) throw new Error("Дүрмийн төрөл буруу");
    const scope = data.scope ?? "all";
    if (!DISCOUNT_SCOPES.includes(scope)) throw new Error("Хамрах хүрээ буруу");
    const valueType = data.valueType ?? "percent";
    if (!DISCOUNT_VALUE_TYPES.includes(valueType)) throw new Error("Утгын төрөл буруу");
    const value = Number(data.value ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new Error("Утга 0-ээс багагүй тоо байна");
    if (valueType === "percent" && value > 100) throw new Error("Хувь 100-аас ихгүй");
    const scopeRef = cleanText(data.scopeRef);
    if (scope !== "all" && !scopeRef) throw new Error("Хамрах хүрээний утга (бүлэг / бараа / харилцагчийн бүлэг) оруулна уу");
    if (scope === "item" && scopeRef) {
      const item = await db.query.inventoryItems.findFirst({
        where: and(eq(inventoryItems.id, scopeRef), eq(inventoryItems.organizationId, orgId)),
        columns: { id: true },
      });
      if (!item) throw new Error("Бараа олдсонгүй");
    }
    if (data.ruleType === "buy_x_get_y" && !((data.buyQty ?? 0) > 0 && (data.getQty ?? 0) > 0))
      throw new Error("N авбал M үнэгүй: N ба M хоёулаа 0-ээс их");
    if (data.ruleType === "coupon" && !cleanText(data.couponCode))
      throw new Error("Купоны код оруулна уу");
    if (data.ruleType === "qty_tier" && !(data.tiers && data.tiers.length > 0))
      throw new Error("Шатлалын мөрүүд оруулна уу");
    for (const field of ["dateFrom", "dateTo"] as const) {
      const raw = cleanText(data[field]);
      if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Огноо YYYY-MM-DD хэлбэртэй");
    }
    for (const field of ["timeFrom", "timeTo"] as const) {
      const raw = cleanText(data[field]);
      if (raw && !/^\d{2}:\d{2}$/.test(raw)) throw new Error("Цаг HH:MM хэлбэртэй");
    }
    const duplicate = await db.query.posDiscountRules.findFirst({
      where: and(eq(posDiscountRules.organizationId, orgId), eq(posDiscountRules.code, code)),
      columns: { id: true },
    });
    if (duplicate && duplicate.id !== data.id)
      throw new Error(`"${code}" кодтой дүрэм бүртгэгдсэн байна`);
    const values = {
      code,
      name,
      ruleType: data.ruleType,
      scope,
      scopeRef,
      valueType,
      value: String(value),
      minQty: data.minQty == null ? null : String(Number(data.minQty)),
      minAmount: data.minAmount == null ? null : String(Number(data.minAmount)),
      buyQty: data.buyQty == null ? null : String(Number(data.buyQty)),
      getQty: data.getQty == null ? null : String(Number(data.getQty)),
      tiers: data.tiers ?? null,
      dateFrom: cleanText(data.dateFrom),
      dateTo: cleanText(data.dateTo),
      timeFrom: cleanText(data.timeFrom),
      timeTo: cleanText(data.timeTo),
      weekdays: cleanText(data.weekdays),
      couponCode: cleanText(data.couponCode)?.toUpperCase() ?? null,
      maxUsesTotal: data.maxUsesTotal == null ? null : Number(data.maxUsesTotal),
      maxUsesPerCustomer: data.maxUsesPerCustomer == null ? null : Number(data.maxUsesPerCustomer),
      stackable: !!data.stackable,
      priority: Number(data.priority ?? 100),
      requiresApproval: !!data.requiresApproval,
      isActive: data.isActive ?? true,
      updatedAt: new Date(),
    };
    let id = data.id ?? null;
    if (id) {
      const [updated] = await db
        .update(posDiscountRules)
        .set(values)
        .where(and(eq(posDiscountRules.id, id), eq(posDiscountRules.organizationId, orgId)))
        .returning({ id: posDiscountRules.id });
      if (!updated) throw new Error("Дүрэм олдсонгүй");
    } else {
      const [inserted] = await db
        .insert(posDiscountRules)
        .values({ userId, organizationId: orgId, ...values })
        .returning({ id: posDiscountRules.id });
      id = inserted.id;
    }
    revalidatePos();
    return { id };
  } catch (caught) {
    return actionError("saveDiscountRule", caught, "Хөнгөлөлтийн дүрэм хадгалагдсангүй");
  }
}

export async function deleteDiscountRule(id: string): Promise<ActionResult> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const used = await db.query.posSaleDiscounts.findFirst({
      where: eq(posSaleDiscounts.ruleId, id),
      columns: { id: true },
    });
    if (used) {
      await db
        .update(posDiscountRules)
        .set({ isActive: false })
        .where(and(eq(posDiscountRules.id, id), eq(posDiscountRules.organizationId, orgId)));
    } else
      await db
        .delete(posDiscountRules)
        .where(and(eq(posDiscountRules.id, id), eq(posDiscountRules.organizationId, orgId)));
    revalidatePos();
    return {};
  } catch (caught) {
    return actionError("deleteDiscountRule", caught, "Дүрэм устгагдсангүй");
  }
}

// ─── Кассын дэлгэцийн өгөгдөл, үнийн санал (quote) ───────────────────────────

export async function getPosCheckoutData(): Promise<ActionResult<{ data: CheckoutData }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { data: await loadCheckoutData(orgId, userId) };
  } catch (caught) {
    return actionError("getPosCheckoutData", caught, "Кассын өгөгдөл уншигдсангүй");
  }
}

export interface SaleLineInput {
  itemId: string;
  quantity: number;
  /** Үнэ өөрчлөх (эрх: pos post). */
  unitPrice?: number | null;
  manualDiscountPercent?: number | null;
  manualDiscountAmount?: number | null;
}

export interface SaleQuoteInput {
  counterpartyId?: string | null;
  lines: SaleLineInput[];
  couponCodes?: string[];
  receiptDiscountPercent?: number | null;
  receiptDiscountAmount?: number | null;
}

interface QuoteContext {
  orgId: string;
  settings: Awaited<ReturnType<typeof ensurePosSettings>>;
  isVatPayer: boolean;
  vatRatePercent: number;
  rules: DiscountRule[];
  customer: typeof counterparties.$inferSelect;
  isWalkIn: boolean;
}

async function resolveCustomer(orgId: string, settings: QuoteContext["settings"], counterpartyId: string | null | undefined) {
  const id = cleanText(counterpartyId) ?? settings.walkInCounterpartyId;
  if (!id) throw new Error("Бэлэн худалдан авагч тохируулаагүй байна — POS тохиргоог шалгана уу");
  const customer = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.id, id),
      eq(counterparties.organizationId, orgId),
      eq(counterparties.isActive, true)
    ),
  });
  if (!customer) throw new Error("Идэвхтэй харилцагч олдсонгүй");
  if (!["customer", "both"].includes(customer.counterpartyType))
    throw new Error("Харилцагч худалдан авагч төрөлтэй байх ёстой");
  return { customer, isWalkIn: customer.id === settings.walkInCounterpartyId };
}

async function buildQuote(input: SaleQuoteInput, ctx: QuoteContext) {
  if (!input.lines || input.lines.length === 0) throw new Error("Сагс хоосон байна");
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const items = await db.query.inventoryItems.findMany({
    where: and(
      eq(inventoryItems.organizationId, ctx.orgId),
      eq(inventoryItems.isActive, true),
      inArray(inventoryItems.id, itemIds)
    ),
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const approvalExtra: string[] = [];
  const cart: CartLine[] = input.lines.map((line, index) => {
    const item = itemById.get(line.itemId);
    if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${item.name}: тоо хэмжээ 0-ээс их`);
    const salesPrice = item.salesPrice === null ? null : Number(item.salesPrice);
    const override = line.unitPrice == null ? null : Number(line.unitPrice);
    if (override != null && (!Number.isFinite(override) || override < 0))
      throw new Error(`${item.name}: нэгж үнэ буруу`);
    const unitPrice = override ?? salesPrice;
    if (unitPrice == null)
      throw new Error(`${item.code} · ${item.name}: борлуулах үнэ тохируулаагүй — Бараа, агуулах дээр оруулна уу`);
    if (override != null && salesPrice != null && Math.abs(override - salesPrice) >= 0.01)
      approvalExtra.push(`${item.name}: үнэ ${fmt(salesPrice)} → ${fmt(override)} өөрчлөгдсөн`);
    return {
      key: `${index}`,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      unit: item.unit,
      categoryCode: item.categoryCode,
      quantity,
      unitPrice,
      vatMode: toItemVatMode(item.vatMode),
      minSalesPrice: item.minSalesPrice === null ? null : Number(item.minSalesPrice),
      manualDiscountPercent: line.manualDiscountPercent ?? null,
      manualDiscountAmount: line.manualDiscountAmount ?? null,
    };
  });
  const now = ulaanbaatarNow();
  const cartCtx: CartContext = {
    customerGroup: ctx.isWalkIn ? null : ctx.customer.customerGroup,
    couponCodes: input.couponCodes ?? [],
    date: now.date,
    time: now.time,
    weekday: now.weekday,
    receiptDiscountPercent: input.receiptDiscountPercent ?? null,
    receiptDiscountAmount: input.receiptDiscountAmount ?? null,
    discountStacking: ctx.settings.discountStacking === "cumulative" ? "cumulative" : "best_single",
    maxManualDiscountPercent: Number(ctx.settings.maxManualDiscountPercent),
    maxTotalDiscountPercent: Number(ctx.settings.maxTotalDiscountPercent),
  };
  const discounts = applyDiscounts(cart, ctx.rules, cartCtx);
  const totals = computeSaleTotals(discounts.lines, {
    isVatPayer: ctx.isVatPayer,
    vatRatePercent: ctx.vatRatePercent,
  });
  return {
    now,
    cart,
    discounts,
    totals,
    approvalReasons: [...discounts.approvalReasons, ...approvalExtra],
    itemById,
  };
}

async function quoteContext(orgId: string, userId: string, counterpartyId: string | null | undefined): Promise<QuoteContext> {
  const settings = await ensurePosSettings(orgId, userId);
  const [vat, rules, { customer, isWalkIn }] = await Promise.all([
    loadVatSettings(orgId, userId),
    loadDiscountRuleViews(orgId),
    resolveCustomer(orgId, settings, counterpartyId),
  ]);
  return {
    orgId,
    settings,
    isVatPayer: vat.isVatPayer,
    vatRatePercent: Number(vat.vatRatePercent),
    rules,
    customer,
    isWalkIn,
  };
}

export interface SaleQuote {
  lines: TotaledLine[];
  grossAmount: number;
  discountTotal: number;
  netAmount: number;
  vatAmount: number;
  total: number;
  receiptDiscounts: { ruleCode: string | null; kind: string; amount: number }[];
  approvalReasons: string[];
  isVatPayer: boolean;
}

/** Кассын дэлгэцийн үнийн санал — борлуулалттай ЯГ ижил хөдөлгөгч. */
export async function quotePosSale(input: SaleQuoteInput): Promise<ActionResult<{ quote: SaleQuote }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const ctx = await quoteContext(orgId, userId, input.counterpartyId);
    const quote = await buildQuote(input, ctx);
    return {
      quote: {
        lines: quote.totals.lines,
        grossAmount: quote.totals.grossAmount,
        discountTotal: quote.totals.discountTotal,
        netAmount: quote.totals.netAmount,
        vatAmount: quote.totals.vatAmount,
        total: quote.totals.total,
        receiptDiscounts: quote.discounts.receiptDiscounts.map((entry) => ({
          ruleCode: entry.ruleCode,
          kind: entry.kind,
          amount: entry.amount,
        })),
        approvalReasons: quote.approvalReasons,
        isVatPayer: ctx.isVatPayer,
      },
    };
  } catch (caught) {
    return actionError("quotePosSale", caught, "Үнийн санал тооцогдсонгүй");
  }
}

// ─── Борлуулалт (НЭГ транзакц) ────────────────────────────────────────────────

export interface CreatePosSaleInput extends SaleQuoteInput {
  shiftId: string;
  warehouseId?: string | null;
  payments: PaymentInput[];
  note?: string | null;
  /** Гараар олгосон ДДТД (PosAPI-гүй үед) — өгвөл автомат илгээлт ҮГҮЙ. */
  ebarimtId?: string | null;
  /** Иргэний eBarimt дугаар (8 орон) — B2C баримтад. */
  ebarimtConsumerNo?: string | null;
  /** Байгууллагын ТТД — өгвөл B2B баримт. РД өгвөл ТЕГ-ийн лавлахаас ТТД хайна. */
  ebarimtCustomerTin?: string | null;
  ebarimtCustomerRegNo?: string | null;
  /**
   * Кассчин ЭНЭ борлуулалтыг eBarimt-гүй явуулна (төлбөрийн диалогийн «eBarimt
   * илгээх» унтраалттай) — статус `skipped`, дараалалд орохгүй; панелиас
   * [Илгээх]-ээр дараа нь илгээж болно. eBarimt унтраалттай бол нөлөөгүй.
   */
  skipEbarimt?: boolean | null;
}

export interface PosReceipt {
  saleId: string;
  documentNo: string;
  date: string;
  soldAt: string;
  cashierName: string;
  customerName: string;
  isVatPayer: boolean;
  lines: { name: string; quantity: number; unit: string; unitPrice: number; discount: number; total: number }[];
  grossAmount: number;
  discountTotal: number;
  netAmount: number;
  vatAmount: number;
  roundingAmount: number;
  total: number;
  payments: { name: string; amount: number; currency: string; baseAmount: number; change: number }[];
  change: number;
  header: string;
  footer: string;
  /** Хасах үлдэгдэлд орсон бараанууд (D9 мэдэгдэл). */
  negativeStock: { itemName: string; warehouseName: string; balanceAfter: number }[];
  ebarimtId: string | null;
  /**
   * Сугалаа ба QR — ЗӨВХӨН борлуулалтын мөчид PosAPI-ийн хариунаас (түр, нэг
   * удаагийн хэвлэлт). DB-д хадгалагдахгүй (албан спек §5) тул дахин хэвлэхэд
   * үргэлж null — зөвхөн ДДТД гарна.
   */
  ebarimtLottery: string | null;
  ebarimtQrData: string | null;
  ebarimtStatus: string | null;
}

export async function createPosSale(
  input: CreatePosSaleInput
): Promise<ActionResult<{ id: string; documentNo: string; receipt: PosReceipt }>> {
  try {
    return await createPosSaleCore(input);
  } catch (caught) {
    return actionError("createPosSale", caught, "Борлуулалт бүртгэгдсэнгүй");
  }
}

async function createPosSaleCore(input: CreatePosSaleInput) {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
  const ctx = await quoteContext(orgId, userId, input.counterpartyId);
  const quote = await buildQuote(input, ctx);
  if (quote.approvalReasons.length > 0) {
    // Менежерийн зөвшөөрөл = pos:post эрх (D5). Кассчин зөвшөөрөлгүй бол алдаа.
    try {
      await requireModuleAction(POS_MODULE_KEY, "post");
    } catch {
      throw new Error(`[APPROVAL_REQUIRED] ${quote.approvalReasons.join("; ")}`);
    }
  }
  const { settings, customer, isWalkIn } = ctx;
  const date = quote.now.date;
  await assertPeriodOpen(orgId, date);

  // eBarimt худалдан авагч (§4.5): ТТД ил → B2B; РД → ТЕГ-ийн лавлах; 8 оронтой → иргэн.
  const manualEbarimtId = cleanText(input.ebarimtId);
  let ebarimtCustomerTin = cleanText(input.ebarimtCustomerTin);
  const ebarimtCustomerRegNo = cleanText(input.ebarimtCustomerRegNo);
  if (!ebarimtCustomerTin && ebarimtCustomerRegNo) {
    const info = await lookupTinByRegNo(ebarimtCustomerRegNo);
    ebarimtCustomerTin = info.tin;
  }
  if (ebarimtCustomerTin && !MERCHANT_TIN_RE.test(ebarimtCustomerTin))
    throw new Error("Худалдан авагчийн ТТД 11 эсвэл 14 оронтой тоо байна");
  const ebarimtConsumerNo = cleanText(input.ebarimtConsumerNo);
  if (ebarimtConsumerNo && !CONSUMER_NO_RE.test(ebarimtConsumerNo))
    throw new Error("Иргэний eBarimt дугаар 8 оронтой тоо байна");
  // НӨАТ төлөгч бус байгууллагад eBarimt огт үүсгэхгүй (ctx.isVatPayer — vat_settings);
  // кассчин «eBarimt илгээх»-ийг унтраасан бол skipped (ЦЭВЭР дүрэм — receipt.ts).
  const ebarimtPlan = initialSaleEbarimtStatus({
    enabled: settings.ebarimtEnabled,
    isVatPayer: ctx.isVatPayer,
    manualId: manualEbarimtId,
    skip: !!input.skipEbarimt,
  });
  const autoEbarimt = ebarimtPlan.autoSend;

  const shift = await db.query.posShifts.findFirst({
    where: and(
      eq(posShifts.id, input.shiftId),
      eq(posShifts.organizationId, orgId),
      eq(posShifts.status, "open")
    ),
  });
  if (!shift) throw new Error("Нээлттэй ээлж олдсонгүй — эхлээд ээлж нээнэ үү");
  const warehouseId = cleanText(input.warehouseId) ?? shift.warehouseId;
  const warehouse = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
  });
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");

  // Төлбөрийн төлөвлөгөө.
  const methods = await loadPaymentMethodViews(orgId);
  const giftCodes = (input.payments ?? []).map((payment) => cleanText(payment.giftCardCode)).filter((code): code is string => !!code);
  const giftCards = giftCodes.length
    ? await db.query.posGiftCards.findMany({
        where: and(eq(posGiftCards.organizationId, orgId), inArray(posGiftCards.code, giftCodes), eq(posGiftCards.status, "active")),
      })
    : [];
  const storeCreditRows = isWalkIn
    ? []
    : await db.query.posStoreCredits.findMany({
        where: and(
          eq(posStoreCredits.organizationId, orgId),
          eq(posStoreCredits.counterpartyId, customer.id),
          eq(posStoreCredits.status, "active")
        ),
      });
  const openReceivable = isWalkIn ? 0 : await loadOpenReceivable(db, orgId, customer.id);
  const advanceBalance = isWalkIn ? 0 : await loadAdvanceBalance(orgId, customer.name, settings.customerAdvanceAccountNumber);
  const plan = planPayments(input.payments ?? [], methods, quote.totals.total, {
    isWalkIn,
    creditLimit: customer.creditLimit === null ? null : Number(customer.creditLimit),
    openReceivable,
    advanceBalance,
    giftCardBalances: Object.fromEntries(giftCards.map((card) => [card.code, Number(card.balance)])),
    storeCreditBalances: Object.fromEntries(storeCreditRows.map((credit) => [credit.id, Number(credit.balance)])),
    fxRates: shift.fxRates ?? {},
    cashRoundingUnit: settings.cashRoundingUnit,
  });
  if (plan.errors.length > 0) throw new Error(plan.errors.join("; "));

  const controlAccount = customer.defaultReceivableAccountNumber?.trim();
  if (!controlAccount) throw new Error(`${customer.name}: default авлагын данс тохируулаагүй байна`);
  await assertEnabledMainAccount(orgId, controlAccount);
  const vat = await loadVatSettings(orgId, userId);
  const builders = await codeBuilders(orgId);
  const issueType =
    (settings.issueTypeId
      ? (await loadIssueTypes(orgId, { activeOnly: true })).find((type) => type.id === settings.issueTypeId) ?? null
      : null) ?? (await defaultIssueType(orgId));
  if (!issueType) throw new Error("Зарлагын төрөл (COGS) тохируулаагүй байна");

  // Барааны данснууд (бичих мөчид).
  const itemAccounts = new Map<string, { inventoryAccountNumber: string; cogsAccountNumber: string }>();
  for (const itemId of new Set(quote.cart.map((line) => line.itemId)))
    itemAccounts.set(itemId, await itemAccountsFor(orgId, userId, itemId));
  const revenueAccountOf = (itemId: string) =>
    quote.itemById.get(itemId)?.revenueAccountNumber?.trim() || settings.revenueAccountNumber;
  for (const line of quote.cart) await assertEnabledMainAccount(orgId, revenueAccountOf(line.itemId));
  if (quote.totals.vatAmount > 0) await assertEnabledMainAccount(orgId, vat.outputVatAccountNumber);
  if (settings.discountPosting === "contra" && quote.totals.discountTotal > 0)
    await assertEnabledMainAccount(orgId, settings.discountAccountNumber);
  if (plan.roundingAmount !== 0) await assertEnabledMainAccount(orgId, settings.roundingAccountNumber);

  const negativeStock: PosReceipt["negativeStock"] = [];
  let saleId = "";
  let documentNo = "";
  const soldAt = new Date();

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, date);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), ${POS_LOCK_KEY})`);

    // Үлдэгдэл: зөвшөөрөгдөөгүй бол confirm-тэй ИЖИЛ replay; зөвшөөрсөн бол
    // хасах болсон барааг мэдэгдэлд цуглуулна (D9).
    const ledger = await loadQtyLedgerFast(orgId, undefined, tx);
    const nowIso = soldAt.toISOString();
    const pending: MovementRef[] = quote.cart.map((line, index) => ({
      id: `pending-pos-${index}`,
      movementType: "issue",
      date,
      itemId: line.itemId,
      warehouseId,
      toWarehouseId: null,
      quantity: line.quantity,
      createdAt: nowIso,
    }));
    const violation = findNegativeStock([...ledger.movements, ...pending], null, ledger.opening);
    if (violation) {
      if (!settings.allowNegativeStock)
        throw new Error(
          `[NEGATIVE_STOCK] ${quote.itemById.get(violation.itemId)?.name ?? ""}: үлдэгдэл хасах болно (${violation.balanceAfter}) — борлуулалт зогсов`
        );
      // Мэдэгдэл: бараа бүрийн эцсийн үлдэгдэл.
      const balances = new Map<string, number>(ledger.opening);
      for (const movement of [...ledger.movements, ...pending]) {
        const key = balanceKey(movement.itemId, movement.warehouseId);
        const sign = movement.movementType === "issue" || movement.movementType === "return_out" ? -1 : 1;
        if (movement.movementType === "transfer") continue;
        balances.set(key, Math.round(((balances.get(key) ?? 0) + sign * movement.quantity) * 10000) / 10000);
      }
      for (const line of quote.cart) {
        const after = balances.get(balanceKey(line.itemId, warehouseId)) ?? 0;
        if (after < -0.00005 && !negativeStock.some((entry) => entry.itemName === line.itemName))
          negativeStock.push({ itemName: line.itemName, warehouseName: warehouse.name, balanceAfter: after });
      }
    }

    documentNo = await nextSequentialNo(tx, posSales, orgId, POS_SALE_NO_PREFIX, date, 4);
    const payable = plan.payable;

    // ① pos_sales
    const [sale] = await tx
      .insert(posSales)
      .values({
        userId,
        organizationId: orgId,
        documentNo,
        shiftId: shift.id,
        warehouseId,
        counterpartyId: customer.id,
        cashierUserId: userId,
        soldAt,
        date,
        grossAmount: String(quote.totals.grossAmount),
        discountTotal: String(quote.totals.discountTotal),
        netAmount: String(quote.totals.netAmount),
        vatAmount: String(quote.totals.vatAmount),
        roundingAmount: String(plan.roundingAmount),
        total: String(payable),
        status: "posted",
        note: input.note?.trim() ?? "",
        ebarimtId: manualEbarimtId,
        ebarimtStatus: ebarimtPlan.status,
        ebarimtConsumerNo,
        ebarimtCustomerTin,
      })
      .returning({ id: posSales.id });
    saleId = sale.id;
    const businessObject = { businessObjectType: POS_BUSINESS_OBJECT, businessObjectId: saleId };
    const tag = `[${documentNo}]`;

    // ② АР нэхэмжлэх (posted) + журнал
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date,
        description: `${tag} POS борлуулалт — ${customer.name}`,
        status: "posted",
        externalRef: `pos-sale:${saleId}`,
      })
      .returning({ id: journalVouchers.id });
    const arDocNo = `AR-${documentNo}`;
    const [arDoc] = await tx
      .insert(arApDocuments)
      .values({
        userId,
        organizationId: orgId,
        documentNo: arDocNo,
        documentType: "ar_invoice",
        counterpartyId: customer.id,
        date,
        dueDate: date,
        currency: "MNT",
        exchangeRate: "1",
        controlAccountNumber: controlAccount,
        description: `${tag} POS борлуулалт`,
        totalAmount: String(payable),
        paidAmount: "0",
        baseTotalAmount: String(payable),
        basePaidAmount: "0",
        status: "posted",
        voucherId: voucher.id,
        sourceType: POS_SOURCE_TYPE,
        sourceId: saleId,
        postedAt: soldAt,
      })
      .returning({ id: arApDocuments.id });

    const voucherLines: (typeof journalLines.$inferInsert)[] = [];
    let sortOrder = 0;
    voucherLines.push({
      voucherId: voucher.id,
      accountNumber: builders.sale(controlAccount),
      debit: String(payable),
      credit: "0",
      description: `${tag} ${customer.name}`,
      sortOrder: sortOrder++,
      ...businessObject,
    });
    const arLineIds: string[] = [];
    let vatTotal = 0;
    for (const [index, line] of quote.totals.lines.entries()) {
      const revenueMain = revenueAccountOf(line.itemId);
      const [arLine] = await tx
        .insert(arApDocumentLines)
        .values({
          documentId: arDoc.id,
          accountNumber: revenueMain,
          description: `${line.itemCode} · ${line.itemName}`,
          amount: String(line.netAmount),
          itemId: line.itemId,
          quantity: String(line.quantity),
          warehouseId,
          unitPrice: String(line.unitPrice),
          sortOrder: index,
        })
        .returning({ id: arApDocumentLines.id });
      arLineIds.push(arLine.id);
      vatTotal += line.vatAmount;
      if (settings.discountPosting === "contra" && line.discountAmount > 0) {
        // Cr Орлого БҮТЭН (цэвэр + хөнгөлөлтийн НӨАТ-гүй хэсэг) + Dr Хөнгөлөлт — GL-д л
        const discountNet = discountNetOf(line.discountAmount, line.vatMode, {
          isVatPayer: ctx.isVatPayer,
          vatRatePercent: ctx.vatRatePercent,
        });
        voucherLines.push({
          voucherId: voucher.id,
          accountNumber: builders.sale(revenueMain),
          debit: "0",
          credit: String(round2(line.netAmount + discountNet)),
          description: `${tag} ${line.itemName}`,
          sortOrder: sortOrder++,
          ...businessObject,
        });
        voucherLines.push({
          voucherId: voucher.id,
          accountNumber: builders.sale(settings.discountAccountNumber),
          debit: String(discountNet),
          credit: "0",
          description: `${tag} хөнгөлөлт — ${line.itemName}`,
          sortOrder: sortOrder++,
          ...businessObject,
        });
      } else
        voucherLines.push({
          voucherId: voucher.id,
          accountNumber: builders.sale(revenueMain),
          debit: "0",
          credit: String(line.netAmount),
          description: `${tag} ${line.itemName}`,
          sortOrder: sortOrder++,
          ...businessObject,
        });
    }
    vatTotal = round2(vatTotal);
    if (vatTotal > 0) {
      await tx.insert(arApDocumentLines).values({
        documentId: arDoc.id,
        accountNumber: vat.outputVatAccountNumber,
        description: `НӨАТ ${ctx.vatRatePercent}%`,
        amount: String(vatTotal),
        sortOrder: quote.totals.lines.length,
      });
      voucherLines.push({
        voucherId: voucher.id,
        accountNumber: builders.sale(vat.outputVatAccountNumber),
        debit: "0",
        credit: String(vatTotal),
        description: `${tag} НӨАТ ${ctx.vatRatePercent}%`,
        sortOrder: sortOrder++,
        ...businessObject,
      });
    }
    if (plan.roundingAmount !== 0) {
      await tx.insert(arApDocumentLines).values({
        documentId: arDoc.id,
        accountNumber: settings.roundingAccountNumber,
        description: "Бөөрөнхийлөл",
        amount: String(plan.roundingAmount),
        sortOrder: quote.totals.lines.length + 1,
      });
      voucherLines.push({
        voucherId: voucher.id,
        accountNumber: builders.sale(settings.roundingAccountNumber),
        debit: plan.roundingAmount < 0 ? String(Math.abs(plan.roundingAmount)) : "0",
        credit: plan.roundingAmount > 0 ? String(plan.roundingAmount) : "0",
        description: `${tag} бөөрөнхийлөл`,
        sortOrder: sortOrder++,
        ...businessObject,
      });
    }
    await tx.insert(journalLines).values(voucherLines);

    // ③ Зарлага (confirmed) + ④ урьдчилсан COGS
    const periodCode = periodCodeOf(date);
    const scopes = [...new Set(quote.cart.map((line) => line.itemId))].map((itemId) => ({ itemId, warehouseId }));
    const provisional = settings.provisionalCogs
      ? await loadProvisionalUnitCosts(tx, orgId, scopes, periodCode)
      : new Map<string, number | null>();
    let costVoucherId: string | null = null;
    let costSort = 0;
    const lineRows: { lineId: string; movementId: string; costEntryId: string | null }[] = [];
    for (const [index, line] of quote.totals.lines.entries()) {
      const [saleLine] = await tx
        .insert(posSaleLines)
        .values({
          saleId,
          itemId: line.itemId,
          description: line.itemName,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          lineGross: String(line.lineGross),
          discountAmount: String(line.discountAmount),
          discountDetail: line.discountDetail,
          vatMode: line.vatMode,
          netAmount: String(line.netAmount),
          vatAmount: String(line.vatAmount),
          lineTotal: String(line.lineTotal),
          arApLineId: arLineIds[index] ?? null,
          sortOrder: index,
        })
        .returning({ id: posSaleLines.id });
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          userId,
          organizationId: orgId,
          documentNo: `${documentNo}-${String(index + 1).padStart(2, "0")}`,
          movementType: "issue",
          date,
          itemId: line.itemId,
          warehouseId,
          toWarehouseId: null,
          quantity: String(line.quantity),
          description: `${tag} ${line.itemName}`,
          status: "confirmed",
          confirmedAt: soldAt,
          issueTypeId: issueType.id,
          sourceType: POS_MOVEMENT_SOURCE_TYPE,
          sourceId: saleLine.id,
        })
        .returning({ id: inventoryMovements.id });

      let costEntryId: string | null = null;
      const average = provisional.get(scopeKey(line.itemId, warehouseId)) ?? null;
      if (average != null && average > 0) {
        const accounts = itemAccounts.get(line.itemId)!;
        const debit = resolveIssueDebitAccount(issueType, accounts.cogsAccountNumber);
        const credit = accounts.inventoryAccountNumber;
        await assertEnabledMainAccount(orgId, debit);
        await assertEnabledMainAccount(orgId, credit);
        const amount = round2(line.quantity * average);
        if (amount > 0) {
          if (!costVoucherId) {
            const [costVoucher] = await tx
              .insert(journalVouchers)
              .values({
                userId,
                organizationId: orgId,
                date,
                description: `${tag} Урьдчилсан COGS (явцын дундаж) — сар хаалтад залруулагдана`,
                status: "posted",
                externalRef: `pos-cogs:${saleId}`,
              })
              .returning({ id: journalVouchers.id });
            costVoucherId = costVoucher.id;
          }
          const [entry] = await tx
            .insert(costEntries)
            .values({
              userId,
              organizationId: orgId,
              movementId: movement.id,
              itemId: line.itemId,
              warehouseId,
              periodCode,
              issueTypeId: issueType.id,
              entryType: "issue_cogs",
              date,
              quantity: String(line.quantity),
              unitCost: String(Math.round(average * 10000) / 10000),
              amount: String(amount),
              valuationSource: PROVISIONAL_VALUATION_SOURCE,
              debitAccountNumber: debit,
              creditAccountNumber: credit,
              status: "posted",
              postedAt: soldAt,
              voucherId: costVoucherId,
              ...businessObject,
            })
            .returning({ id: costEntries.id });
          costEntryId = entry.id;
          const costDescription = `${tag} ${line.itemName} — ${line.quantity} × ${fmt(average)} (урьдчилсан)`;
          await tx.insert(journalLines).values([
            {
              voucherId: costVoucherId,
              costEntryId: entry.id,
              inventoryMovementId: movement.id,
              accountNumber: builders.cost(debit),
              debit: String(amount),
              credit: "0",
              description: costDescription,
              sortOrder: costSort++,
              ...businessObject,
            },
            {
              voucherId: costVoucherId,
              costEntryId: entry.id,
              inventoryMovementId: movement.id,
              accountNumber: builders.cost(credit),
              debit: "0",
              credit: String(amount),
              description: costDescription,
              sortOrder: costSort++,
              ...businessObject,
            },
          ]);
        }
      }
      await tx
        .update(posSaleLines)
        .set({ movementId: movement.id, provisionalCostEntryId: costEntryId })
        .where(eq(posSaleLines.id, saleLine.id));
      lineRows.push({ lineId: saleLine.id, movementId: movement.id, costEntryId });
    }

    // Баримтын түвшний хөнгөлөлтүүд.
    if (quote.discounts.receiptDiscounts.length > 0)
      await tx.insert(posSaleDiscounts).values(
        quote.discounts.receiptDiscounts.map((entry) => ({
          saleId,
          ruleId: entry.ruleId,
          kind: entry.kind,
          amount: String(entry.amount),
          approvedBy: quote.approvalReasons.length > 0 ? userId : null,
        }))
      );
    if (quote.discounts.appliedRuleIds.length > 0)
      await tx
        .update(posDiscountRules)
        .set({ usedCount: sql`${posDiscountRules.usedCount} + 1` })
        .where(inArray(posDiscountRules.id, quote.discounts.appliedRuleIds));

    // ⑤ Төлбөр бүр
    let settled = 0;
    for (const [index, payment] of plan.payments.entries()) {
      const netBase = round2(payment.baseAmount - payment.changeGiven);
      const netAmount = round2(payment.amount - payment.changeGiven / payment.exchangeRate);
      const [row] = await tx
        .insert(posPayments)
        .values({
          saleId,
          paymentMethodId: payment.method.id,
          amount: String(payment.amount),
          currency: payment.currency,
          exchangeRate: String(payment.exchangeRate),
          baseAmount: String(payment.baseAmount),
          changeGiven: String(payment.changeGiven),
          reference: cleanText(payment.reference),
          giftCardId: payment.giftCardCode ? (giftCards.find((card) => card.code === payment.giftCardCode)?.id ?? null) : null,
          storeCreditId: cleanText(payment.storeCreditId),
          sortOrder: index,
        })
        .returning({ id: posPayments.id });
      if (netBase <= 0) continue;
      const kind = payment.method.kind;
      if (kind === "credit") continue; // АР нээлттэй үлдэнэ

      if (PAYMENT_KINDS_WITH_CASH_ACCOUNT.includes(kind)) {
        const account = await tx.query.cashAccounts.findFirst({
          where: and(eq(cashAccounts.id, payment.method.cashAccountId ?? ""), eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
        });
        if (!account) throw new Error(`"${payment.method.name}": касс/банкны данс идэвхгүй`);
        const [cashVoucher] = await tx
          .insert(journalVouchers)
          .values({
            userId,
            organizationId: orgId,
            date,
            description: `${tag} Төлбөр — ${payment.method.name}`,
            status: "posted",
            externalRef: `pos-pay:${row.id}`,
          })
          .returning({ id: journalVouchers.id });
        const [cashDoc] = await tx
          .insert(cashDocuments)
          .values({
            userId,
            organizationId: orgId,
            documentNo: `${documentNo}-P${index + 1}`,
            documentType: "receipt",
            date,
            fromCashAccountId: null,
            toCashAccountId: account.id,
            counterAccountNumber: controlAccount,
            counterparty: customer.name,
            description: `${tag} POS төлбөр — ${payment.method.name}${payment.reference ? ` (${payment.reference})` : ""}`,
            amount: String(netAmount),
            currency: payment.currency,
            exchangeRate: String(payment.exchangeRate),
            baseAmount: String(netBase),
            status: "posted",
            voucherId: cashVoucher.id,
            arApDocumentId: arDoc.id,
            sourceType: POS_SOURCE_TYPE,
            sourceId: saleId,
            postedAt: soldAt,
          })
          .returning({ id: cashDocuments.id });
        await tx.insert(journalLines).values([
          {
            voucherId: cashVoucher.id,
            cashAccountId: account.id,
            accountNumber: builders.cash(account.glAccountNumber),
            debit: String(netBase),
            credit: "0",
            description: `${tag} ${payment.method.name}`,
            sortOrder: 0,
            ...businessObject,
          },
          {
            voucherId: cashVoucher.id,
            accountNumber: builders.cash(controlAccount),
            debit: "0",
            credit: String(netBase),
            description: `${tag} ${customer.name}`,
            sortOrder: 1,
            ...businessObject,
          },
        ]);
        await tx.insert(arApSettlements).values({
          userId,
          organizationId: orgId,
          documentId: arDoc.id,
          cashDocumentId: cashDoc.id,
          settlementDate: date,
          amount: String(netBase),
          baseAmount: String(netBase),
        });
        await tx.update(posPayments).set({ cashDocumentId: cashDoc.id }).where(eq(posPayments.id, row.id));
        settled += netBase;
        continue;
      }

      // Бэлэн бус хаалт: урьдчилгаа / бэлгийн карт / дэлгүүрийн кредит →
      // Dr өглөгийн данс / Cr авлага, settlement нь voucherId-тэй (offset загвар).
      const liabilityAccount =
        kind === "advance"
          ? settings.customerAdvanceAccountNumber
          : kind === "gift_card"
            ? settings.giftCardLiabilityAccountNumber
            : settings.storeCreditLiabilityAccountNumber;
      await assertEnabledMainAccount(orgId, liabilityAccount);
      const [offsetVoucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          organizationId: orgId,
          date,
          description: `${tag} Төлбөр — ${payment.method.name}`,
          status: "posted",
          externalRef: `pos-pay:${row.id}`,
        })
        .returning({ id: journalVouchers.id });
      await tx.insert(journalLines).values([
        {
          voucherId: offsetVoucher.id,
          accountNumber: builders.sale(liabilityAccount),
          debit: String(netBase),
          credit: "0",
          description: `${tag} ${payment.method.name}`,
          sortOrder: 0,
          ...businessObject,
        },
        {
          voucherId: offsetVoucher.id,
          accountNumber: builders.sale(controlAccount),
          debit: "0",
          credit: String(netBase),
          description: `${tag} ${customer.name}`,
          sortOrder: 1,
          ...businessObject,
        },
      ]);
      await tx.insert(arApSettlements).values({
        userId,
        organizationId: orgId,
        documentId: arDoc.id,
        voucherId: offsetVoucher.id,
        settlementDate: date,
        amount: String(netBase),
        baseAmount: String(netBase),
      });
      await tx.update(posPayments).set({ voucherId: offsetVoucher.id }).where(eq(posPayments.id, row.id));
      if (kind === "gift_card") {
        const card = giftCards.find((entry) => entry.code === payment.giftCardCode);
        if (!card) throw new Error("Бэлгийн карт олдсонгүй");
        const [updatedCard] = await tx
          .update(posGiftCards)
          .set({
            balance: sql`${posGiftCards.balance} - ${String(netBase)}`,
            status: sql`case when ${posGiftCards.balance} - ${String(netBase)} <= 0.005 then 'used' else 'active' end`,
          })
          .where(and(eq(posGiftCards.id, card.id), sql`${posGiftCards.balance} >= ${String(netBase)} - 0.005`))
          .returning({ id: posGiftCards.id });
        if (!updatedCard) throw new Error("Бэлгийн картын үлдэгдэл өөрчлөгдсөн байна");
      }
      if (kind === "store_credit") {
        const [updatedCredit] = await tx
          .update(posStoreCredits)
          .set({
            balance: sql`${posStoreCredits.balance} - ${String(netBase)}`,
            status: sql`case when ${posStoreCredits.balance} - ${String(netBase)} <= 0.005 then 'used' else 'active' end`,
          })
          .where(
            and(
              eq(posStoreCredits.id, payment.storeCreditId ?? ""),
              eq(posStoreCredits.organizationId, orgId),
              sql`${posStoreCredits.balance} >= ${String(netBase)} - 0.005`
            )
          )
          .returning({ id: posStoreCredits.id });
        if (!updatedCredit) throw new Error("Дэлгүүрийн кредитийн үлдэгдэл өөрчлөгдсөн байна");
      }
      settled += netBase;
    }
    settled = round2(settled);
    await tx
      .update(arApDocuments)
      .set({
        paidAmount: String(settled),
        basePaidAmount: String(settled),
        status: settled >= payable - 0.005 ? "paid" : settled > 0 ? "partially_paid" : "posted",
      })
      .where(eq(arApDocuments.id, arDoc.id));
    await tx.update(posSales).set({ arApDocumentId: arDoc.id }).where(eq(posSales.id, saleId));

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "create_posted",
        entityType: "pos_sale",
        entityId: saleId,
        summary: `POS борлуулалт — ${documentNo}, ${date}, ${customer.name}, ${quote.totals.lines.length} мөр, төлөх ${fmt(payable)}₮ (${plan.payments.map((payment) => `${payment.method.name} ${fmt(payment.baseAmount - payment.changeGiven)}`).join(", ")})${ebarimtPlan.status === "skipped" ? " — eBarimt илгээгээгүй (кассчин)" : ""}`,
      },
      tx
    );
  });

  // eBarimt дараалал — commit-ийн ДАРАА, борлуулалтыг ХЭЗЭЭ Ч зогсоохгүй (§4.4).
  // Server горимд хариуг ХҮЛЭЭЖ (≤ EBARIMT_INLINE_SEND_TIMEOUT_MS) баримт дээр
  // сугалаа/QR-ийг НЭГ удаа хэвлүүлнэ — DB-д хадгалагдахгүй (албан спек §5).
  // Хэтэрвэл баримт QR-гүй гарч, илгээлт ард үргэлжилнэ (ДДТД дахин хэвлэхэд).
  let liveEbarimt: EbarimtSaleResult | null = null;
  if (autoEbarimt) {
    const submissionId = await enqueueEbarimt(orgId, saleId, "send");
    if (settings.ebarimtMode !== "browser") {
      if (submissionId) liveEbarimt = await sendSubmissionNow(submissionId, settings, EBARIMT_INLINE_SEND_TIMEOUT_MS);
      if (!liveEbarimt)
        void processPendingEbarimt(5).catch((error) => console.error("[ebarimt] шууд илгээлт:", error));
    }
  }

  revalidatePos();
  const cashierRow = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { name: true } });
  const receipt: PosReceipt = {
    saleId,
    documentNo,
    date,
    soldAt: soldAt.toISOString(),
    cashierName: cashierRow?.name ?? "",
    customerName: isWalkIn ? "" : customer.name,
    isVatPayer: ctx.isVatPayer,
    lines: quote.totals.lines.map((line) => ({
      name: line.itemName,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discount: line.discountAmount,
      total: line.lineTotal,
    })),
    grossAmount: quote.totals.grossAmount,
    discountTotal: quote.totals.discountTotal,
    netAmount: quote.totals.netAmount,
    vatAmount: quote.totals.vatAmount,
    roundingAmount: plan.roundingAmount,
    total: plan.payable,
    payments: plan.payments.map((payment) => ({
      name: payment.method.name,
      amount: payment.amount,
      currency: payment.currency,
      baseAmount: payment.baseAmount,
      change: payment.changeGiven,
    })),
    change: plan.change,
    header: settings.receiptHeader,
    footer: settings.receiptFooter,
    negativeStock,
    ebarimtId: liveEbarimt?.ebarimtId ?? manualEbarimtId,
    ebarimtLottery: liveEbarimt?.ebarimtLottery ?? null,
    ebarimtQrData: liveEbarimt?.ebarimtQrData ?? null,
    ebarimtStatus: liveEbarimt ? "sent" : ebarimtPlan.status,
  };
  return { id: saleId, documentNo, receipt };
}

/** Харилцагчийн урьдчилгааны үлдэгдэл — урьдчилгааны дансны батлагдсан кассын орлого − POS-ын ашиглалт. */
async function loadAdvanceBalance(orgId: string, counterpartyName: string, advanceAccount: string): Promise<number> {
  const [received] = await db
    .select({ sum: sql<string>`coalesce(sum(${cashDocuments.baseAmount}), 0)` })
    .from(cashDocuments)
    .where(
      and(
        eq(cashDocuments.organizationId, orgId),
        eq(cashDocuments.status, "posted"),
        eq(cashDocuments.documentType, "receipt"),
        eq(cashDocuments.counterparty, counterpartyName),
        sql`${cashDocuments.counterAccountNumber} like ${`${advanceAccount}%`}`
      )
    );
  const [used] = await db
    .select({ sum: sql<string>`coalesce(sum(${posPayments.baseAmount}), 0)` })
    .from(posPayments)
    .innerJoin(posSales, eq(posSales.id, posPayments.saleId))
    .innerJoin(posPaymentMethods, eq(posPaymentMethods.id, posPayments.paymentMethodId))
    .innerJoin(counterparties, eq(counterparties.id, posSales.counterpartyId))
    .where(
      and(
        eq(posSales.organizationId, orgId),
        eq(posPaymentMethods.kind, "advance"),
        eq(counterparties.name, counterpartyName)
      )
    );
  return round2(Number(received?.sum ?? 0) - Number(used?.sum ?? 0));
}

// ─── Буцаалт ─────────────────────────────────────────────────────────────────

export interface ReturnPosSaleInput {
  saleId: string;
  lines: { lineId: string; quantity: number }[];
  reason: string;
  /** Буцаан олгох хэлбэрүүд (Σ = буцаах дүн); хоосон + storeCredit → дэлгүүрийн кредит. */
  refunds: PaymentInput[];
  storeCredit?: boolean;
}

export async function returnPosSale(
  input: ReturnPosSaleInput
): Promise<ActionResult<{ id: string; documentNo: string; refundTotal: number }>> {
  try {
    return await returnPosSaleCore(input);
  } catch (caught) {
    return actionError("returnPosSale", caught, "Буцаалт бүртгэгдсэнгүй");
  }
}

async function returnPosSaleCore(input: ReturnPosSaleInput) {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
  const reason = input.reason?.trim();
  if (!reason) throw new Error("Буцаалтын шалтгаан оруулна уу");
  const original = await db.query.posSales.findFirst({
    where: and(eq(posSales.id, input.saleId), eq(posSales.organizationId, orgId)),
    with: {
      lines: { with: { item: true } },
      counterparty: true,
      arApDocument: true,
      payments: { with: { method: true } },
    },
  });
  if (!original) throw new Error("Борлуулалт олдсонгүй");
  if (original.isReturn) throw new Error("Буцаалтыг буцаах боломжгүй");
  if (original.status === "voided" || original.status === "returned")
    throw new Error("Энэ борлуулалт бүхэлдээ буцаагдсан байна");
  const settings = await ensurePosSettings(orgId, userId);
  const vat = await loadVatSettings(orgId, userId);
  const now = ulaanbaatarNow();
  const date = now.date;
  await assertPeriodOpen(orgId, date);
  // Өнгөрсөн ээлжийн буцаалт — post эрх (§3.10).
  const shift = await db.query.posShifts.findFirst({
    where: and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")),
    orderBy: (row, { desc }) => [desc(row.openedAt)],
  });
  if (!shift) throw new Error("Нээлттэй ээлж олдсонгүй — буцаалт ээлж дотор хийгдэнэ");
  if (original.shiftId !== shift.id) await requireModuleAction(POS_MODULE_KEY, "post");

  // Өмнөх буцаалтууд.
  const priorReturns = await db.query.posSales.findMany({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.originalSaleId, original.id)),
    with: { lines: { columns: { originalLineId: true, quantity: true } } },
  });
  const returnedByLine = new Map<string, number>();
  for (const ret of priorReturns)
    for (const line of ret.lines)
      if (line.originalLineId)
        returnedByLine.set(line.originalLineId, (returnedByLine.get(line.originalLineId) ?? 0) + Number(line.quantity));

  const planned: {
    original: (typeof original.lines)[number];
    quantity: number;
    lineTotal: number;
    netAmount: number;
    vatAmount: number;
    discountAmount: number;
    lineGross: number;
  }[] = [];
  for (const request of input.lines) {
    const line = original.lines.find((entry) => entry.id === request.lineId);
    if (!line) throw new Error("Борлуулалтын мөр олдсонгүй");
    const quantity = Number(request.quantity);
    if (!(quantity > 0)) continue;
    const sold = Number(line.quantity);
    const already = returnedByLine.get(line.id) ?? 0;
    if (quantity > sold - already + 1e-9)
      throw new Error(`${line.description}: буцаах тоо ${quantity} нь үлдсэн ${sold - already}-аас их`);
    const ratio = quantity / sold;
    const isFull = Math.abs(quantity - (sold - already)) < 1e-9;
    const remainingOf = (value: number) => {
      // Бүтэн буцаалтад өмнө буцаасныг хассан яг үлдэгдэл; хэсэгчилсэнд pro-rata.
      if (!isFull) return round2(value * ratio);
      const priorRatio = already / sold;
      return round2(value - round2(value * priorRatio));
    };
    planned.push({
      original: line,
      quantity,
      lineTotal: remainingOf(Number(line.lineTotal)),
      netAmount: remainingOf(Number(line.netAmount)),
      vatAmount: remainingOf(Number(line.vatAmount)),
      discountAmount: remainingOf(Number(line.discountAmount)),
      lineGross: remainingOf(Number(line.lineGross)),
    });
  }
  if (planned.length === 0) throw new Error("Буцаах мөр сонгоно уу");
  const refundTotal = round2(planned.reduce((sum, entry) => sum + entry.lineTotal, 0));
  const netTotal = round2(planned.reduce((sum, entry) => sum + entry.netAmount, 0));
  const vatTotal = round2(planned.reduce((sum, entry) => sum + entry.vatAmount, 0));

  const methods = await loadPaymentMethodViews(orgId);
  const useStoreCredit = !!input.storeCredit;
  const refundPlan = useStoreCredit
    ? { payments: [] as ResolvedPayment[], errors: [] as string[] }
    : planRefund(input.refunds ?? [], methods, refundTotal, shift.fxRates ?? {});
  if (refundPlan.errors.length > 0) throw new Error(refundPlan.errors.join("; "));
  if (useStoreCredit && original.counterpartyId === settings.walkInCounterpartyId)
    throw new Error("Дэлгүүрийн кредит зөвхөн бүртгэлтэй харилцагчид");

  const controlAccount = original.arApDocument?.controlAccountNumber ?? original.counterparty?.defaultReceivableAccountNumber ?? "";
  if (!controlAccount) throw new Error("Авлагын данс олдсонгүй");
  const builders = await codeBuilders(orgId);
  const issueType =
    (settings.issueTypeId
      ? (await loadIssueTypes(orgId, { activeOnly: true })).find((type) => type.id === settings.issueTypeId) ?? null
      : null) ?? (await defaultIssueType(orgId));
  const provisionalEntries = await db.query.costEntries.findMany({
    where: inArray(
      costEntries.id,
      original.lines.map((line) => line.provisionalCostEntryId).filter((id): id is string => !!id)
    ),
  });
  const provisionalById = new Map(provisionalEntries.map((entry) => [entry.id, entry]));

  let returnId = "";
  let documentNo = "";
  const at = new Date();
  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, date);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), ${POS_LOCK_KEY})`);
    documentNo = await nextSequentialNo(tx, posSales, orgId, POS_RETURN_NO_PREFIX, date, 4);
    const [ret] = await tx
      .insert(posSales)
      .values({
        userId,
        organizationId: orgId,
        documentNo,
        shiftId: shift.id,
        warehouseId: original.warehouseId,
        counterpartyId: original.counterpartyId,
        cashierUserId: userId,
        soldAt: at,
        date,
        grossAmount: String(round2(planned.reduce((sum, entry) => sum + entry.lineGross, 0))),
        discountTotal: String(round2(planned.reduce((sum, entry) => sum + entry.discountAmount, 0))),
        netAmount: String(netTotal),
        vatAmount: String(vatTotal),
        roundingAmount: "0",
        total: String(refundTotal),
        status: "posted",
        isReturn: true,
        originalSaleId: original.id,
        returnReason: reason,
        note: "",
      })
      .returning({ id: posSales.id });
    returnId = ret.id;
    const businessObject = { businessObjectType: POS_BUSINESS_OBJECT, businessObjectId: original.id };
    const tag = `[${documentNo}]`;
    const customerName = original.counterparty?.name ?? "";

    // АР кредит: Dr Орлого (цэвэр) + Dr НӨАТ / Cr Авлага.
    const [creditVoucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date,
        description: `${tag} POS буцаалт ← ${original.documentNo} — ${reason}`,
        status: "posted",
        externalRef: `pos-return:${returnId}`,
      })
      .returning({ id: journalVouchers.id });
    const creditLines: (typeof journalLines.$inferInsert)[] = [];
    let sortOrder = 0;
    for (const entry of planned) {
      const item = entry.original.item;
      const revenueMain = item?.revenueAccountNumber?.trim() || settings.revenueAccountNumber;
      if (settings.discountPosting === "contra" && entry.discountAmount > 0) {
        const discountNet = discountNetOf(entry.discountAmount, toItemVatMode(entry.original.vatMode), {
          isVatPayer: vat.isVatPayer,
          vatRatePercent: Number(vat.vatRatePercent),
        });
        creditLines.push({
          voucherId: creditVoucher.id,
          accountNumber: builders.sale(revenueMain),
          debit: String(round2(entry.netAmount + discountNet)),
          credit: "0",
          description: `${tag} ${entry.original.description}`,
          sortOrder: sortOrder++,
          ...businessObject,
        });
        creditLines.push({
          voucherId: creditVoucher.id,
          accountNumber: builders.sale(settings.discountAccountNumber),
          debit: "0",
          credit: String(discountNet),
          description: `${tag} хөнгөлөлт — ${entry.original.description}`,
          sortOrder: sortOrder++,
          ...businessObject,
        });
      } else
        creditLines.push({
          voucherId: creditVoucher.id,
          accountNumber: builders.sale(revenueMain),
          debit: String(entry.netAmount),
          credit: "0",
          description: `${tag} ${entry.original.description}`,
          sortOrder: sortOrder++,
          ...businessObject,
        });
    }
    if (vatTotal > 0)
      creditLines.push({
        voucherId: creditVoucher.id,
        accountNumber: builders.sale(vat.outputVatAccountNumber),
        debit: String(vatTotal),
        credit: "0",
        description: `${tag} НӨАТ`,
        sortOrder: sortOrder++,
        ...businessObject,
      });
    creditLines.push({
      voucherId: creditVoucher.id,
      accountNumber: builders.sale(controlAccount),
      debit: "0",
      credit: String(refundTotal),
      description: `${tag} ${customerName}`,
      sortOrder: sortOrder++,
      ...businessObject,
    });
    await tx.insert(journalLines).values(creditLines);

    // Мөрүүд + return_in хөдөлгөөн + урьдчилсан COGS урвуу.
    let costVoucherId: string | null = null;
    let costSort = 0;
    for (const [index, entry] of planned.entries()) {
      const [line] = await tx
        .insert(posSaleLines)
        .values({
          saleId: returnId,
          itemId: entry.original.itemId,
          description: entry.original.description,
          quantity: String(entry.quantity),
          unitPrice: entry.original.unitPrice,
          lineGross: String(entry.lineGross),
          discountAmount: String(entry.discountAmount),
          discountDetail: [],
          vatMode: entry.original.vatMode,
          netAmount: String(entry.netAmount),
          vatAmount: String(entry.vatAmount),
          lineTotal: String(entry.lineTotal),
          originalLineId: entry.original.id,
          sortOrder: index,
        })
        .returning({ id: posSaleLines.id });
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          userId,
          organizationId: orgId,
          documentNo: `${documentNo}-${String(index + 1).padStart(2, "0")}`,
          movementType: "return_in",
          date,
          itemId: entry.original.itemId,
          warehouseId: original.warehouseId,
          toWarehouseId: null,
          quantity: String(entry.quantity),
          description: `${tag} ${entry.original.description} — буцаалт`,
          status: "confirmed",
          confirmedAt: at,
          issueTypeId: null,
          sourceType: POS_MOVEMENT_SOURCE_TYPE,
          sourceId: line.id,
        })
        .returning({ id: inventoryMovements.id });
      let costEntryId: string | null = null;
      const provisional = entry.original.provisionalCostEntryId
        ? provisionalById.get(entry.original.provisionalCostEntryId)
        : null;
      if (settings.provisionalCogs && provisional && issueType) {
        const unitCost = Number(provisional.unitCost);
        const amount = round2(entry.quantity * unitCost);
        const debit = provisional.creditAccountNumber ?? "";
        const credit = provisional.debitAccountNumber ?? "";
        if (amount > 0 && debit && credit) {
          if (!costVoucherId) {
            const [costVoucher] = await tx
              .insert(journalVouchers)
              .values({
                userId,
                organizationId: orgId,
                date,
                description: `${tag} Буцаалтын урьдчилсан COGS урвуу — сар хаалтад залруулагдана`,
                status: "posted",
                externalRef: `pos-cogs:${returnId}`,
              })
              .returning({ id: journalVouchers.id });
            costVoucherId = costVoucher.id;
          }
          const [costEntry] = await tx
            .insert(costEntries)
            .values({
              userId,
              organizationId: orgId,
              movementId: movement.id,
              itemId: entry.original.itemId,
              warehouseId: original.warehouseId,
              periodCode: periodCodeOf(date),
              issueTypeId: issueType.id,
              entryType: "return_in",
              date,
              quantity: String(entry.quantity),
              unitCost: String(unitCost),
              amount: String(amount),
              valuationSource: PROVISIONAL_VALUATION_SOURCE,
              debitAccountNumber: debit,
              creditAccountNumber: credit,
              status: "posted",
              postedAt: at,
              voucherId: costVoucherId,
              ...businessObject,
            })
            .returning({ id: costEntries.id });
          costEntryId = costEntry.id;
          const description = `${tag} ${entry.original.description} — ${entry.quantity} × ${fmt(unitCost)} (урьдчилсан урвуу)`;
          await tx.insert(journalLines).values([
            {
              voucherId: costVoucherId,
              costEntryId: costEntry.id,
              inventoryMovementId: movement.id,
              accountNumber: builders.cost(debit),
              debit: String(amount),
              credit: "0",
              description,
              sortOrder: costSort++,
              ...businessObject,
            },
            {
              voucherId: costVoucherId,
              costEntryId: costEntry.id,
              inventoryMovementId: movement.id,
              accountNumber: builders.cost(credit),
              debit: "0",
              credit: String(amount),
              description,
              sortOrder: costSort++,
              ...businessObject,
            },
          ]);
        }
      }
      await tx
        .update(posSaleLines)
        .set({ movementId: movement.id, provisionalCostEntryId: costEntryId })
        .where(eq(posSaleLines.id, line.id));
    }

    // Буцаан олголт.
    if (useStoreCredit) {
      await assertEnabledMainAccount(orgId, settings.storeCreditLiabilityAccountNumber);
      const [voucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          organizationId: orgId,
          date,
          description: `${tag} Дэлгүүрийн кредит олгов`,
          status: "posted",
          externalRef: `pos-refund:${returnId}`,
        })
        .returning({ id: journalVouchers.id });
      await tx.insert(journalLines).values([
        {
          voucherId: voucher.id,
          accountNumber: builders.sale(controlAccount),
          debit: String(refundTotal),
          credit: "0",
          description: `${tag} ${customerName}`,
          sortOrder: 0,
          ...businessObject,
        },
        {
          voucherId: voucher.id,
          accountNumber: builders.sale(settings.storeCreditLiabilityAccountNumber),
          debit: "0",
          credit: String(refundTotal),
          description: `${tag} дэлгүүрийн кредит`,
          sortOrder: 1,
          ...businessObject,
        },
      ]);
      await tx.insert(posStoreCredits).values({
        organizationId: orgId,
        counterpartyId: original.counterpartyId,
        amount: String(refundTotal),
        balance: String(refundTotal),
        sourceSaleId: returnId,
        status: "active",
      });
      const method = methods.find((entry) => entry.kind === "store_credit");
      if (method)
        await tx.insert(posPayments).values({
          saleId: returnId,
          paymentMethodId: method.id,
          amount: String(refundTotal),
          currency: "MNT",
          exchangeRate: "1",
          baseAmount: String(refundTotal),
          voucherId: voucher.id,
          sortOrder: 0,
        });
    } else {
      for (const [index, payment] of refundPlan.payments.entries()) {
        const kind = payment.method.kind;
        if (kind === "credit") {
          // Зээлийн борлуулалтын буцаалт: нээлттэй авлагыг бууруулна.
          const doc = original.arApDocument;
          if (!doc) throw new Error("Эх нэхэмжлэх олдсонгүй");
          const open = round2(Number(doc.baseTotalAmount) - Number(doc.basePaidAmount));
          if (payment.baseAmount > open + 0.005)
            throw new Error(`Нээлттэй авлага ${fmt(open)}₮ — зээлээр буцаах дүн үүнээс ихгүй`);
          const [updated] = await tx
            .update(arApDocuments)
            .set({
              totalAmount: sql`${arApDocuments.totalAmount} - ${String(payment.baseAmount)}`,
              baseTotalAmount: sql`${arApDocuments.baseTotalAmount} - ${String(payment.baseAmount)}`,
              status: sql`case when ${arApDocuments.paidAmount} >= ${arApDocuments.totalAmount} - ${String(payment.baseAmount)} - 0.005 then 'paid' when ${arApDocuments.paidAmount} > 0 then 'partially_paid' else 'posted' end`,
            })
            .where(eq(arApDocuments.id, doc.id))
            .returning({ id: arApDocuments.id });
          if (!updated) throw new Error("Нэхэмжлэх шинэчлэгдсэнгүй");
          await tx.insert(posPayments).values({
            saleId: returnId,
            paymentMethodId: payment.method.id,
            amount: String(payment.amount),
            currency: payment.currency,
            exchangeRate: String(payment.exchangeRate),
            baseAmount: String(payment.baseAmount),
            sortOrder: index,
          });
          continue;
        }
        if (!PAYMENT_KINDS_WITH_CASH_ACCOUNT.includes(kind))
          throw new Error(`"${payment.method.name}" хэлбэрээр буцаан олгох боломжгүй — бэлэн, карт эсвэл дэлгүүрийн кредит`);
        const account = await tx.query.cashAccounts.findFirst({
          where: and(eq(cashAccounts.id, payment.method.cashAccountId ?? ""), eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
        });
        if (!account) throw new Error(`"${payment.method.name}": касс/банкны данс идэвхгүй`);
        const [voucher] = await tx
          .insert(journalVouchers)
          .values({
            userId,
            organizationId: orgId,
            date,
            description: `${tag} Буцаан олголт — ${payment.method.name}`,
            status: "posted",
            externalRef: `pos-refund:${returnId}:${index}`,
          })
          .returning({ id: journalVouchers.id });
        const [cashDoc] = await tx
          .insert(cashDocuments)
          .values({
            userId,
            organizationId: orgId,
            documentNo: `${documentNo}-R${index + 1}`,
            documentType: "payment",
            date,
            fromCashAccountId: account.id,
            toCashAccountId: null,
            counterAccountNumber: controlAccount,
            counterparty: customerName,
            description: `${tag} POS буцаан олголт — ${payment.method.name}`,
            amount: String(payment.amount),
            currency: payment.currency,
            exchangeRate: String(payment.exchangeRate),
            baseAmount: String(payment.baseAmount),
            status: "posted",
            voucherId: voucher.id,
            sourceType: POS_SOURCE_TYPE,
            sourceId: returnId,
            postedAt: at,
          })
          .returning({ id: cashDocuments.id });
        await tx.insert(journalLines).values([
          {
            voucherId: voucher.id,
            accountNumber: builders.cash(controlAccount),
            debit: String(payment.baseAmount),
            credit: "0",
            description: `${tag} ${customerName}`,
            sortOrder: 0,
            ...businessObject,
          },
          {
            voucherId: voucher.id,
            cashAccountId: account.id,
            accountNumber: builders.cash(account.glAccountNumber),
            debit: "0",
            credit: String(payment.baseAmount),
            description: `${tag} ${payment.method.name}`,
            sortOrder: 1,
            ...businessObject,
          },
        ]);
        await tx.insert(posPayments).values({
          saleId: returnId,
          paymentMethodId: payment.method.id,
          amount: String(payment.amount),
          currency: payment.currency,
          exchangeRate: String(payment.exchangeRate),
          baseAmount: String(payment.baseAmount),
          reference: cleanText(payment.reference),
          cashDocumentId: cashDoc.id,
          sortOrder: index,
        });
      }
    }

    const totalReturnedAfter = original.lines.every((line) => {
      const sold = Number(line.quantity);
      const returned = (returnedByLine.get(line.id) ?? 0) + (planned.find((entry) => entry.original.id === line.id)?.quantity ?? 0);
      return returned >= sold - 1e-9;
    });
    await tx
      .update(posSales)
      .set({ status: totalReturnedAfter ? "returned" : "partially_returned" })
      .where(eq(posSales.id, original.id));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "return",
        entityType: "pos_sale",
        entityId: original.id,
        summary: `POS буцаалт — ${documentNo} ← ${original.documentNo}, ${planned.length} мөр, ${fmt(refundTotal)}₮ (${reason})`,
      },
      tx
    );
  });
  // Илгээгдсэн eBarimt-тэй эх борлуулалт → бүтэн буцаалт бол DELETE, хэсэгчилсэн
  // бол inactiveId-тай засварын бичилт (сугалаа дахин олгохгүй) — prepareSubmission шийднэ.
  // НӨАТ төлөгч бус болсон бол шинэ илгээлт үүсгэхгүй (өмнө илгээгдсэн нь ТЕГ-д хэвээр).
  if (
    settings.ebarimtEnabled &&
    original.ebarimtStatus === "sent" &&
    original.ebarimtId &&
    (await isOrgVatPayer(orgId))
  ) {
    await enqueueEbarimt(orgId, original.id, "cancel");
    if (settings.ebarimtMode !== "browser")
      void processPendingEbarimt(5).catch((error) => console.error("[ebarimt] цуцлах илгээлт:", error));
  }
  revalidatePos();
  return { id: returnId, documentNo, refundTotal };
}

// ─── Ээлж ────────────────────────────────────────────────────────────────────

export async function getShifts(options?: { openOnly?: boolean }): Promise<ActionResult<{ shifts: PosShiftView[] }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { shifts: await loadShiftViews(orgId, options) };
  } catch (caught) {
    return actionError("getShifts", caught, "Ээлж уншигдсангүй");
  }
}

export async function openShift(data: {
  cashAccountId: string;
  warehouseId: string;
  openingFloat: number;
  fxRates?: Record<string, number>;
  note?: string;
}): Promise<ActionResult<{ id: string; documentNo: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    await ensurePosSettings(orgId, userId);
    const openingFloat = Number(data.openingFloat ?? 0);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) throw new Error("Эхний мөнгө 0-ээс багагүй");
    const [account, warehouse] = await Promise.all([
      db.query.cashAccounts.findFirst({
        where: and(eq(cashAccounts.id, data.cashAccountId), eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
      }),
      db.query.warehouses.findFirst({
        where: and(eq(warehouses.id, data.warehouseId), eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
      }),
    ]);
    if (!account) throw new Error("Идэвхтэй кассын данс олдсонгүй");
    if (account.accountType !== "cash" || account.currency !== "MNT")
      throw new Error("Ээлжийн касс нь MNT бэлэн мөнгөний данс байх ёстой");
    if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
    const fxRates: Record<string, number> = {};
    for (const [currency, rate] of Object.entries(data.fxRates ?? {})) {
      const code = currency.trim().toUpperCase();
      const value = Number(rate);
      if (!/^[A-Z]{3}$/.test(code) || !(value > 0)) throw new Error(`${currency} ханш буруу`);
      fxRates[code] = value;
    }
    const date = ulaanbaatarNow().date;
    await assertPeriodOpen(orgId, date);
    let id = "";
    let documentNo = "";
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), ${POS_LOCK_KEY})`);
      const existing = await tx.query.posShifts.findFirst({
        where: and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open"), eq(posShifts.cashAccountId, account.id)),
        columns: { documentNo: true },
      });
      if (existing) throw new Error(`${account.name} кассанд ${existing.documentNo} ээлж нээлттэй байна — эхлээд хаана уу`);
      documentNo = await nextSequentialNo(tx, posShifts, orgId, POS_SHIFT_NO_PREFIX, date, 3);
      const [row] = await tx
        .insert(posShifts)
        .values({
          userId,
          organizationId: orgId,
          documentNo,
          cashAccountId: account.id,
          warehouseId: warehouse.id,
          openedBy: userId,
          openingFloat: String(round2(openingFloat)),
          fxRates,
          status: "open",
          note: data.note?.trim() ?? "",
        })
        .returning({ id: posShifts.id });
      id = row.id;
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "open",
          entityType: "pos_shift",
          entityId: id,
          summary: `Ээлж нээгдэв — ${documentNo}, ${account.name}, эхний мөнгө ${fmt(openingFloat)}₮`,
        },
        tx
      );
    });
    revalidatePos();
    return { id, documentNo };
  } catch (caught) {
    return actionError("openShift", caught, "Ээлж нээгдсэнгүй");
  }
}

export async function closeShift(
  id: string,
  data: { countedCash: number; note?: string }
): Promise<ActionResult<{ systemCash: number; variance: number }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const settings = await ensurePosSettings(orgId, userId);
    const countedCash = Number(data.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) throw new Error("Тоолсон мөнгө 0-ээс багагүй");
    const [view] = await loadShiftViews(orgId, { openOnly: true }).then((rows) => rows.filter((row) => row.id === id));
    if (!view) throw new Error("Нээлттэй ээлж олдсонгүй");
    const date = ulaanbaatarNow().date;
    await assertPeriodOpen(orgId, date);
    const systemCash = round2(view.openingFloat + view.cashReceipts - view.cashRefunds);
    const variance = round2(countedCash - systemCash);
    const account = await db.query.cashAccounts.findFirst({ where: eq(cashAccounts.id, view.cashAccountId) });
    if (!account) throw new Error("Кассын данс олдсонгүй");
    const builders = await codeBuilders(orgId);
    let varianceDocId: string | null = null;
    await db.transaction(async (tx) => {
      await assertPeriodOpenInTx(tx, orgId, date);
      if (Math.abs(variance) >= 0.01) {
        const isOver = variance > 0;
        const counterAccount = isOver ? settings.cashOverAccountNumber : settings.cashShortAccountNumber;
        await assertEnabledMainAccount(orgId, counterAccount);
        const amount = Math.abs(variance);
        const [voucher] = await tx
          .insert(journalVouchers)
          .values({
            userId,
            organizationId: orgId,
            date,
            description: `[${view.documentNo}] Ээлжийн кассын ${isOver ? "илүүдэл" : "дутагдал"}`,
            status: "posted",
            externalRef: `pos-shift-variance:${id}`,
          })
          .returning({ id: journalVouchers.id });
        const [doc] = await tx
          .insert(cashDocuments)
          .values({
            userId,
            organizationId: orgId,
            documentNo: `${view.documentNo}-V`,
            documentType: isOver ? "receipt" : "payment",
            date,
            fromCashAccountId: isOver ? null : account.id,
            toCashAccountId: isOver ? account.id : null,
            counterAccountNumber: counterAccount,
            counterparty: null,
            description: `[${view.documentNo}] Ээлж хаалтын зөрүү: систем ${fmt(systemCash)}, тоолсон ${fmt(countedCash)}`,
            amount: String(amount),
            currency: "MNT",
            exchangeRate: "1",
            baseAmount: String(amount),
            status: "posted",
            voucherId: voucher.id,
            sourceType: POS_SOURCE_TYPE,
            sourceId: id,
            postedAt: new Date(),
          })
          .returning({ id: cashDocuments.id });
        varianceDocId = doc.id;
        await tx.insert(journalLines).values(
          isOver
            ? [
                { voucherId: voucher.id, cashAccountId: account.id, accountNumber: builders.cash(account.glAccountNumber), debit: String(amount), credit: "0", description: "Кассын илүүдэл", sortOrder: 0 },
                { voucherId: voucher.id, accountNumber: builders.cash(counterAccount), debit: "0", credit: String(amount), description: "Кассын илүүдэл", sortOrder: 1 },
              ]
            : [
                { voucherId: voucher.id, accountNumber: builders.cash(counterAccount), debit: String(amount), credit: "0", description: "Кассын дутагдал", sortOrder: 0 },
                { voucherId: voucher.id, cashAccountId: account.id, accountNumber: builders.cash(account.glAccountNumber), debit: "0", credit: String(amount), description: "Кассын дутагдал", sortOrder: 1 },
              ]
        );
      }
      const [claimed] = await tx
        .update(posShifts)
        .set({
          status: "closed",
          closedBy: userId,
          closedAt: new Date(),
          countedCash: String(round2(countedCash)),
          systemCash: String(systemCash),
          varianceAmount: String(variance),
          varianceCashDocumentId: varianceDocId,
          note: data.note?.trim() || view.note,
        })
        .where(and(eq(posShifts.id, id), eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")))
        .returning({ id: posShifts.id });
      if (!claimed) throw new Error("Ээлжийн төлөв өөрчлөгдсөн байна");
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "close",
          entityType: "pos_shift",
          entityId: id,
          summary: `Ээлж хаагдав — ${view.documentNo}, систем ${fmt(systemCash)}₮, тоолсон ${fmt(countedCash)}₮, зөрүү ${fmt(variance)}₮`,
        },
        tx
      );
    });
    revalidatePos();
    return { systemCash, variance };
  } catch (caught) {
    return actionError("closeShift", caught, "Ээлж хаагдсангүй");
  }
}

// ─── Бэлгийн карт ────────────────────────────────────────────────────────────

export async function issueGiftCard(data: {
  code: string;
  amount: number;
  paymentMethodId: string;
  reference?: string | null;
  counterpartyId?: string | null;
  expiresAt?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const settings = await ensurePosSettings(orgId, userId);
    const code = data.code.trim().toUpperCase();
    const amount = round2(Number(data.amount));
    if (!code) throw new Error("Картын код оруулна уу");
    if (!(amount > 0)) throw new Error("Дүн 0-ээс их");
    const methods = await loadPaymentMethodViews(orgId);
    const method = methods.find((entry) => entry.id === data.paymentMethodId && entry.isActive);
    if (!method || !PAYMENT_KINDS_WITH_CASH_ACCOUNT.includes(method.kind) || method.currency !== "MNT")
      throw new Error("Бэлгийн картыг бэлэн/карт/QPay (MNT) хэлбэрээр л зарна");
    const account = await db.query.cashAccounts.findFirst({
      where: and(eq(cashAccounts.id, method.cashAccountId ?? ""), eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
    });
    if (!account) throw new Error("Касс/банкны данс идэвхгүй");
    await assertEnabledMainAccount(orgId, settings.giftCardLiabilityAccountNumber);
    const date = ulaanbaatarNow().date;
    await assertPeriodOpen(orgId, date);
    const builders = await codeBuilders(orgId);
    let id = "";
    await db.transaction(async (tx) => {
      await assertPeriodOpenInTx(tx, orgId, date);
      const duplicate = await tx.query.posGiftCards.findFirst({
        where: and(eq(posGiftCards.organizationId, orgId), eq(posGiftCards.code, code)),
        columns: { id: true },
      });
      if (duplicate) throw new Error(`"${code}" кодтой карт бүртгэгдсэн байна`);
      const [card] = await tx
        .insert(posGiftCards)
        .values({
          organizationId: orgId,
          code,
          initialAmount: String(amount),
          balance: String(amount),
          counterpartyId: cleanText(data.counterpartyId),
          expiresAt: cleanText(data.expiresAt),
          status: "active",
        })
        .returning({ id: posGiftCards.id });
      id = card.id;
      const [voucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          organizationId: orgId,
          date,
          description: `[GC ${code}] Бэлгийн карт зарав — ${method.name}`,
          status: "posted",
          externalRef: `pos-gift:${id}`,
        })
        .returning({ id: journalVouchers.id });
      await tx.insert(cashDocuments).values({
        userId,
        organizationId: orgId,
        documentNo: `GC-${code}`,
        documentType: "receipt",
        date,
        toCashAccountId: account.id,
        counterAccountNumber: settings.giftCardLiabilityAccountNumber,
        description: `Бэлгийн карт ${code} — ${method.name}${data.reference ? ` (${data.reference})` : ""}`,
        amount: String(amount),
        currency: "MNT",
        exchangeRate: "1",
        baseAmount: String(amount),
        status: "posted",
        voucherId: voucher.id,
        sourceType: POS_SOURCE_TYPE,
        sourceId: id,
        postedAt: new Date(),
      });
      await tx.insert(journalLines).values([
        { voucherId: voucher.id, cashAccountId: account.id, accountNumber: builders.cash(account.glAccountNumber), debit: String(amount), credit: "0", description: `Бэлгийн карт ${code}`, sortOrder: 0 },
        { voucherId: voucher.id, accountNumber: builders.cash(settings.giftCardLiabilityAccountNumber), debit: "0", credit: String(amount), description: `Бэлгийн карт ${code}`, sortOrder: 1 },
      ]);
      await logAuditEvent(
        { userId, organizationId: orgId, action: "create", entityType: "pos_gift_card", entityId: id, summary: `Бэлгийн карт ${code} — ${fmt(amount)}₮` },
        tx
      );
    });
    revalidatePos();
    return { id };
  } catch (caught) {
    return actionError("issueGiftCard", caught, "Бэлгийн карт бүртгэгдсэнгүй");
  }
}

export async function getGiftCardsAndCredits(): Promise<
  ActionResult<{
    giftCards: { id: string; code: string; initialAmount: number; balance: number; status: string; expiresAt: string | null; createdAt: string }[];
    storeCredits: { id: string; counterpartyId: string; counterpartyName: string; amount: number; balance: number; status: string; createdAt: string }[];
  }>
> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const [cards, credits] = await Promise.all([
      db.query.posGiftCards.findMany({ where: eq(posGiftCards.organizationId, orgId), orderBy: (row, { desc }) => [desc(row.createdAt)] }),
      db.query.posStoreCredits.findMany({ where: eq(posStoreCredits.organizationId, orgId), orderBy: (row, { desc }) => [desc(row.createdAt)] }),
    ]);
    const cpIds = [...new Set(credits.map((credit) => credit.counterpartyId))];
    const cps = cpIds.length
      ? await db.query.counterparties.findMany({ where: inArray(counterparties.id, cpIds), columns: { id: true, name: true } })
      : [];
    const cpName = new Map(cps.map((cp) => [cp.id, cp.name]));
    return {
      giftCards: cards.map((card) => ({
        id: card.id,
        code: card.code,
        initialAmount: Number(card.initialAmount),
        balance: Number(card.balance),
        status: card.status,
        expiresAt: card.expiresAt,
        createdAt: card.createdAt.toISOString(),
      })),
      storeCredits: credits.map((credit) => ({
        id: credit.id,
        counterpartyId: credit.counterpartyId,
        counterpartyName: cpName.get(credit.counterpartyId) ?? "—",
        amount: Number(credit.amount),
        balance: Number(credit.balance),
        status: credit.status,
        createdAt: credit.createdAt.toISOString(),
      })),
    };
  } catch (caught) {
    return actionError("getGiftCardsAndCredits", caught, "Уншигдсангүй");
  }
}

// ─── Жагсаалт, дэлгэрэнгүй ──────────────────────────────────────────────────

export async function getPosSales(filter: SaleFilter = {}): Promise<ActionResult<{ sales: PosSaleView[] }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { sales: await loadSaleViews(orgId, filter) };
  } catch (caught) {
    return actionError("getPosSales", caught, "Борлуулалт уншигдсангүй");
  }
}

export async function getPosSaleDetail(id: string): Promise<ActionResult<{ sale: PosSaleDetail }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const sale = await loadSaleDetail(orgId, id);
    if (!sale) throw new Error("Борлуулалт олдсонгүй");
    return { sale };
  } catch (caught) {
    return actionError("getPosSaleDetail", caught, "Борлуулалт уншигдсангүй");
  }
}

/** Борлуулалтын баримтыг дахин хэвлэх өгөгдөл. */
export async function getPosReceipt(id: string): Promise<ActionResult<{ receipt: PosReceipt }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const sale = await loadSaleDetail(orgId, id);
    if (!sale) throw new Error("Борлуулалт олдсонгүй");
    const settings = await ensurePosSettings(orgId, userId);
    const vat = await loadVatSettings(orgId, userId);
    return {
      receipt: {
        saleId: sale.id,
        documentNo: sale.documentNo,
        date: sale.date,
        soldAt: sale.soldAt,
        cashierName: sale.cashierName,
        customerName: sale.counterpartyId === settings.walkInCounterpartyId ? "" : sale.counterpartyName,
        isVatPayer: vat.isVatPayer,
        lines: sale.lines.map((line) => ({
          name: line.itemName,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          discount: line.discountAmount,
          total: line.lineTotal,
        })),
        grossAmount: sale.grossAmount,
        discountTotal: sale.discountTotal,
        netAmount: sale.netAmount,
        vatAmount: sale.vatAmount,
        roundingAmount: sale.roundingAmount,
        total: sale.total,
        payments: sale.payments.map((payment) => ({
          name: payment.methodName,
          amount: payment.amount,
          currency: payment.currency,
          baseAmount: payment.baseAmount,
          change: payment.changeGiven,
        })),
        change: sale.payments.reduce((sum, payment) => sum + payment.changeGiven, 0),
        header: settings.receiptHeader,
        footer: settings.receiptFooter,
        negativeStock: [],
        ebarimtId: sale.ebarimtId,
        // Дахин хэвлэхэд сугалаа/QR ҮГҮЙ — хадгалагддаггүй (албан спек §5).
        ebarimtLottery: null,
        ebarimtQrData: null,
        ebarimtStatus: sale.ebarimtStatus,
      },
    };
  } catch (caught) {
    return actionError("getPosReceipt", caught, "Баримт уншигдсангүй");
  }
}

export async function updateSaleEbarimt(
  id: string,
  data: { ebarimtId?: string | null }
): Promise<ActionResult> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const ebarimtId = cleanText(data.ebarimtId);
    const sale = await db.query.posSales.findFirst({
      where: and(eq(posSales.id, id), eq(posSales.organizationId, orgId)),
      columns: { ebarimtStatus: true },
    });
    if (!sale) throw new Error("Борлуулалт олдсонгүй");
    if (sale.ebarimtStatus === "sent") throw new Error("ТЕГ-д илгээгдсэн баримтын ДДТД-г гараар өөрчлөхгүй");
    await db
      .update(posSales)
      .set({ ebarimtId, ebarimtStatus: ebarimtId ? "manual" : null })
      .where(and(eq(posSales.id, id), eq(posSales.organizationId, orgId)));
    if (ebarimtId)
      // Гараар олгосон бол хүлээгдэж буй автомат илгээлтийг зогсооно (давхар баримт үүсгэхгүй).
      await db
        .update(posEbarimtSubmissions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(posEbarimtSubmissions.saleId, id), inArray(posEbarimtSubmissions.status, ["pending", "failed"])));
    revalidatePos();
    return {};
  } catch (caught) {
    return actionError("updateSaleEbarimt", caught, "eBarimt мэдээлэл хадгалагдсангүй");
  }
}

export async function getCurrentUserName(): Promise<string> {
  const { userId } = await getActiveOrg();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { name: true } });
  return user?.name ?? "";
}

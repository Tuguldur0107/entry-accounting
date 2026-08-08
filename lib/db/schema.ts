import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  integer,
  boolean,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Organizations (Фаз 01 multi-tenancy) ────────────────────────────────────
// Байгууллага = компани. Хэрэглэгч олон байгууллагад гишүүн байж болно
// (нягтлан фирмийн кейс). Бизнесийн бүх хүснэгт organization_id-аар scope
// хийгдэнэ; user_id багана нь "хэн үүсгэсэн" (createdBy) утгаар үлдсэн.

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** ТТД — Татвар төлөгчийн дугаар. */
  registryNo: text("registry_no"),
  /** Фаз 05 (billing)-д ашиглана — одоогоор үргэлж null. */
  planId: text("plan_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MembershipRole = "owner" | "admin" | "accountant" | "viewer";

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // MembershipRole
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.userId),
    index("memberships_user_ix").on(t.userId),
  ]
);

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    number: text("number").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default("gl,ar,ap,fa,cost,cash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.number), unique().on(t.organizationId, t.number)]
);

// ─── Accounting periods (нягтлан бодох период) ───────────────────────────────
// Апп даяарх НЭГ период бүртгэл. Өртгийн модулийн Periodic Weighted Average
// нь энэ периодын хил дээр тооцогдоно (docs/cost OD-002 → "GL-ийн period
// системийг ашиглана" гэж product owner баталсан).
//
// Мөчлөг: open → closed. Хаагдсан периодод бичилт хийхийг хориглоно;
// дахин нээх нь ил үйлдэл (closedAt цэвэрлэгдэнэ).

export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(), // "YYYY-MM"
    startDate: text("start_date").notNull(), // YYYY-MM-DD (оруулаад)
    endDate: text("end_date").notNull(), // YYYY-MM-DD (оруулаад)
    status: text("status").notNull().default("open"), // "open" | "closed"
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

// ─── Journal Vouchers ─────────────────────────────────────────────────────────

export const journalVouchers = pgTable(
  "journal_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    date: text("date").notNull(), // YYYY-MM-DD
    description: text("description").notNull(),
    // Draft-first систем тул default нь draft — status-аа мартсан ямар ч
    // insert аюулгүй талдаа (ноорог) унана. Бүх код status-аа ил өгдөг.
    status: text("status").notNull().default("draft"), // "draft" | "posted" | "reversed"
    // Гадаад системийн давтагдашгүй дугаар (eBarimt ДДТД г.м) — idempotency
    // түлхүүр: ижил ref-тэй хоёр дахь create шинэ баримт үүсгэхгүй.
    externalRef: text("external_ref"),
    // GL unpost-ийн буцаалтын журнал ЭХ журналдаа хамааралтай: эхийг устгавал
    // буцаалт нь хамт устана (cascade); буцаалтыг дангаар нь устгахыг
    // deleteVoucher хориглоно — эс бөгөөс эх нь "reversed" статустай атлаа
    // тайланд бүрэн тоологдоно.
    reversalOfVoucherId: uuid("reversal_of_voucher_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("journal_vouchers_org_external_ref_uq")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index("journal_vouchers_user_date_ix").on(t.userId, t.date), index("journal_vouchers_org_date_ix").on(t.organizationId, t.date),
    index("journal_vouchers_user_status_ix").on(t.userId, t.status), index("journal_vouchers_org_status_ix").on(t.organizationId, t.status),
    foreignKey({
      columns: [t.reversalOfVoucherId],
      foreignColumns: [t.id],
    }).onDelete("cascade"),
  ]
);

// ─── Journal Lines ────────────────────────────────────────────────────────────

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => journalVouchers.id, { onDelete: "cascade" }),
    cashAccountId: uuid("cash_account_id"),
    // Дэд дэвтрийн эх сурвалж (FR-ARCH-001: Source → Movement → Cost → GL мөр
    // → Журнал). FK биш — дэд дэвтэр устахад журнал үлдэх ёстой (аудит).
    costEntryId: uuid("cost_entry_id"),
    inventoryMovementId: uuid("inventory_movement_id"),
    accountNumber: text("account_number").notNull(),
    debit: numeric("debit", { precision: 18, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    description: text("description").default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    foreignKey({
      columns: [table.cashAccountId],
      foreignColumns: [cashAccounts.id],
    }).onDelete("set null"),
    index("journal_lines_voucher_ix").on(table.voucherId),
    index("journal_lines_cost_entry_ix")
      .on(table.costEntryId)
      .where(sql`${table.costEntryId} is not null`),
    index("journal_lines_inventory_movement_ix")
      .on(table.inventoryMovementId)
      .where(sql`${table.inventoryMovementId} is not null`),
  ]
);

// ─── Cash Management ─────────────────────────────────────────────────────────

export const cashAccounts = pgTable("cash_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  accountType: text("account_type").notNull(), // "cash" | "bank"
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  currency: text("currency").notNull().default("MNT"),
  glAccountNumber: text("gl_account_number").notNull(),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cashDocuments = pgTable(
  "cash_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(),
    documentType: text("document_type").notNull(), // "receipt" | "payment" | "transfer"
    date: text("date").notNull(),
    fromCashAccountId: uuid("from_cash_account_id").references(
      () => cashAccounts.id,
      { onDelete: "restrict" }
    ),
    toCashAccountId: uuid("to_cash_account_id").references(
      () => cashAccounts.id,
      { onDelete: "restrict" }
    ),
    counterAccountNumber: text("counter_account_number"),
    cashFlowCode: text("cash_flow_code"),
    counterparty: text("counterparty"),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("MNT"),
    exchangeRate: numeric("exchange_rate", {
      precision: 18,
      scale: 8,
    })
      .notNull()
      .default("1"),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }),
    status: text("status").notNull().default("draft"), // "draft" | "posted" | "reversed"
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
      onDelete: "set null",
    }),
    reversalVoucherId: uuid("reversal_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    // Set when this document was auto-derived FROM a GL voucher (reverse
    // sync). Posting such a draft adopts the referenced voucher rather than
    // creating a new one, so the GL entry isn't double-counted.
    sourceVoucherId: uuid("source_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    arApDocumentId: uuid("ar_ap_document_id").references(
      () => arApDocuments.id,
      { onDelete: "restrict" }
    ),
    // Гадаад системийн давтагдашгүй дугаар (банкны гүйлгээний ID г.м).
    externalRef: text("external_ref"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique().on(t.userId, t.documentNo), unique().on(t.organizationId, t.documentNo),
    uniqueIndex("cash_documents_org_external_ref_uq")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index("cash_documents_user_status_ix").on(t.userId, t.status), index("cash_documents_org_status_ix").on(t.organizationId, t.status),
    index("cash_documents_user_date_ix").on(t.userId, t.date), index("cash_documents_org_date_ix").on(t.organizationId, t.date),
  ]
);

export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    bankName: text("bank_name"),
    currency: text("currency").notNull().default("MNT"),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    rowCount: integer("row_count").notNull().default(0),
    totalIncome: numeric("total_income", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalExpense: numeric("total_expense", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("posted"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.fileHash), unique().on(table.organizationId, table.fileHash)]
);

export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => bankStatements.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    transactionDate: text("transaction_date").notNull(),
    valueDate: text("value_date"),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    counterAccount: text("counter_account"),
    income: numeric("income", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    expense: numeric("expense", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    balance: numeric("balance", { precision: 18, scale: 2 }),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }),
    debitAccountNumber: text("debit_account_number").notNull(),
    creditAccountNumber: text("credit_account_number").notNull(),
    rawData: text("raw_data"),
    cashDocumentId: uuid("cash_document_id").references(
      () => cashDocuments.id,
      { onDelete: "set null" }
    ),
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.statementId, table.rowNumber)]
);

export const cashFxRevaluations = pgTable(
  "cash_fx_revaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
    valuationDate: text("valuation_date").notNull(),
    currency: text("currency").notNull(),
    closingRate: numeric("closing_rate", { precision: 18, scale: 8 }).notNull(),
    rateSource: text("rate_source").notNull().default("manual"),
    rateBasis: text("rate_basis").notNull().default("official"),
    sourceDate: text("source_date"),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at"),
    manualOverrideReason: text("manual_override_reason"),
    foreignBalance: numeric("foreign_balance", {
      precision: 18,
      scale: 2,
    }).notNull(),
    carryingAmount: numeric("carrying_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    revaluedAmount: numeric("revalued_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    adjustmentAmount: numeric("adjustment_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    gainLossAccountNumber: text("gain_loss_account_number").notNull(),
    status: text("status").notNull().default("posted"),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => journalVouchers.id, { onDelete: "restrict" }),
    reversalVoucherId: uuid("reversal_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "restrict" }
    ),
    reversedAt: timestamp("reversed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(
      table.userId,
      table.cashAccountId,
      table.valuationDate,
      table.revision
    ), unique().on(table.organizationId,
      table.cashAccountId,
      table.valuationDate,
      table.revision
    ),
  ]
);

// ─── Counterparty AR/AP ──────────────────────────────────────────────────────

export const counterparties = pgTable(
  "counterparties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    counterpartyType: text("counterparty_type").notNull().default("both"), // "customer" | "supplier" | "both"
    registerNo: text("register_no"),
    defaultReceivableAccountNumber: text("default_receivable_account_number"),
    defaultPayableAccountNumber: text("default_payable_account_number"),
    defaultCurrency: text("default_currency").notNull().default("MNT"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    // Нэхэмжлэх илгээхэд ашиглагдана.
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.name), unique().on(table.organizationId, table.name)]
);

export const arApDocuments = pgTable(
  "ar_ap_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(),
    documentType: text("document_type").notNull(), // "ar_invoice" | "ap_bill"
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "restrict" }),
    date: text("date").notNull(),
    dueDate: text("due_date").notNull(),
    currency: text("currency").notNull().default("MNT"),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 })
      .notNull()
      .default("1"),
    controlAccountNumber: text("control_account_number").notNull(),
    description: text("description").notNull(),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    baseTotalAmount: numeric("base_total_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    basePaidAmount: numeric("base_paid_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("draft"), // "draft" | "posted" | "partially_paid" | "paid" | "reversed"
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
      onDelete: "set null",
    }),
    reversalVoucherId: uuid("reversal_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    // Гадаад системийн давтагдашгүй дугаар (eBarimt ДДТД г.м).
    externalRef: text("external_ref"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.userId, table.documentNo), unique().on(table.organizationId, table.documentNo),
    uniqueIndex("ar_ap_documents_org_external_ref_uq")
      .on(table.organizationId, table.externalRef)
      .where(sql`${table.externalRef} is not null`),
    index("ar_ap_documents_user_status_ix").on(table.userId, table.status), index("ar_ap_documents_org_status_ix").on(table.organizationId, table.status),
    index("ar_ap_documents_user_date_ix").on(table.userId, table.date), index("ar_ap_documents_org_date_ix").on(table.organizationId, table.date),
  ]
);

export const arApDocumentLines = pgTable(
  "ar_ap_document_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => arApDocuments.id, { onDelete: "cascade" }),
    accountNumber: text("account_number").notNull(),
    description: text("description").notNull().default(""),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    // Бараатай мөр: батлагдахад inventory-д тоо хэмжээний draft үүсгэнэ.
    itemId: uuid("item_id").references(() => inventoryItems.id, {
      onDelete: "set null",
    }),
    quantity: numeric("quantity", { precision: 18, scale: 4 }),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

export const arApSettlements = pgTable("ar_ap_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => arApDocuments.id, { onDelete: "restrict" }),
  cashDocumentId: uuid("cash_document_id").references(() => cashDocuments.id, {
    onDelete: "set null",
  }),
  settlementDate: text("settlement_date").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  baseAmount: numeric("base_amount", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ar_ap_settlements_document_ix").on(t.documentId),
  index("ar_ap_settlements_cash_document_ix")
    .on(t.cashDocumentId)
    .where(sql`${t.cashDocumentId} is not null`),
]);

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(chartOfAccounts),
  vouchers: many(journalVouchers),
  moduleConfigs: many(moduleConfigs),
  segmentConfigs: many(segmentConfigs),
  segmentValues: many(segmentValues),
  cashAccounts: many(cashAccounts),
  cashDocuments: many(cashDocuments),
  bankStatements: many(bankStatements),
  cashFxRevaluations: many(cashFxRevaluations),
  counterparties: many(counterparties),
  arApDocuments: many(arApDocuments),
  arApSettlements: many(arApSettlements),
}));

export const chartOfAccountsRelations = relations(chartOfAccounts, ({ one }) => ({
  user: one(users, { fields: [chartOfAccounts.userId], references: [users.id] }),
}));

export const journalVouchersRelations = relations(journalVouchers, ({ one, many }) => ({
  user: one(users, { fields: [journalVouchers.userId], references: [users.id] }),
  lines: many(journalLines),
}));

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  voucher: one(journalVouchers, {
    fields: [journalLines.voucherId],
    references: [journalVouchers.id],
  }),
}));

export const cashAccountsRelations = relations(
  cashAccounts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [cashAccounts.userId],
      references: [users.id],
    }),
    outgoingDocuments: many(cashDocuments, {
      relationName: "cashDocumentFromAccount",
    }),
    incomingDocuments: many(cashDocuments, {
      relationName: "cashDocumentToAccount",
    }),
    bankStatements: many(bankStatements),
    fxRevaluations: many(cashFxRevaluations),
  })
);

export const cashDocumentsRelations = relations(cashDocuments, ({ one }) => ({
  user: one(users, {
    fields: [cashDocuments.userId],
    references: [users.id],
  }),
  fromAccount: one(cashAccounts, {
    fields: [cashDocuments.fromCashAccountId],
    references: [cashAccounts.id],
    relationName: "cashDocumentFromAccount",
  }),
  toAccount: one(cashAccounts, {
    fields: [cashDocuments.toCashAccountId],
    references: [cashAccounts.id],
    relationName: "cashDocumentToAccount",
  }),
  voucher: one(journalVouchers, {
    fields: [cashDocuments.voucherId],
    references: [journalVouchers.id],
    relationName: "cashDocumentVoucher",
  }),
  reversalVoucher: one(journalVouchers, {
    fields: [cashDocuments.reversalVoucherId],
    references: [journalVouchers.id],
    relationName: "cashDocumentReversalVoucher",
  }),
}));

export const bankStatementsRelations = relations(
  bankStatements,
  ({ one, many }) => ({
    user: one(users, {
      fields: [bankStatements.userId],
      references: [users.id],
    }),
    cashAccount: one(cashAccounts, {
      fields: [bankStatements.cashAccountId],
      references: [cashAccounts.id],
    }),
    lines: many(bankStatementLines),
  })
);

export const bankStatementLinesRelations = relations(
  bankStatementLines,
  ({ one }) => ({
    statement: one(bankStatements, {
      fields: [bankStatementLines.statementId],
      references: [bankStatements.id],
    }),
    cashDocument: one(cashDocuments, {
      fields: [bankStatementLines.cashDocumentId],
      references: [cashDocuments.id],
    }),
    voucher: one(journalVouchers, {
      fields: [bankStatementLines.voucherId],
      references: [journalVouchers.id],
    }),
  })
);

export const cashFxRevaluationsRelations = relations(
  cashFxRevaluations,
  ({ one }) => ({
    user: one(users, {
      fields: [cashFxRevaluations.userId],
      references: [users.id],
    }),
    cashAccount: one(cashAccounts, {
      fields: [cashFxRevaluations.cashAccountId],
      references: [cashAccounts.id],
    }),
    voucher: one(journalVouchers, {
      fields: [cashFxRevaluations.voucherId],
      references: [journalVouchers.id],
    }),
  })
);

export const counterpartiesRelations = relations(
  counterparties,
  ({ one, many }) => ({
    user: one(users, {
      fields: [counterparties.userId],
      references: [users.id],
    }),
    documents: many(arApDocuments),
  })
);

export const arApDocumentsRelations = relations(
  arApDocuments,
  ({ one, many }) => ({
    user: one(users, {
      fields: [arApDocuments.userId],
      references: [users.id],
    }),
    counterparty: one(counterparties, {
      fields: [arApDocuments.counterpartyId],
      references: [counterparties.id],
    }),
    lines: many(arApDocumentLines),
    settlements: many(arApSettlements),
    voucher: one(journalVouchers, {
      fields: [arApDocuments.voucherId],
      references: [journalVouchers.id],
      relationName: "arApDocumentVoucher",
    }),
    reversalVoucher: one(journalVouchers, {
      fields: [arApDocuments.reversalVoucherId],
      references: [journalVouchers.id],
      relationName: "arApDocumentReversalVoucher",
    }),
  })
);

export const arApDocumentLinesRelations = relations(
  arApDocumentLines,
  ({ one }) => ({
    document: one(arApDocuments, {
      fields: [arApDocumentLines.documentId],
      references: [arApDocuments.id],
    }),
  })
);

export const arApSettlementsRelations = relations(
  arApSettlements,
  ({ one }) => ({
    user: one(users, {
      fields: [arApSettlements.userId],
      references: [users.id],
    }),
    document: one(arApDocuments, {
      fields: [arApSettlements.documentId],
      references: [arApDocuments.id],
    }),
    cashDocument: one(cashDocuments, {
      fields: [arApSettlements.cashDocumentId],
      references: [cashDocuments.id],
    }),
  })
);

// ─── Module Configs ───────────────────────────────────────────────────────────

export const moduleConfigs = pgTable(
  "module_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    moduleKey: text("module_key").notNull(), // "gl" | "ar" | "ap" | "fa" | "cost" | "cash" | "agis"
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.moduleKey), unique().on(t.organizationId, t.moduleKey)]
);

export const moduleConfigsRelations = relations(moduleConfigs, ({ one }) => ({
  user: one(users, { fields: [moduleConfigs.userId], references: [users.id] }),
}));

// ─── Segment Values (S1,S2,S4–S10 code lists) ────────────────────────────────

export const segmentValues = pgTable(
  "segment_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    segmentId: integer("segment_id").notNull(), // 1–10 (except 3, which uses chartOfAccounts)
    code: text("code").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.segmentId, t.code), unique().on(t.organizationId, t.segmentId, t.code)]
);

export const segmentValuesRelations = relations(segmentValues, ({ one }) => ({
  user: one(users, { fields: [segmentValues.userId], references: [users.id] }),
}));

// ─── Segment Configs ──────────────────────────────────────────────────────────

export const segmentConfigs = pgTable(
  "segment_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    segmentId: integer("segment_id").notNull(), // 1–10
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default(""), // comma-separated: "gl,ar,ap,fa,cost,cash"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.segmentId), unique().on(t.organizationId, t.segmentId)]
);

export const segmentConfigsRelations = relations(segmentConfigs, ({ one }) => ({
  user: one(users, { fields: [segmentConfigs.userId], references: [users.id] }),
}));

// ─── Report Line Mappings ────────────────────────────────────────────────────
// Per-user override of which GL accounts roll up into each statutory report
// line. When no row exists for a (reportType, lineKey) the report falls
// back to the line's hard-coded default prefixes.

export const reportLineMappings = pgTable(
  "report_line_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    reportType: text("report_type").notNull(), // "balance-sheet" | "income-statement" | "cash-flow"
    /**
     * Built-in lines: key from BS_LINES (e.g. "cash", "ap").
     * Custom user-added lines: starts with "custom-" + nanoid.
     */
    lineKey: text("line_key").notNull(),
    /** Comma-separated 8-digit chart-of-accounts codes that roll into this line. */
    accountNumbers: text("account_numbers").notNull().default(""),
    /** Hide the line from the rendered statement (built-in or custom). */
    isHidden: boolean("is_hidden").notNull().default(false),
    /** Override the built-in label, or set the display label for a custom line. */
    customLabel: text("custom_label"),
    /**
     * Group ID for a custom line (e.g. "current-assets"). Built-in lines
     * inherit their group from BS_LINES — this field is null for them.
     */
    customGroup: text("custom_group"),
    /** Position within its group; lower = higher in the statement. */
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.reportType, t.lineKey), unique().on(t.organizationId, t.reportType, t.lineKey)]
);

export const reportLineMappingsRelations = relations(reportLineMappings, ({ one }) => ({
  user: one(users, { fields: [reportLineMappings.userId], references: [users.id] }),
}));


// ─── Inventory (inv) — quantity-only subledger ───────────────────────────────
// The inventory module records movements in UNITS ONLY (no money fields);
// valuation and GL postings belong to the costing module below.

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("ш"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(),
    movementType: text("movement_type").notNull(), // "receipt" | "issue" | "transfer" | "adjustment"
    date: text("date").notNull(),
    // Sentinel drafts (GL/кассаас үүссэн, бараа нь тодорхойгүй) null байж
    // болно — батлахын өмнө заавал бөглөнө.
    itemId: uuid("item_id").references(() => inventoryItems.id, {
      onDelete: "restrict",
    }),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
      onDelete: "restrict",
    }),
    // transfer destination; null for other types
    toWarehouseId: uuid("to_warehouse_id").references(() => warehouses.id, {
      onDelete: "restrict",
    }),
    // Units only. Positive for receipt/issue/transfer; adjustment is SIGNED
    // (+ илүүдэл, − дутагдал).
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("draft"), // "draft" | "confirmed" | "cancelled"
    // Зарлагын төрөл — өртгийн дебет чиглэлийг шийднэ (FR-ISSUE-001/002).
    // Зөвхөн зарлагад хамаарна; орлого/шилжүүлэгт null.
    issueTypeId: uuid("issue_type_id").references(() => inventoryIssueTypes.id, {
      onDelete: "restrict",
    }),
    sourceType: text("source_type").notNull().default("manual"), // "manual" | "arap_line" | "gl_voucher" | "cash_document"
    sourceId: uuid("source_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [
    unique().on(t.userId, t.documentNo), unique().on(t.organizationId, t.documentNo),
    index("inventory_movements_user_status_ix").on(t.userId, t.status), index("inventory_movements_org_status_ix").on(t.organizationId, t.status),
    index("inventory_movements_user_date_ix").on(t.userId, t.date), index("inventory_movements_org_date_ix").on(t.organizationId, t.date),
  ]
);

// ─── Costing (cost) — valuation layer + GL postings ──────────────────────────
// Values confirmed inventory movements (weighted average) via costing runs and
// writes its OWN journal vouchers (clearing-account scheme — never adopts).

export const costingItemSettings = pgTable(
  "costing_item_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    inventoryAccountNumber: text("inventory_account_number")
      .notNull()
      .default("14000001"),
    cogsAccountNumber: text("cogs_account_number").notNull().default("61100000"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.itemId), unique().on(t.organizationId, t.itemId)]
);

// ── Өртгийн master data (docs/cost FR-MD-CC-*, FR-MD-IT-*) ──────────────────
// Хоёулаа ХЭРЭГЛЭГЧИЙН тохируулдаг лавлах — код дотор хаалттай жагсаалт
// байхыг spec хориглодог (FR-MD-CC-002, FR-PR-005). Устгахгүй, зөвхөн
// идэвхгүй болгоно (FR-AUD-004); өөрчлөлт нь аудитлагдана (FR-AUD-002).

export const costComponents = pgTable(
  "cost_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Бүлэглэл/тайлангийн ангилал — ЧӨЛӨӨТ текст. Ангиллын жагсаалт нь
    // нээлттэй шийдвэр тул enum болгохгүй (docs/cost 7.1).
    classification: text("classification").notNull().default(""),
    // Journal-д холбогдох данс (сонголтоор) — байхгүй бол зөвхөн
    // ангилал/тайлангийн зорилготой компонент.
    accountNumber: text("account_number"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

export const inventoryIssueTypes = pgTable(
  "inventory_issue_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Зориулалтын ангилал (COGS / удирдлагын зардал / үйлдвэрлэл-WIP …) —
    // ЧӨЛӨӨТ текст, хаалттай жагсаалт биш (FR-MD-IT-002).
    destinationClass: text("destination_class").notNull().default(""),
    /**
     * Дебет дансыг хаанаас шийдэх вэ (posting profile, FR-MD-IT-002):
     *   "fixed"     — debitAccountNumber-ийг шууд хэрэглэнэ
     *   "item_cogs" — тухайн барааны costing_item_settings.cogsAccountNumber
     */
    debitAccountSource: text("debit_account_source")
      .notNull()
      .default("fixed"),
    debitAccountNumber: text("debit_account_number"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

/**
 * Өртгийн модулийн дансны РОЛЬ-ууд. Урьд нь эдгээр нь кодод хатуу бичигдсэн
 * тогтмолууд байсан (JPR-006 зөрчил) — одоо хэрэглэгчийн тохиргоо.
 * Эхний уншилтад өнөөгийн утгуудаар seed хийгдэнэ (product owner
 * "одоогийн дүрмийг батлагдсан болгоё" гэж шийдсэн — README change-control).
 */
export const costingAccountSettings = pgTable("costing_account_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  /** Орлогын эсрэг тал — худалдан авалтын клиринг. */
  clearingAccountNumber: text("clearing_account_number").notNull(),
  /** Тооллогын илүүдэл (орлого). */
  adjustmentGainAccountNumber: text("adjustment_gain_account_number").notNull(),
  /** Тооллогын дутагдал (зардал). */
  adjustmentLossAccountNumber: text("adjustment_loss_account_number").notNull(),
  /** NRV бууруулалтын зардал. */
  nrvExpenseAccountNumber: text("nrv_expense_account_number").notNull(),
  /** NRV нөөц (contra-хөрөнгө). */
  nrvReserveAccountNumber: text("nrv_reserve_account_number").notNull(),
  /** Валютын төлбөрийн ханшийн олз (settlement) — өмнө нь кодод хатуу байсан. */
  fxGainAccountNumber: text("fx_gain_account_number")
    .notNull()
    .default("51800001"),
  /** Валютын төлбөрийн ханшийн гарз (settlement). */
  fxLossAccountNumber: text("fx_loss_account_number")
    .notNull()
    .default("87000003"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.organizationId)]);

// ─── Payroll (Цалин) ─────────────────────────────────────────────────────────
// Knowledge: knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/. Тооцооллын
// хувь хэмжээ lib/payroll/calc.ts-д огноогоор (effective date guardrail §10);
// данс/доод цалин/босго нь ЭНЭ тохиргооноос — кодод хатуу утга байхгүй.

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    position: text("position").notNull().default(""),
    /** Сарын үндсэн цалин — бодолтод earnings-ийн default болно. */
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    /** ҮОМШӨ (%) — салбараас хамаарна: оффис 0.8 … уул уурхай 3.0. */
    accidentRatePercent: numeric("accident_rate_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0.8"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.name), unique().on(t.organizationId, t.name)]
);

export const payrollSettings = pgTable("payroll_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  salaryExpenseAccountNumber: text("salary_expense_account_number")
    .notNull()
    .default("72100000"),
  employerSiExpenseAccountNumber: text("employer_si_expense_account_number")
    .notNull()
    .default("72100002"),
  siPayableAccountNumber: text("si_payable_account_number")
    .notNull()
    .default("31420000"),
  pitPayableAccountNumber: text("pit_payable_account_number")
    .notNull()
    .default("31430000"),
  salaryPayableAccountNumber: text("salary_payable_account_number")
    .notNull()
    .default("31500001"),
  /** Бусад суутгалын (зээл г.м) кредит тал. */
  deductionAccountNumber: text("deduction_account_number")
    .notNull()
    .default("31900001"),
  /** Хөдөлмөрийн хөлсний доод хэмжээ — НДШ cap = доод цалин × үржүүлэгч. */
  minimumWage: numeric("minimum_wage", { precision: 18, scale: 2 })
    .notNull()
    .default("792000"),
  siCapMultiplier: integer("si_cap_multiplier").notNull().default(10),
  /**
   * Сарын татваргүй босго (2026 шинэчлэлт: 800,000₮ — хуулийн
   * баталгаажуулалтын дараа хэрэглэгч тохируулна; default 0 = идэвхгүй).
   */
  monthlyTaxFree: numeric("monthly_tax_free", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.organizationId)]);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    periodMonth: text("period_month").notNull(), // YYYY-MM
    status: text("status").notNull().default("draft"), // "draft" | "voucher_created"
    /** GL-ийн НООРОГ журнал (human-in-the-loop §9 — эндээс шууд postгүй). */
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.periodMonth), unique().on(t.organizationId, t.periodMonth)]
);

export const payrollRunLines = pgTable("payroll_run_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  /** Нийт олголт (үндсэн + илүү цаг + урамшуулал) — засварлагдана. */
  earnings: numeric("earnings", { precision: 18, scale: 2 }).notNull(),
  /** Бусад суутгал (зээл г.м) — засварлагдана. */
  otherDeductions: numeric("other_deductions", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  // Доорх багана server-д calc.ts-ээр ДАХИН бодогдож хадгалагдана (түүх).
  employeeSi: numeric("employee_si", { precision: 18, scale: 2 }).notNull(),
  employerSi: numeric("employer_si", { precision: 18, scale: 2 }).notNull(),
  pit: numeric("pit", { precision: 18, scale: 2 }).notNull(),
  netSalary: numeric("net_salary", { precision: 18, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const payrollRunsRelations = relations(payrollRuns, ({ one, many }) => ({
  user: one(users, { fields: [payrollRuns.userId], references: [users.id] }),
  voucher: one(journalVouchers, {
    fields: [payrollRuns.voucherId],
    references: [journalVouchers.id],
  }),
  lines: many(payrollRunLines),
}));

export const payrollRunLinesRelations = relations(payrollRunLines, ({ one }) => ({
  run: one(payrollRuns, {
    fields: [payrollRunLines.runId],
    references: [payrollRuns.id],
  }),
  employee: one(employees, {
    fields: [payrollRunLines.employeeId],
    references: [employees.id],
  }),
}));

// ─── VAT (НӨАТ) ──────────────────────────────────────────────────────────────
// Дансны роль тохиргоо — кодод хатуу дугаар байхгүй (costing_account_settings-
// тэй ижил ratified-seed хэв маяг). Default нь стандарт дансны схемээс.

export const vatSettings = pgTable("vat_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  /** Гаралтын НӨАТ өглөг (борлуулалтын НӨАТ). */
  outputVatAccountNumber: text("output_vat_account_number")
    .notNull()
    .default("31410000"),
  /** Оролтын НӨАТ авлага (худалдан авалтын НӨАТ). */
  inputVatAccountNumber: text("input_vat_account_number")
    .notNull()
    .default("13620000"),
  /** НӨАТ-ийн хувь (%) — хуулиар 10; effective-date шинэчлэлт гарвал энд. */
  vatRatePercent: numeric("vat_rate_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("10"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.organizationId)]);

export const costingRuns = pgTable("costing_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  asOfDate: text("as_of_date").notNull(),
  entryCount: integer("entry_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Нэмэлт зардлын ХУВААРИЛАЛТ (docs/cost §10, FR-ALLOC-*). Нэг тээвэр/гаалийн
 * зардлыг олон бараанд хуваарилах баримт. Хуваарийн суурь нь баримт бүрд
 * сонгогддог (OD-017, README change-control 0.3).
 *
 * Мөр бүр нь `landed_cost` төрлийн өртгийн бичилт үүсгэж, тухайн орлогын
 * хөдөлгөөний Орлогын дүнд нэмэгддэг.
 */
export const costAllocations = pgTable(
  "cost_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    costComponentId: uuid("cost_component_id")
      .notNull()
      .references(() => costComponents.id, { onDelete: "restrict" }),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
    /** "value" | "quantity" | "manual" */
    allocationBase: text("allocation_base").notNull(),
    description: text("description").notNull().default(""),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.documentNo), unique().on(t.organizationId, t.documentNo)]
);

export const costAllocationLines = pgTable("cost_allocation_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  allocationId: uuid("allocation_id")
    .notNull()
    .references(() => costAllocations.id, { onDelete: "cascade" }),
  movementId: uuid("movement_id")
    .notNull()
    .references(() => inventoryMovements.id, { onDelete: "restrict" }),
  /** Хуваарилалтад хэрэглэгдсэн жин (дүн эсвэл тоо; гараар бол 0). */
  baseValue: numeric("base_value", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  /** Үүссэн өртгийн бичилт — задаргааны гинжийг хаана. */
  costEntryId: uuid("cost_entry_id"),
});

// ── Үйлдвэрлэлийн өртөг (docs/cost OD-016 → 0.4-д шийдэгдсэн хэсэг) ─────────
// Хэрэглэгч ДУРААРАА дамжлага (шат) үүсгэж, GL-ийн зардлыг өртгийн бүлэгт
// зураглаж, сарын нийт өртгийг гарсан бүтээгдэхүүнүүдэд хуваарилна.
// Загвар нь Excel-ийн Production Cost Report-ийн урсгалыг дагана:
//   GL (S2 өртгийн төв × данс) → Өртгийн бүлэг → Дамжлага → Бүтээгдэхүүн.

export const productionStages = pgTable(
  "production_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Тооцооллын дараалал — өмнөх шатны гаралт дараагийнхад орж болно. */
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

export const costPools = pgTable(
  "cost_pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => productionStages.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // "105BLAST DRILL" маягийн
    name: text("name").notNull(),
    /** Хувьсах / тогтмол ангилал (Excel-ийн VARIABLE/FIXED). */
    costBehavior: text("cost_behavior").notNull().default("variable"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

/**
 * GL → өртгийн бүлгийн зураглалын дүрэм: S2 өртгийн төв ба/эсвэл дансны
 * угтвар. Аль нь ч хоосон байж болно (нэгээр нь л тааруулна); хоёулаа
 * байвал хоёулаа таарах ёстой. priority бага нь түрүүлж таарна.
 */
export const costPoolRules = pgTable("cost_pool_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  poolId: uuid("pool_id")
    .notNull()
    .references(() => costPools.id, { onDelete: "cascade" }),
  costCenterCode: text("cost_center_code"), // S2 код (яг таарна)
  accountPrefix: text("account_prefix"), // үндсэн дансны угтвар
  priority: integer("priority").notNull().default(100),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Сарын үйлдвэрлэлийн тооцоолол — нэг сард нэг идэвхтэй run. */
export const productionRuns = pgTable(
  "production_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    periodCode: text("period_code").notNull(), // YYYY-MM
    status: text("status").notNull().default("draft"), // "draft" | "confirmed"
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [unique().on(t.userId, t.periodCode), unique().on(t.organizationId, t.periodCode)]
);

/** Шат бүрийн run-д хэрэглэсэн хуваарийн суурь. */
export const productionRunStages = pgTable("production_run_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => productionRuns.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => productionStages.id, { onDelete: "restrict" }),
  /** "sales_value" | "quantity" | "manual" */
  allocationBase: text("allocation_base").notNull().default("sales_value"),
});

/** GL-ээс цугласан бүлгийн дүн (run бүрд хөлдөнө — дахин тооцоход шинэчлэгдэнэ). */
export const productionRunPools = pgTable("production_run_pools", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => productionRuns.id, { onDelete: "cascade" }),
  poolId: uuid("pool_id")
    .notNull()
    .references(() => costPools.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  matchedLineCount: integer("matched_line_count").notNull().default(0),
});

/** Шатанд зарцуулсан орц: өмнөх шатны гаралт эсвэл нөөцөөс. */
export const productionRunInputs = pgTable("production_run_inputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => productionRuns.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => productionStages.id, { onDelete: "restrict" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  /** Нэгж өртөг: энэ run-ийн өмнөх шатнаас ирвэл тэндээс, үгүй бол нөөцийн дундажаас. */
  unitCost: numeric("unit_cost", { precision: 28, scale: 10 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  /** Энэ run доторх өмнөх шатны гаралтаас зарцуулсан бол тэр шат. */
  sourceStageId: uuid("source_stage_id").references(() => productionStages.id, {
    onDelete: "restrict",
  }),
});

/** Шатны гаралт: бүтээгдэхүүн + хуваарилагдсан өртөг. */
export const productionRunOutputs = pgTable("production_run_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => productionRuns.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => productionStages.id, { onDelete: "restrict" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "restrict" }),
  warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
    onDelete: "restrict",
  }),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  /** "sales_value" суурьт: нэгжийн борлуулах үнэ. */
  salesPrice: numeric("sales_price", { precision: 18, scale: 2 }),
  /** "manual" суурьт: гараар өгсөн дүн. */
  manualAmount: numeric("manual_amount", { precision: 18, scale: 2 }),
  allocatedAmount: numeric("allocated_amount", { precision: 18, scale: 2 }),
  unitCost: numeric("unit_cost", { precision: 28, scale: 10 }),
  /** Батлахад үүссэн нөөцийн хөдөлгөөн ба өртгийн бичилт. */
  movementId: uuid("movement_id").references(() => inventoryMovements.id, {
    onDelete: "set null",
  }),
  costEntryId: uuid("cost_entry_id").references(() => costEntries.id, {
    onDelete: "set null",
  }),
});

/**
 * Cost Ledger-ийн ПЕРИОДЫН ҮР ДҮН — бараа × агуулах × период тус бүрд нэг мөр
 * (docs/cost FR-LEDGER-COST-002). Хамрах хүрээ OD-001-ээр батлагдсан.
 *
 * Нарийвчлал (OD-003): нэгж өртөг ба дүнг numeric(28,10)-аар бүтнээр нь
 * хадгална — бөөрөнхийлөлт зөвхөн харуулах/GL-д бичих үед. Ингэснээр
 * C1+Inbound = Outbound+C2 тэнцэл алдагдахгүй.
 */
export const costPeriodResults = pgTable(
  "cost_period_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    periodCode: text("period_code").notNull(), // YYYY-MM
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    // C1
    openingQty: numeric("opening_qty", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    openingAmount: numeric("opening_amount", { precision: 28, scale: 10 })
      .notNull()
      .default("0"),
    // Inbound
    inboundQty: numeric("inbound_qty", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    inboundAmount: numeric("inbound_amount", { precision: 28, scale: 10 })
      .notNull()
      .default("0"),
    // Outbound / C2 — хуваалцсан дундаж (FR-COST-001)
    outboundQty: numeric("outbound_qty", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    averageUnitCost: numeric("average_unit_cost", {
      precision: 28,
      scale: 10,
    }),
    outboundAmount: numeric("outbound_amount", { precision: 28, scale: 10 }),
    closingQty: numeric("closing_qty", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    closingAmount: numeric("closing_amount", { precision: 28, scale: 10 }),
    // Хяналт (FR-COST-003/004) ба тооцооллын төлөв (FR-UX-003)
    qtyBalanced: boolean("qty_balanced").notNull().default(false),
    amountBalanced: boolean("amount_balanced").notNull().default(false),
    status: text("status").notNull(), // "calculated" | "blocked-*"
    blockReason: text("block_reason"),
    calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.periodCode, t.itemId, t.warehouseId), unique().on(t.organizationId, t.periodCode, t.itemId, t.warehouseId)]
);

export const costEntries = pgTable("cost_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  runId: uuid("run_id").references(() => costingRuns.id, {
    onDelete: "set null",
  }),
  // 1:1 with the movement among non-reversed entries (enforced in code so a
  // reversed entry can be superseded by a fresh valuation). NULL for NRV
  // entries — they attach to an ITEM, not a movement, and never touch the
  // moving average.
  movementId: uuid("movement_id").references(() => inventoryMovements.id, {
    onDelete: "restrict",
  }),
  // NRV бичилтийн бараа (movement-гүй тул шууд холбоно).
  itemId: uuid("item_id").references(() => inventoryItems.id, {
    onDelete: "restrict",
  }),
  entryType: text("entry_type").notNull(), // "receipt_capitalize" | "issue_cogs" | "adjustment_gain" | "adjustment_loss" | "landed_cost" | "nrv_writedown" | "nrv_reversal" | "return_in"
  date: text("date").notNull(), // movement date — the voucher date
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // MNT
  valuationSource: text("valuation_source").notNull(), // "manual" | "avg_cost"
  // Хамрах хүрээ + период (OD-001 "бараа × агуулах × компани", OD-002 GL
  // период). Хуучин мөрүүдэд null — backfill хийгдэнэ.
  warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
    onDelete: "restrict",
  }),
  periodCode: text("period_code"), // YYYY-MM
  // Ангилал (FR-LEDGER-COST-003, JPR-004): аль зарлагын төрөл / өртгийн
  // бүрэлдэхүүнд хамаарах вэ.
  issueTypeId: uuid("issue_type_id").references(() => inventoryIssueTypes.id, {
    onDelete: "restrict",
  }),
  costComponentId: uuid("cost_component_id").references(
    () => costComponents.id,
    { onDelete: "restrict" }
  ),
  // Бичих МӨЧИД шийдэгдсэн дансны хувилбар — хожим master data өөрчлөгдөхөд
  // түүхэн бичилт дахин бичигдэхгүй (JPR-005, FR-AUD-003).
  debitAccountNumber: text("debit_account_number"),
  creditAccountNumber: text("credit_account_number"),
  status: text("status").notNull().default("draft"), // "draft" | "posted" | "reversed"
  voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
    onDelete: "set null",
  }),
  reversalVoucherId: uuid("reversal_voucher_id").references(
    () => journalVouchers.id,
    { onDelete: "set null" }
  ),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // 1:1 дүрмийн DB backstop: нэг хөдөлгөөнд идэвхтэй ҮНДСЭН үнэлгээний
  // бичилт нэг л байна (landed_cost нь нэмэлт давхарга тул хамаарахгүй).
  uniqueIndex("cost_entries_movement_active_uq")
    .on(t.movementId)
    .where(
      sql`${t.movementId} is not null and ${t.status} <> 'reversed' and ${t.entryType} <> 'landed_cost'`
    ),
  index("cost_entries_user_status_ix").on(t.userId, t.status), index("cost_entries_org_status_ix").on(t.organizationId, t.status),
]);

export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  user: one(users, { fields: [inventoryItems.userId], references: [users.id] }),
  movements: many(inventoryMovements),
}));

export const warehousesRelations = relations(warehouses, ({ one }) => ({
  user: one(users, { fields: [warehouses.userId], references: [users.id] }),
}));

export const inventoryMovementsRelations = relations(
  inventoryMovements,
  ({ one, many }) => ({
    user: one(users, {
      fields: [inventoryMovements.userId],
      references: [users.id],
    }),
    item: one(inventoryItems, {
      fields: [inventoryMovements.itemId],
      references: [inventoryItems.id],
    }),
    warehouse: one(warehouses, {
      fields: [inventoryMovements.warehouseId],
      references: [warehouses.id],
      relationName: "movement_warehouse",
    }),
    toWarehouse: one(warehouses, {
      fields: [inventoryMovements.toWarehouseId],
      references: [warehouses.id],
      relationName: "movement_to_warehouse",
    }),
    costEntries: many(costEntries),
  })
);

export const costingItemSettingsRelations = relations(
  costingItemSettings,
  ({ one }) => ({
    user: one(users, {
      fields: [costingItemSettings.userId],
      references: [users.id],
    }),
    item: one(inventoryItems, {
      fields: [costingItemSettings.itemId],
      references: [inventoryItems.id],
    }),
  })
);

export const productionStagesRelations = relations(
  productionStages,
  ({ one, many }) => ({
    user: one(users, {
      fields: [productionStages.userId],
      references: [users.id],
    }),
    pools: many(costPools),
  })
);

export const costPoolsRelations = relations(costPools, ({ one, many }) => ({
  stage: one(productionStages, {
    fields: [costPools.stageId],
    references: [productionStages.id],
  }),
  rules: many(costPoolRules),
}));

export const costPoolRulesRelations = relations(costPoolRules, ({ one }) => ({
  pool: one(costPools, {
    fields: [costPoolRules.poolId],
    references: [costPools.id],
  }),
}));

export const productionRunsRelations = relations(
  productionRuns,
  ({ many }) => ({
    stages: many(productionRunStages),
    pools: many(productionRunPools),
    inputs: many(productionRunInputs),
    outputs: many(productionRunOutputs),
  })
);

export const productionRunStagesRelations = relations(
  productionRunStages,
  ({ one }) => ({
    run: one(productionRuns, {
      fields: [productionRunStages.runId],
      references: [productionRuns.id],
    }),
  })
);

export const productionRunPoolsRelations = relations(
  productionRunPools,
  ({ one }) => ({
    run: one(productionRuns, {
      fields: [productionRunPools.runId],
      references: [productionRuns.id],
    }),
    pool: one(costPools, {
      fields: [productionRunPools.poolId],
      references: [costPools.id],
    }),
  })
);

export const productionRunInputsRelations = relations(
  productionRunInputs,
  ({ one }) => ({
    run: one(productionRuns, {
      fields: [productionRunInputs.runId],
      references: [productionRuns.id],
    }),
    item: one(inventoryItems, {
      fields: [productionRunInputs.itemId],
      references: [inventoryItems.id],
    }),
  })
);

export const productionRunOutputsRelations = relations(
  productionRunOutputs,
  ({ one }) => ({
    run: one(productionRuns, {
      fields: [productionRunOutputs.runId],
      references: [productionRuns.id],
    }),
    item: one(inventoryItems, {
      fields: [productionRunOutputs.itemId],
      references: [inventoryItems.id],
    }),
  })
);

export const costAllocationsRelations = relations(
  costAllocations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [costAllocations.userId],
      references: [users.id],
    }),
    component: one(costComponents, {
      fields: [costAllocations.costComponentId],
      references: [costComponents.id],
    }),
    lines: many(costAllocationLines),
  })
);

export const costAllocationLinesRelations = relations(
  costAllocationLines,
  ({ one }) => ({
    allocation: one(costAllocations, {
      fields: [costAllocationLines.allocationId],
      references: [costAllocations.id],
    }),
    movement: one(inventoryMovements, {
      fields: [costAllocationLines.movementId],
      references: [inventoryMovements.id],
    }),
  })
);

export const costEntriesRelations = relations(costEntries, ({ one }) => ({
  user: one(users, { fields: [costEntries.userId], references: [users.id] }),
  movement: one(inventoryMovements, {
    fields: [costEntries.movementId],
    references: [inventoryMovements.id],
  }),
  item: one(inventoryItems, {
    fields: [costEntries.itemId],
    references: [inventoryItems.id],
  }),
  run: one(costingRuns, {
    fields: [costEntries.runId],
    references: [costingRuns.id],
  }),
  voucher: one(journalVouchers, {
    fields: [costEntries.voucherId],
    references: [journalVouchers.id],
  }),
}));


// ─── Fixed Assets (fa) — хөрөнгийн карт + элэгдэл ────────────────────────────
// Худалдан авалтын GL-ийг АП/касс/GL модуль бичдэг; FA модуль картыг хөтөлж
// зөвхөн ЭЛЭГДЛИЙН журналыг (Dr 70000001 / Cr 21000099, §2.21) бичнэ.

export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    acquisitionDate: text("acquisition_date").notNull(),
    cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
    salvageValue: numeric("salvage_value", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    usefulLifeMonths: integer("useful_life_months").notNull().default(0),
    // "straight_line" | "declining_balance" (×2 үлдэгдэл буурах)
    depreciationMethod: text("depreciation_method")
      .notNull()
      .default("straight_line"),
    // Хөрөнгө эзэмшигч / хариуцагч (ажилтан, хэлтэс)
    custodian: text("custodian"),
    // Элэгдэл эхлэх сар (YYYY-MM); идэвхжүүлэхэд заавал бөглөнө.
    depreciationStartMonth: text("depreciation_start_month"),
    assetAccountNumber: text("asset_account_number")
      .notNull()
      .default("21010000"),
    accumDepAccountNumber: text("accum_dep_account_number")
      .notNull()
      .default("21000099"),
    depExpenseAccountNumber: text("dep_expense_account_number")
      .notNull()
      .default("70000001"),
    status: text("status").notNull().default("draft"), // "draft" | "active" | "disposed"
    // Худалдан авалтыг бичсэн GL воучер (АП/касс/гар журналын sync).
    sourceVoucherId: uuid("source_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code), unique().on(t.organizationId, t.code)]
);

export const faDepreciationEntries = pgTable("fa_depreciation_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => fixedAssets.id, { onDelete: "restrict" }),
  periodMonth: text("period_month").notNull(), // YYYY-MM — нэг сард 1 идэвхтэй бичилт (кодоор)
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  status: text("status").notNull().default("draft"), // "draft" | "posted" | "reversed"
  voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
    onDelete: "set null",
  }),
  reversalVoucherId: uuid("reversal_voucher_id").references(
    () => journalVouchers.id,
    { onDelete: "set null" }
  ),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // "Нэг сард 1 идэвхтэй бичилт" дүрмийн DB backstop (advisory lock-ийн нэмэлт).
  uniqueIndex("fa_dep_entries_asset_month_active_uq")
    .on(t.assetId, t.periodMonth)
    .where(sql`${t.status} <> 'reversed'`),
]);

export const fixedAssetsRelations = relations(fixedAssets, ({ one, many }) => ({
  user: one(users, { fields: [fixedAssets.userId], references: [users.id] }),
  depreciationEntries: many(faDepreciationEntries),
}));

export const faDepreciationEntriesRelations = relations(
  faDepreciationEntries,
  ({ one }) => ({
    user: one(users, {
      fields: [faDepreciationEntries.userId],
      references: [users.id],
    }),
    asset: one(fixedAssets, {
      fields: [faDepreciationEntries.assetId],
      references: [fixedAssets.id],
    }),
    voucher: one(journalVouchers, {
      fields: [faDepreciationEntries.voucherId],
      references: [journalVouchers.id],
    }),
  })
);

// ─── AI чат ──────────────────────────────────────────────────────────────────
// AI туслахын харилцан ярианы түүх — хэрэглэгч бүрд нэг урсгал.
// Draft-first бодлого: AI зөвхөн зөвлөгөө өгнө, DB-руу бичилт хийхгүй тул
// энд журналын reference хадгалахгүй.

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Мессежид хавсаргасан файлууд (зураг/PDF/текст, base64) — дараагийн
// асуултуудад ч AI контекстээ харж чаддаг байхын тулд хадгална.
export const aiAttachments = pgTable("ai_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => aiMessages.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mediaType: text("media_type").notNull(),
  data: text("data").notNull(), // base64
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiMessagesRelations = relations(aiMessages, ({ many }) => ({
  attachments: many(aiAttachments),
}));

export const aiAttachmentsRelations = relations(aiAttachments, ({ one }) => ({
  message: one(aiMessages, {
    fields: [aiAttachments.messageId],
    references: [aiMessages.id],
  }),
}));

// ── OAuth 2.1 (MCP custom connector) ────────────────────────────────────────
// claude.ai / Cowork-ийн custom connector "Connect" дарахад dynamic client
// registration → PKCE authorize → token гэсэн стандарт урсгалаар холбогдоно.
// Бүх нууц (code, access, refresh) sha256 hash-аараа хадгалагдана.

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(), // = client_id
  name: text("name").notNull(),
  /** JSON массив — зөвшөөрөгдсөн redirect_uri-ууд. */
  redirectUris: text("redirect_uris").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const oauthCodes = pgTable("oauth_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  accessTokenHash: text("access_token_hash").notNull().unique(),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  accessExpiresAt: timestamp("access_expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

// MCP холболтын Personal Access Token — Claude Code зэрэг гадны MCP клиент
// Bearer token-оор нэвтэрнэ. Түлхүүр өөрөө хадгалагдахгүй, sha256 hash нь л
// хадгалагдана (үүсгэх мөчид НЭГ л удаа бүтнээрээ харагдана).
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** Сүүлийн 4 тэмдэгт — жагсаалтад таних зорилгоор. */
  tokenHint: text("token_hint").notNull(),
  /** Дуусах хугацаа — null бол хугацаагүй (хуучин токенууд хэвээр). */
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

// AI туслахын хэрэглэгч бүрийн тохиргоо. apiKey нь хэрэглэгчийн өөрийн
// Anthropic түлхүүр — байхгүй бол серверийн ANTHROPIC_API_KEY-г ашиглана.
// openaiApiKey — OpenAI моделиудад (байхгүй бол серверийн OPENAI_API_KEY).
// model нь аль ч provider-ийн модель байж болно (provider нь моделиос
// тодорхойлогдоно — lib/ai/models.ts modelInfo).
export const aiSettings = pgTable("ai_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  apiKey: text("api_key"),
  openaiApiKey: text("openai_api_key"),
  model: text("model").notNull().default("claude-opus-4-8"),
  effort: text("effort").notNull().default("high"), // low | medium | high
  // AI бичилт хийх горим: "draft" = зөвхөн ноорог (§9 human-in-the-loop),
  // "post" = тэнцсэн журналыг шууд батлахыг зөвшөөрнө (хэрэглэгч ил сонгоно).
  writeMode: text("write_mode").notNull().default("draft"),
  customInstructions: text("custom_instructions"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique().on(t.userId, t.organizationId)]);

// ─── Компанийн мэдээлэл — нэхэмжлэх, хэвлэх маягтын толгой ───────────────────

export const companySettings = pgTable("company_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull().default(""),
  registerNo: text("register_no"),
  vatPayerNo: text("vat_payer_no"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  /** Банкны данснууд — [{ bankName, accountNo, accountName }] */
  bankAccounts: jsonb("bank_accounts")
    .$type<{ bankName: string; accountNo: string; accountName: string }[]>()
    .notNull()
    .default([]),
  /** PNG зурагнууд — data URL биш, цэвэр base64 (aiAttachments-тай ижил загвар). */
  logo: text("logo"),
  stamp: text("stamp"),
  /** Гарын үсгүүд — [{ name, title, image(base64 PNG) }] */
  signatures: jsonb("signatures")
    .$type<{ name: string; title: string; image: string }[]>()
    .notNull()
    .default([]),
  /** Нэхэмжлэхийн PDF-д тамга/гарын үсгийг автоматаар оруулах эсэх. */
  autoStamp: boolean("auto_stamp").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique().on(t.organizationId)]);

// ─── Нэхэмжлэх илгээлт — суваг бүрийн бүртгэл, төлөв мөрдөлт ─────────────────

export const arApInvoiceSends = pgTable("ar_ap_invoice_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
    onDelete: "cascade",
  }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => arApDocuments.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // "email" | "link"
  /** И-мэйл суваг: хүлээн авагчийн хаяг. Линк суваг: null. */
  recipient: text("recipient"),
  /** Public линкний токен — таамаглагдашгүй, хүчингүй болгож болно. */
  token: uuid("token").notNull().defaultRandom().unique(),
  revokedAt: timestamp("revoked_at"),
  /** Линкний дуусах хугацаа — null бол хугацаагүй (хуучин линкүүд хэвээр). */
  expiresAt: timestamp("expires_at"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  /** Линк анх нээгдсэн мөч — "Үзсэн" төлөв. */
  viewedAt: timestamp("viewed_at"),
});

// ─── Audit log — хэн, хэзээ, юу хийснийг мөрдөх ──────────────────────────────
// Батлах/буцаах/устгах/хаах зэрэг статус шилжилт бүрд НЭГ мөр. Бизнесийн
// дата энд ХАДГАЛАГДАХГҮЙ — зөвхөн мөрдөлтийн тэмдэглэл (summary текст).

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Фаз 01: scope нь байгууллага; userId нь createdBy утгаар үлдсэн.
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    /** post | unpost | reverse | delete | close | reopen | create_voucher ... */
    action: text("action").notNull(),
    /** journal | cash | arap | fa | cost | period | payroll | vat ... */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Хүнд уншигдах товч тайлбар (дүн, дугаар, огноо). */
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_user_created_ix").on(t.userId, t.createdAt), index("audit_events_org_created_ix").on(t.organizationId, t.createdAt)]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type ChartOfAccount = typeof chartOfAccounts.$inferSelect;
export type JournalVoucher = typeof journalVouchers.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type JournalVoucherWithLines = JournalVoucher & { lines: JournalLine[] };
export type SegmentConfig = typeof segmentConfigs.$inferSelect;
export type SegmentValue = typeof segmentValues.$inferSelect;
export type ModuleConfig = typeof moduleConfigs.$inferSelect;
export type ReportLineMapping = typeof reportLineMappings.$inferSelect;
export type AccountingPeriod = typeof accountingPeriods.$inferSelect;
export type CashAccount = typeof cashAccounts.$inferSelect;
export type CashDocument = typeof cashDocuments.$inferSelect;
export type BankStatement = typeof bankStatements.$inferSelect;
export type BankStatementLine = typeof bankStatementLines.$inferSelect;
export type CashFxRevaluation = typeof cashFxRevaluations.$inferSelect;
export type Counterparty = typeof counterparties.$inferSelect;
export type ArApDocument = typeof arApDocuments.$inferSelect;
export type ArApDocumentLine = typeof arApDocumentLines.$inferSelect;
export type ArApSettlement = typeof arApSettlements.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type CostComponent = typeof costComponents.$inferSelect;
export type InventoryIssueType = typeof inventoryIssueTypes.$inferSelect;
export type CostingAccountSetting = typeof costingAccountSettings.$inferSelect;
export type CostingItemSetting = typeof costingItemSettings.$inferSelect;
export type CostingRun = typeof costingRuns.$inferSelect;
export type CostEntry = typeof costEntries.$inferSelect;
export type CostPeriodResult = typeof costPeriodResults.$inferSelect;
export type ProductionStage = typeof productionStages.$inferSelect;
export type CostPool = typeof costPools.$inferSelect;
export type CostPoolRule = typeof costPoolRules.$inferSelect;
export type ProductionRun = typeof productionRuns.$inferSelect;
export type CostAllocation = typeof costAllocations.$inferSelect;
export type CostAllocationLine = typeof costAllocationLines.$inferSelect;
export type FixedAsset = typeof fixedAssets.$inferSelect;
export type FaDepreciationEntry = typeof faDepreciationEntries.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiAttachment = typeof aiAttachments.$inferSelect;
export type AiSettings = typeof aiSettings.$inferSelect;
export type CompanySettings = typeof companySettings.$inferSelect;
export type ArApInvoiceSend = typeof arApInvoiceSends.$inferSelect;

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  integer,
  boolean,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default("gl,ar,ap,fa,cost,cash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.number)]
);

// ─── Journal Vouchers ─────────────────────────────────────────────────────────

export const journalVouchers = pgTable("journal_vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD
  description: text("description").notNull(),
  status: text("status").notNull().default("posted"), // "draft" | "posted" | "reversed"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Journal Lines ────────────────────────────────────────────────────────────

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => journalVouchers.id, { onDelete: "cascade" }),
    cashAccountId: uuid("cash_account_id"),
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
  ]
);

// ─── Cash Management ─────────────────────────────────────────────────────────

export const cashAccounts = pgTable("cash_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.documentNo)]
);

export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  (table) => [unique().on(table.userId, table.fileHash)]
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
    name: text("name").notNull(),
    counterpartyType: text("counterparty_type").notNull().default("both"), // "customer" | "supplier" | "both"
    registerNo: text("register_no"),
    defaultReceivableAccountNumber: text("default_receivable_account_number"),
    defaultPayableAccountNumber: text("default_payable_account_number"),
    defaultCurrency: text("default_currency").notNull().default("MNT"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.name)]
);

export const arApDocuments = pgTable(
  "ar_ap_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.documentNo)]
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
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

export const arApSettlements = pgTable("ar_ap_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
});

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
    moduleKey: text("module_key").notNull(), // "gl" | "ar" | "ap" | "fa" | "cost" | "cash" | "agis"
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.moduleKey)]
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
    segmentId: integer("segment_id").notNull(), // 1–10 (except 3, which uses chartOfAccounts)
    code: text("code").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.segmentId, t.code)]
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
    segmentId: integer("segment_id").notNull(), // 1–10
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default(""), // comma-separated: "gl,ar,ap,fa,cost,cash"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.segmentId)]
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
  (t) => [unique().on(t.userId, t.reportType, t.lineKey)]
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
    code: text("code").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("ш"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code)]
);

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.code)]
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentNo: text("document_no").notNull(),
    movementType: text("movement_type").notNull(), // "receipt" | "issue" | "transfer" | "adjustment"
    date: text("date").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    // transfer destination; null for other types
    toWarehouseId: uuid("to_warehouse_id").references(() => warehouses.id, {
      onDelete: "restrict",
    }),
    // Units only. Positive for receipt/issue/transfer; adjustment is SIGNED
    // (+ илүүдэл, − дутагдал).
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("draft"), // "draft" | "confirmed" | "cancelled"
    sourceType: text("source_type").notNull().default("manual"), // "manual" | "arap_line" | "gl_voucher" | "cash_document"
    sourceId: uuid("source_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [unique().on(t.userId, t.documentNo)]
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
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    inventoryAccountNumber: text("inventory_account_number")
      .notNull()
      .default("14000001"),
    cogsAccountNumber: text("cogs_account_number").notNull().default("61100000"),
    costMethod: text("cost_method").notNull().default("weighted_avg"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.itemId)]
);

export const costingRuns = pgTable("costing_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  asOfDate: text("as_of_date").notNull(),
  entryCount: integer("entry_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const costEntries = pgTable("cost_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => costingRuns.id, {
    onDelete: "set null",
  }),
  // 1:1 with the movement among non-reversed entries (enforced in code so a
  // reversed entry can be superseded by a fresh valuation).
  movementId: uuid("movement_id")
    .notNull()
    .references(() => inventoryMovements.id, { onDelete: "restrict" }),
  entryType: text("entry_type").notNull(), // "receipt_capitalize" | "issue_cogs" | "adjustment_gain" | "adjustment_loss"
  date: text("date").notNull(), // movement date — the voucher date
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // MNT
  valuationSource: text("valuation_source").notNull(), // "manual" | "avg_cost"
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
});

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

export const costEntriesRelations = relations(costEntries, ({ one }) => ({
  user: one(users, { fields: [costEntries.userId], references: [users.id] }),
  movement: one(inventoryMovements, {
    fields: [costEntries.movementId],
    references: [inventoryMovements.id],
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
export type CostingItemSetting = typeof costingItemSettings.$inferSelect;
export type CostingRun = typeof costingRuns.$inferSelect;
export type CostEntry = typeof costEntries.$inferSelect;

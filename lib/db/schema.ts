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

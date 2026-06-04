import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  integer,
  boolean,
  unique,
  check,
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
  status: text("status").notNull().default("posted"), // "draft" | "posted"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Journal Lines ────────────────────────────────────────────────────────────

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  voucherId: uuid("voucher_id")
    .notNull()
    .references(() => journalVouchers.id, { onDelete: "cascade" }),
  accountNumber: text("account_number").notNull(),
  debit: numeric("debit", { precision: 18, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 18, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(chartOfAccounts),
  vouchers: many(journalVouchers),
  moduleConfigs: many(moduleConfigs),
  segmentConfigs: many(segmentConfigs),
  segmentValues: many(segmentValues),
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

// ─── Bank Accounts (Cash module) ──────────────────────────────────────────────

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountNumber: text("account_number").notNull(), // GL данс: 10xxxxxx касс / 11xxxxxx банк
  name: text("name").notNull(),
  currency: text("currency").notNull().default("MNT"),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Bank Transactions (Cash module) ──────────────────────────────────────────

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    direction: text("direction").notNull(), // "inflow" | "outflow"
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    contraAccount: text("contra_account").notNull(), // нөгөө тал GL данс
    cfCategory: text("cf_category").notNull().default("operating"), // operating|investing|financing
    counterparty: text("counterparty").default(""),
    description: text("description").notNull(),
    reference: text("reference").default(""),
    source: text("source").notNull().default("manual"), // manual|ar|ap|import
    sourceId: text("source_id"),
    status: text("status").notNull().default("draft"), // draft|posted
    reconStatus: text("recon_status").notNull().default("unreconciled"), // unreconciled|matched|cleared
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("bank_tx_direction_chk", sql`${t.direction} in ('inflow','outflow')`),
    check(
      "bank_tx_cf_category_chk",
      sql`${t.cfCategory} in ('operating','investing','financing')`
    ),
    check("bank_tx_status_chk", sql`${t.status} in ('draft','posted')`),
    check(
      "bank_tx_source_chk",
      sql`${t.source} in ('manual','ar','ap','import')`
    ),
    check(
      "bank_tx_recon_chk",
      sql`${t.reconStatus} in ('unreconciled','matched','cleared')`
    ),
    check("bank_tx_amount_positive_chk", sql`${t.amount} >= 0`),
  ]
);

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  user: one(users, { fields: [bankAccounts.userId], references: [users.id] }),
  transactions: many(bankTransactions),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  user: one(users, { fields: [bankTransactions.userId], references: [users.id] }),
  bankAccount: one(bankAccounts, {
    fields: [bankTransactions.bankAccountId],
    references: [bankAccounts.id],
  }),
  voucher: one(journalVouchers, {
    fields: [bankTransactions.voucherId],
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
export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;

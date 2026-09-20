import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  integer,
  boolean,
  uniqueIndex,
  index,
  foreignKey,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  /**
   * И-мэйл баталгаажсан мөч. null = баталгаажаагүй (баннер + дахин илгээх).
   * Багана нэмэгдэхээс ӨМНӨХ хэрэглэгчид preDeploy-д createdAt-аар нөхөгдөнө
   * (харилцагчийн deploy дээр ажиллаж буй хүмүүс түгжигдэхгүй); урилгаар
   * бүртгүүлсэн, и-мэйл тохируулаагүй deploy-д бүртгүүлсэн хэрэглэгч мөн
   * шууд баталгаажсан гэж тооцогдоно — баталгаажуулалт хэзээ ч нэвтрэлтийг
   * ХААХГҮЙ (lib/actions/account-recovery.ts).
   */
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
// UNIQUE CONSTRAINT биш, UNIQUE INDEX — drizzle-kit 0.31.x-ийн #5955 (§5b):
// constraint-ыг push бүрд "байхгүй" гэж үзээд бөглөөтэй хүснэгтэд дахин
// нэмэхийг оролдож «truncate хийх үү?» гэж асууж non-TTY preDeploy-г унагаана.
(t) => [uniqueIndex("users_email_ux").on(t.email)]);

// ─── Нэг удаагийн нууц token (нууц үг сэргээх, и-мэйл баталгаажуулах) ───────
// Зөвхөн sha256 hash хадгална (lib/account/tokens.ts); хугацаатай, нэг удаа.
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** password_reset | email_verify (AuthTokenKind) */
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_token_hash_ux").on(t.tokenHash),
    index("auth_tokens_user_kind_ix").on(t.userId, t.kind),
  ]
);

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

// ─── Billing / entitlement (docs/billing/00-proposal.md) ─────────────────────
// SaaS горимд байгууллага бүрийн багц; мөр байхгүй = trial (үүссэнээс 14 хоног).
// Хүснэгт АНХ үүсэхэд preDeploy бүх байгууллагад standard/active нөхнө
// (ажиллаж буй хэн ч read-only болохгүй). dedicated горимд уншигдахгүй.
export const organizationSubscriptions = pgTable(
  "organization_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** lib/billing/plans.ts PlanId */
    planId: text("plan_id").notNull().default("standard"),
    /** trialing | active | past_due | suspended | cancelled */
    status: text("status").notNull().default("active"),
    /** Төлсөн суудал (null = багцын default / хязгааргүй). */
    seats: integer("seats"),
    trialEndsAt: timestamp("trial_ends_at"),
    /** Төлбөр төлөгдсөн хугацааны эцэс — past_due-ийн grace эндээс тоологдоно. */
    currentPeriodEnd: timestamp("current_period_end"),
    /** { features?: {key: bool}, limits?: {seats?, companies?} } — байгууллагын онцгой тохиргоо. */
    overrides: jsonb("overrides"),
    /** Тусгай үнэ ₮/суудал/сар (null = багцын үнэ) — enterprise хэлэлцээр, хөнгөлөлт. */
    pricePerSeatMnt: integer("price_per_seat_mnt"),
    note: text("note"),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organization_subscriptions_org_ux").on(t.organizationId)]
);

/**
 * Багцын ҮНЭ — ПЛАТФОРМЫН лавлах (organizationId БАЙХГҮЙ: үнэ бүх харилцагчид
 * нэг). Мөр бүр нь ОГНООНЫ МУЖ тул багцын үнийн ТҮҮХ энд хадгалагдана: анхны
 * үнэ, дараагийн шинэчлэлт, ирээдүйн үнэ бүгд тусдаа мөр. Тухайн өдрийг хамрах
 * үе БАЙХГҮЙ бол `lib/billing/plans.ts`-ийн default үнэ үйлчилнэ.
 * price_per_seat_mnt null = хэлэлцээрээр (0₮ БИШ).
 * Entry Console `/api/platform/plan-prices`-ээр удирдана.
 */
export const platformPlanPrices = pgTable(
  "platform_plan_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** lib/billing/plans.ts PlanId */
    planId: text("plan_id").notNull(),
    /** MNT / суудал / сар; null = хэлэлцээрээр */
    pricePerSeatMnt: integer("price_per_seat_mnt"),
    /** Мөрдөж эхлэх өдөр (YYYY-MM-DD) */
    effectiveFrom: text("effective_from").notNull(), // YYYY-MM-DD
    /** Мөрдөх сүүлийн өдөр (ХАМРУУЛСАН); null = хугацаагүй */
    effectiveTo: text("effective_to"), // YYYY-MM-DD
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  // Нэг багцад нэг өдрөөс хоёр үе эхлэхгүй; давхцлыг planPriceChange барина.
  (t) => [uniqueIndex("platform_plan_prices_period_ux").on(t.planId, t.effectiveFrom)]
);

/**
 * ДЭМЖЛЭГИЙН ХАНДАЛТ — платформын оператор харилцагчийн байгууллагад ТҮР
 * хугацаагаар орох сесс (lib/platform/support.ts). Апп дотор "супер админ"
 * РОЛЬ БАЙХГҮЙ: линкийг ЗӨВХӨН Entry Console (Bearer ENTRY_PLATFORM_API_KEY)
 * олгоно, эрх нь хэрэглэгчид биш СЕССЭД уягдаж хугацаа дуусмагц унтарна.
 * Орох/гарах бүр аудитад бичигдэнэ — харилцагч /settings/audit дээрээ хардаг.
 */
export const platformSupportSessions = pgTable(
  "platform_support_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Линкийг ашиглах ЭРХТЭЙ Entry данс (операторын өөрийн хэрэглэгч). */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256(raw) — DB алдагдсан ч линк/cookie хүчинтэй болохгүй. */
    tokenHash: text("token_hash").notNull(),
    /** viewer (зөвхөн унших, default) | admin — owner ХЭЗЭЭ Ч олгогдохгүй. */
    role: text("role").notNull().default("viewer"),
    /** Console-д бичсэн шалтгаан — аудитын тайлбарт ил гарна. */
    reason: text("reason"),
    /** "Entry Console · <actor>" — логт л ордог, эрх олгохгүй. */
    issuedBy: text("issued_by"),
    /** Ашиглагдаагүй ЛИНК хүчингүй болох мөч. */
    expiresAt: timestamp("expires_at").notNull(),
    /** Линк идэвхжсэн (хэрэглэгч орсон) мөч. */
    startedAt: timestamp("started_at"),
    /** Сесс автоматаар унтрах мөч (startedAt + TTL). */
    endsAt: timestamp("ends_at"),
    /** Гараар гарсан / Console-оос тасалсан мөч. */
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("platform_support_sessions_token_ux").on(t.tokenHash),
    index("platform_support_sessions_org_ix").on(t.organizationId),
    index("platform_support_sessions_user_ix").on(t.userId),
  ]
);

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
    /**
     * Модулийн нарийн эрх — JSON (moduleKey → "none"|"read"|"write"|"post").
     * null = role-ийн default (lib/permissions.ts); owner/admin-д үйлчлэхгүй.
     */
    permissions: text("permissions"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_organization_id_user_id_ux").on(
      t.organizationId,
      t.userId
    ),
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

/** Урилгын линкийн хүчинтэй хугацаа (хоног) — дуусвал шинээр урина. */
export const ORG_INVITATION_TTL_DAYS = 7;

// Бүртгэлгүй и-мэйл рүү илгээсэн урилга. Хүлээн авагч token-той линкээр
// бүртгүүлмэгц гишүүнчлэл идэвхжиж acceptedAt тавигдана; цуцлах = мөр устгах.
// Линк ХУГАЦААТАЙ (expiresAt, default 7 хоног) — хуучин линк үүрд хүчинтэй
// үлдэхгүй; дахин урихад хугацаа шинэчлэгдэнэ.
export const orgInvitations = pgTable(
  "org_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("accountant"), // MembershipRole (owner-гүй)
    token: uuid("token").notNull().defaultRandom(),
    invitedBy: text("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Линк хүчингүй болох мөч — үүнээс хойш бүртгүүлэх боломжгүй. */
    expiresAt: timestamp("expires_at")
      .notNull()
      .default(sql`now() + interval '7 days'`),
    acceptedAt: timestamp("accepted_at"),
  },
  (t) => [
    // Нэг байгууллагад нэг и-мэйлд НЭГ л хүлээгдэж буй урилга.
    uniqueIndex("org_invitations_pending_ux")
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} is null`),
    uniqueIndex("org_invitations_token_ux").on(t.token),
  ]
);

export const orgInvitationsRelations = relations(orgInvitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgInvitations.organizationId],
    references: [organizations.id],
  }),
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
  (t) => [
    uniqueIndex("chart_of_accounts_organization_id_number_ux").on(
      t.organizationId,
      t.number
    ),
  ]
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
  (t) => [
    uniqueIndex("accounting_periods_organization_id_code_ux").on(
      t.organizationId,
      t.code
    ),
  ]
);

// П28 — Периодын дансны үлдэгдлийн SNAPSHOT. Период хаагдахад бичигдэж
// (lib/periods/snapshot.ts), дахин нээхэд устдаг. Хаагдсан период immutable
// тул snapshot хуучирдаггүй — тайлангийн уншилт үүн дээр тулгуурлан
// журналын бүрэн скан хийхгүй (lib/reports/period-balances.ts).
// accountNumber нь journal_lines-тэй ИЖИЛ бүтэн сегмент код — дараа нь
// аль ч activeSegIds бүлэглэлтээр дахин нэгтгэж болно.
export const accountPeriodBalances = pgTable(
  "account_period_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodCode: text("period_code").notNull(), // "YYYY-MM"
    accountNumber: text("account_number").notNull(),
    /** Кумулятив нээлт — периодын эхнээс ӨМНӨХ бүх posted/reversed бичилт. */
    openingDebit: numeric("opening_debit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    openingCredit: numeric("opening_credit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    periodDebit: numeric("period_debit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    periodCredit: numeric("period_credit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_period_balances_org_period_account_ux").on(
      t.organizationId,
      t.periodCode,
      t.accountNumber
    ),
    index("account_period_balances_org_period_ix").on(
      t.organizationId,
      t.periodCode
    ),
  ]
);

// Кассын дансны периодын ХААЛТЫН ҮЛДЭГДЭЛ (П28-ын кассын хувилбар). Период
// хаагдахад lib/cash/period-snapshot.ts бичиж, дахин нээхэд устдаг. Хаагдсан
// период immutable тул хуучирдаггүй — үлдэгдэл = сүүлийн snapshot + дараах
// баримтын SQL нийлбэр (lib/cash/period-balances.ts); баримт JS-д ачаалагдахгүй.
// ДАНСНЫ ВАЛЮТААР хадгална (product owner 2026-09-13); MNT дүн нь тухайн
// дансны GL дансны snapshot-д (account_period_balances) байгаа тул давхардуулахгүй.
export const cashAccountPeriodBalances = pgTable(
  "cash_account_period_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodCode: text("period_code").notNull(), // "YYYY-MM"
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    /** Периодын эцсийн үлдэгдэл дансны валютаар = нээлт + Σ posted баримт (≤ endDate). */
    closingBalance: numeric("closing_balance", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cash_account_period_balances_org_period_acct_ux").on(
      t.organizationId,
      t.periodCode,
      t.cashAccountId
    ),
    index("cash_account_period_balances_org_account_ix").on(
      t.organizationId,
      t.cashAccountId,
      t.periodCode
    ),
  ]
);

// Бараа × агуулахын периодын хаалтын үлдэгдэл (тоо хэмжээ) — snapshot + delta
// (П28-ын бараа материалын хувилбар). closePeriod-д бичигдэж, reopen-д устдаг.
// Зөвхөн 0-ээс ялгаатай үлдэгдэл хадгалагдана; уншигч байхгүйг 0 гэж үзнэ.
export const inventoryPeriodBalances = pgTable(
  "inventory_period_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodCode: text("period_code").notNull(), // "YYYY-MM"
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    /** Периодын эцсийн үлдэгдэл = Σ confirmed хөдөлгөөний нөлөө (≤ endDate). */
    quantity: numeric("quantity", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_period_balances_org_period_item_wh_ux").on(
      t.organizationId,
      t.periodCode,
      t.itemId,
      t.warehouseId
    ),
    index("inventory_period_balances_org_period_ix").on(
      t.organizationId,
      t.periodCode
    ),
  ]
);

// ─── Journal Vouchers ─────────────────────────────────────────────────────────

// ─── Баримтын дугаарын тоолуур ───────────────────────────────────────────────
//
// Журналын дугаарыг `select max(...) + 1`-ээр бодвол зэрэгцээ хоёр транзакц
// ИЖИЛ дугаар авч, нэг нь unique зөрчлөөр унах эрсдэлтэй (бичилт нь том
// транзакцийн дотор тул дахин оролдоход бүх ажил буцна). Тиймээс тоолуурыг
// `insert … on conflict do update set value = value + 1 returning value`-ээр
// АТОМААР нэмэгдүүлнэ — мөрийн цоожинд зөвхөн тухайн scope л орно.
//
// scope = дугаарын "ишний" тогтмол хэсэг (ж: "GL-26") — жил солигдоход шинэ
// мөр үүсч тоолуур 1-ээс эхэлнэ.

export const documentCounters = pgTable(
  "document_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("document_counters_org_scope_ux").on(t.organizationId, t.scope),
  ]
);

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
    // Журналын бичилтийн ДУГААР: "<модуль>-<YY>-<NNNNNN>" (ж: GL-26-000001).
    // Эх модулиа ил харуулж, жил бүр 1-ээс эхэлнэ (lib/gl/voucher-no.ts).
    // NULL зөвшөөрөгдөнө — энэ багана нэмэгдэхээс ӨМНӨХ түүхэн бичилтүүд
    // дугааргүй үлдэнэ (UI-д «—»); шинэ бичилт бүр дугаартай.
    documentNo: text("document_no"),
    // Draft-first систем тул default нь draft — status-аа мартсан ямар ч
    // insert аюулгүй талдаа (ноорог) унана. Бүх код status-аа ил өгдөг.
    status: text("status").notNull().default("draft"), // "draft" | "posted" | "reversed"
    // Гадаад системийн давтагдашгүй дугаар (eBarimt ДДТД г.м) — idempotency
    // түлхүүр: ижил ref-тэй хоёр дахь create шинэ баримт үүсгэхгүй.
    externalRef: text("external_ref"),
    /**
     * Баримтын ВАЛЮТ ба ханш (IAS 21) — баримтад НЭГ валют, НЭГ ханш (касс,
     * АР/АП-тай ИЖИЛ загвар). MNT баримтад currency="MNT", exchangeRate=1.
     * Мөрийн debit/credit нь ҮРГЭЛЖ ДЭВТРИЙН валют (MNT) — баланс, тайлан
     * бүгд түүгээр бодогдоно; валютын дүн нь мөрийн debitFc/creditFc.
     */
    currency: text("currency").notNull().default("MNT"),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 })
      .notNull()
      .default("1"),
    /** "mongolbank" — албан ханшаар автоматаар; "manual" — гараар дарж бичсэн. */
    rateSource: text("rate_source"),
    /** Хэрэглэсэн ханшийн ӨӨРИЙН огноо (амралтын өдөр — өмнөх ажлын өдрийнх). */
    rateDate: text("rate_date"),
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
    // Дугаар нь байгууллага дотор давхардахгүй. Partial — дугааргүй түүхэн
    // мөрүүд (NULL) хэдэн ч байж болно.
    uniqueIndex("journal_vouchers_org_document_no_ux")
      .on(t.organizationId, t.documentNo)
      .where(sql`${t.documentNo} is not null`),
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
    /**
     * ГАДААД валютын дүн — баримтын валют MNT БИШ үед л бөглөгдөнө (MNT
     * баримтад 0). `debit`/`credit` нь эдгээрээс ханшаар бодогдсон ДЭВТРИЙН
     * валютын дүн; бөөрөнхийллийн зөрүү хамгийн том мөрөнд шингэдэг
     * (lib/gl/currency.ts convertLinesToBase).
     */
    debitFc: numeric("debit_fc", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    creditFc: numeric("credit_fc", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    description: text("description").default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    // Клирингийн бизнес объектын түлхүүр — бичих МӨЧИД тавигдана
    // (FR-PROC-003/004): 'purchase_order' + PO id. FK биш: объект устахад
    // журналын мөр үлдэх ёстой (аудит).
    businessObjectType: text("business_object_type"),
    businessObjectId: uuid("business_object_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.cashAccountId],
      foreignColumns: [cashAccounts.id],
    }).onDelete("set null"),
    index("journal_lines_voucher_ix").on(table.voucherId),
    index("journal_lines_business_object_ix")
      .on(table.businessObjectType, table.businessObjectId)
      .where(sql`${table.businessObjectId} is not null`),
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
    // S8 мөнгөн гүйлгээний ангилал (МГ код) — segment_values(8)-ийн код.
    cashFlowCode: text("cash_flow_code"),
    // Харилцагчийн НЭР (чөлөөт текст — банкны хуулга, GL-ээс үүссэн ноорог
    // г.м. бүртгэлгүй харилцагчид ч бичигдэнэ). Бүртгэлтэй харилцагч бол
    // counterpartyId холбоос + нэр нь бүртгэлийнхтэй ижил.
    counterparty: text("counterparty"),
    // Харилцагчийн БҮРТГЭЛТЭЙ холбоос (код/РД, нэр нь эндээс уншигдана).
    // Харилцагч устгагдвал холбоос тасарч нэр текстээрээ үлдэнэ.
    counterpartyId: uuid("counterparty_id").references(
      () => counterparties.id,
      { onDelete: "set null" }
    ),
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
    /** Эх модуль: "manual" | "pos" — POS-ийн баримтыг кассын панелиас буцаахгүй. */
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("cash_documents_organization_id_document_no_ux").on(
      t.organizationId,
      t.documentNo
    ),
    uniqueIndex("cash_documents_org_external_ref_uq")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index("cash_documents_user_status_ix").on(t.userId, t.status), index("cash_documents_org_status_ix").on(t.organizationId, t.status),
    index("cash_documents_user_date_ix").on(t.userId, t.date), index("cash_documents_org_date_ix").on(t.organizationId, t.date),
    index("cash_documents_counterparty_ix").on(t.counterpartyId),
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
  (table) => [
    uniqueIndex("bank_statements_organization_id_file_hash_ux").on(
      table.organizationId,
      table.fileHash
    ),
  ]
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
    /** @deprecated 2026-09: импортод хэрэггүй болсон — бичигдэхгүй. Багана нь
     *  харилцагчийн DB дээр `db:push` DROP хийхээс сэргийлж хэвээр үлдэв. */
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
    /** @deprecated 2026-09: банкны үлдэгдэл импортлогдохгүй — тулгалт нь
     *  нээлт + Σ(орлого − зарлага)-аас ӨӨРӨӨ тооцно. Багана DROP хийгдээгүй. */
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
  (table) => [
    // UNIQUE CONSTRAINT биш, UNIQUE INDEX — drizzle-kit 0.31.x-ийн алдаа
    // (drizzle-team/drizzle-orm#5955): `unique()`-ээр үүссэн constraint-ыг
    // push дараагийн удаа "байхгүй" гэж үзээд бөглөөтэй хүснэгтэд дахин
    // нэмэхийг оролдож «truncate хийх үү?» гэж асуудаг — non-TTY preDeploy
    // дээр тэр асуулт crash болж, схемийн БҮХ өөрчлөлт DB-д ОРОХГҮЙ үлддэг
    // (2026-09-18: 3 мөртэй болмогц үндсэн апп унаж, АР/АП хуудас 500 өгсөн).
    // Нэр нь хуучин `…_unique` constraint-аас ЗОРИУД өөр — давхцахгүй.
    uniqueIndex("bank_statement_lines_statement_row_ux").on(
      table.statementId,
      table.rowNumber
    ),
  ]
);

// П8 — Банкны хуулгын импортын хэрэглэгчийн дүрэм: нөхцөл (текст агуулна /
// чиглэл / дүнгийн муж) → үйлдэл (харьцах данс, харилцагч, тайлбар бөглөх).
// mode: suggest (санал болгох) | auto (уншигдмагц шууд бөглөх). Тулгалтын
// цэвэр логик lib/cash/bank-rules.ts-д.
export const bankRules = pgTable("bank_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  matchText: text("match_text").notNull(),
  side: text("side").notNull().default("any"),
  minAmount: numeric("min_amount", { precision: 18, scale: 2 }),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  counterAccountNumber: text("counter_account_number").notNull(),
  setCounterparty: text("set_counterparty"),
  setDescription: text("set_description"),
  mode: text("mode").notNull().default("suggest"),
  priority: integer("priority").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
    uniqueIndex("cash_fx_revaluations_org_acct_date_rev_ux").on(table.organizationId,
      table.cashAccountId,
      table.valuationDate,
      table.revision
    ),
  ]
);

// ─── Ханшийн түүх (нийтийн лавлах — байгууллагаар хуваагдахгүй) ─────────────
// Монголбанкны албан ханш ба арилжааны банкуудын ханшийг ӨДРӨӨР хадгална.
// Зорилго: (1) эхний үлдэгдэл, өмнөх үеийн бичилтэд ТУХАЙН ӨДРИЙН ханшийг
// ашиглах, (2) эх сурвалж унтарсан ч тайлан дахин бодогдох, (3) ямар ханшаар
// юу бичсэн нь аудитад мөрдөгдөх. Ханш нь нийтийн баримт тул org-оор
// хуваахгүй; татсан хэрэглэгчийг мэдээллийн зорилгоор л үлдээнэ.
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "mongolbank" | "tdb" | "golomt" */
    source: text("source").notNull(),
    /** Ханшийн ӨӨРИЙН огноо (эх сурвалжийн RATE_DATE), YYYY-MM-DD. */
    date: text("date").notNull(),
    currency: text("currency").notNull(),
    officialRate: numeric("official_rate", { precision: 18, scale: 8 }),
    nonCashBuyRate: numeric("non_cash_buy_rate", { precision: 18, scale: 8 }),
    nonCashSellRate: numeric("non_cash_sell_rate", { precision: 18, scale: 8 }),
    cashBuyRate: numeric("cash_buy_rate", { precision: 18, scale: 8 }),
    cashSellRate: numeric("cash_sell_rate", { precision: 18, scale: 8 }),
    sourceUrl: text("source_url"),
    /** Хэзээ татсан (сүүлийн шинэчлэлт). */
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    /** Татсан хэрэглэгч — мэдээллийн зорилгоор (ханш нь нийтийн лавлах). */
    fetchedBy: text("fetched_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // UNIQUE CONSTRAINT биш, UNIQUE INDEX — drizzle-kit 0.31.x-ийн алдаа
    // (drizzle-team/drizzle-orm#5955): `unique()`-ээр үүссэн constraint-ыг
    // push нь дараагийн удаа "байхгүй" гэж үзээд бөглөөтэй хүснэгтэд дахин
    // нэмэх гэж truncate асуулт тавьж, non-TTY preDeploy дээр crash хийдэг.
    // Unique index нь pg_indexes-ээс зөв танигдана; ON CONFLICT (source,
    // currency, date) index-ээр ч ажиллана. Нэр нь хуучин constraint-ийн
    // `…_unique`-ээс ЗОРИУД өөр — байгаа DB дээр давхцахгүй.
    uniqueIndex("exchange_rates_source_currency_date_ux").on(
      t.source,
      t.currency,
      t.date
    ),
    index("exchange_rates_currency_date_ix").on(t.currency, t.date),
    index("exchange_rates_source_date_ix").on(t.source, t.date),
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
    // Харилцагчийн КОД — РД/ТТД-ээс тусдаа, байгууллага дотор давтагдашгүй
    // танигдахуун (кассын "Харилцагчийн код" багана). Хоосон байж болно.
    code: text("code"),
    counterpartyType: text("counterparty_type").notNull().default("both"), // "customer" | "supplier" | "both"
    // СУБЪЕКТИЙН төрөл — "organization" | "individual" (lib/arap/counterparty-kind.ts);
    // тооцооны чиглэлээс (counterpartyType) ТУСДАА хэмжээс.
    entityKind: text("entity_kind").notNull().default("organization"),
    // Байгууллагад РД (7) / ТТД (11/14), хувь хүнд иргэний РД (УУ12345678).
    registerNo: text("register_no"),
    defaultReceivableAccountNumber: text("default_receivable_account_number"),
    defaultPayableAccountNumber: text("default_payable_account_number"),
    defaultCurrency: text("default_currency").notNull().default("MNT"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    // Нэхэмжлэх илгээхэд ашиглагдана.
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    // Ханган нийлүүлэгчийн мэдээлэл (PO панелийн карт, төлбөрийн заавар).
    contactPerson: text("contact_person"),
    // POS (docs/pos §3.2): хөнгөлөлтийн харилцагчийн бүлэг (VIP, ажилтан, бөөний…)
    // ба зээлээр борлуулах лимит (MNT, null = хязгааргүй).
    customerGroup: text("customer_group"),
    creditLimit: numeric("credit_limit", { precision: 18, scale: 2 }),
    bankName: text("bank_name"),
    bankAccountNo: text("bank_account_no"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("counterparties_organization_id_name_ux").on(
      table.organizationId,
      table.name
    ),
    uniqueIndex("counterparties_organization_id_code_ux")
      .on(table.organizationId, table.code)
      .where(sql`${table.code} is not null`),
  ]
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
    // Хангамжийн захиалга — PO-той нэхэмжлэхийн бараа/бүрэлдэхүүн мөр нь
    // ӨГЛӨГИЙН ТҮР ДАНС руу бичигдэж, орлого нь хүлээн авалтын баримтаас
    // үүснэ (docs/procurement §3.3 ③④).
    purchaseOrderId: uuid("purchase_order_id").references(
      () => purchaseOrders.id,
      { onDelete: "restrict" }
    ),
    /**
     * Эх модуль: "manual" | "pos" (docs/pos §3.2). POS-оос үүссэн баримтыг
     * АР панелиас засах/устгах/буцаах ХОРИОТОЙ — зөвхөн POS буцаалтаар.
     */
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ar_ap_documents_organization_id_document_no_ux").on(
      table.organizationId,
      table.documentNo
    ),
    uniqueIndex("ar_ap_documents_org_external_ref_uq")
      .on(table.organizationId, table.externalRef)
      .where(sql`${table.externalRef} is not null`),
    index("ar_ap_documents_user_status_ix").on(table.userId, table.status), index("ar_ap_documents_org_status_ix").on(table.organizationId, table.status),
    index("ar_ap_documents_user_date_ix").on(table.userId, table.date), index("ar_ap_documents_org_date_ix").on(table.organizationId, table.date),
    index("ar_ap_documents_po_ix")
      .on(table.purchaseOrderId)
      .where(sql`${table.purchaseOrderId} is not null`),
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
    // Хангамж: PO мөрийн холбоос + нэгж үнэ (PO валютаар). Бүрэлдэхүүнтэй
    // мөр = барааны өртөгт капиталжих нэмэлт зардал (гааль, тээвэр …);
    // бараатай мөртэй ЗЭРЭГ байж болохгүй (CHECK).
    purchaseOrderLineId: uuid("purchase_order_line_id").references(
      () => purchaseOrderLines.id,
      { onDelete: "restrict" }
    ),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }),
    costComponentId: uuid("cost_component_id").references(
      () => costComponents.id,
      { onDelete: "restrict" }
    ),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "ar_ap_document_lines_item_xor_component",
      sql`not (${table.itemId} is not null and ${table.costComponentId} is not null)`
    ),
    index("ar_ap_document_lines_po_line_ix")
      .on(table.purchaseOrderLineId)
      .where(sql`${table.purchaseOrderLineId} is not null`),
    index("ar_ap_document_lines_component_ix")
      .on(table.costComponentId)
      .where(sql`${table.costComponentId} is not null`),
  ]
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
  // Кассгүй хаалт — харилцан суутган тооцоо (АР↔АП offset): GL воучертоо
  // шууд холбогдоно. Нэг offset = хоёр settlement мөр (АР-д нэг, АП-д нэг)
  // нэг voucherId-гаар холбогдоно; cashDocumentId null байна.
  voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
    onDelete: "restrict",
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
  index("ar_ap_settlements_voucher_ix")
    .on(t.voucherId)
    .where(sql`${t.voucherId} is not null`),
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
  // `counterparty` нэр нь текст баганатай давхцах тул холбоосыг `counterpartyRef`.
  counterpartyRef: one(counterparties, {
    fields: [cashDocuments.counterpartyId],
    references: [counterparties.id],
    relationName: "cashDocumentCounterparty",
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
    cashDocuments: many(cashDocuments, {
      relationName: "cashDocumentCounterparty",
    }),
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
    purchaseOrder: one(purchaseOrders, {
      fields: [arApDocuments.purchaseOrderId],
      references: [purchaseOrders.id],
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
    purchaseOrderLine: one(purchaseOrderLines, {
      fields: [arApDocumentLines.purchaseOrderLineId],
      references: [purchaseOrderLines.id],
    }),
    costComponent: one(costComponents, {
      fields: [arApDocumentLines.costComponentId],
      references: [costComponents.id],
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
  (t) => [
    uniqueIndex("module_configs_organization_id_module_key_ux").on(
      t.organizationId,
      t.moduleKey
    ),
  ]
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
    /**
     * S1 (Компани) / S6 (Группын дотоод) — автомат бүрдэх утгын эх байгууллага.
     * Холбоос нь кодыг ТОГТВОРТОЙ байлгана: компанийн нэр солигдоход утгын
     * нэр дагаж шинэчлэгдэнэ, код (журналд бичигдсэн) хэвээр үлдэнэ.
     * null = хэрэглэгч гараар оруулсан утга.
     */
    linkedOrganizationId: uuid("linked_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" }
    ),
    isEnabled: boolean("is_enabled").notNull().default(true),
    modules: text("modules").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("segment_values_org_id_segment_id_code_ux").on(
      t.organizationId,
      t.segmentId,
      t.code
    ),
  ]
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
  (t) => [
    uniqueIndex("segment_configs_organization_id_segment_id_ux").on(
      t.organizationId,
      t.segmentId
    ),
  ]
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
    /**
     * Comma-separated S8 (мөнгөн урсгалын) сегментийн кодууд — зөвхөн
     * cash-flow тайланд: журналын мөрийн S8 код эдгээрийн аль нэгтэй таарвал
     * урсгал ЭНЭ мөрөнд орно (дансны таарцаас түрүүлж шалгагдана).
     * Хоосон/null = S8-аар шүүхгүй, зөвхөн дансаар.
     */
    cfCodes: text("cf_codes"),
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
  (t) => [
    uniqueIndex("report_line_mappings_org_type_line_ux").on(
      t.organizationId,
      t.reportType,
      t.lineKey
    ),
  ]
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
    // ── POS (docs/pos/00-proposal.md §3.2) — бүгд сонголтоор ──
    /** Борлуулах үнэ (MNT, нэгжид) — АР нэхэмжлэх/POS-д нэгж үнэ автоматаар. НӨАТ төлөгч байгууллагад НӨАТ ОРСОН үнэ; null = тогтоогоогүй. Өртөгтэй ХОЛБООГҮЙ. */
    salesPrice: numeric("sales_price", { precision: 18, scale: 4 }),
    /** Кассчны хөнгөлөлтийн доод хязгаар — үнэ − хөнгөлөлт ≥ энэ (эрхтэй нь давна). */
    minSalesPrice: numeric("min_sales_price", { precision: 18, scale: 2 }),
    /** Сканнерын код — байгууллага дотор давхцахгүй (partial unique index). */
    barcode: text("barcode"),
    /** "standard" (НӨАТ-тай) | "exempt" (чөлөөлөгдсөн) | "zero" (0%). */
    vatMode: text("vat_mode").notNull().default("standard"),
    /** Барааны орлогын дансны override — хоосон бол pos_settings.revenueAccountNumber. */
    revenueAccountNumber: text("revenue_account_number"),
    /** Барааны бүлэг (inventory_categories.code) — хөнгөлөлтийн дүрэм, тайлан. */
    categoryCode: text("category_code"),
    // ── eBarimt 3.0 (docs/pos/03-ebarimt-integration-plan.md §4.1) ──
    /** ТЕГ-ийн бараа/үйлчилгээний ангилал — 7 орон. Хоосон бол бүлгийнхийг өвлөнө; байхгүй бол eBarimt илгээгдэхгүй (ангилал ЗОХИОХГҮЙ). */
    ebarimtClassificationCode: text("ebarimt_classification_code"),
    /** НӨАТ-гүй / 0%-ийн барааны татварын бүтээгдэхүүний код — 3 орон (VAT_FREE / VAT_ZERO-д заавал). */
    ebarimtTaxProductCode: text("ebarimt_tax_product_code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_items_organization_id_code_ux").on(
      t.organizationId,
      t.code
    ),
    uniqueIndex("inventory_items_org_barcode_ux")
      .on(t.organizationId, t.barcode)
      .where(sql`${t.barcode} is not null`),
  ]
);

/** Барааны бүлэг — хөнгөлөлтийн дүрмийн хамрах хүрээ, тайлангийн бүлэглэл. */
export const inventoryCategories = pgTable(
  "inventory_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Бүлгийн eBarimt ангилалын код (7 орон) — бараанд хоосон бол өвлөгдөнө. */
    ebarimtClassificationCode: text("ebarimt_classification_code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_categories_org_code_ux").on(t.organizationId, t.code),
  ]
);

/**
 * Борлуулах үнийн ТҮҮХ — үнэ өөрчлөх бүрд мөр (аудит). Борлуулалтын мөр
 * үнээ ӨӨРТӨӨ хадгалдаг тул тайлан энэ түүхээс хамаарахгүй.
 */
export const itemPriceHistory = pgTable(
  "item_price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    salesPrice: numeric("sales_price", { precision: 18, scale: 2 }),
    effectiveFrom: text("effective_from").notNull(), // YYYY-MM-DD
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("item_price_history_item_ix").on(t.itemId, t.createdAt)]
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
  (t) => [
    uniqueIndex("warehouses_organization_id_code_ux").on(
      t.organizationId,
      t.code
    ),
  ]
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
    // "manual" | "arap_line" | "gl_voucher" | "cash_document" | "po_receipt"
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [
    uniqueIndex("inventory_movements_org_id_document_no_ux").on(
      t.organizationId,
      t.documentNo
    ),
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
  (t) => [
    uniqueIndex("costing_item_settings_org_id_item_id_ux").on(
      t.organizationId,
      t.itemId
    ),
  ]
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
  (t) => [
    uniqueIndex("cost_components_organization_id_code_ux").on(
      t.organizationId,
      t.code
    ),
  ]
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
  (t) => [
    uniqueIndex("inventory_issue_types_org_id_code_ux").on(
      t.organizationId,
      t.code
    ),
  ]
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
  /** Орлогын эсрэг тал — худалдан авалтын клиринг (бараа материалын түр данс). */
  clearingAccountNumber: text("clearing_account_number").notNull(),
  /**
   * Өглөгийн түр данс — PO-той нэхэмжлэх бүр Dr, PO хаалтад Cr
   * (docs/procurement §3.1). Хоёр түр данс PO объектоор тэгширнэ.
   */
  apClearingAccountNumber: text("ap_clearing_account_number")
    .notNull()
    .default("31000099"),
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
}, (t) => [uniqueIndex("costing_account_settings_org_id_ux").on(t.organizationId)]);

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
    /** Овог — нэрээс тусдаа (харагдац: "Овог Нэр"). */
    lastName: text("last_name").notNull().default(""),
    /** Регистрийн дугаар — байгууллага дотор ДАВХЦАХГҮЙ цорын ганц талбар. */
    registerNo: text("register_no"),
    birthDate: text("birth_date"),
    phone: text("phone"),
    email: text("email"),
    homeAddress: text("home_address"),
    bankName: text("bank_name"),
    bankAccountNo: text("bank_account_no"),
    iban: text("iban"),
    /** Ажилд орсон огноо — "ажилласан жил" үүнээс АВТОМАТААР бодогдоно. */
    hireDate: text("hire_date"),
    terminationDate: text("termination_date"),
    department: text("department").notNull().default(""),
    /** primary | contract | hourly. */
    employmentType: text("employment_type").notNull().default("primary"),
    position: text("position").notNull().default(""),
    /** Сарын үндсэн цалин — бодолтод earnings-ийн default болно. */
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    /**
     * АО-НДШ (%) — ажил олгогчийн НИЙТ НДШ хувь (суурь 11.7 + ҮОМШӨ):
     * оффис 12.5 · барилга 13.2 · уул уурхай 14.2–14.7.
     */
    employerSiPercent: numeric("employer_si_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("12.5"),
    /**
     * ХЧТА тэтгэмжийн хувь (%) — НД-ын шимтгэл төлсөн ЖИЛЭЭС хамаарна тул
     * ажилтан бүрд ил тохируулна. null = тохируулаагүй → тэтгэмж
     * АВТОМАТААР бодогдохгүй (хувийг ЗОХИОХГҮЙ, нягтлан гараар оруулна).
     */
    sickBenefitPercent: numeric("sick_benefit_percent", {
      precision: 5,
      scale: 2,
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // Нэр/овог давхцаж болно — зөвхөн РД (өгөгдсөн үед) давхцахгүй.
  (t) => [
    uniqueIndex("employees_org_register_ux")
      .on(t.organizationId, t.registerNo)
      .where(sql`${t.registerNo} is not null`),
  ]
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
  /**
   * Сарын стандарт ажлын цаг — цагийн хөлс = үндсэн цалин / энэ тоо
   * (payroll/overtime.md: 22 ажлын өдөр × 8 цаг = 168; салбараас хамаарч
   * 168–176 тул тохиргоогоор өөрчилнө). Урьдчилгаа цалинг ажилласан
   * цагаар бодоход ашиглагдана.
   */
  standardMonthlyHours: numeric("standard_monthly_hours", {
    precision: 8,
    scale: 2,
  })
    .notNull()
    .default("168"),
  /**
   * Сарын ажлын өдрийн норм — ӨДРИЙН дундаж хөлсний хуваагч (ээлжийн амралт,
   * ХЧТА-ийн олговорт). overtime.md: дундаж 22 өдөр.
   */
  monthlyWorkDays: numeric("monthly_work_days", { precision: 6, scale: 2 })
    .notNull()
    .default("22"),
  /**
   * Ээлжийн амралт / тэтгэмжийн дундаж цалинг хэдэн сараар бодох (ХЗ-ийн
   * «дундаж цалин хөлс»). Тайлант сараас ӨМНӨХ N сарын бодит олголт.
   */
  averageEarningsMonths: integer("average_earnings_months").notNull().default(12),
  /** Илүү цагийн коэффициентүүд — хуулийн доод хэмжээ (ХЗ 103·106·107·108). */
  overtimeMultiplier: numeric("overtime_multiplier", { precision: 5, scale: 2 })
    .notNull()
    .default("1.5"),
  restDayMultiplier: numeric("rest_day_multiplier", { precision: 5, scale: 2 })
    .notNull()
    .default("1.5"),
  holidayMultiplier: numeric("holiday_multiplier", { precision: 5, scale: 2 })
    .notNull()
    .default("2"),
  /** Шөнийн нэмэгдэл — цагийн хөлсний хувь (0.2 = +20%). */
  nightBonusRate: numeric("night_bonus_rate", { precision: 5, scale: 2 })
    .notNull()
    .default("0.2"),
  /**
   * ХЧТА тэтгэмжийн зардлын данс — тохируулаагүй бол цалингийн зардлын данс
   * хэрэглэгдэнэ (нийгмийн даатгалын сангаас нөхөн авдаг хэсгийг нягтлан
   * дараа нь ангилна).
   */
  sickBenefitAccountNumber: text("sick_benefit_account_number"),
  /**
   * Цалингийн нэхэмжлэхийн ӨГЛӨГИЙН ХЯНАЛТЫН данс — АР/АП модулийн
   * ажилтанд өгөх өглөг энд суудаг (кассаас энэ өглөгийг хаана).
   * Цалингийн өглөг (salaryPayable) нь КЛИРИНГ тал: нэхэмжлэх батлагдахад
   * Dr Цалингийн өглөг / Cr энэ данс болж, §7-ийн нэгдсэн журналын
   * кредитийг ажилтны өглөг рүү шилжүүлнэ (зардал давхар бичигдэхгүй).
   */
  employeePayableAccountNumber: text("employee_payable_account_number")
    .notNull()
    .default("31000001"),
  /**
   * Цалингийн нэхэмжлэхийн нэгтгэсэн харилцагч ("Ажилчид") — эхний
   * нэхэмжлэх үүсгэхэд автоматаар бүртгэгдэнэ.
   */
  employeeCounterpartyId: uuid("employee_counterparty_id").references(
    () => counterparties.id,
    { onDelete: "set null" }
  ),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("payroll_settings_org_id_ux").on(t.organizationId)]);

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
    /** Урьдчилгаа олгох огноо — хэрэглэгч бодолт бүрд сонгоно (сар дундуур). */
    advanceDate: text("advance_date"),
    /** Урьдчилгааны нэгтгэсэн өглөгийн нэхэмжлэх (АР/АП модульд). */
    advanceDocumentId: uuid("advance_document_id").references(
      () => arApDocuments.id,
      { onDelete: "set null" }
    ),
    /** Сүүл цалингийн нэгтгэсэн өглөгийн нэхэмжлэх. */
    finalDocumentId: uuid("final_document_id").references(
      () => arApDocuments.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_runs_org_id_period_month_ux").on(
      t.organizationId,
      t.periodMonth
    ),
  ]
);

export const payrollRunLines = pgTable("payroll_run_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "restrict" }),
  /**
   * Нийт олголт = үндсэн олголт (цалин × ажилласан/ажиллавал зохих цаг)
   * + ээлжийн амралт + бусад нэмэгдэл. Server талд ДАХИН бодогдоно.
   */
  earnings: numeric("earnings", { precision: 18, scale: 2 }).notNull(),
  /**
   * Сард бодитоор ажилласан цаг (БҮТЭН сараар) — үндсэн олголтыг тогтооно.
   * Бодолт хийхэд ажиллавал зохих цагаар бөглөгдөнө (бүтэн сар ажилласан).
   * Урьдчилгааны advanceHours-оос ТУСДАА: тэр нь зөвхөн урьдчилгаа олгох
   * хүртэлх цаг.
   */
  workedHours: numeric("worked_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Ээлжийн амралтын олголт — засварлагдана, нийт олголтод НЭМЭГДЭНЭ. */
  vacationPay: numeric("vacation_pay", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /** Бусад нэмэгдэл (урамшуулал, илүү цаг г.м) — нийт олголтод НЭМЭГДЭНЭ. */
  otherAdditions: numeric("other_additions", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /**
   * Бусад суутгал (зээл г.м) — НДШ, ХАОАТ тооцоологдсоны ДАРАА гарт
   * олгохоос хасагдана (татварын сууринд ОРОХГҮЙ).
   */
  otherDeductions: numeric("other_deductions", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /**
   * Тухайн сард ажиллавал зохих цаг — ажилтан бүрд засварлагдана (бүтэн бус
   * цагийн ажилтан, сар бүрийн ажлын өдрийн зөрүү). Цагийн хөлсний
   * ХУВААГЧ: цагийн хөлс = үндсэн цалин / ажиллавал зохих цаг.
   * Бодолт хийхэд тохиргооны стандарт цагаар бөглөгдөнө.
   */
  standardHours: numeric("standard_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /**
   * Урьдчилгаа цалинд тооцох ажилласан цаг — засварлагдана. Урьдчилгаа нь
   * сарын ГАРТ ОЛГОХ цалингийн урьдчилсан төлбөр (нэмэлт олголт БИШ):
   * дүн нь суутгалгүйгээр олгогдож, сүүл цалингаас хасагдана.
   */
  advanceHours: numeric("advance_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Урьдчилгаагаар олгосон дүн = цагийн хөлс × ажилласан цаг (server бодно). */
  advanceAmount: numeric("advance_amount", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  // ── Нэмэгдэл, олговрын ОРЦ (цаг / хоног) ───────────────────────────────
  // Дүн нь эдгээрээс АВТОМАТААР бодогдоно (lib/payroll/additions.ts); дүнг
  // гараар дарж бичвэл харгалзах `*Manual` тэмдэг асаж, дахин бодолт түүнийг
  // ДАРАХГҮЙ (тэмдгийг арилгавал дахин автомат болно).
  /** Ердийн илүү цаг (ХЗ 103 — 1.5×). */
  overtimeHours: numeric("overtime_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Амралтын өдөр ажилласан цаг (ХЗ 107 — 1.5×). */
  restDayHours: numeric("rest_day_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Баярын өдөр ажилласан цаг (ХЗ 108 — 2.0×). */
  holidayHours: numeric("holiday_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Шөнийн цаг 22:00–06:00 (ХЗ 106 — цагийн хөлсний +20% нэмэгдэл). */
  nightHours: numeric("night_hours", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Ээлжийн амралтын хоног (ХЗ 109). */
  vacationDays: numeric("vacation_days", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** ХЧТА (хөдөлмөрийн чадвар түр алдалт)-ын хоног. */
  sickDays: numeric("sick_days", { precision: 8, scale: 2 })
    .notNull()
    .default("0"),
  /** Илүү цаг/шөнө/амралт-баярын нэмэгдлийн НИЙЛБЭР — нийт олголтод орно. */
  overtimePay: numeric("overtime_pay", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /**
   * ХЧТА тэтгэмж — ХАОАТ, НДШ-ийн сууринд ОРОХГҮЙ (ХАОАТ хууль 24), зөвхөн
   * гарт олгох дүнд нэмэгдэнэ.
   */
  sickBenefit: numeric("sick_benefit", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /** Дүнг гараар дарж бичсэн эсэх — дахин бодолт эдгээрийг хөндөхгүй. */
  vacationPayManual: boolean("vacation_pay_manual").notNull().default(false),
  overtimePayManual: boolean("overtime_pay_manual").notNull().default(false),
  sickBenefitManual: boolean("sick_benefit_manual").notNull().default(false),
  /**
   * Ээлжийн амралт / ХЧТА-ийн суурь болсон дундаж (харуулах, аудитад):
   * сарын дундаж олголт ба хэдэн сарын дата ашигласан.
   */
  averageMonthlyEarnings: numeric("average_monthly_earnings", {
    precision: 18,
    scale: 2,
  })
    .notNull()
    .default("0"),
  averageMonthsUsed: integer("average_months_used").notNull().default(0),
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
  advanceDocument: one(arApDocuments, {
    fields: [payrollRuns.advanceDocumentId],
    references: [arApDocuments.id],
    relationName: "payrollAdvanceDocument",
  }),
  finalDocument: one(arApDocuments, {
    fields: [payrollRuns.finalDocumentId],
    references: [arApDocuments.id],
    relationName: "payrollFinalDocument",
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

// Татварын дансны тохиргоо — НӨАТ-аас БУСАД татвар бүрийн өглөг + авлагын
// данс (НӨАТ нь vat_settings, ХХОАТ/НДШ-ийн өглөг нь payroll_settings-д).
// Ratified-seed: мөр байхгүй бол default-уудаар үүсдэг (lib/tax/settings.ts).
export const taxSettings = pgTable("tax_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  citPayableAccountNumber: text("cit_payable_account_number")
    .notNull()
    .default("31000003"),
  citReceivableAccountNumber: text("cit_receivable_account_number")
    .notNull()
    .default("13630000"),
  whtPayableAccountNumber: text("wht_payable_account_number")
    .notNull()
    .default("31000004"),
  whtReceivableAccountNumber: text("wht_receivable_account_number")
    .notNull()
    .default("13660000"),
  propertyPayableAccountNumber: text("property_payable_account_number")
    .notNull()
    .default("31000005"),
  propertyReceivableAccountNumber: text("property_receivable_account_number")
    .notNull()
    .default("13660000"),
  customsPayableAccountNumber: text("customs_payable_account_number")
    .notNull()
    .default("31000006"),
  customsReceivableAccountNumber: text("customs_receivable_account_number")
    .notNull()
    .default("13660000"),
  /** ХХОАТ, НДШ-ийн ӨГЛӨГ нь payroll_settings-д — энд зөвхөн авлага тал. */
  pitReceivableAccountNumber: text("pit_receivable_account_number")
    .notNull()
    .default("13640000"),
  siReceivableAccountNumber: text("si_receivable_account_number")
    .notNull()
    .default("13650000"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("tax_settings_org_id_ux").on(t.organizationId)]);

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
  /**
   * Байгууллага НӨАТ төлөгч эсэх (docs/pos §3.8, D4). Төлөгч биш бол POS
   * борлуулалтад НӨАТ мөр огт үүсэхгүй, барааны үнэ = орлого. Мөр анх
   * үүсэхэд company_settings.vatPayerNo бөглөгдсөн эсэхээр тавигдана.
   */
  isVatPayer: boolean("is_vat_payer").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("vat_settings_org_id_ux").on(t.organizationId)]);

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
    /** "value" | "quantity" | "manual" — хэрэглэгч баримт бүрд сонгоно (OD-017). */
    allocationBase: text("allocation_base").notNull(),
    description: text("description").notNull().default(""),
    /** Хангамж: зардал гарсан АП нэхэмжлэхийн мөр (Σ ≤ мөрийн MNT дүн). */
    sourceLineId: uuid("source_line_id").references(
      () => arApDocumentLines.id,
      { onDelete: "restrict" }
    ),
    /** Хангамж: хуваарилалт хамаарах захиалга. */
    purchaseOrderId: uuid("purchase_order_id").references(
      () => purchaseOrders.id,
      { onDelete: "restrict" }
    ),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cost_allocations_org_id_document_no_ux").on(
      t.organizationId,
      t.documentNo
    ),
    index("cost_allocations_source_line_ix")
      .on(t.sourceLineId)
      .where(sql`${t.sourceLineId} is not null`),
    index("cost_allocations_po_ix")
      .on(t.purchaseOrderId)
      .where(sql`${t.purchaseOrderId} is not null`),
  ]
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
  (t) => [
    uniqueIndex("cost_period_results_org_period_item_wh_ux").on(
      t.organizationId,
      t.periodCode,
      t.itemId,
      t.warehouseId
    ),
  ]
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
  // "receipt_capitalize" | "issue_cogs" | "adjustment_gain" | "adjustment_loss"
  // | "landed_cost" | "nrv_writedown" | "nrv_reversal" | "return_in" | "return_out"
  // | "cogs_true_up" (docs/pos §3.7: урьдчилсан COGS-ийн сар хаалтын залруулга —
  //   amount ТЭМДЭГТЭЙ: + → Dr COGS / Cr Бараа, − → урвуу)
  entryType: text("entry_type").notNull(),
  date: text("date").notNull(), // movement date — the voucher date
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // MNT
  // "manual" | "avg_cost" | "po_receipt" (PO үнэ × хүлээн авсан өдрийн МБ
  // ханш) | "ap_line" (нэмэлт зардлын нэхэмжлэхийн мөрөөс хуваарилагдсан)
  // | "provisional_avg" (POS: борлуулах мөчийн явцын дундаж — сар хаалтад
  //   cogs_true_up-аар залруулагдана, docs/pos §3.7)
  valuationSource: text("valuation_source").notNull(),
  /** cogs_true_up: аль урьдчилсан бичилтийг залруулж байна. */
  trueUpOfEntryId: uuid("true_up_of_entry_id"),
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
  // Хангамжийн lineage: зардал гарсан АП нэхэмжлэхийн мөр + клирингийн
  // бизнес объект (PO) — түр дансдын тэгшитгэлийг объектоор нэгтгэнэ.
  sourceLineId: uuid("source_line_id").references(() => arApDocumentLines.id, {
    onDelete: "set null",
  }),
  businessObjectType: text("business_object_type"),
  businessObjectId: uuid("business_object_id"),
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
  // cogs_true_up нь ҮНДСЭН үнэлгээний давхарга биш — залруулга (олон байж
  // болно: дахин нээх/хаах бүрд нэг) тул мөн хамаарахгүй.
  uniqueIndex("cost_entries_movement_active_uq")
    .on(t.movementId)
    .where(
      sql`${t.movementId} is not null and ${t.status} <> 'reversed' and ${t.entryType} not in ('landed_cost', 'cogs_true_up')`
    ),
  // Нэг хөдөлгөөнд нэг л ИДЭВХТЭЙ НООРОГ залруулга (идемпотент дахин тооцоолол).
  uniqueIndex("cost_entries_true_up_draft_uq")
    .on(t.movementId)
    .where(
      sql`${t.movementId} is not null and ${t.entryType} = 'cogs_true_up' and ${t.status} = 'draft'`
    ),
  index("cost_entries_user_status_ix").on(t.userId, t.status), index("cost_entries_org_status_ix").on(t.organizationId, t.status),
  index("cost_entries_source_line_ix")
    .on(t.sourceLineId)
    .where(sql`${t.sourceLineId} is not null`),
  index("cost_entries_business_object_ix")
    .on(t.businessObjectType, t.businessObjectId)
    .where(sql`${t.businessObjectId} is not null`),
]);

// ─── Хангамж (Procurement — PO + хүлээн авалт) ───────────────────────────────
// docs/procurement/00-proposal.md §3. PO нь GL бичилт үүсгэхгүй ХОЛБООСЫН
// объект: бараа хүлээн авалт (Dr бараа / Cr бараа материалын түр данс),
// нийлүүлэгчийн ба нэмэлт зардлын нэхэмжлэх (Dr өглөгийн түр данс / Cr өглөг),
// зардлын хуваарилалт (Dr бараа / Cr бараа материалын түр данс), PO хаалт
// (Dr бараа материалын түр данс / Cr өглөгийн түр данс + ханшийн зөрүү).

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(),
    /** Ханган нийлүүлэгч — counterpartyType "supplier" | "both". */
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "restrict" }),
    date: text("date").notNull(), // YYYY-MM-DD
    /** Хүлээгдэж буй хүргэлтийн огноо (мэдээлэл). */
    expectedDate: text("expected_date"),
    currency: text("currency").notNull().default("MNT"),
    /** Мөр бүрийн агуулахын default. */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
      onDelete: "restrict",
    }),
    description: text("description").notNull().default(""),
    /** "draft" | "open" | "closed" | "cancelled" */
    status: text("status").notNull().default("draft"),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    externalRef: text("external_ref"),
    approvedAt: timestamp("approved_at"),
    closedAt: timestamp("closed_at"),
    /** Түр дансдыг тэгшитгэсэн хаалтын журнал. */
    closeVoucherId: uuid("close_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    /** Хаасан өдрийн Монголбанкны ханш — мэдээллийн зорилгоор. */
    closeExchangeRate: numeric("close_exchange_rate", {
      precision: 18,
      scale: 8,
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_orders_org_id_document_no_ux").on(
      t.organizationId,
      t.documentNo
    ),
    uniqueIndex("purchase_orders_org_external_ref_uq")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index("purchase_orders_org_status_ix").on(t.organizationId, t.status),
    index("purchase_orders_org_date_ix").on(t.organizationId, t.date),
    index("purchase_orders_org_counterparty_ix").on(
      t.organizationId,
      t.counterpartyId
    ),
  ]
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    /** Нэгж үнэ PO валютаар — орлогдох нэгж өртгийн суурь. */
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    /** quantity × unitPrice (PO валют). */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
      onDelete: "restrict",
    }),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("purchase_order_lines_po_ix").on(t.purchaseOrderId)]
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
    documentNo: text("document_no").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    /** Хүлээн авсан өдрийн Монголбанкны албан ханш — БАРААНЫ ӨРТӨГ энүүгээр. */
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 })
      .notNull()
      .default("1"),
    rateSource: text("rate_source").notNull().default("mongolbank"),
    rateDate: text("rate_date"),
    description: text("description").notNull().default(""),
    /** "draft" | "confirmed" | "reversed" */
    status: text("status").notNull().default("draft"),
    /** Капитализацийн журнал (Dr бараа / Cr бараа материалын түр данс). */
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, {
      onDelete: "set null",
    }),
    reversalVoucherId: uuid("reversal_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("goods_receipts_org_id_document_no_ux").on(
      t.organizationId,
      t.documentNo
    ),
    index("goods_receipts_org_status_ix").on(t.organizationId, t.status),
    index("goods_receipts_po_date_ix").on(t.purchaseOrderId, t.date),
    index("goods_receipts_org_date_ix").on(t.organizationId, t.date),
  ]
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    purchaseOrderLineId: uuid("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    /** Батлахад үүссэн бараа материалын орлого (sourceType "po_receipt"). */
    movementId: uuid("movement_id").references(() => inventoryMovements.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("goods_receipt_lines_receipt_ix").on(t.receiptId),
    index("goods_receipt_lines_po_line_ix").on(t.purchaseOrderLineId),
  ]
);

// ─── Хавсралт (нийтлэг) ──────────────────────────────────────────────────────
// Үнийн санал, гэрээ, нэхэмжлэх, гаалийн мэдүүлэг г.м. баримт. Файл нь
// base64-аар DB-д (ai_attachments / компанийн лого-той ИЖИЛ загвар).
// entityType нь polymorphic тул FK байхгүй — устгалтыг модуль өөрөө хийнэ.

export const documentAttachments = pgTable(
  "document_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Хэн хавсаргасан. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    /** "purchase_order" — дараа "arap", "cash" г.м. */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /**
     * quotation | proforma | contract | invoice | packing_list |
     * bill_of_lading | customs_declaration | certificate | other —
     * лавлах шошго, кодод хаалттай жагсаалт БИШ.
     */
    kind: text("kind").notNull().default("other"),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: text("data").notNull(), // base64
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("document_attachments_org_entity_ix").on(
      t.organizationId,
      t.entityType,
      t.entityId
    ),
  ]
);

export const purchaseOrdersRelations = relations(
  purchaseOrders,
  ({ one, many }) => ({
    user: one(users, {
      fields: [purchaseOrders.userId],
      references: [users.id],
    }),
    counterparty: one(counterparties, {
      fields: [purchaseOrders.counterpartyId],
      references: [counterparties.id],
    }),
    warehouse: one(warehouses, {
      fields: [purchaseOrders.warehouseId],
      references: [warehouses.id],
    }),
    lines: many(purchaseOrderLines),
    receipts: many(goodsReceipts),
  })
);

export const purchaseOrderLinesRelations = relations(
  purchaseOrderLines,
  ({ one, many }) => ({
    purchaseOrder: one(purchaseOrders, {
      fields: [purchaseOrderLines.purchaseOrderId],
      references: [purchaseOrders.id],
    }),
    item: one(inventoryItems, {
      fields: [purchaseOrderLines.itemId],
      references: [inventoryItems.id],
    }),
    warehouse: one(warehouses, {
      fields: [purchaseOrderLines.warehouseId],
      references: [warehouses.id],
    }),
    receiptLines: many(goodsReceiptLines),
  })
);

export const goodsReceiptsRelations = relations(
  goodsReceipts,
  ({ one, many }) => ({
    purchaseOrder: one(purchaseOrders, {
      fields: [goodsReceipts.purchaseOrderId],
      references: [purchaseOrders.id],
    }),
    warehouse: one(warehouses, {
      fields: [goodsReceipts.warehouseId],
      references: [warehouses.id],
    }),
    lines: many(goodsReceiptLines),
  })
);

export const goodsReceiptLinesRelations = relations(
  goodsReceiptLines,
  ({ one }) => ({
    receipt: one(goodsReceipts, {
      fields: [goodsReceiptLines.receiptId],
      references: [goodsReceipts.id],
    }),
    purchaseOrderLine: one(purchaseOrderLines, {
      fields: [goodsReceiptLines.purchaseOrderLineId],
      references: [purchaseOrderLines.id],
    }),
    movement: one(inventoryMovements, {
      fields: [goodsReceiptLines.movementId],
      references: [inventoryMovements.id],
    }),
  })
);

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
    /** Байршил (салбар, барилга, агуулах) — картын жагсаалтад харагдана. */
    location: text("location"),
    /** Дэд байршил (давхар, өрөө, тасаг). */
    subLocation: text("sub_location"),
    // Элэгдэл эхлэх сар (YYYY-MM); идэвхжүүлэхэд заавал бөглөнө.
    depreciationStartMonth: text("depreciation_start_month"),
    /**
     * Элэгдэл эхлэх ОГНОО (YYYY-MM-DD) — ӨДРИЙН суурьт заавал. Сар дундуур
     * ашиглалтад орсон хөрөнгө тэр сард хувь тэнцүүлэн элэгдэнэ.
     * Хоосон бол элэгдэл эхлэх сарын 1-ний өдөр гэж үзнэ.
     */
    depreciationStartDate: text("depreciation_start_date"),
    /**
     * ТАТВАРЫН зорилгоорх ашиглалтын хугацаа (сар) — ААНОАТ-ын хуулийн
     * хувь хэмжээгээр (cit.md: барилга 5%, тоног төхөөрөмж/тээвэр 10%,
     * компьютер 20%). 0 = татварын элэгдэл бодохгүй.
     * Санхүүгийн (IAS 16) хугацаанаас ЗӨРӨХ нь хэвийн — зөрүү нь IAS 12
     * хойшлогдсон татварын суурь болно. GL-д ЗӨВХӨН санхүүгийнх бичигдэнэ.
     */
    taxUsefulLifeMonths: integer("tax_useful_life_months").notNull().default(0),
    /** Татварын элэгдлийн арга — ихэвчлэн шулуун шугам. */
    taxDepreciationMethod: text("tax_depreciation_method")
      .notNull()
      .default("straight_line"),
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
    // Данснаас хасалт (актлах/борлуулах/бэлэглэх) — status="disposed" үед.
    disposalType: text("disposal_type"), // "scrap" | "sale" | "donation"
    disposalDate: text("disposal_date"),
    disposalProceeds: numeric("disposal_proceeds", { precision: 18, scale: 2 }),
    disposalVoucherId: uuid("disposal_voucher_id").references(
      () => journalVouchers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fixed_assets_organization_id_code_ux").on(
      t.organizationId,
      t.code
    ),
  ]
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
  /** САНХҮҮГИЙН (IAS 16) элэгдэл — GL-д бичигдэх дүн. */
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  /**
   * ТАТВАРЫН зорилгоорх элэгдэл — МЭМО (GL-д БИЧИГДЭХГҮЙ). ААНОАТ-ын
   * тайлан ба IAS 12 хойшлогдсон татварын зөрүүг тооцоход ашиглагдана.
   */
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  /** Тухайн сард элэгдүүлсэн ӨДРИЙН тоо (өдрийн суурьт; сараар бол 0). */
  depreciatedDays: integer("depreciated_days").notNull().default(0),
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

/**
 * Үндсэн хөрөнгийн байгууллагын түвшний тохиргоо (ratified-seed хэв маяг —
 * vat_settings / payroll_settings-тэй ижил).
 */
export const faSettings = pgTable("fa_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /**
   * Элэгдлийн суурь — БҮХ хөрөнгөд нэг мөр үйлчилнэ:
   *   "monthly" — сарын тогтмол дүн (одоогийн, default)
   *   "daily"   — өдрийн хөлсөөр: тухайн сард элэгдүүлэх ӨДРИЙН тоогоор
   *               (ашиглалтад орсон/хугацаа дуусах сар хувь тэнцүүлэгдэнэ)
   */
  depreciationBasis: text("depreciation_basis").notNull().default("monthly"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("fa_settings_organization_id_ux").on(t.organizationId)]);

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
  codeHash: text("code_hash").notNull(),
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
}, (t) => [uniqueIndex("oauth_codes_code_hash_ux").on(t.codeHash)]);

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
  accessTokenHash: text("access_token_hash").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  accessExpiresAt: timestamp("access_expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
}, (t) => [
  uniqueIndex("oauth_tokens_access_token_hash_ux").on(t.accessTokenHash),
  uniqueIndex("oauth_tokens_refresh_token_hash_ux").on(t.refreshTokenHash),
]);

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
  tokenHash: text("token_hash").notNull(),
  /** Сүүлийн 4 тэмдэгт — жагсаалтад таних зорилгоор. */
  tokenHint: text("token_hint").notNull(),
  /** Дуусах хугацаа — null бол хугацаагүй (хуучин токенууд хэвээр). */
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
}, (t) => [uniqueIndex("api_tokens_token_hash_ux").on(t.tokenHash)]);

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
}, (t) => [
  // UNIQUE CONSTRAINT биш, UNIQUE INDEX — бусад хүснэгттэй ИЖИЛ шалтгаан
  // (drizzle-orm#5955): push нь `unique()` constraint-ыг "байхгүй" гэж үзээд
  // бөглөөтэй хүснэгтэд дахин нэмэхийг оролдож «truncate хийх үү?» гэж асууж
  // non-TTY preDeploy-г унагаана (2026-09-18: ai_settings 1 мөртэй болмогц
  // энэ асуулт гарч схемийн БҮХ өөрчлөлт DB-д орохгүй үлдсэн).
  // upsert-ийн `target: [userId, organizationId]` нь индекс дээр ч ажиллана.
  uniqueIndex("ai_settings_user_org_ux").on(t.userId, t.organizationId),
]);

// ─── Байгууллагын реквизит (organization profile) — нэхэмжлэх/хэвлэх толгой ──
// organizations-ийн 1:1 дагавар (satellite): нэр, ТТД, НӨАТ дугаар, хаяг,
// банкны данс, лого, тамга, гарын үсэг — зөвхөн баримт хэвлэхэд уншигдана
// (халуун зам биш). Кодод organizationProfile; ФИЗИК хүснэгтийн нэр
// "company_settings" ХЭВЭЭР — rename хийвэл drizzle-kit push нь drop+create
// гэж үзэж бодит дата (лого/тамга/банк) устгах эрсдэлтэй тул зориуд үлдээв.
export const organizationProfile = pgTable("company_settings", {
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
  /** Нэхэмжлэх илгээгч и-мэйл (verify хийгдсэн домэйн) — null бол env default. */
  invoiceFromEmail: text("invoice_from_email"),
  /** Хариу очих хаяг — null бол env default. */
  invoiceReplyTo: text("invoice_reply_to"),
  /** Илгээгч домэйн Resend дээр verify хийгдсэнийг админ баталсан эсэх —
      false үед tenant-ийн from хаягаар илгээхийг оролдохгүй (ил алдаа). */
  emailDomainVerified: boolean("email_domain_verified").notNull().default(false),
  /** «Том дүн» мэдэгдлийн босго (MNT) — null = default (D2, 10 сая ₮). */
  largeAmountAlertMnt: numeric("large_amount_alert_mnt", { precision: 18, scale: 2 }),
  /** AI/MCP/REST шууд батлах дээд хязгаар (MNT) — null = default 10 сая ₮ (§9).
      Tool-оор өсгөхөд тааз (lib/ai/post-limit.ts); вэбээс админ чөлөөтэй. */
  aiPostLimitMnt: numeric("ai_post_limit_mnt", { precision: 18, scale: 2 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("company_settings_org_id_ux").on(t.organizationId)]);

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
  token: uuid("token").notNull().defaultRandom(),
  revokedAt: timestamp("revoked_at"),
  /** Линкний дуусах хугацаа — null бол хугацаагүй (хуучин линкүүд хэвээр). */
  expiresAt: timestamp("expires_at"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  /** Линк анх нээгдсэн мөч — "Үзсэн" төлөв. */
  viewedAt: timestamp("viewed_at"),
  /** И-мэйл суваг: Resend-ийн message id — мөрдөлт/лавлагаанд. */
  messageId: text("message_id"),
}, (t) => [uniqueIndex("invoice_deliveries_token_ux").on(t.token)]);

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

// ─── POS (Борлуулалтын цэг) — docs/pos/00-proposal.md §3.2 ─────────────────────
// Бараа материал модулийн дотор. Борлуулалт бүр АР нэхэмжлэх (sourceType
// "pos") + кассын баримт(ууд) + confirmed зарлага + урьдчилсан COGS-ийг НЭГ
// транзакцад үүсгэнэ. Дансны дугаар кодод байхгүй — pos_settings-ийн рольууд.

export const posSettings = pgTable(
  "pos_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    /** Борлуулалтын орлого (барааны revenueAccountNumber override-тэй). */
    revenueAccountNumber: text("revenue_account_number").notNull().default("51100000"),
    /** Хөнгөлөлтийн contra данс — discountPosting = "contra" үед Dr. */
    discountAccountNumber: text("discount_account_number").notNull().default("51900001"),
    /** "net" (орлого цэвэр дүнгээр, IFRS 15) | "contra" (бүтэн орлого + Dr хөнгөлөлт). C3. */
    discountPosting: text("discount_posting").notNull().default("net"),
    giftCardLiabilityAccountNumber: text("gift_card_liability_account_number")
      .notNull()
      .default("31600003"),
    storeCreditLiabilityAccountNumber: text("store_credit_liability_account_number")
      .notNull()
      .default("31600004"),
    customerAdvanceAccountNumber: text("customer_advance_account_number")
      .notNull()
      .default("31300001"),
    cashOverAccountNumber: text("cash_over_account_number").notNull().default("51800002"),
    cashShortAccountNumber: text("cash_short_account_number").notNull().default("87000006"),
    roundingAccountNumber: text("rounding_account_number").notNull().default("87000007"),
    /** Харилцагчгүй борлуулалтын "Бэлэн худалдан авагч" (counterparties). */
    walkInCounterpartyId: uuid("walk_in_counterparty_id").references(() => counterparties.id, {
      onDelete: "set null",
    }),
    /** Зарлагын төрөл (COGS-ийн дебет чиглэл) — хоосон бол анхны "COGS". */
    issueTypeId: uuid("issue_type_id").references(() => inventoryIssueTypes.id, {
      onDelete: "set null",
    }),
    /** Кассын дэлгэцийн анхдагч агуулах. */
    defaultWarehouseId: uuid("default_warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    /** Борлуулах мөчид явцын дунджаар урьдчилсан COGS бичих эсэх (C2). */
    provisionalCogs: boolean("provisional_cogs").notNull().default(true),
    /** Хасах үлдэгдэлтэй борлуулалт зөвшөөрөх эсэх (D9). */
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(true),
    /** Кассчны гар хөнгөлөлтийн дээд хувь (менежерийн зөвшөөрөлгүй). */
    maxManualDiscountPercent: numeric("max_manual_discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("10"),
    /** Нийт хөнгөлөлтийн дээд хувь (stacking-ийн тааз). */
    maxTotalDiscountPercent: numeric("max_total_discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("50"),
    /** "best_single" | "cumulative" — давхцах дүрмүүдийн бодлого. */
    discountStacking: text("discount_stacking").notNull().default("best_single"),
    /** Бэлэн төлбөрийн бөөрөнхийллийн нэгж: 0 | 10 | 100 ₮. */
    cashRoundingUnit: integer("cash_rounding_unit").notNull().default(0),
    receiptHeader: text("receipt_header").notNull().default(""),
    receiptFooter: text("receipt_footer").notNull().default("Худалдан авалтад баярлалаа"),
    // ── eBarimt 3.0 (docs/pos/03-ebarimt-integration-plan.md §4.1, T1a) ──
    // Мерчантын тохиргоо харилцагчийн апп-д (Console-д биш); нууц энд байхгүй.
    /** Автомат илгээлт асаалттай эсэх — унтраалттай бол v1-ийн гар ДДТД хэвээр. */
    ebarimtEnabled: boolean("ebarimt_enabled").notNull().default(false),
    /** Мерчантын ТТД (11 эсвэл 14 орон) — ebarimt.mn порталаас. */
    ebarimtMerchantTin: text("ebarimt_merchant_tin").notNull().default(""),
    /** Салбарын дугаар (branchNo). */
    ebarimtBranchNo: text("ebarimt_branch_no").notNull().default(""),
    /** Дүүргийн код (4 орон, getBranchInfo лавлахаас). */
    ebarimtDistrictCode: text("ebarimt_district_code").notNull().default(""),
    /** Кассын дугаар (posNo) — бүртгэлтэй терминал; ээлжээс тусдаа. */
    ebarimtPosNo: text("ebarimt_pos_no").notNull().default(""),
    /** PosAPI 3.0 үйлчилгээний URL — "server" горимд серверээс, "browser" горимд кассын PC-ээс дуудагдана. */
    ebarimtPosApiUrl: text("ebarimt_pos_api_url").notNull().default("http://localhost:7080"),
    /** "server" (Railway-ийн posapi service, worker илгээнэ) | "browser" (кассын PC-ийн localhost, дэлгэц илгээнэ). */
    ebarimtMode: text("ebarimt_mode").notNull().default("server"),
    // ── QPay (docs/pos/04-qpay-integration-plan.md §3.4) — qpay-dashboard хаалгаар ──
    // Мерчантын API key / webhook secret нь ШИФРТЭЙ (lib/ai/crypto.ts encryptSecret),
    // лог/аудит/health-д ХЭЗЭЭ Ч гарахгүй. Console-д БИШ — харилцагчийн апп-д.
    qpayEnabled: boolean("qpay_enabled").notNull().default(false),
    /** qpay-dashboard-ын суурь URL (интеграторын REST v1). */
    qpayApiUrl: text("qpay_api_url").notNull().default("https://qpay-dashboard-production.up.railway.app"),
    /** Мерчантын `qpd_live_…` API key — AES-256-GCM (enc:v1:). null = тохируулаагүй. */
    qpayApiKeyEnc: text("qpay_api_key_enc"),
    /** Webhook HMAC secret (`whsec_…`) — AES-256-GCM. null = тохируулаагүй. */
    qpayWebhookSecretEnc: text("qpay_webhook_secret_enc"),
    /** Dashboard-оос уншсан мерчант id — зөвхөн харуулах (холболт шалгахад бөглөгдөнө). */
    qpayMerchantId: text("qpay_merchant_id"),
    /** Нэхэмжлэхийн хүчинтэй хугацаа (сек) — хэтэрвэл intent expired, QPay-д DELETE. */
    qpayInvoiceTtlSec: integer("qpay_invoice_ttl_sec").notNull().default(180),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pos_settings_org_id_ux").on(t.organizationId)]
);

/**
 * Төлбөрийн хэлбэрийн лавлах (D6). `kind` бүртгэлийн замыг шийднэ:
 *   cash | cash_fx | card | ewallet | transfer | credit | advance |
 *   gift_card | store_credit | bnpl
 */
export const posPaymentMethods = pgTable(
  "pos_payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** Мөнгө хүлээн авах касс/банк/түр данс (credit, advance, gift_card, store_credit-д null). */
    cashAccountId: uuid("cash_account_id").references(() => cashAccounts.id, {
      onDelete: "set null",
    }),
    currency: text("currency").notNull().default("MNT"),
    requiresReference: boolean("requires_reference").notNull().default(false),
    /** Хариулт өгөх боломжтой эсэх — зөвхөн бэлэн. */
    allowsChange: boolean("allows_change").notNull().default(false),
    allowsRefund: boolean("allows_refund").notNull().default(true),
    /** Мэдээллийн шимтгэл % — тайланд; бичилт банкны тулгалтаас. */
    feePercent: numeric("fee_percent", { precision: 5, scale: 2 }),
    /** eBarimt төлбөрийн код (payments[].code: CASH, PAYMENT_CARD …) — ТЕГ-ийн жагсаалтаас; хоосон бол тэр хэлбэртэй борлуулалт илгээгдэхгүй ([EBARIMT_UNMAPPED_PAYMENT]). Код ЗОХИОХГҮЙ. */
    ebarimtCode: text("ebarimt_code"),
    /** `ewallet` kind-ийн ПРОВАЙДЕР — "qpay" бол төлбөр QPay intent-ээр (QR) л батлагдана; null = гар лавлагаатай ewallet. */
    provider: text("provider"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pos_payment_methods_org_code_ux").on(t.organizationId, t.code)]
);

/**
 * Хөнгөлөлтийн дүрэм (D5). ruleType: line_percent | line_amount | fixed_price |
 * qty_tier | buy_x_get_y | basket_threshold | customer_group | coupon |
 * time_window. Хөдөлгөгч lib/pos/discounts.ts (цэвэр, тесттэй).
 */
export const posDiscountRules = pgTable(
  "pos_discount_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    ruleType: text("rule_type").notNull(),
    /** all | category | item | customer_group */
    scope: text("scope").notNull().default("all"),
    /** categoryCode / itemId / customerGroup — scope-оос хамаарна. */
    scopeRef: text("scope_ref"),
    /** percent | amount | fixed_price */
    valueType: text("value_type").notNull().default("percent"),
    value: numeric("value", { precision: 18, scale: 4 }).notNull().default("0"),
    minQty: numeric("min_qty", { precision: 18, scale: 4 }),
    minAmount: numeric("min_amount", { precision: 18, scale: 2 }),
    buyQty: numeric("buy_qty", { precision: 18, scale: 4 }),
    getQty: numeric("get_qty", { precision: 18, scale: 4 }),
    /** qty_tier: [{ minQty, percent?, price? }] */
    tiers: jsonb("tiers").$type<{ minQty: number; percent?: number; price?: number }[]>(),
    dateFrom: text("date_from"),
    dateTo: text("date_to"),
    timeFrom: text("time_from"), // HH:MM
    timeTo: text("time_to"),
    /** "1,2,3,4,5" — 1 = Даваа … 7 = Ням; хоосон = бүх өдөр. */
    weekdays: text("weekdays"),
    couponCode: text("coupon_code"),
    maxUsesTotal: integer("max_uses_total"),
    maxUsesPerCustomer: integer("max_uses_per_customer"),
    usedCount: integer("used_count").notNull().default(0),
    stackable: boolean("stackable").notNull().default(false),
    priority: integer("priority").notNull().default(100),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pos_discount_rules_org_code_ux").on(t.organizationId, t.code)]
);

/** Ээлж (D7): нээх → борлуулалт → хаах (тоолсон vs системийн, зөрүү). */
export const posShifts = pgTable(
  "pos_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(), // SH-YYMM-NNN
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    openedBy: text("opened_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    openingFloat: numeric("opening_float", { precision: 18, scale: 2 }).notNull().default("0"),
    closedBy: text("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at"),
    countedCash: numeric("counted_cash", { precision: 18, scale: 2 }),
    systemCash: numeric("system_cash", { precision: 18, scale: 2 }),
    varianceAmount: numeric("variance_amount", { precision: 18, scale: 2 }),
    varianceCashDocumentId: uuid("variance_cash_document_id").references(() => cashDocuments.id, {
      onDelete: "set null",
    }),
    /** Валютын кассын ээлжийн ханш — { USD: 3450 } */
    fxRates: jsonb("fx_rates").$type<Record<string, number>>(),
    status: text("status").notNull().default("open"), // "open" | "closed"
    note: text("note").notNull().default(""),
  },
  (t) => [
    uniqueIndex("pos_shifts_org_document_no_ux").on(t.organizationId, t.documentNo),
    index("pos_shifts_org_status_ix").on(t.organizationId, t.status),
  ]
);

export const posSales = pgTable(
  "pos_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentNo: text("document_no").notNull(), // POS-YYMM-NNNN (дараалсан)
    shiftId: uuid("shift_id").references(() => posShifts.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "restrict" }),
    cashierUserId: text("cashier_user_id").notNull().references(() => users.id, {
      onDelete: "restrict",
    }),
    soldAt: timestamp("sold_at").notNull().defaultNow(),
    /** УБ өдөр (YYYY-MM-DD) — периодын guard, тайлан ҮҮГЭЭР. */
    date: text("date").notNull(),
    /** Хөнгөлөлтийн өмнөх нийт (үнэ × тоо). */
    grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    discountTotal: numeric("discount_total", { precision: 18, scale: 2 }).notNull().default("0"),
    /** НӨАТ-гүй цэвэр орлого. */
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    roundingAmount: numeric("rounding_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Төлөх дүн = net + vat + rounding. */
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    arApDocumentId: uuid("ar_ap_document_id").references(() => arApDocuments.id, {
      onDelete: "restrict",
    }),
    // "posted" | "partially_returned" | "returned" | "voided"
    status: text("status").notNull().default("posted"),
    isReturn: boolean("is_return").notNull().default(false),
    /** Буцаалт бол эх борлуулалт. */
    originalSaleId: uuid("original_sale_id"),
    returnReason: text("return_reason"),
    /** ДДТД — хэсэгчилсэн буцаалтын засвар (inactiveId гинж) бүрд СҮҮЛИЙН ДДТД руу шинэчлэгдэнэ. */
    ebarimtId: text("ebarimt_id"),
    /** null | "manual" | "pending" | "sent" | "failed" | "cancelled" (lib/ebarimt/constants.ts EBARIMT_STATUSES) */
    ebarimtStatus: text("ebarimt_status"),
    /**
     * ТЕГ-ийн хариу — хэвлэсэн огноо (yyyy-MM-dd HH:mm:ss), баримтын төрөл (B2C_RECEIPT …).
     * Сугалаа (lottery) ба QR (qrData) ХАДГАЛАГДАХГҮЙ — албан спек §5 хориглодог
     * (scripts/lib/removed-schema-objects.mjs: ebarimt_lottery, ebarimt_qr_data).
     */
    ebarimtDate: text("ebarimt_date"),
    ebarimtType: text("ebarimt_type"),
    /** Худалдан авагч: иргэний eBarimt дугаар (B2C) эсвэл байгууллагын ТТД (B2B) — борлуулах мөчид бичигдэнэ. */
    ebarimtConsumerNo: text("ebarimt_consumer_no"),
    ebarimtCustomerTin: text("ebarimt_customer_tin"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_sales_org_document_no_ux").on(t.organizationId, t.documentNo),
    index("pos_sales_org_date_ix").on(t.organizationId, t.date),
    index("pos_sales_org_shift_ix").on(t.organizationId, t.shiftId),
    index("pos_sales_original_ix")
      .on(t.originalSaleId)
      .where(sql`${t.originalSaleId} is not null`),
  ]
);

export const posSaleLines = pgTable(
  "pos_sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => posSales.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    /** Барааны нэр — борлуулах мөчийнх. */
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    /** Нэгж үнэ — борлуулах мөчийнх (НӨАТ төлөгч бол орсон). */
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
    lineGross: numeric("line_gross", { precision: 18, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Дүрэм бүрийн задаргаа: [{ ruleId?, ruleCode?, kind, amount }] */
    discountDetail: jsonb("discount_detail")
      .$type<{ ruleId?: string | null; ruleCode?: string | null; kind: string; amount: number }[]>()
      .notNull()
      .default([]),
    vatMode: text("vat_mode").notNull().default("standard"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    /** Хөнгөлөлтийн дараах, НӨАТ орсон мөрийн дүн. */
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
    /** Буцаалтын мөр бол эх борлуулалтын мөр. */
    originalLineId: uuid("original_line_id"),
    arApLineId: uuid("ar_ap_line_id").references(() => arApDocumentLines.id, {
      onDelete: "set null",
    }),
    movementId: uuid("movement_id").references(() => inventoryMovements.id, {
      onDelete: "set null",
    }),
    /** Урьдчилсан COGS бичилт (байхгүй бол "өртөг хүлээж байна"). */
    provisionalCostEntryId: uuid("provisional_cost_entry_id").references(() => costEntries.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("pos_sale_lines_sale_ix").on(t.saleId), index("pos_sale_lines_item_ix").on(t.itemId)]
);

/** Баримтын түвшний хөнгөлөлт — мөрүүдэд pro-rata хуваарилагдсаны бүртгэл. */
export const posSaleDiscounts = pgTable(
  "pos_sale_discounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => posSales.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => posDiscountRules.id, { onDelete: "set null" }),
    /** auto | manual | coupon | receipt */
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
  },
  (t) => [index("pos_sale_discounts_sale_ix").on(t.saleId)]
);

export const posPayments = pgTable(
  "pos_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => posSales.id, { onDelete: "cascade" }),
    paymentMethodId: uuid("payment_method_id")
      .notNull()
      .references(() => posPaymentMethods.id, { onDelete: "restrict" }),
    /** Төлбөрийн валютаарх дүн (буцаалтад сөрөг). */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("MNT"),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }).notNull().default("1"),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }).notNull(),
    /** Бэлэн хариулт (MNT) — зөвхөн allowsChange хэлбэрт. */
    changeGiven: numeric("change_given", { precision: 18, scale: 2 }).notNull().default("0"),
    cashDocumentId: uuid("cash_document_id").references(() => cashDocuments.id, {
      onDelete: "set null",
    }),
    /** Бэлэн бус (урьдчилгаа/бэлгийн карт/кредит) settlement-ийн журнал. */
    voucherId: uuid("voucher_id").references(() => journalVouchers.id, { onDelete: "set null" }),
    reference: text("reference"),
    giftCardId: uuid("gift_card_id"),
    storeCreditId: uuid("store_credit_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("pos_payments_sale_ix").on(t.saleId)]
);

export const posGiftCards = pgTable(
  "pos_gift_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    code: text("code").notNull(),
    initialAmount: numeric("initial_amount", { precision: 18, scale: 2 }).notNull(),
    balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
    issuedSaleId: uuid("issued_sale_id").references(() => posSales.id, { onDelete: "set null" }),
    counterpartyId: uuid("counterparty_id").references(() => counterparties.id, {
      onDelete: "set null",
    }),
    expiresAt: text("expires_at"),
    status: text("status").notNull().default("active"), // active | used | expired | void
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pos_gift_cards_org_code_ux").on(t.organizationId, t.code)]
);

export const posStoreCredits = pgTable(
  "pos_store_credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
    sourceSaleId: uuid("source_sale_id").references(() => posSales.id, { onDelete: "set null" }),
    expiresAt: text("expires_at"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("pos_store_credits_cp_ix").on(t.organizationId, t.counterpartyId)]
);

/**
 * eBarimt илгээлтийн ДАРААЛАЛ (docs/pos/03-ebarimt-integration-plan.md §4.4).
 * Борлуулалт батлагдмагц commit-ийн ДАРАА мөр үүсч, worker (server горим)
 * эсвэл кассын дэлгэц (browser горим) PosAPI-д илгээнэ. Борлуулалт ХЭЗЭЭ Ч
 * илгээлтээс болж зогсохгүй; амжилтгүй бол backoff-оор дахин оролдоно,
 * шалтгаан нь lastError-д ил.
 *   kind:   "send" (баримт үүсгэх) | "cancel" (эх ДДТД-г цуцлах — буцаалт)
 *   status: "pending" | "claimed" (worker авсан түр төлөв) | "sent" | "failed" | "cancelled"
 * Идемпотент: нэг борлуулалтад нэг ХҮЛЭЭГДЭЖ БУЙ send / cancel (partial unique
 * INDEX — constraint биш, #5955); аль хэдийн sent борлуулалтад send дахин
 * ирвэл prepare үед дуудлагагүйгээр sent болно.
 */
export const posEbarimtSubmissions = pgTable(
  "pos_ebarimt_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => posSales.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("send"),
    status: text("status").notNull().default("pending"),
    /** PosAPI-д илгээх JSON (receipt.ts-ээр үүссэн) — дахин илгээхэд ижил. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** PosAPI-ийн сүүлийн хариу (амжилт/алдаа хоёуланд) — аудит. */
    response: jsonb("response").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_ebarimt_submissions_active_ux")
      .on(t.saleId, t.kind)
      .where(sql`${t.status} in ('pending', 'claimed')`),
    index("pos_ebarimt_submissions_org_status_ix").on(t.organizationId, t.status, t.nextAttemptAt),
  ]
);

/**
 * QPay төлбөрийн INTENT (docs/pos/04-qpay-integration-plan.md §3.3) — борлуулалт
 * төлбөр батлагдтал ҮҮСДЭГГҮЙ тул QPay нэхэмжлэх, QR, сагсны snapshot энд түр
 * амьдарна: open → paid (webhook / check) → finalized (createPosSale) | cancelled |
 * expired | failed. `paid` боловч `saleId` null = мөнгө орсон ч борлуулалт
 * бүртгэгдээгүй — attention дохио, жагсаалтын «QPay хүлээгдэж буй».
 */
export const posQpayIntents = pgTable(
  "pos_qpay_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    shiftId: uuid("shift_id").references(() => posShifts.id, { onDelete: "set null" }),
    cashierUserId: text("cashier_user_id").references(() => users.id, { onDelete: "set null" }),
    /** QPay-ээр төлөх дүн (MNT, бүхэл). */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** createPosSale-ийн бүтэн оролт (payments, buyer орсон) — дараа нь finalize хийхэд replay. */
    cartSnapshot: jsonb("cart_snapshot").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("open"),
    /** Dashboard/QPay нэхэмжлэхийн id (Quick QR `id`). */
    qpayInvoiceId: text("qpay_invoice_id"),
    qrText: text("qr_text"),
    /** base64 PNG — finalized/expired/cancelled болмогц null-дана (хэмжээ). */
    qrImage: text("qr_image"),
    /** Банкны deeplink-үүд [{name, logo, link}]. */
    urls: jsonb("urls").$type<{ name: string; logo: string; link: string }[]>(),
    paymentId: text("payment_id"),
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }),
    paidAt: timestamp("paid_at"),
    expiresAt: timestamp("expires_at").notNull(),
    saleId: uuid("sale_id").references(() => posSales.id, { onDelete: "set null" }),
    /** Сүүлийн гар/автомат `payments/check` дуудлага — QPay-руу ≤ 1/10 сек. */
    lastCheckAt: timestamp("last_check_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_qpay_intents_org_invoice_ux")
      .on(t.organizationId, t.qpayInvoiceId)
      .where(sql`${t.qpayInvoiceId} is not null`),
    index("pos_qpay_intents_org_status_ix").on(t.organizationId, t.status, t.createdAt),
  ]
);

export const posQpayIntentsRelations = relations(posQpayIntents, ({ one }) => ({
  sale: one(posSales, { fields: [posQpayIntents.saleId], references: [posSales.id] }),
  shift: one(posShifts, { fields: [posQpayIntents.shiftId], references: [posShifts.id] }),
}));

export const posEbarimtSubmissionsRelations = relations(posEbarimtSubmissions, ({ one }) => ({
  sale: one(posSales, { fields: [posEbarimtSubmissions.saleId], references: [posSales.id] }),
}));

export const posSalesRelations = relations(posSales, ({ one, many }) => ({
  lines: many(posSaleLines),
  payments: many(posPayments),
  discounts: many(posSaleDiscounts),
  ebarimtSubmissions: many(posEbarimtSubmissions),
  shift: one(posShifts, { fields: [posSales.shiftId], references: [posShifts.id] }),
  warehouse: one(warehouses, { fields: [posSales.warehouseId], references: [warehouses.id] }),
  counterparty: one(counterparties, {
    fields: [posSales.counterpartyId],
    references: [counterparties.id],
  }),
  cashier: one(users, { fields: [posSales.cashierUserId], references: [users.id] }),
  arApDocument: one(arApDocuments, {
    fields: [posSales.arApDocumentId],
    references: [arApDocuments.id],
  }),
}));

export const posSaleLinesRelations = relations(posSaleLines, ({ one }) => ({
  sale: one(posSales, { fields: [posSaleLines.saleId], references: [posSales.id] }),
  item: one(inventoryItems, { fields: [posSaleLines.itemId], references: [inventoryItems.id] }),
  movement: one(inventoryMovements, {
    fields: [posSaleLines.movementId],
    references: [inventoryMovements.id],
  }),
}));

export const posSaleDiscountsRelations = relations(posSaleDiscounts, ({ one }) => ({
  sale: one(posSales, { fields: [posSaleDiscounts.saleId], references: [posSales.id] }),
  rule: one(posDiscountRules, {
    fields: [posSaleDiscounts.ruleId],
    references: [posDiscountRules.id],
  }),
}));

export const posPaymentsRelations = relations(posPayments, ({ one }) => ({
  sale: one(posSales, { fields: [posPayments.saleId], references: [posSales.id] }),
  method: one(posPaymentMethods, {
    fields: [posPayments.paymentMethodId],
    references: [posPaymentMethods.id],
  }),
  cashDocument: one(cashDocuments, {
    fields: [posPayments.cashDocumentId],
    references: [cashDocuments.id],
  }),
}));

export const posShiftsRelations = relations(posShifts, ({ one, many }) => ({
  sales: many(posSales),
  cashAccount: one(cashAccounts, { fields: [posShifts.cashAccountId], references: [cashAccounts.id] }),
  warehouse: one(warehouses, { fields: [posShifts.warehouseId], references: [warehouses.id] }),
  opener: one(users, { fields: [posShifts.openedBy], references: [users.id] }),
}));

export const posPaymentMethodsRelations = relations(posPaymentMethods, ({ one }) => ({
  cashAccount: one(cashAccounts, {
    fields: [posPaymentMethods.cashAccountId],
    references: [cashAccounts.id],
  }),
}));

// ─── Мэдэгдэл (docs/notifications/00-proposal.md) ────────────────────────────
// Хэрэглэгч × байгууллага бүрд НЭГ мөр = нэг мэдэгдэл (in-app inbox). Аудитын
// мөр нь баримт (устгагдахгүй), мэдэгдэл нь хүргэлт (90/180 хоногийн дараа
// цэвэрлэгдэнэ) — тиймээс audit_events-ийг өргөтгөхгүй, тусдаа хүснэгт.
// dedupeKey нь дүрэм бүрийн «байгалийн үе» (ж: tax:vat:2026-09:3) — scheduler
// дахин ажилласан ч давхардахгүй (unique INDEX, constraint биш — #5955).
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** ХҮЛЭЭН АВАГЧ (createdBy биш). */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** lib/notifications/catalog.ts-ийн төрөл (doc.posted, tax.deadline …). */
    type: text("type").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull().default("info"), // info | warning | danger
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** Дарахад очих зам — панельгүй объектод. */
    href: text("href"),
    /** Панель нээх түлхүүр (аудитын entityType-тай ижил үгсийн сан). */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** JSON — UI/AI-д нэмэлт (дүн, огноо, харилцагч). */
    payload: text("payload"),
    /** Үйлдлийг хийсэн хүн — өөрийн үйлдлээ өөртөө мэдэгдэхгүй. */
    actorUserId: text("actor_user_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at"),
    /** И-мэйлээр илгээгдсэн цаг (instant/digest) — null: илгээгдээгүй/тохиргоо off. */
    emailedAt: timestamp("emailed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_org_user_dedupe_ux").on(
      t.organizationId,
      t.userId,
      t.dedupeKey
    ),
    index("notifications_user_org_created_ix").on(
      t.userId,
      t.organizationId,
      t.createdAt
    ),
  ]
);

// Хэрэглэгч × байгууллагын мэдэгдлийн тохиргоо (ai_settings-тэй ИЖИЛ загвар).
// Мөр байхгүй = каталогийн default (lib/notifications/catalog.ts).
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** JSON: category → { inApp: boolean, email: "off" | "instant" | "digest" }. */
    channels: text("channels"),
    /** Өдрийн нэгтгэл (digest) илгээх цаг — Улаанбаатарын цагаар. */
    digestHour: integer("digest_hour").notNull().default(8),
    /** Telegram суваг — холбогдсон chat (lib/notifications/channels/telegram.ts). */
    telegramChatId: text("telegram_chat_id"),
    /** Холболтын түр код — хэрэглэгч bot-д `/start <код>` илгээж баталгаажуулна. */
    telegramLinkCode: text("telegram_link_code"),
    /** Түр дуугүй — энэ хугацаа хүртэл мэдэгдэл үүсэхгүй. */
    mutedUntil: timestamp("muted_until"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("notification_preferences_user_org_ux").on(
      t.userId,
      t.organizationId
    ),
  ]
);

// Хуваарьт ажлын бүртгэл — (job, periodKey, org) нэг л удаа: cron route,
// in-process ticker, script гурвуул зэрэг дуудсан ч НЭГ нь л ажиллана
// (insert … on conflict do nothing returning — ялагч нэг).
export const notificationRuns = pgTable(
  "notification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** daily | digest */
    job: text("job").notNull(),
    /** YYYY-MM-DD (Улаанбаатарын өдөр). */
    periodKey: text("period_key").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    /** Үүссэн мэдэгдлийн тоо. */
    emitted: integer("emitted").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("notification_runs_job_period_org_ux").on(
      t.job,
      t.periodKey,
      t.organizationId
    ),
  ]
);

// Суваг бүрийн хүргэлт (и-мэйлээс бусад: telegram, custom/) — нэг мэдэгдэл нэг
// сувгаар нэг л удаа (unique INDEX). error = алдаа эсвэл "skipped:…" (дахин
// оролдохгүй); deliveredAt = амжилттай.
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    deliveredAt: timestamp("delivered_at"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_deliveries_notification_channel_ux").on(
      t.notificationId,
      t.channel
    ),
  ]
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
export type CostAllocation = typeof costAllocations.$inferSelect;
export type CostAllocationLine = typeof costAllocationLines.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type CashAccountPeriodBalance = typeof cashAccountPeriodBalances.$inferSelect;
export type InventoryPeriodBalance = typeof inventoryPeriodBalances.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type GoodsReceiptLine = typeof goodsReceiptLines.$inferSelect;
export type DocumentAttachment = typeof documentAttachments.$inferSelect;
export type FixedAsset = typeof fixedAssets.$inferSelect;
export type FaDepreciationEntry = typeof faDepreciationEntries.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiAttachment = typeof aiAttachments.$inferSelect;
export type AiSettings = typeof aiSettings.$inferSelect;
export type OrganizationProfile = typeof organizationProfile.$inferSelect;
export type ArApInvoiceSend = typeof arApInvoiceSends.$inferSelect;
export type InventoryCategory = typeof inventoryCategories.$inferSelect;
export type ItemPriceHistory = typeof itemPriceHistory.$inferSelect;
export type PosSettings = typeof posSettings.$inferSelect;
export type PosPaymentMethod = typeof posPaymentMethods.$inferSelect;
export type PosDiscountRule = typeof posDiscountRules.$inferSelect;
export type PosShift = typeof posShifts.$inferSelect;
export type PosSale = typeof posSales.$inferSelect;
export type PosSaleLine = typeof posSaleLines.$inferSelect;
export type PosSaleDiscount = typeof posSaleDiscounts.$inferSelect;
export type PosPayment = typeof posPayments.$inferSelect;
export type PosGiftCard = typeof posGiftCards.$inferSelect;
export type PosStoreCredit = typeof posStoreCredits.$inferSelect;
export type PosEbarimtSubmission = typeof posEbarimtSubmissions.$inferSelect;
export type PosQpayIntent = typeof posQpayIntents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

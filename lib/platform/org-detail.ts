// Байгууллагын ДЭЛГЭРЭНГҮЙ — Entry Console-ийн байгууллагын хуудсанд
// ("use server" БИШ; дуудагч нь app/api/platform/organizations route).
//
// Дүрэм: ЗӨВХӨН УНШИНА (энд засварын зам байхгүй) бөгөөд НУУЦ өгөгдөл
// буцаахгүй — нууц үгийн hash, API token, лого/тамга, бизнесийн бичилтийн
// агуулга ОРОХГҮЙ. Console нь харилцагчийн дансны ДЭВТЭР биш, удирдлагын
// самбар: тоо, төлөв, тохиргооны ТӨЛӨВ л хангалттай. Бодит өгөгдөл рүү
// хандах ганц зам нь аудитад бичигддэг дэмжлэгийн сесс (support.ts).

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountingPeriods,
  apiTokens,
  arApDocuments,
  auditEvents,
  billingPayments,
  cashAccounts,
  counterparties,
  employees,
  fixedAssets,
  inventoryItems,
  journalVouchers,
  knowledgeReads,
  moduleConfigs,
  oauthTokens,
  organizationProfile,
  organizations,
  posSettings,
  vatSettings,
} from "@/lib/db/schema";
import { listSupportSessions, loadOrgMembers } from "@/lib/platform/support-store";
import type { SupportSessionView } from "@/lib/platform/support-store";

export type PlatformOrgMember = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  emailVerified: boolean;
  joinedAt: string;
};

export type PlatformOrgDetail = {
  organizationId: string;
  name: string;
  registryNo: string | null;
  createdAt: string;
  /** Компанийн мэдээлэл (Тохиргоо → Компани) — бөглөсөн хэсэг нь л. */
  profile: {
    name: string | null;
    registerNo: string | null;
    vatPayerNo: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    bankAccountCount: number;
    hasLogo: boolean;
    hasStamp: boolean;
    invoiceFromEmail: string | null;
    emailDomainVerified: boolean;
    aiPostLimitMnt: number | null;
    largeAmountAlertMnt: number | null;
    updatedAt: string | null;
  } | null;
  members: PlatformOrgMember[];
  /** Унтраасан модулиуд (module_configs дахь is_enabled=false мөрүүд). */
  disabledModules: string[];
  settings: {
    isVatPayer: boolean | null;
    posEnabled: boolean;
    ebarimtEnabled: boolean;
  };
  usage: {
    journalVouchers: number;
    counterparties: number;
    inventoryItems: number;
    fixedAssets: number;
    cashAccounts: number;
    arApDocuments: number;
    employees: number;
    apiTokens: number;
    closedPeriods: number;
    lastClosedPeriod: string | null;
  };
  /** Сүүлийн үйл ажиллагаа — аудитын хамгийн сүүлийн мөрийн мөч. */
  lastActivityAt: string | null;
  /**
   * «AI нягтлан» (мэдлэгийн сан + MCP) хэрэглээ — Console-д худалдан авсан
   * хэрэглэгч бодитоор ашиглаж байгаа эсэхийг хянах. Зөвхөн ТОО/цаг —
   * асуултын агуулга, token хэзээ ч буцаахгүй.
   */
  aiAccountant: {
    /** Мэдлэгийн сангийн хэсэг уншсан тоо — сүүлийн 30 хоног. */
    knowledgeReads30d: number;
    lastKnowledgeReadAt: string | null;
    /** ChatGPT / Claude-ийн OAuth холболт (connector) — хүчинтэй эсэхээс үл хамааран. */
    oauthConnections: number;
    lastConnectorUseAt: string | null;
  };
  /** Багцын QPay төлбөр (сүүлийн 10) — QR, нууц БАЙХГҮЙ. */
  billingPayments: {
    id: string;
    status: string;
    planId: string;
    seats: number;
    months: number;
    amount: number;
    qpayInvoiceId: string | null;
    paidAt: string | null;
    periodEnd: string | null;
    lastError: string | null;
    createdAt: string;
  }[];
  supportSessions: SupportSessionView[];
};

export async function loadPlatformOrgDetail(
  organizationId: string
): Promise<PlatformOrgDetail | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { id: true, name: true, registryNo: true, createdAt: true },
  });
  if (!org) return null;

  const count = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    column: any
  ): Promise<number> => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(column, organizationId));
    return row?.n ?? 0;
  };

  const [
    profileRow,
    members,
    modules,
    vat,
    pos,
    journals,
    parties,
    items,
    assets,
    cash,
    arap,
    staff,
    tokens,
    closedRows,
    lastAudit,
    supportSessions,
    [knowledgeUse],
    [connectors],
    payments,
  ] = await Promise.all([
    db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, organizationId),
    }),
    loadOrgMembers(organizationId),
    db
      .select({ moduleKey: moduleConfigs.moduleKey, isEnabled: moduleConfigs.isEnabled })
      .from(moduleConfigs)
      .where(eq(moduleConfigs.organizationId, organizationId)),
    db.query.vatSettings.findFirst({
      where: eq(vatSettings.organizationId, organizationId),
      columns: { isVatPayer: true },
    }),
    db.query.posSettings.findFirst({
      where: eq(posSettings.organizationId, organizationId),
      columns: { ebarimtEnabled: true },
    }),
    count(journalVouchers, journalVouchers.organizationId),
    count(counterparties, counterparties.organizationId),
    count(inventoryItems, inventoryItems.organizationId),
    count(fixedAssets, fixedAssets.organizationId),
    count(cashAccounts, cashAccounts.organizationId),
    count(arApDocuments, arApDocuments.organizationId),
    count(employees, employees.organizationId),
    count(apiTokens, apiTokens.organizationId),
    db
      .select({ code: accountingPeriods.code })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.organizationId, organizationId),
          eq(accountingPeriods.status, "closed")
        )
      )
      .orderBy(desc(accountingPeriods.code)),
    db
      .select({ at: auditEvents.createdAt })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1),
    listSupportSessions({ organizationId, limit: 10 }),
    db
      .select({
        n: sql<number>`count(*) filter (where ${knowledgeReads.createdAt} >= now() - interval '30 days')::int`,
        last: sql<string | null>`max(${knowledgeReads.createdAt})`,
      })
      .from(knowledgeReads)
      .where(eq(knowledgeReads.organizationId, organizationId)),
    db
      .select({
        n: sql<number>`count(*)::int`,
        last: sql<string | null>`max(${oauthTokens.lastUsedAt})`,
      })
      .from(oauthTokens)
      .where(eq(oauthTokens.organizationId, organizationId)),
    db
      .select({
        id: billingPayments.id,
        status: billingPayments.status,
        planId: billingPayments.planId,
        seats: billingPayments.seats,
        months: billingPayments.months,
        amount: billingPayments.amount,
        qpayInvoiceId: billingPayments.qpayInvoiceId,
        paidAt: billingPayments.paidAt,
        periodEnd: billingPayments.periodEnd,
        lastError: billingPayments.lastError,
        createdAt: billingPayments.createdAt,
      })
      .from(billingPayments)
      .where(eq(billingPayments.organizationId, organizationId))
      .orderBy(desc(billingPayments.createdAt))
      .limit(10),
  ]);

  return {
    organizationId: org.id,
    name: org.name,
    registryNo: org.registryNo,
    createdAt: org.createdAt.toISOString(),
    profile: profileRow
      ? {
          name: profileRow.name || null,
          registerNo: profileRow.registerNo,
          vatPayerNo: profileRow.vatPayerNo,
          address: profileRow.address,
          phone: profileRow.phone,
          email: profileRow.email,
          bankAccountCount: profileRow.bankAccounts?.length ?? 0,
          hasLogo: Boolean(profileRow.logo),
          hasStamp: Boolean(profileRow.stamp),
          invoiceFromEmail: profileRow.invoiceFromEmail,
          emailDomainVerified: profileRow.emailDomainVerified,
          aiPostLimitMnt: profileRow.aiPostLimitMnt ? Number(profileRow.aiPostLimitMnt) : null,
          largeAmountAlertMnt: profileRow.largeAmountAlertMnt
            ? Number(profileRow.largeAmountAlertMnt)
            : null,
          updatedAt: profileRow.updatedAt?.toISOString() ?? null,
        }
      : null,
    members: members.map((row) => ({
      userId: row.userId,
      name: row.name ?? null,
      email: row.email ?? null,
      role: row.role,
      emailVerified: Boolean(row.emailVerifiedAt),
      joinedAt: row.joinedAt.toISOString(),
    })),
    disabledModules: modules.filter((row) => !row.isEnabled).map((row) => row.moduleKey),
    settings: {
      isVatPayer: vat ? Boolean(vat.isVatPayer) : null,
      posEnabled: Boolean(pos),
      ebarimtEnabled: Boolean(pos?.ebarimtEnabled),
    },
    usage: {
      journalVouchers: journals,
      counterparties: parties,
      inventoryItems: items,
      fixedAssets: assets,
      cashAccounts: cash,
      arApDocuments: arap,
      employees: staff,
      apiTokens: tokens,
      closedPeriods: closedRows.length,
      lastClosedPeriod: closedRows[0]?.code ?? null,
    },
    lastActivityAt: lastAudit[0]?.at?.toISOString() ?? null,
    aiAccountant: {
      knowledgeReads30d: knowledgeUse?.n ?? 0,
      lastKnowledgeReadAt: isoOrNull(knowledgeUse?.last),
      oauthConnections: connectors?.n ?? 0,
      lastConnectorUseAt: isoOrNull(connectors?.last),
    },
    billingPayments: payments.map((row) => ({
      ...row,
      paidAt: row.paidAt?.toISOString() ?? null,
      periodEnd: row.periodEnd?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    supportSessions,
  };
}

/** Raw `sql` max(timestamp) нь драйвераас string эсвэл Date ирдэг — ISO болгоно. */
function isoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

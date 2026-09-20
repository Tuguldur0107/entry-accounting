import Link from "next/link";
import { auth, getSupportBanner, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { EAMark, EAWordmark } from "@/components/auth/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { SoundToggle } from "@/components/layout/sound-toggle";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { HeaderReportSelect } from "@/components/layout/header-report-select";
import { PeriodFilter } from "@/components/periods/period-filter";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { getMyOrgs } from "@/lib/actions/org";
import { getPeriodSelection } from "@/lib/periods/selection";
import { QuickCreate } from "@/components/layout/quick-create";
import { QuickNav } from "@/components/layout/quick-nav";
import { AiChatButton } from "@/components/layout/ai-chat-button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { EmailVerifyBanner } from "@/components/layout/email-verify-banner";
import { SubscriptionBanner } from "@/components/layout/subscription-banner";
import { SupportBanner } from "@/components/layout/support-banner";
import { getEntitlements } from "@/lib/billing/load";
import { NavVisibilityProvider } from "@/components/layout/nav-visibility";
import {
  disabledNavItemKeys,
  disabledNavModuleIds,
} from "@/components/layout/modules";
import { PanelHost } from "@/components/panel/panel-host";
import { db } from "@/lib/db";
import { memberships, moduleConfigs, notifications, users } from "@/lib/db/schema";
import type { MembershipRole } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { APP_MODULE_DEFS } from "@/lib/constants/app-modules";
import { effectiveLevel } from "@/lib/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Системийн хэмжээний периодын сонголт (cookie) — topbar-ийн шүүлтүүрт.
  const periodSelection = await getPeriodSelection();
  // Фаз 01: идэвхтэй байгууллага + сонголтын жагсаалт (personal org
  // байхгүй бол энд автоматаар үүснэ — getActiveOrg-ийн safety net).
  const { activeOrgId, orgs } = await getMyOrgs();
  // Платформын дэмжлэгийн сесс (Console-оос олгогдсон) — идэвхтэй үед
  // топбарын доор ил баннер гарна (lib/platform/support.ts).
  const support = await getSupportBanner();

  // Модулийн тохиргоо → навигацийн харагдац: унтраасан модуль switcher,
  // палитр, "+ Шинэ" цэснээс нуугдана (Тохиргоо → Модулийн тохиргоо).
  // Дээр нь гишүүний "Байхгүй" эрхтэй модулиуд мөн нуугдана
  // (Тохиргоо → Хэрэглэгчдийн эрх) — бодит хамгаалалт нь server action-ы
  // requireModuleAction, энэ нь зөвхөн харагдац.
  const [modConfigs, myMembership, [unreadRow], me, entitlements] = await Promise.all([
    db.query.moduleConfigs.findMany({
      where: eq(moduleConfigs.organizationId, activeOrgId),
      columns: { moduleKey: true, isEnabled: true },
    }),
    db.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, activeOrgId),
        eq(memberships.userId, session.user.id!)
      ),
      columns: { role: true, permissions: true },
    }),
    // Топбарын хонхны анхны тоолуур — client 60 сек тутам шинэчилнэ.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, activeOrgId),
          eq(notifications.userId, session.user.id!),
          isNull(notifications.readAt)
        )
      ),
    // И-мэйл баталгаажуулалтын баннер (нэвтрэлтийг хаахгүй).
    db.query.users.findFirst({
      where: eq(users.id, session.user.id!),
      columns: { email: true, emailVerifiedAt: true },
    }),
    // Багцын баннер (trial/grace/read-only) — dedicated горимд DB хөндөхгүй.
    getEntitlements(activeOrgId),
  ]);

  const memberHiddenNavIds = myMembership
    ? APP_MODULE_DEFS.filter(
        (def) =>
          def.navId &&
          effectiveLevel(
            myMembership.role as MembershipRole,
            myMembership.permissions,
            def.key
          ) === "none"
      ).map((def) => def.navId!)
    : [];
  // Модуль бүхэлдээ биш, ЦЭС нуух түлхүүрүүд (ModuleItem.configKey — POS нь
  // Бараа материалын дотор): "item:<configKey>" хэлбэрээр нэг жагсаалтад.
  const memberHiddenItemKeys = myMembership
    ? APP_MODULE_DEFS.filter(
        (def) =>
          !def.navId &&
          effectiveLevel(
            myMembership.role as MembershipRole,
            myMembership.permissions,
            def.key
          ) === "none"
      ).map((def) => def.key)
    : [];
  const hiddenModuleIds = [
    ...new Set([
      ...disabledNavModuleIds(modConfigs),
      ...memberHiddenNavIds,
      ...[...disabledNavItemKeys(modConfigs), ...memberHiddenItemKeys].map(
        (key) => `item:${key}`
      ),
    ]),
  ];

  return (
    <NavVisibilityProvider disabledModuleIds={hiddenModuleIds}>
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header
        className="ea-glass shrink-0"
        style={{
          borderBottom: "1px solid var(--ea-border)",
          zIndex: 10,
        }}
      >
        <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2 md:flex-nowrap md:gap-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <div className="md:hidden">
              <SidebarToggle />
            </div>
            {/* Global brand — module / page context lives in the sidebar
                (module switcher) so the header stays constant app-wide. */}
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2.5"
              style={{ textDecoration: "none" }}
              aria-label="Entry Accounting — нүүр"
            >
              <EAMark size={26} />
              <span className="hidden md:inline">
                <EAWordmark size={16} />
              </span>
            </Link>
          </div>
          <div className="order-3 flex w-full items-center gap-2 md:order-none md:w-auto md:flex-1 md:justify-end">
            <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
            <PeriodFilter
              initialPeriodCode={periodSelection.periodCode}
              initialScope={periodSelection.scope}
              today={periodSelection.today}
            />
            <HeaderReportSelect />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <QuickCreate />
            <AiChatButton />
            <NotificationBell initialUnread={unreadRow?.n ?? 0} />
            <SoundToggle />
            <ThemeToggle />
            <span className="hidden text-sm sm:inline" style={{ color: "var(--ea-text-3)" }}>
              {session.user.name}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="ea-interactive rounded border border-transparent px-3 py-1.5 text-sm"
                style={{
                  color: "var(--ea-text-3)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Гарах
              </button>
            </form>
          </div>
        </div>
      </header>
      {me && !me.emailVerifiedAt ? <EmailVerifyBanner email={me.email} /> : null}
      {support ? (
        <SupportBanner orgName={support.orgName} role={support.role} endsAt={support.endsAt} />
      ) : null}
      <SubscriptionBanner entitlements={entitlements} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5 md:px-6 md:py-8">{children}</main>
      </div>
      {/* Ажлын панелиуд — олон зэрэг нээгдэж, доод докоор сэлгэнэ */}
      <PanelHost />
      {/* "/" палитр + "?" товчлолын тусламж — глобал keyboard навигаци */}
      <QuickNav />
    </div>
    </NavVisibilityProvider>
  );
}

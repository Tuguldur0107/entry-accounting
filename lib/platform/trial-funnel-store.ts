// Туршилтын funnel-ийн DB давхарга — "use server" БИШ (дуудагч нь
// /api/platform/trial-funnel). Когортын байгууллага бүрд алхмын АНХНЫ огноог
// НЭГ асуулгаар (индекстэй organization_id шүүлтүүр) уншина; шийдвэр нь ЦЭВЭР
// trial-funnel.ts-д.

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { DEMO_ORG_NAME } from "@/lib/onboarding/first-run";
import {
  buildTrialFunnel,
  type FunnelProduct,
  type TrialFunnel,
  type TrialFunnelOrg,
} from "./trial-funnel";

type RawRow = {
  id: string;
  name: string;
  created_at: Date | string;
  plan_id: string | null;
  sub_status: string | null;
  first_org_of_owner: boolean;
  connected_at: Date | string | null;
  master_data_at: Date | string | null;
  first_journal_at: Date | string | null;
  paid_at: Date | string | null;
  welcome_dismissed: boolean;
};

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** from/to нь YYYY-MM-DD (хамруулсан), parseFunnelRange-ээр шалгагдсан. */
export async function loadTrialFunnel(input: {
  from: string;
  to: string;
  product: FunnelProduct;
}): Promise<TrialFunnel> {
  // Raw sql-д Date ШУУД параметр болохгүй (CLAUDE.md §5c) — огноог текстээр.
  const rows = (await db.execute(sql`
    select
      o.id,
      o.name,
      o.created_at,
      s.plan_id,
      s.status as sub_status,
      -- Эзэн нь ЭНЭ байгууллагаас ӨМНӨ өөр байгууллага эзэмшиж байсан бол шинэ бүртгэл биш.
      not exists (
        select 1
        from memberships mo
        join memberships mp on mp.user_id = mo.user_id and mp.role = 'owner' and mp.organization_id <> o.id
        join organizations op on op.id = mp.organization_id and op.created_at < o.created_at
        where mo.organization_id = o.id and mo.role = 'owner'
      ) as first_org_of_owner,
      least(
        (select min(t.created_at) from oauth_tokens t where t.organization_id = o.id),
        (select min(t.created_at) from api_tokens t where t.organization_id = o.id)
      ) as connected_at,
      -- Системийн seed харилцагч (POS «Бэлэн худалдан авагч», цалингийн «Ажилчид»)
      -- хэрэглэгчийн оруулсан мастер дата биш.
      least(
        (select min(c.created_at) from counterparties c
          where c.organization_id = o.id
            and c.id not in (select ps.walk_in_counterparty_id from pos_settings ps
                             where ps.organization_id = o.id and ps.walk_in_counterparty_id is not null)
            and c.id not in (select py.employee_counterparty_id from payroll_settings py
                             where py.organization_id = o.id and py.employee_counterparty_id is not null)),
        (select min(i.created_at) from inventory_items i where i.organization_id = o.id),
        (select min(e.created_at) from employees e where e.organization_id = o.id)
      ) as master_data_at,
      (select min(j.created_at) from journal_vouchers j where j.organization_id = o.id) as first_journal_at,
      (select min(b.paid_at) from billing_payments b where b.organization_id = o.id and b.status = 'paid') as paid_at,
      exists (
        select 1 from memberships m join users u on u.id = m.user_id
        where m.organization_id = o.id and u.welcome_dismissed_at is not null
      ) as welcome_dismissed
    from organizations o
    left join organization_subscriptions s on s.organization_id = o.id
    where o.created_at >= ${input.from}::date
      and o.created_at < (${input.to}::date + 1)
    order by o.created_at
  `)) as unknown as RawRow[];

  const orgs: TrialFunnelOrg[] = rows.map((row) => {
    const paidAt = toDate(row.paid_at);
    const paidPlan = row.plan_id != null && row.plan_id !== "trial";
    const activeStatus = row.sub_status === "active" || row.sub_status === "past_due";
    return {
      organizationId: row.id,
      orgName: row.name,
      createdAt: toDate(row.created_at) ?? new Date(0),
      planId: row.plan_id,
      isDemo: row.name === DEMO_ORG_NAME,
      firstOrgOfOwner: row.first_org_of_owner === true,
      connectedAt: toDate(row.connected_at),
      masterDataAt: toDate(row.master_data_at),
      firstJournalAt: toDate(row.first_journal_at),
      paidAt,
      manuallyConverted: !paidAt && paidPlan && activeStatus,
      welcomeDismissed: row.welcome_dismissed === true,
    };
  });
  return buildTrialFunnel(orgs, input);
}

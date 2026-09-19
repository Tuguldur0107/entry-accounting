import { and, eq } from "drizzle-orm";

import { PayrollSettingsView } from "@/components/payroll/payroll-settings-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts } from "@/lib/db/schema";
import { loadSegmentPickerData } from "@/lib/gl/segment-picker-data";
import { loadPayrollSettingsView } from "@/lib/actions/payroll";

export default async function PayrollSettingsPage() {
  const { orgId } = await getActiveOrg();

  const [settings, glAccounts, segmentData] = await Promise.all([
    loadPayrollSettingsView(),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
      columns: { number: true, name: true },
    }),
    loadSegmentPickerData(orgId),
  ]);

  return (
    <PayrollSettingsView
      settings={settings}
      glAccounts={glAccounts}
      activeSegIds={segmentData.activeSegIds}
      segmentOptions={segmentData.segmentOptions}
      defaultSegments={segmentData.defaultSegments}
    />
  );
}

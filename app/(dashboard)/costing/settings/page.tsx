import { and, eq } from "drizzle-orm";

import {
  CostingSettingsView,
  type CostComponentRow,
  type CostingSettingRow,
  type IssueTypeRow,
} from "@/components/costing/costing-settings-view";
import { getActiveOrg } from "@/lib/auth";
import {
  loadCostComponents,
  loadCostingAccountSettings,
  loadIssueTypes,
} from "@/lib/costing/master-data";
import { db } from "@/lib/db";
import { chartOfAccounts, costingItemSettings } from "@/lib/db/schema";
import { loadInventoryBase } from "@/lib/inventory/load-data";
import { loadSegmentPickerData } from "@/lib/gl/segment-picker-data";

export default async function CostingSettingsPage() {
  const { orgId } = await getActiveOrg();

  const [
    { itemViews },
    settings,
    glAccounts,
    segmentData,
    accountRoles,
    issueTypes,
    components,
  ] = await Promise.all([
    loadInventoryBase(orgId),
    db.query.costingItemSettings.findMany({
      where: eq(costingItemSettings.organizationId, orgId),
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    loadSegmentPickerData(orgId),
    loadCostingAccountSettings(orgId),
    loadIssueTypes(orgId),
    loadCostComponents(orgId),
  ]);

  const settingByItem = new Map(settings.map((s) => [s.itemId, s]));
  const rows: CostingSettingRow[] = itemViews.map((item) => {
    const setting = settingByItem.get(item.id);
    return {
      itemId: item.id,
      itemLabel: `${item.code} · ${item.name}`,
      inventoryAccountNumber: setting?.inventoryAccountNumber ?? "14000001",
      cogsAccountNumber: setting?.cogsAccountNumber ?? "61100000",
    };
  });

  const issueTypeRows: IssueTypeRow[] = issueTypes.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    destinationClass: type.destinationClass,
    debitAccountSource: type.debitAccountSource,
    debitAccountNumber: type.debitAccountNumber,
    isActive: type.isActive,
  }));

  const componentRows: CostComponentRow[] = components.map((component) => ({
    id: component.id,
    code: component.code,
    name: component.name,
    classification: component.classification,
    accountNumber: component.accountNumber,
    isActive: component.isActive,
  }));

  return (
    <CostingSettingsView
      rows={rows}
      issueTypes={issueTypeRows}
      components={componentRows}
      accountRoles={{
        clearingAccountNumber: accountRoles.clearingAccountNumber,
        apClearingAccountNumber: accountRoles.apClearingAccountNumber,
        adjustmentGainAccountNumber: accountRoles.adjustmentGainAccountNumber,
        adjustmentLossAccountNumber: accountRoles.adjustmentLossAccountNumber,
        nrvExpenseAccountNumber: accountRoles.nrvExpenseAccountNumber,
        nrvReserveAccountNumber: accountRoles.nrvReserveAccountNumber,
      }}
      openPoCloseMode={accountRoles.openPoCloseMode === "warn" ? "warn" : "block"}
      glAccounts={glAccounts.map((account) => ({
        number: account.number,
        name: account.name,
      }))}
      activeSegIds={segmentData.activeSegIds}
      segmentOptions={segmentData.segmentOptions}
      defaultSegments={segmentData.defaultSegments}
    />
  );
}

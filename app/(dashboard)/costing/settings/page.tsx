import { and, eq } from "drizzle-orm";

import {
  CostingSettingsView,
  type CostingSettingRow,
} from "@/components/costing/costing-settings-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts, costingItemSettings } from "@/lib/db/schema";
import { loadInventoryBase } from "@/lib/inventory/load-data";

export default async function CostingSettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [{ itemViews }, settings, glAccounts] = await Promise.all([
    loadInventoryBase(userId),
    db.query.costingItemSettings.findMany({
      where: eq(costingItemSettings.userId, userId),
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
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

  return (
    <CostingSettingsView
      rows={rows}
      glAccounts={glAccounts.map((account) => ({
        number: account.number,
        name: account.name,
      }))}
    />
  );
}

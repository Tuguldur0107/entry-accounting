import { and, eq, inArray } from "drizzle-orm";

import {
  FaDashboard,
  type FaTieOutRow,
  type NbvRow,
} from "@/components/fa/fa-dashboard";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  faDepreciationEntries,
  fixedAssets,
  journalVouchers,
} from "@/lib/db/schema";

function mainAccountOf(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

export default async function FaDashboardPage() {
  const { orgId } = await getActiveOrg();

  const [assets, entries, vouchers, accounts] = await Promise.all([
    db.query.fixedAssets.findMany({ where: eq(fixedAssets.organizationId, orgId) }),
    db.query.faDepreciationEntries.findMany({
      where: eq(faDepreciationEntries.organizationId, orgId),
    }),
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    }),
  ]);

  const postedAccum = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    postedAccum.set(
      entry.assetId,
      (postedAccum.get(entry.assetId) ?? 0) + Number(entry.amount)
    );
  }

  const active = assets.filter((asset) => asset.status === "active");
  const rows: NbvRow[] = active
    .map((asset) => {
      const cost = Number(asset.cost);
      const accumulated =
        Math.round((postedAccum.get(asset.id) ?? 0) * 100) / 100;
      return {
        assetId: asset.id,
        code: asset.code,
        name: asset.name,
        cost,
        accumulated,
        nbv: Math.round((cost - accumulated) * 100) / 100,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  // Tie-out: өртгийн данс — идэвхтэй картын Σ өртөг vs GL; хуримт. элэгдлийн
  // данс — Σ батлагдсан элэгдэл (кредит үлдэгдэл → сөрөг) vs GL.
  const subledgerByAccount = new Map<string, number>();
  for (const asset of active)
    subledgerByAccount.set(
      asset.assetAccountNumber,
      (subledgerByAccount.get(asset.assetAccountNumber) ?? 0) + Number(asset.cost)
    );
  for (const asset of assets) {
    const accum = postedAccum.get(asset.id) ?? 0;
    if (accum === 0) continue;
    subledgerByAccount.set(
      asset.accumDepAccountNumber,
      (subledgerByAccount.get(asset.accumDepAccountNumber) ?? 0) - accum
    );
  }

  const relevantAccounts = new Set(subledgerByAccount.keys());
  const glByAccount = new Map<string, number>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const main = mainAccountOf(line.accountNumber);
      if (!relevantAccounts.has(main)) continue;
      glByAccount.set(
        main,
        (glByAccount.get(main) ?? 0) + Number(line.debit) - Number(line.credit)
      );
    }
  }

  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const tieOut: FaTieOutRow[] = [...relevantAccounts].sort().map((accountNumber) => {
    const subledgerValue =
      Math.round((subledgerByAccount.get(accountNumber) ?? 0) * 100) / 100;
    const glBalance = Math.round((glByAccount.get(accountNumber) ?? 0) * 100) / 100;
    return {
      accountNumber,
      accountName: accountName.get(accountNumber) ?? "",
      subledgerValue,
      glBalance,
      difference: Math.round((glBalance - subledgerValue) * 100) / 100,
    };
  });

  return (
    <FaDashboard
      rows={rows}
      tieOut={tieOut}
      draftAssetCount={assets.filter((asset) => asset.status === "draft").length}
      draftEntryCount={entries.filter((entry) => entry.status === "draft").length}
    />
  );
}

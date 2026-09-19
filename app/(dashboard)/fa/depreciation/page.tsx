import { and, eq, inArray, lt } from "drizzle-orm";

import {
  FaDepreciationView,
  type DepreciationEntryView,
} from "@/components/fa/fa-depreciation-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { faDepreciationEntries, users } from "@/lib/db/schema";
import { basisOf, loadFaSettings } from "@/lib/fa/settings";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";

// Элэгдлийн хуудас — ЗӨВХӨН тайлант үеийн (topbar-ийн периодын сонголт)
// элэгдлийг харуулна; URL-ийн ил `period` параметр сонголтыг ДАРНА.
type SearchParams = Promise<{ period?: string }>;

export default async function FaDepreciationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId, userId } = await getActiveOrg();
  const [{ period }, selection] = await Promise.all([
    searchParams,
    getPeriodSelection(),
  ]);
  const month =
    period && isPeriodCode(period) ? period : selection.periodCode;

  const [entries, priorEntries, settings] = await Promise.all([
    // Тайлант үеийн бичилтүүд (буцаагдсаныг ч харуулж түүхийг нуухгүй).
    db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        eq(faDepreciationEntries.periodMonth, month)
      ),
      with: { asset: true },
      orderBy: (entry, { asc }) => [asc(entry.createdAt)],
    }),
    // ӨМНӨХ сарууд — хуримтлагдсан элэгдлийг гаргахад (идэвхтэй бичилт л).
    db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        lt(faDepreciationEntries.periodMonth, month),
        inArray(faDepreciationEntries.status, ["draft", "posted"])
      ),
      columns: { assetId: true, amount: true, taxAmount: true },
    }),
    loadFaSettings(orgId, userId),
  ]);

  const priorAccum = new Map<string, number>();
  const priorTaxAccum = new Map<string, number>();
  for (const row of priorEntries) {
    priorAccum.set(
      row.assetId,
      (priorAccum.get(row.assetId) ?? 0) + Number(row.amount)
    );
    priorTaxAccum.set(
      row.assetId,
      (priorTaxAccum.get(row.assetId) ?? 0) + Number(row.taxAmount)
    );
  }

  // Элэгдэл бодуулсан хэрэглэгчийн нэр — бичилт бүрийн createdBy.
  const runnerIds = [...new Set(entries.map((entry) => entry.userId))];
  const runners = runnerIds.length
    ? await db.query.users.findMany({
        where: inArray(users.id, runnerIds),
        columns: { id: true, name: true, email: true },
      })
    : [];
  const runnerName = new Map(
    runners.map((row) => [row.id, row.name || row.email || "—"])
  );

  const views: DepreciationEntryView[] = entries.map((entry) => {
    const amount = Number(entry.amount);
    const taxAmount = Number(entry.taxAmount);
    const cost = Number(entry.asset.cost);
    // Хуримтлагдсан = өмнөх сарууд + ЭНЭ сарын бичилт (буцаагдсан бол ороогүй).
    const active = entry.status !== "reversed";
    const accum =
      (priorAccum.get(entry.assetId) ?? 0) + (active ? amount : 0);
    const taxAccum =
      (priorTaxAccum.get(entry.assetId) ?? 0) + (active ? taxAmount : 0);
    return {
      id: entry.id,
      assetCode: entry.asset.code,
      assetName: entry.asset.name,
      periodMonth: entry.periodMonth,
      debitAccount: entry.asset.depExpenseAccountNumber,
      creditAccount: entry.asset.accumDepAccountNumber,
      cost,
      accumulated: Math.round(accum * 100) / 100,
      netBookValue: Math.round((cost - accum) * 100) / 100,
      amount,
      taxAmount,
      taxAccumulated: Math.round(taxAccum * 100) / 100,
      depreciatedDays: entry.depreciatedDays,
      status: entry.status,
      runBy: runnerName.get(entry.userId) ?? "—",
    };
  });

  return (
    <FaDepreciationView
      entries={views}
      month={month}
      basis={basisOf(settings)}
    />
  );
}

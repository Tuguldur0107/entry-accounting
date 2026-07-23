import { and, eq, inArray } from "drizzle-orm";

import { FaAssetsView, type FixedAssetView } from "@/components/fa/fa-assets-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { faDepreciationEntries, fixedAssets } from "@/lib/db/schema";
import { loadSegmentPickerData } from "@/lib/gl/segment-picker-data";

export default async function FaAssetsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [assets, entries, segmentData] = await Promise.all([
    db.query.fixedAssets.findMany({
      where: eq(fixedAssets.userId, userId),
      orderBy: (asset, { desc }) => [desc(asset.acquisitionDate), desc(asset.createdAt)],
    }),
    // Дэлгэрэнгүй харагдацад бүх бичилт (ноорог/батлагдсан/сторно) хэрэгтэй;
    // хуримтлагдсанд зөвхөн posted-ыг тооцно.
    db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.userId, userId),
        inArray(faDepreciationEntries.status, ["draft", "posted", "reversed"])
      ),
      columns: {
        id: true,
        assetId: true,
        periodMonth: true,
        amount: true,
        status: true,
      },
      orderBy: (entry, { asc }) => [asc(entry.periodMonth)],
    }),
    loadSegmentPickerData(userId),
  ]);

  const accumByAsset = new Map<string, number>();
  const entriesByAsset = new Map<
    string,
    { id: string; periodMonth: string; amount: number; status: string }[]
  >();
  for (const entry of entries) {
    if (entry.status === "posted")
      accumByAsset.set(
        entry.assetId,
        (accumByAsset.get(entry.assetId) ?? 0) + Number(entry.amount)
      );
    const list = entriesByAsset.get(entry.assetId) ?? [];
    list.push({
      id: entry.id,
      periodMonth: entry.periodMonth,
      amount: Number(entry.amount),
      status: entry.status,
    });
    entriesByAsset.set(entry.assetId, list);
  }

  const views: FixedAssetView[] = assets.map((asset) => {
    const accumulated = Math.round((accumByAsset.get(asset.id) ?? 0) * 100) / 100;
    return {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      acquisitionDate: asset.acquisitionDate,
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod,
      depreciationStartMonth: asset.depreciationStartMonth,
      assetAccountNumber: asset.assetAccountNumber,
      accumDepAccountNumber: asset.accumDepAccountNumber,
      depExpenseAccountNumber: asset.depExpenseAccountNumber,
      status: asset.status,
      accumulated,
      netBookValue: Math.round((Number(asset.cost) - accumulated) * 100) / 100,
      entries: entriesByAsset.get(asset.id) ?? [],
    };
  });

  return (
    <FaAssetsView
      assets={views}
      activeSegIds={segmentData.activeSegIds}
      segmentOptions={segmentData.segmentOptions}
      defaultSegments={segmentData.defaultSegments}
    />
  );
}

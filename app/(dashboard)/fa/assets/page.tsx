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
    db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.userId, userId),
        inArray(faDepreciationEntries.status, ["posted"])
      ),
      columns: { assetId: true, amount: true },
    }),
    loadSegmentPickerData(userId),
  ]);

  const accumByAsset = new Map<string, number>();
  for (const entry of entries)
    accumByAsset.set(
      entry.assetId,
      (accumByAsset.get(entry.assetId) ?? 0) + Number(entry.amount)
    );

  const views: FixedAssetView[] = assets.map((asset) => ({
    id: asset.id,
    code: asset.code,
    name: asset.name,
    acquisitionDate: asset.acquisitionDate,
    cost: Number(asset.cost),
    salvageValue: Number(asset.salvageValue),
    usefulLifeMonths: asset.usefulLifeMonths,
    depreciationStartMonth: asset.depreciationStartMonth,
    assetAccountNumber: asset.assetAccountNumber,
    accumDepAccountNumber: asset.accumDepAccountNumber,
    depExpenseAccountNumber: asset.depExpenseAccountNumber,
    status: asset.status,
    accumulated: Math.round((accumByAsset.get(asset.id) ?? 0) * 100) / 100,
  }));

  return (
    <FaAssetsView
      assets={views}
      activeSegIds={segmentData.activeSegIds}
      segmentOptions={segmentData.segmentOptions}
      defaultSegments={segmentData.defaultSegments}
    />
  );
}

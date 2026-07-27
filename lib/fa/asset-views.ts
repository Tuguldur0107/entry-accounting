// Хөрөнгийн картын нэгдсэн уншигч — жагсаалтын хуудас (app/(dashboard)/fa/assets)
// болон панелийн server action (getFaAssetPanelData) хоёулаа ЭНЭ нэг
// хэрэгжилтээр уншина (query давхардуулахгүй).
//
// Дүрэм: хуримтлагдсан элэгдэлд зөвхөн posted бичилт тооцогдоно; дэлгэрэнгүй
// харагдацад бүх бичилт (ноорог/батлагдсан/буцаагдсан) харагдана.

import { and, eq, inArray, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { faDepreciationEntries, fixedAssets } from "@/lib/db/schema";

export interface FaDepreciationEntryRow {
  id: string;
  periodMonth: string;
  amount: number;
  status: string;
}

export interface FixedAssetView {
  id: string;
  code: string;
  name: string;
  acquisitionDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  depreciationMethod: string;
  custodian: string | null;
  depreciationStartMonth: string | null;
  assetAccountNumber: string;
  accumDepAccountNumber: string;
  depExpenseAccountNumber: string;
  status: string;
  accumulated: number;
  netBookValue: number;
  entries: FaDepreciationEntryRow[];
}

/**
 * Хэрэглэгчийн хөрөнгийн картууд — хуримтлагдсан элэгдэл, үлдэгдэл өртөг,
 * бичилтийн жагсаалттай нь. `assetId` өгвөл зөвхөн тэр нэг картыг уншина
 * (панелийн дэлгэрэнгүй), өгөхгүй бол бүгдийг (жагсаалтын хуудас).
 */
export async function loadFixedAssetViews(
  userId: string,
  assetId?: string
): Promise<FixedAssetView[]> {
  const entryConditions: SQL[] = [
    eq(faDepreciationEntries.userId, userId),
    inArray(faDepreciationEntries.status, ["draft", "posted", "reversed"]),
  ];
  if (assetId) entryConditions.push(eq(faDepreciationEntries.assetId, assetId));

  const [assets, entries] = await Promise.all([
    db.query.fixedAssets.findMany({
      where: assetId
        ? and(eq(fixedAssets.userId, userId), eq(fixedAssets.id, assetId))
        : eq(fixedAssets.userId, userId),
      orderBy: (asset, { desc }) => [
        desc(asset.acquisitionDate),
        desc(asset.createdAt),
      ],
    }),
    db.query.faDepreciationEntries.findMany({
      where: and(...entryConditions),
      columns: {
        id: true,
        assetId: true,
        periodMonth: true,
        amount: true,
        status: true,
      },
      orderBy: (entry, { asc }) => [asc(entry.periodMonth)],
    }),
  ]);

  const accumByAsset = new Map<string, number>();
  const entriesByAsset = new Map<string, FaDepreciationEntryRow[]>();
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

  return assets.map((asset) => {
    const accumulated =
      Math.round((accumByAsset.get(asset.id) ?? 0) * 100) / 100;
    return {
      id: asset.id,
      code: asset.code,
      name: asset.name,
      acquisitionDate: asset.acquisitionDate,
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod,
      custodian: asset.custodian,
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
}

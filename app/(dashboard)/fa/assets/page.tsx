import { FaAssetsView } from "@/components/fa/fa-assets-view";
import { auth } from "@/lib/auth";
import { loadFixedAssetViews } from "@/lib/fa/asset-views";

// Дэлгэрэнгүй болон формын панелиуд өгөгдлөө өөрсдөө server action-аар
// татдаг (getFaAssetPanelData) — хуудас зөвхөн жагсаалтын мөрүүдийг өгнө.
// Уншилт нь панелийн action-тай НЭГ хэрэгжилт: lib/fa/asset-views.ts.
export default async function FaAssetsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const assets = await loadFixedAssetViews(userId);

  return <FaAssetsView assets={assets} />;
}

import { FaAssetsView } from "@/components/fa/fa-assets-view";
import { getActiveOrg } from "@/lib/auth";
import { loadFixedAssetViews } from "@/lib/fa/asset-views";

// Дэлгэрэнгүй болон формын панелиуд өгөгдлөө өөрсдөө server action-аар
// татдаг (getFaAssetPanelData) — хуудас зөвхөн жагсаалтын мөрүүдийг өгнө.
// Уншилт нь панелийн action-тай НЭГ хэрэгжилт: lib/fa/asset-views.ts.
export default async function FaAssetsPage() {
  const { orgId } = await getActiveOrg();

  const assets = await loadFixedAssetViews(orgId);

  return <FaAssetsView assets={assets} />;
}

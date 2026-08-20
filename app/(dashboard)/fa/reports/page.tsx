import { FaReportView } from "@/components/fa/fa-report-view";
import { getActiveOrg } from "@/lib/auth";
import { loadFixedAssetViews } from "@/lib/fa/asset-views";

// ҮХ-ийн тайлан: хөрөнгийн бүртгэл (register) + элэгдлийн сарын нэгтгэл.
// Дата нь жагсаалтын хуудас/панельтай НЭГ уншигчаас (loadFixedAssetViews) —
// өртөг, хуримтлагдсан элэгдэл, үлдэгдэл өртөг ижил дүрмээр тооцогдоно.
export default async function FaReportsPage() {
  const { orgId } = await getActiveOrg();
  const assets = await loadFixedAssetViews(orgId);
  return <FaReportView assets={assets} />;
}

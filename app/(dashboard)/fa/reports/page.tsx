import { FaReportView } from "@/components/fa/fa-report-view";
import { getActiveOrg } from "@/lib/auth";
import { loadFixedAssetViews } from "@/lib/fa/asset-views";

// ҮХ-ийн тайлан: хөрөнгийн бүртгэл (register) + элэгдлийн сарын нэгтгэл.
// Дата нь жагсаалтын хуудас/панельтай НЭГ уншигчаас (loadFixedAssetViews) —
// өртөг, хуримтлагдсан элэгдэл, үлдэгдэл өртөг ижил дүрмээр тооцогдоно.
// `view` = нэг тайлангийн зүсэлт (register | months) — URL-д хадгалагдана.
type SearchParams = Promise<{ view?: string }>;

export default async function FaReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { view } = await searchParams;
  const assets = await loadFixedAssetViews(orgId);
  return <FaReportView assets={assets} view={view === "months" ? "months" : "register"} />;
}

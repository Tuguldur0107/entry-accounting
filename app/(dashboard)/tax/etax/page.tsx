// eTax («Цахим татварын систем») — НӨАТ-ын тайланг ТЕГ-д тушаахад бэлтгэх, илгээлтийн
// түүх, холболтын тохиргоо (docs/dev/etax.md). Албан API спек ирэх хүртэл тушаалт нь
// etax.mta.mn-ээс гараар, Entry-д ТЕГ-ийн дугаараар бүртгэнэ. Огноо = топбарын период
// (URL `period` дарна — системийн стандарт).

import { EtaxView } from "@/components/tax/etax-view";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEtaxPageData } from "@/lib/itc/etax/store";
import { PERMISSION_RANK } from "@/lib/permissions";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";

type SearchParams = Promise<{ period?: string }>;

export default async function EtaxPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ period }, active, selection] = await Promise.all([searchParams, requireModuleAction("tax", "read"), getPeriodSelection()]);
  const periodCode = period && isPeriodCode(period) ? period : selection.periodCode;
  const [data, access] = await Promise.all([loadEtaxPageData(active.orgId, periodCode), moduleAccess(["tax"])]);
  const isAdmin = active.role === "owner" || active.role === "admin";
  const taxLevel = PERMISSION_RANK[access.levels.tax ?? "none"];
  const canWrite = taxLevel >= PERMISSION_RANK.write;
  const canPost = taxLevel >= PERMISSION_RANK.post;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <EtaxView data={data} isAdmin={isAdmin} canWrite={canWrite} canPost={canPost} />
    </div>
  );
}

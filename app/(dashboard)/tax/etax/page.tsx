// eTax («Цахим татварын систем») — НӨАТ / ХАОАТ / ААНОАТ тайланг ТЕГ-д бэлтгэх, API-аар
// хадгалах/илгээх, илгээлтийн түүх, холболтын тохиргоо (docs/dev/etax.md). Маягт `form`
// параметр (vat | pit | cit, хуудас доторх таб = НЭГ хуудасны зүсэлт); огноо = топбарын
// период (URL `period` дарна — системийн стандарт), улирлынх сараас гарна.

import { EtaxView } from "@/components/tax/etax-view";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEtaxPageData } from "@/lib/itc/etax/store";
import { isEtaxFormKey } from "@/lib/itc/etax/constants";
import { PERMISSION_RANK } from "@/lib/permissions";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";

type SearchParams = Promise<{ period?: string; form?: string }>;

export default async function EtaxPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ period, form }, active, selection] = await Promise.all([searchParams, requireModuleAction("tax", "read"), getPeriodSelection()]);
  const periodCode = period && isPeriodCode(period) ? period : selection.periodCode;
  const formKey = isEtaxFormKey(form) ? form : "vat";
  const [data, access] = await Promise.all([loadEtaxPageData(active.orgId, periodCode, formKey), moduleAccess(["tax"])]);
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

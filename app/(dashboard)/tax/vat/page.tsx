import { getVatReturnData } from "@/lib/actions/vat";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { isPeriodCode } from "@/lib/periods/period";
import { loadTaxLedger } from "@/lib/tax/ledger";
import { TaxManager } from "@/components/tax/tax-manager";
import { VatReturnView } from "@/components/vat/vat-return-view";

// URL-ийн ил `period` параметр topbar-ийн сонголтыг ДАРНА (deep link) —
// системийн периодын шүүлтүүрийн стандарт хэв маяг.
type SearchParams = Promise<{ period?: string }>;

export default async function VatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period } = await searchParams;
  const [{ orgId }, selection] = await Promise.all([
    getActiveOrg(),
    getPeriodSelection(),
  ]);
  const periodCode =
    period && isPeriodCode(period) ? period : selection.periodCode;

  const data = await getVatReturnData(periodCode);
  // НӨАТ-ийн гаралт/оролтын дансны нийт үлдэгдэл + хуулга — тохиргооны
  // данснуудаар (сарын тайлангаас тусдаа, өнөөдрийн байдлаар).
  const ledger = await loadTaxLedger(orgId, [
    data.settings.outputVatAccountNumber,
    data.settings.inputVatAccountNumber,
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <VatReturnView periodCode={periodCode} data={data} />
      <TaxManager
        accounts={ledger.accounts.map((account, index) => ({
          ...account,
          // Гаралтын НӨАТ — өглөг (Кт), оролтын НӨАТ — авлага (Дт).
          direction: index === 0 ? ("credit" as const) : ("debit" as const),
        }))}
        entries={ledger.entries}
        payment={{
          counterMain: data.settings.outputVatAccountNumber,
          description: "НӨАТ төлөлт",
          title: "НӨАТ төлөлт",
        }}
      />
    </div>
  );
}

import { getActiveOrg } from "@/lib/auth";
import { loadTaxLedger } from "@/lib/tax/ledger";
import { loadTaxSettings } from "@/lib/tax/settings";
import { TaxManager } from "@/components/tax/tax-manager";
import {
  TaxFactRow,
  TaxGlExample,
  TaxModuleLink,
  TaxPageHeader,
  TaxSection,
  TaxStatCard,
} from "@/components/tax/tax-info";

// Суутган татвар (WHT) — лавлагаа + GL бичилтийн заавар. Төлбөрөө Өглөг /
// Мөнгөн хөрөнгө модулиар бүртгэхдээ суутгалын мөрийг журналд оруулна.
// Лавлагаа: knowledge/01-онол-хууль-стандарт/tax/wht.md.

export default async function WhtPage() {
  const { orgId, userId } = await getActiveOrg();
  // Өглөг + авлагын данс тохиргооноос (tax_settings, default 31000004/13660000).
  const settings = await loadTaxSettings(orgId, userId);
  const payableMain = settings.whtPayableAccountNumber;
  const receivableMain = settings.whtReceivableAccountNumber;
  const ledger = await loadTaxLedger(orgId, [payableMain, receivableMain]);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TaxPageHeader
          title="Суутган татвар (WHT)"
          subtitle="Төлбөр хийгч нь хүлээн авагчийн өмнөөс суутгаж, сар бүр тайлагнана."
        />
        <div className="flex gap-2">
          <TaxModuleLink href="/payables/documents" icon="document">
            Өглөгийн нэхэмжлэх
          </TaxModuleLink>
          <TaxModuleLink href="/gl/journal" icon="journal">
            Журнал бичих
          </TaxModuleLink>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label="Дотоодын суутгал"
          value="10%"
          hint="Гэрээлэгч, ногдол ашиг, роялти, хүү, түрээс"
        />
        <TaxStatCard
          label="Гадаад төлбөр"
          value="20%"
          hint="Монголд эх үүсвэртэй орлого — DTA гэрээгээр буурч болно"
        />
        <TaxStatCard
          label="Тайлан"
          value="Сар бүр"
          hint="Суутгасан татвараа дараа сард нь шилжүүлнэ"
        />
      </div>

      <TaxManager
        accounts={ledger.accounts.map((account) => ({
          ...account,
          // Өглөгийн данс Кт, авлагын данс Дт чиглэлтэй.
          direction:
            account.main === receivableMain
              ? ("debit" as const)
              : ("credit" as const),
        }))}
        entries={ledger.entries}
        payment={{
          counterMain: payableMain,
          description: "Суутган татварын төлөлт",
          title: "Суутган татварын төлөлт",
        }}
        offset={{
          debitMain: payableMain,
          description: "Суутган татвар — илүү төлөлтөөр хаах",
        }}
      />

      <TaxSection title="Суутгалын хувь хэмжээ">
        <TaxFactRow label="Бие даасан гэрээлэгч (хувь хүн)" value="10%" />
        <TaxFactRow label="Ногдол ашиг (иргэн / ААН)" value="10%" />
        <TaxFactRow label="Роялти" value="10%" />
        <TaxFactRow label="Хүү (иргэнд)" value="10%" />
        <TaxFactRow label="Үл хөдлөх хөрөнгийн түрээс (иргэнээс)" value="10%" />
        <TaxFactRow
          label="Гадаадын ААН-д төлөх (Монголд эх үүсвэртэй)"
          value="20% (DTA-гаар буурч болно)"
        />
        <TaxFactRow
          label="Давхар татварын гэрээ (DTA)"
          value="40+ улстай — ОХУ, БНХАУ, Солонгос, Япон г.м"
        />
      </TaxSection>

      <TaxSection title="GL бичилт (жишээ: гэрээлэгчид 5,000,000₮)">
        <div className="space-y-3">
          <TaxGlExample
            title="Төлбөр хийхдээ 10% суутгана:"
            lines={[
              "Dr 73100001 Үйл ажиллагааны зардал  5,000,000",
              `  Cr ${payableMain} Суутган татварын өглөг  500,000`,
              "  Cr 11000001 Банк                 4,500,000",
            ]}
          />
          <TaxGlExample
            title="Суутгасан татвараа төлөх (сар бүр):"
            lines={[
              `Dr ${payableMain} Суутган татварын өглөг / Cr 11000001 Банк`,
            ]}
          />
        </div>
      </TaxSection>
    </div>
  );
}

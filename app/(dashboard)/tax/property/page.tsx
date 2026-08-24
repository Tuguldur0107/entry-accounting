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

// Үл хөдлөх хөрөнгийн албан татвар — лавлагаа + GL бичилтийн заавар.
// Хөрөнгийн дансны үнэ Үндсэн хөрөнгө модульд бүртгэлтэй.
// Лавлагаа: knowledge/01-онол-хууль-стандарт/tax/property.md.

// Өглөг/авлагын данс tax_settings тохиргооноос (default 31000005/13660000).
// Зардлын дансыг диалог дээр хэрэглэгч сонгоно.
export default async function PropertyTaxPage() {
  const { orgId, userId } = await getActiveOrg();
  const settings = await loadTaxSettings(orgId, userId);
  const payableMain = settings.propertyPayableAccountNumber;
  const receivableMain = settings.propertyReceivableAccountNumber;
  const ledger = await loadTaxLedger(orgId, [payableMain, receivableMain]);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TaxPageHeader
          title="Хөрөнгийн татвар"
          subtitle="Газар, барилгын үл хөдлөх хөрөнгийн жилийн албан татвар."
        />
        <div className="flex gap-2">
          <TaxModuleLink href="/fa/assets" icon="fixedAsset">
            Хөрөнгийн карт
          </TaxModuleLink>
          <TaxModuleLink href="/gl/journal" icon="journal">
            Журнал бичих
          </TaxModuleLink>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label="Газар"
          value="0.1–1%"
          hint="Газрын үнэлгээнээс, байршлаас хамаарна"
        />
        <TaxStatCard
          label="Барилга"
          value="0.6%"
          hint="Дансны үнээс (ердийн хувь)"
        />
        <TaxStatCard
          label="Тооцох суурь"
          value="Дансны үнэ / үнэлгээ"
          hint="Хөрөнгийн картын дансны үнэ × хувь"
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
          description: "Хөрөнгийн татварын төлөлт",
          title: "Хөрөнгийн татварын төлөлт",
        }}
        offset={{
          debitMain: payableMain,
          description: "Хөрөнгийн татвар — илүү төлөлтөөр хаах",
        }}
        accrual={{
          debitMain: "",
          creditMain: payableMain,
          description: "Хөрөнгийн татварын тооцоо",
        }}
      />

      <TaxSection title="Хувь хэмжээ">
        <TaxFactRow label="Газар" value="Үнэлгээний 0.1–1% (байршлаас хамаарна)" />
        <TaxFactRow label="Барилга" value="Дансны үнийн 0.6%" />
        <TaxFactRow
          label="Орон сууц"
          value="Тодорхой хэмжээнээс давсан бол 0.6%"
        />
        <TaxFactRow label="Төлөгч" value="Эзэмшигч (ААН — FA бүртгэлээс)" />
      </TaxSection>

      <TaxSection title="GL бичилт">
        <div className="space-y-3">
          <TaxGlExample
            title="Жилийн эцэст тооцох:"
            lines={[
              `Dr [зардлын данс — өөрөө сонгоно] / Cr ${payableMain} Хөрөнгийн татварын өглөг`,
            ]}
          />
          <TaxGlExample
            title="Төлөх:"
            lines={[`Dr ${payableMain} Хөрөнгийн татварын өглөг / Cr 11000001 Банк`]}
          />
        </div>
      </TaxSection>
    </div>
  );
}

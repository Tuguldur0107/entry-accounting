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

// ААНОАТ — лавлагаа + GL бичилтийн заавар. Автомат тооцоолол одоогоор
// байхгүй: татвар ногдох орлого нь хасагдах/хасагдахгүй зардлын залруулга
// шаарддаг тул нягтлан бодогч журналаа гараар бичнэ (Ерөнхий журнал).
// Лавлагаа: knowledge/01-онол-хууль-стандарт/tax/cit.md.

const CIT_EXPENSE_MAIN = "70000004";

export default async function CitPage() {
  const { orgId, userId } = await getActiveOrg();
  // Өглөг + авлагын данс тохиргооноос (tax_settings).
  const settings = await loadTaxSettings(orgId, userId);
  const payableMain = settings.citPayableAccountNumber;
  const receivableMain = settings.citReceivableAccountNumber;
  const ledger = await loadTaxLedger(orgId, [payableMain, receivableMain]);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TaxPageHeader
          title="ААНОАТ — Аж ахуйн нэгжийн орлогын албан татвар"
          subtitle="Улирлын урьдчилгаа + жилийн эцсийн тооцоо. Ашгийн суурийг Орлогын тайлангаас харна."
        />
        <div className="flex gap-2">
          <TaxModuleLink href="/gl/reports" icon="report">
            Орлогын тайлан
          </TaxModuleLink>
          <TaxModuleLink href="/gl/journal" icon="journal">
            Журнал бичих
          </TaxModuleLink>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label="Хувь хэмжээ"
          value="10% / 25%"
          hint="Татвар ногдох орлого 6 тэрбум₮ хүртэл 10%, дээш нь 25%"
        />
        <TaxStatCard
          label="Улирлын урьдчилгаа"
          value="Дараа улирлын 20"
          hint="Улирлын ашиг × татварын хувь"
        />
        <TaxStatCard
          label="Жилийн тайлан"
          value="2-р сарын 10"
          hint="Жилийн ААНОАТ − төлсөн урьдчилгаа = нэмж төлөх / буцаан авах"
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
          description: "ААНОАТ төлөлт",
          title: "ААНОАТ төлөлт",
        }}
        accrual={{
          debitMain: CIT_EXPENSE_MAIN,
          creditMain: payableMain,
          description: "ААНОАТ тооцоо",
        }}
        offset={{
          debitMain: payableMain,
          description: "ААНОАТ — урьдчилж төлсөн татвараар хаах",
        }}
      />

      <TaxSection title="Татвар ногдох орлогын бүтэц">
        <TaxFactRow label="Нийт орлого − COGS − үйл ажиллагааны зардал" value="Тайлангийн ашиг" />
        <TaxFactRow
          label="+ Хасагдахгүй зардал (буцааж нэмнэ)"
          value="Торгууль, баримтгүй зардал, лимит хэтрэлт"
        />
        <TaxFactRow
          label="Сурталчилгааны зардлын хязгаар"
          value="Орлогын 2% хүртэл хасагдана"
        />
        <TaxFactRow label="Хандивын хязгаар" value="Орлогын 1% хүртэл хасагдана" />
        <TaxFactRow
          label="Элэгдлийн зөрүү (татвар ≠ IAS 16)"
          value="IAS 12 — хойшлогдсон татвар (DTA/DTL)"
        />
      </TaxSection>

      <TaxSection title="GL бичилт">
        <div className="space-y-3">
          <TaxGlExample
            title="Улирлын урьдчилгаа төлөх:"
            lines={[
              `Dr ${receivableMain} ААНОАТ-ын авлага / Cr 11000001 Банк`,
            ]}
          />
          <TaxGlExample
            title="Жилийн эцсийн тооцоо:"
            lines={[
              `Dr 70000004 ААНОАТ зардал  / Cr ${payableMain} ААНОАТ өглөг`,
              `Dr ${payableMain} ААНОАТ өглөг   / Cr ${receivableMain} ААНОАТ-ын авлага`,
              `Dr ${payableMain} ААНОАТ өглөг   / Cr 11000001 Банк (үлдэгдэл)`,
            ]}
          />
        </div>
      </TaxSection>
    </div>
  );
}

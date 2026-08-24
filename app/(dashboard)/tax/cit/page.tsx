import { getActiveOrg } from "@/lib/auth";
import { loadTaxLedger } from "@/lib/tax/ledger";
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

// Өглөгийн данс: стандарт дансны 31000003 "Татварын өр" — диалог болон
// кассын панел дээр ил харагдаж, солигдох боломжтой prefill (нуугдмал биш).
const CIT_PAYABLE_MAIN = "31000003";
const CIT_EXPENSE_MAIN = "70000004";

export default async function CitPage() {
  const { orgId } = await getActiveOrg();
  const ledger = await loadTaxLedger(orgId, [CIT_PAYABLE_MAIN]);
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
          direction: "credit" as const,
        }))}
        entries={ledger.entries}
        payment={{
          counterMain: CIT_PAYABLE_MAIN,
          description: "ААНОАТ төлөлт",
          title: "ААНОАТ төлөлт",
        }}
        accrual={{
          debitMain: CIT_EXPENSE_MAIN,
          creditMain: CIT_PAYABLE_MAIN,
          description: "ААНОАТ тооцоо",
        }}
        offset={{
          debitMain: CIT_PAYABLE_MAIN,
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
              "Dr 18000001 Урьдчилж төлсөн зардал / Cr 11000001 Банк",
            ]}
          />
          <TaxGlExample
            title="Жилийн эцсийн тооцоо:"
            lines={[
              "Dr 70000004 ААНОАТ зардал  / Cr 31000003 ААНОАТ өглөг",
              "Dr 31000003 ААНОАТ өглөг   / Cr 18000001 Урьдчилж төлсөн зардал",
              "Dr 31000003 ААНОАТ өглөг   / Cr 11000001 Банк (үлдэгдэл)",
            ]}
          />
        </div>
      </TaxSection>
    </div>
  );
}

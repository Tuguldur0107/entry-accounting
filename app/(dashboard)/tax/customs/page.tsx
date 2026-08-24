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

// Гаалийн татвар — лавлагаа. Хувь хэмжээ нь барааны ангиллаас (БТКУС код)
// хамаардаг тул энд тогтмол хувь заагаагүй; импортын зардлууд барааны
// өртөгт капитализацлагдана (Өглөг → Бараа материал → Өртөг урсгал).

// Гаалийн татварын өглөг: стандарт дансны 31000003 "Татварын өр" —
// шууд төлбөрт; импортын урсгалд татвар нь барааны өртөгт орно.
const CUSTOMS_PAYABLE_MAIN = "31000003";

export default async function CustomsTaxPage() {
  const { orgId } = await getActiveOrg();
  const ledger = await loadTaxLedger(orgId, [CUSTOMS_PAYABLE_MAIN]);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TaxPageHeader
          title="Гаалийн татвар"
          subtitle="Импортын бараанд гаалийн байгууллагад төлөх татвар, хураамжууд."
        />
        <div className="flex gap-2">
          <TaxModuleLink href="/payables/documents" icon="document">
            Өглөгийн нэхэмжлэх
          </TaxModuleLink>
          <TaxModuleLink href="/inventory/movements" icon="inventory">
            Барааны хөдөлгөөн
          </TaxModuleLink>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label="Гаалийн татвар"
          value="Барааны ангиллаар"
          hint="БТКУС кодоос хамаарна — гаалийн тарифын хуваарь"
        />
        <TaxStatCard
          label="Импортын НӨАТ"
          value="10%"
          hint="Гаалийн үнэ + гаалийн татвар дээр тооцогдоно"
        />
        <TaxStatCard
          label="Онцгой албан татвар"
          value="Зарим бараанд"
          hint="Архи, тамхи, шатахуун г.м"
        />
      </div>

      <TaxManager
        accounts={ledger.accounts.map((account) => ({
          ...account,
          direction: "credit" as const,
        }))}
        entries={ledger.entries}
        payment={{
          counterMain: CUSTOMS_PAYABLE_MAIN,
          description: "Гаалийн татварын төлөлт",
          title: "Гаалийн татварын төлөлт",
        }}
        offset={{
          debitMain: CUSTOMS_PAYABLE_MAIN,
          creditMain: "18000001",
          description: "Гаалийн татвар — илүү төлөлтөөр хаах",
        }}
      />

      <TaxSection title="Импортын татварын бүтэц">
        <TaxFactRow
          label="Тооцох дараалал"
          value="Гаалийн үнэ → + гаалийн татвар → + онцгой → импортын НӨАТ 10%"
        />
        <TaxFactRow
          label="Гаалийн татвар, хураамж"
          value="Барааны ӨРТӨГТ капитализацлагдана"
        />
        <TaxFactRow
          label="Импортын НӨАТ"
          value="Оролтын НӨАТ-д тооцогдоно (буцаан суутгагдана)"
        />
        <TaxFactRow label="Хариуцах байгууллага" value="Гаалийн ерөнхий газар" />
      </TaxSection>

      <TaxSection title="Бүртгэлийн урсгал">
        <div className="space-y-3">
          <TaxGlExample
            title="Импортын нэхэмжлэх (Өглөг) — гаалийн татвар өртөгт орно:"
            lines={[
              "Dr 14000099 Клиринг (бараа + гаалийн татвар)",
              "Dr 13620000 НӨАТ авсан (импортын НӨАТ)",
              "  Cr 31000001 Өглөг / 11000001 Банк",
            ]}
          />
          <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
            Бараатай мөр клирингийн дансанд суух ба капитализацийг өртгийн
            модуль хийнэ (Dr бараа / Cr клиринг). Нэмэлт зардлын хуваарилалтаар
            гаалийн татварыг барааны өртөгт хуваарилна.
          </p>
        </div>
      </TaxSection>
    </div>
  );
}

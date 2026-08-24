import { getActiveOrg } from "@/lib/auth";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import { loadTaxLedger } from "@/lib/tax/ledger";
import { loadPayrollTaxMonths } from "@/lib/tax/payroll-summary";
import { PayrollTaxGrid } from "@/components/tax/payroll-tax-grid";
import { TaxManager } from "@/components/tax/tax-manager";
import {
  TaxFactRow,
  TaxGlExample,
  TaxModuleLink,
  TaxPageHeader,
  TaxSection,
  TaxStatCard,
} from "@/components/tax/tax-info";

// ХХОАТ (Хувь хүний орлогын албан татвар, хуучнаар ХАОАТ) — цалингийн
// суутгалын нэгтгэл. Тооцоолол нь Цалин модульд (lib/payroll/calc.ts,
// effective date-ээр); энд бодогдсон тоог л саруулж нэгтгэнэ.
// Лавлагаа: knowledge/01-онол-хууль-стандарт/tax/pit.md, 2026-updates.md.

export default async function PitPage() {
  const { orgId, userId } = await getActiveOrg();
  // Өглөгийн данс тохиргооноос (payroll_settings, default 31430000).
  const settings = await loadPayrollSettings(orgId, userId);
  const [months, ledger] = await Promise.all([
    loadPayrollTaxMonths(orgId),
    loadTaxLedger(orgId, [settings.pitPayableAccountNumber]),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TaxPageHeader
          title="ХХОАТ — Хувь хүний орлогын албан татвар"
          subtitle="Цалингийн суутгалын сарын нэгтгэл — тооцоолол Цалин модульд хийгдэнэ."
        />
        <TaxModuleLink href="/payroll" icon="movement">
          Цалин бодолт руу
        </TaxModuleLink>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label="Хувь хэмжээ (2026)"
          value="10% / 15% / 20%"
          hint="Шатлалт — 2025 хүртэл бүх орлогод 10% тогтмол"
        />
        <TaxStatCard
          label="Суутгалын тайлан"
          value="Дараа сарын 10"
          hint="Жилийн ТТ-11 тайлан — 2-р сарын 15"
        />
        <TaxStatCard
          label="Татваргүй босго (2026)"
          value="800,000₮/сар"
          hint="Цалингийн тохиргоогоор идэвхжинэ (хуулийн баталгаажуулалтын дараа)"
        />
      </div>

      <TaxManager
        accounts={ledger.accounts.map((account) => ({
          ...account,
          direction: "credit" as const,
        }))}
        entries={ledger.entries}
        payment={{
          counterMain: settings.pitPayableAccountNumber,
          description: "ХХОАТ төлөлт",
          title: "ХХОАТ төлөлт",
        }}
        offset={{
          debitMain: settings.pitPayableAccountNumber,
          creditMain: "18000001",
          description: "ХХОАТ — илүү төлөлтийн суутган тооцоо",
        }}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
          Сарын суутгал (цалингийн бодолтоос)
        </h2>
        {months.length === 0 ? (
          <p className="rounded-md border border-[var(--ea-border)] px-3 py-8 text-center text-xs text-[var(--ea-text-3)]">
            Цалингийн бодолт хийгдээгүй байна — Цалин модульд сарын бодолт
            хийхэд ХХОАТ-ийн суутгал энд нэгтгэгдэнэ.
          </p>
        ) : (
          <PayrollTaxGrid rows={months} variant="pit" />
        )}
      </section>

      <TaxSection title="Шатлалт хувь (2026 оноос)">
        <TaxFactRow label="Сарын татвар ногдох орлого 0 – 10,000,000₮" value="10%" />
        <TaxFactRow label="10,000,001 – 15,000,000₮" value="15%" />
        <TaxFactRow label="15,000,001₮-аас дээш" value="20%" />
        <TaxFactRow
          label="Хэн суутгана"
          value="Цалин — ажил олгогч; гэрээлэгч — төлбөр хийгч (Суутган татвар)"
        />
        <TaxFactRow
          label="Чөлөөлөгдөх орлого"
          value="Тэтгэвэр, тэтгэмж, нэг удаагийн тусламж, нөхөн олговор"
        />
      </TaxSection>

      <TaxSection title="GL бичилт (цалингийн журналын хэсэг)">
        <TaxGlExample
          title="Сарын цалингийн журналд ХХОАТ өглөг мөрөөр орно:"
          lines={[
            "Dr 72100000 Цалингийн зардал",
            "  Cr 31430000 ХАОАТ өглөг      ← суутгасан ХХОАТ",
            "  Cr 31500001 Цалингийн өглөг",
            "",
            "Төлөх (дараа сарын 10 дотор):",
            "Dr 31430000 ХАОАТ өглөг / Cr 11000001 Банк",
          ]}
        />
      </TaxSection>
    </div>
  );
}

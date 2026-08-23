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

// НДШ — нийгмийн даатгалын шимтгэлийн нэгтгэл. Тооцоолол (cap, хувь) нь
// Цалин модульд payroll_settings-ээс effective date-ээр хийгдэнэ.
// Лавлагаа: knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/, tax/2026-updates.md.

export default async function NdshPage() {
  const { orgId, userId } = await getActiveOrg();
  // Өглөгийн данс тохиргооноос (payroll_settings, default 31420000).
  const settings = await loadPayrollSettings(orgId, userId);
  const [months, ledger] = await Promise.all([
    loadPayrollTaxMonths(orgId),
    loadTaxLedger(orgId, [settings.siPayableAccountNumber]),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TaxPageHeader
          title="НДШ — Нийгмийн даатгалын шимтгэл"
          subtitle="Ажилтан + ажил олгогчийн шимтгэлийн сарын нэгтгэл — тооцоолол Цалин модульд."
        />
        <TaxModuleLink href="/payroll" icon="movement">
          Цалин бодолт руу
        </TaxModuleLink>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label="Ажилтны шимтгэл"
          value="11.5%"
          hint="Тэтгэвэр 8.5 + тэтгэмж 0.8 + ажилгүйдэл 0.2 + ЭМД 2.0"
        />
        <TaxStatCard
          label="Ажил олгогчийн шимтгэл"
          value="12.5–14.5%"
          hint="ҮОМШӨ 0.8–3.0% салбараас хамаарна"
        />
        <TaxStatCard
          label="Тайлан, төлөлт"
          value="Дараа сарын 5"
          hint="Шимтгэлийн суурийн дээд хязгаар: доод цалин × 10"
        />
      </div>

      <TaxManager
        accounts={ledger.accounts.map((account) => ({
          ...account,
          direction: "credit" as const,
        }))}
        entries={ledger.entries}
        payment={{
          counterMain: settings.siPayableAccountNumber,
          description: "НДШ төлөлт",
          title: "НДШ төлөлт",
        }}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
          Сарын шимтгэл (цалингийн бодолтоос)
        </h2>
        {months.length === 0 ? (
          <p className="rounded-md border border-[var(--ea-border)] px-3 py-8 text-center text-xs text-[var(--ea-text-3)]">
            Цалингийн бодолт хийгдээгүй байна — Цалин модульд сарын бодолт
            хийхэд НДШ энд нэгтгэгдэнэ.
          </p>
        ) : (
          <PayrollTaxGrid rows={months} variant="si" />
        )}
      </section>

      <TaxSection title="Шимтгэлийн задаргаа">
        <TaxFactRow label="Тэтгэврийн даатгал" value="8.5% + 8.5%" />
        <TaxFactRow label="Тэтгэмжийн даатгал" value="0.8% + 1.0%" />
        <TaxFactRow label="Ажилгүйдлийн даатгал" value="0.2% + 0.2%" />
        <TaxFactRow label="ЭМД" value="2.0% + 2.0%" />
        <TaxFactRow label="ҮОМШӨ (зөвхөн ажил олгогч)" value="0.8–3.0%" />
        <TaxFactRow
          label="Дээд хязгаар"
          value="Шимтгэлийн суурь ≤ доод цалин × 10"
        />
      </TaxSection>

      <TaxSection title="GL бичилт (цалингийн журналын хэсэг)">
        <TaxGlExample
          title="Сарын цалингийн журналд НДШ өглөг мөрөөр орно:"
          lines={[
            "Dr 72100000 Цалингийн зардал        ← нийт олголт",
            "Dr 72100002 НДШ зардал (ажил олгогч)",
            "  Cr 31420000 НДШ өглөг             ← ажилтан + ажил олгогч",
            "  Cr 31500001 Цалингийн өглөг",
            "",
            "Төлөх (дараа сарын 5 дотор):",
            "Dr 31420000 НДШ өглөг / Cr 11000001 Банк",
          ]}
        />
      </TaxSection>
    </div>
  );
}

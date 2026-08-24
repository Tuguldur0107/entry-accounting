"use server";

// Татварын суутган тооцооны кандидатууд — системийн БҮХ татварын дансны
// (НӨАТ гаралт/оролт, ХХОАТ, НДШ, ААНОАТ/суутган г.м.) өнөөдрийн
// хуримтлагдсан үлдэгдэл. Товч дарахад аль данс Кт үлдэгдэлтэй (өглөг —
// Дт талд хаагдана), аль нь Дт үлдэгдэлтэй (авлага/илүү төлөлт — Кт талд)
// байгааг ЭНЭ жагсаалтаас автоматаар сонгоно. Нэгтгэл П28 уншигчаар.

import { eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts } from "@/lib/db/schema";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import { loadBalanceRowsFast } from "@/lib/reports/period-balances";
import { loadVatSettings } from "@/lib/vat/settings";

/** ААНОАТ/суутган/хөрөнгө/гаалийн өглөгийн данс — тохиргоожих хүртэл
 * татварын хуудсуудтай ИЖИЛ утга (app/(dashboard)/tax/... _PAYABLE_MAIN). */
const OTHER_TAX_PAYABLE_MAIN = "31000003";

export type TaxOffsetCandidate = {
  main: string;
  name: string;
  /** Дт − Кт хуримтлагдсан үлдэгдэл: сөрөг = өглөг, эерэг = авлага. */
  balance: number;
};

export async function getTaxOffsetCandidates(
  extraMains: string[]
): Promise<ActionResult<{ candidates: TaxOffsetCandidate[] }>> {
  try {
    const { orgId, userId } = await getActiveOrg();
    const [vat, payroll, accounts] = await Promise.all([
      loadVatSettings(orgId, userId),
      loadPayrollSettings(orgId, userId),
      db.query.chartOfAccounts.findMany({
        where: eq(chartOfAccounts.organizationId, orgId),
      }),
    ]);

    const mains = [
      ...new Set(
        [
          vat.outputVatAccountNumber,
          vat.inputVatAccountNumber,
          payroll.pitPayableAccountNumber,
          payroll.siPayableAccountNumber,
          OTHER_TAX_PAYABLE_MAIN,
          ...extraMains,
        ]
          .map((main) => (main ?? "").trim())
          .filter((main) => /^\d{8}$/.test(main))
      ),
    ];

    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const rows = await loadBalanceRowsFast(
      orgId,
      "1900-01-01",
      today,
      accounts,
      [3]
    );
    const byMain = new Map(rows.map((row) => [row.mainAccount, row]));

    return {
      candidates: mains.map((main) => {
        const row = byMain.get(main);
        return {
          main,
          name:
            row?.name ??
            accounts.find((account) => account.number === main)?.name ??
            "",
          balance: row ? row.totals.closeDebit - row.totals.closeCredit : 0,
        };
      }),
    };
  } catch (caught) {
    return actionError(
      "getTaxOffsetCandidates",
      caught,
      "Татварын дансдын үлдэгдэл ачаалж чадсангүй"
    );
  }
}

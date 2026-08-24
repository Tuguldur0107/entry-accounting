"use server";

// Татварын суутган тооцооны туслах — сонгосон дансдын өнөөдрийн хуримтлагдсан
// үлдэгдлийг диалогт үзүүлэхэд ашиглана. Нэгтгэл нь П28-ын snapshot+delta
// уншигчаар (тайлангуудтай НЭГ зам); бичилт үүсгэх нь createTaxAccrualVoucher
// (lib/actions/tax.ts) — энэ файл зөвхөн УНШИЛТ тул тусдаа (chip session
// lib/actions/tax.ts дээр зэрэг ажиллаж байгаа тул мөргөлдөөнгүй).

import { eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts } from "@/lib/db/schema";
import { loadBalanceRowsFast } from "@/lib/reports/period-balances";

export type TaxAccountBalanceView = {
  main: string;
  name: string;
  /** Дт − Кт хуримтлагдсан үлдэгдэл (өглөг данс сөрөг, авлага эерэг). */
  balance: number;
};

export async function getTaxAccountBalances(
  mains: string[]
): Promise<ActionResult<{ balances: TaxAccountBalanceView[] }>> {
  try {
    const { orgId } = await getActiveOrg();
    const wanted = [
      ...new Set(
        mains.map((main) => main.trim()).filter((main) => /^\d{8}$/.test(main))
      ),
    ];
    if (wanted.length === 0) return { balances: [] };

    const accounts = await db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    });
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
      balances: wanted.map((main) => {
        const row = byMain.get(main);
        return {
          main,
          name:
            row?.name ??
            accounts.find((account) => account.number === main)?.name ??
            "",
          balance: row
            ? row.totals.closeDebit - row.totals.closeCredit
            : 0,
        };
      }),
    };
  } catch (caught) {
    return actionError(
      "getTaxAccountBalances",
      caught,
      "Дансны үлдэгдэл ачаалж чадсангүй"
    );
  }
}

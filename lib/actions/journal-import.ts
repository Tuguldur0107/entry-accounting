"use server";

// Excel-ээс БАГЦ журнал оруулах — бүх журнал НООРОГ болж үүснэ
// (human-in-the-loop: хэрэглэгч шалгаад өөрөө Post хийнэ).
//
// Клиент урьдчилан шалгасан ч энд ДАХИН шалгана: данс идэвхтэй эсэх,
// период нээлттэй эсэх, мөрийн тоо. Баримт тус бүр бие даан амжилтлана/
// унана — нэг баримтын алдаа бусдыг унагахгүй.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts, journalLines, journalVouchers } from "@/lib/db/schema";
import { parseSegParts } from "@/lib/grid/segments";
import { ClosedPeriodError, assertPeriodOpen } from "@/lib/periods/guard";

export interface VoucherImportInput {
  voucherKey: string;
  date: string;
  description: string;
  lines: { account: string; debit: number; credit: number; description: string }[];
}

export type VoucherImportResult =
  | {
      ok: true;
      created: number;
      failures: { voucherKey: string; reason: string }[];
    }
  | { ok: false; code: "unauthenticated" | "failed" };

export async function importJournalVouchers(
  vouchers: VoucherImportInput[]
): Promise<VoucherImportResult> {
  // Excel импорт = бичилт үүсгэх мутаци — accountant+ эрх шаардана.
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireRole("accountant"));
  } catch {
    return { ok: false, code: "unauthenticated" };
  }

  try {
    const accounts = await db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      columns: { number: true },
    });
    const enabledMains = new Set(accounts.map((account) => account.number));

    let created = 0;
    const failures: { voucherKey: string; reason: string }[] = [];

    for (const voucher of vouchers) {
      const validLines = voucher.lines.filter(
        (line) => line.account && (line.debit > 0 || line.credit > 0)
      );
      if (validLines.length < 2) {
        failures.push({
          voucherKey: voucher.voucherKey,
          reason: "Журналд дор хаяж 2 мөр хэрэгтэй",
        });
        continue;
      }

      const badAccount = validLines.find(
        (line) => !enabledMains.has(parseSegParts(line.account, [3])[3] ?? "")
      );
      if (badAccount) {
        failures.push({
          voucherKey: voucher.voucherKey,
          reason: `"${badAccount.account}" данс идэвхтэй жагсаалтад алга`,
        });
        continue;
      }

      try {
        await assertPeriodOpen(orgId, voucher.date);
      } catch (error) {
        failures.push({
          voucherKey: voucher.voucherKey,
          reason:
            error instanceof ClosedPeriodError
              ? error.message
              : "Тайлант үеийн шалгалт амжилтгүй",
        });
        continue;
      }

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(journalVouchers)
          .values({
            userId,
            organizationId: orgId,
            date: voucher.date,
            description: voucher.description,
            status: "draft",
          })
          .returning();

        await tx.insert(journalLines).values(
          validLines.map((line, index) => ({
            voucherId: row.id,
            accountNumber: line.account,
            debit: String(line.debit),
            credit: String(line.credit),
            description: line.description,
            sortOrder: index,
          }))
        );
      });
      created += 1;
    }

    if (created > 0) {
      revalidatePath("/gl/journal");
      revalidatePath("/gl/reports");
    }
    return { ok: true, created, failures };
  } catch {
    return { ok: false, code: "failed" };
  }
}

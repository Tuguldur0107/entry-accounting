// Батлагдсан журналыг УЛААН СТОРНО-оор буцаах (CLAUDE.md §1) — дуудагчийн
// транзакц дотор. GL-ийн «Буцаах» (`unpostVoucherCore`) ба дэд дэвтэр өөрийн
// журналаа буцаахдаа (цалин — `reversePayrollVoucher`) НЭГ логикоор: эх
// журнал `reversed`, эх огноогоор буцаалтын журнал (ижил тал, сөрөг дүн),
// эх модулийн дугаар, аудит. Эрх, период, эзэмшлийн шалгалт ДУУДАГЧИЙН үүрэг.

import { and, eq } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import type { db } from "@/lib/db";
import { journalLines, journalVouchers } from "@/lib/db/schema";
import { stornoOf } from "@/lib/gl/storno";
import { moduleOfVoucherNo, nextVoucherNo } from "@/lib/gl/voucher-no";
import { stateChangedError } from "@/lib/state-guard";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ReversibleVoucher = {
  id: string;
  date: string;
  description: string;
  documentNo: string | null;
  lines: {
    accountNumber: string;
    debit: string;
    credit: string;
    description: string | null;
  }[];
};

/** Буцаалтын журналын ID-г буцаана. Эх журнал батлагдсан биш бол `[STATE_CHANGED]`. */
export async function reverseVoucherInTx(
  tx: Tx,
  input: { orgId: string; userId: string; voucher: ReversibleVoucher }
): Promise<string> {
  const { orgId, userId, voucher } = input;
  const [claimed] = await tx
    .update(journalVouchers)
    .set({ status: "reversed" })
    .where(
      and(
        eq(journalVouchers.id, voucher.id),
        eq(journalVouchers.organizationId, orgId),
        eq(journalVouchers.status, "posted")
      )
    )
    .returning({ id: journalVouchers.id });
  if (!claimed) throw stateChangedError("Журнал");

  const [reversal] = await tx
    .insert(journalVouchers)
    .values({
      userId,
      organizationId: orgId,
      date: voucher.date,
      description: `Буцаалт: ${voucher.description}`,
      // Буцаалт нь эх журналынхаа модульд үлдэнэ (CM-ийн буцаалт CM-).
      documentNo: await nextVoucherNo(
        tx,
        orgId,
        moduleOfVoucherNo(voucher.documentNo, "gl"),
        voucher.date
      ),
      status: "posted",
      // Эх журналтайгаа хосолно: эхийг устгавал буцаалт FK cascade-аар
      // хамт устана; буцаалтыг дангаар устгахыг deleteVoucher хориглоно.
      reversalOfVoucherId: voucher.id,
    })
    .returning({ id: journalVouchers.id });

  await tx.insert(journalLines).values(
    voucher.lines.map((line, index) => ({
      voucherId: reversal.id,
      accountNumber: line.accountNumber,
      ...stornoOf({ debit: Number(line.debit), credit: Number(line.credit) }),
      description: line.description,
      sortOrder: index,
    }))
  );
  await logAuditEvent(
    {
      userId,
      organizationId: orgId,
      action: "unpost",
      entityType: "journal",
      entityId: voucher.id,
      summary: `Журнал буцаагдав — ${voucher.date}, ${voucher.description}, дүн ${voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0).toLocaleString("en-US")}₮`,
    },
    tx
  );
  return reversal.id;
}
